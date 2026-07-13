import { setNetworkId } from '@midnight-ntwrk/midnight-js-network-id';
import { createLogger } from '@midnight-ntwrk/testkit-js';
import { beforeAll, expect } from 'vitest';
import { assertFunded } from './dust.js';
import { FundedWallet } from './FundedWallet.js';
import { fundFromDeployer } from './funding.js';
import { LiveSimulatorBackend } from './LiveSimulatorBackend.js';
import { localEnv } from './network.js';
import {
  MAX_LIVE_WORKERS,
  type WalletBuilder,
  WalletPool,
  walletSeedsFor,
} from './WalletPool.js';

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
 * Each vitest worker drives a disjoint wallet partition keyed on its
 * `VITEST_POOL_ID` (see {@link walletSeedsFor}), so parallel `unit-live` files
 * never share a wallet's UTXOs. Every worker's deployer is a genesis-funded
 * seed; its three signers start empty and are topped up from it before the
 * pool's readiness gate.
 *
 * Order matters: pin the process network id first (deployContract and the
 * indexer provider read it globally), register the backend, then build the
 * wallets up front so specs can read each published `MIDNIGHT_<ALIAS>_COIN_PK`
 * at module load (e.g. a forwarder's parent key, or a multisig's live signer
 * set). Top-level await; setup files are awaited before test files.
 */

setNetworkId('undeployed');

// The forks pool sets `VITEST_POOL_ID` to 1..maxWorkers before setup files
// load; it is this worker's partition index. Defaults to 1 on a non-forked run.
const worker = Number(process.env.VITEST_POOL_ID ?? '1');
if (!Number.isInteger(worker) || worker < 1 || worker > MAX_LIVE_WORKERS) {
  throw new Error(
    `live setup: VITEST_POOL_ID='${process.env.VITEST_POOL_ID}' is outside ` +
      `1..${MAX_LIVE_WORKERS}. The wallet partition only has ${MAX_LIVE_WORKERS} ` +
      'genesis-funded deployers — lower MIDNIGHT_LIVE_WORKERS, and check that ' +
      "VITEST_MAX_WORKERS isn't overriding the configured worker count.",
  );
}

// Total configured live workers (resolved and published by vitest.config).
// Shown in the per-worker banner and the per-file tag below.
const totalWorkers = Number(
  process.env.MIDNIGHT_LIVE_WORKERS ?? MAX_LIVE_WORKERS,
);

// Per-file worker pointer: tag each spec file with the worker running it, so
// interleaved output from parallel workers stays attributable. A setup-file
// `beforeAll` fires once before each spec file's suite.
beforeAll(() => {
  const testPath = (expect.getState?.().testPath ?? '') as string;
  const file = testPath ? (testPath.split('/').pop() ?? testPath) : '(spec)';
  console.log(`[w${worker}] ❯ ${file}`);
});

const seeds = walletSeedsFor(worker);
const logger = createLogger(`logs/live-harness-w${worker}.log`);
const env = localEnv();

// The deployer pays for every deploy and funds the signers, so it must be
// genesis-funded — fail fast if its seed carries no NIGHT.
const deployer = await FundedWallet.build(
  env,
  'deployer',
  seeds.deployer,
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

const pool = new WalletPool(seeds, buildWallet);
const backend = new LiveSimulatorBackend(pool, env);

backend.register();
await pool.ensureReady();

// Worker ready: wallets funded, backend registered. Printed after the (slow)
// wallet build, before any spec in this worker runs — a "we're live" pointer.
console.log(
  `▶ live worker ${worker}/${totalWorkers} ready — deployer 0x…${seeds.deployer.slice(-4)}`,
);
