import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createLogger } from '@midnight-ntwrk/testkit-js';
import { assertFunded } from './dust.js';
import { FundedWallet } from './FundedWallet.js';
import { fundFromDeployer } from './funding.js';
import { LiveSimulatorBackend } from './LiveSimulatorBackend.js';
import { localEnv } from './network.js';
import { WALLET_SEEDS, type WalletBuilder, WalletPool } from './WalletPool.js';

/**
 * Composition root for the live backend. Runs once per worker before the unit
 * specs when `test:live` is used (on the dry path this file is not loaded).
 *
 * It owns the wiring — everything else is split by responsibility:
 *   - {@link WalletPool} builds the pooled wallets (testkit-free orchestration).
 *   - {@link FundedWallet} builds one dust-funded wallet from a seed.
 *   - {@link fundFromDeployer} tops up a signer the dev preset didn't fund.
 *   - {@link LiveSimulatorBackend} deploys per `Sim.create()` and assembles the
 *     simulator `LiveContext`.
 *
 * The local dev preset genesis-funds only three of the four pool seeds, so the
 * deployer is built first (it must be genesis-funded) and any signer that comes
 * up empty is topped up from it before the pool's readiness gate.
 *
 * Order matters: pin the process network id first (deployContract and the
 * indexer provider read it globally), register the backend, then build the
 * wallets up front so specs can read each published `MIDNIGHT_<ALIAS>_COIN_PK`
 * at module load (e.g. a forwarder's parent key, or a multisig's live signer
 * set). Top-level await; setup files are awaited before test files.
 */

setNetworkId('undeployed');

const logger = createLogger('logs/live-harness.log');
const env = localEnv();

// The deployer pays for every deploy and funds the signers, so it must be
// genesis-funded — fail fast if its seed carries no NIGHT.
const deployer = await FundedWallet.build(
  env,
  'deployer',
  WALLET_SEEDS.deployer,
  logger,
);
assertFunded('deployer', deployer.nightBalance);

// Reuse the prebuilt deployer; build each signer and top it up from the deployer
// if the preset left it unfunded, so `.as('SIGNERn')` can pay its own fees.
const buildWallet: WalletBuilder = async (alias, walletSeed) => {
  if (alias === 'deployer') return deployer;
  const wallet = await FundedWallet.build(env, alias, walletSeed, logger);
  if (!wallet.isFunded) {
    await fundFromDeployer(deployer.provider, wallet.provider, env, logger);
    await wallet.refresh();
    if (!wallet.isFunded) assertFunded(alias, wallet.nightBalance);
  }
  return wallet;
};

const pool = new WalletPool(WALLET_SEEDS, buildWallet);
const backend = new LiveSimulatorBackend(pool, env);

backend.register();
await pool.ensureReady();
