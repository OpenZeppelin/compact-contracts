import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import { encodeCoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import {
  type DeployedContract,
  type FoundContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import {
  Contract as TestTokenV1,
  type Ledger as TestTokenV1Ledger,
  ledger as testTokenLedger,
} from '../../../artifacts/TestTokenV1/contract/index.js';
import {
  contractAssetsPath,
  deployModule,
  moduleRootPath,
} from '../_harness/deploy.js';
import { networkConfig, setupNetwork } from '../_harness/network.js';
import { buildProviders } from '../_harness/providers.js';
import { buildWallet } from '../_harness/wallet.js';
import type { WalletPool } from '../_harness/walletPool.js';
import { getSharedSigners, Signers } from './walletPool.js';

/**
 * TestToken has no witness needs (all five composed modules — Initializable,
 * Pausable, AccessControl, FungibleToken, Utils — declare empty private
 * states). A single empty record satisfies the runtime.
 */
export type TestTokenV1PrivateState = Record<string, never>;
export const TestTokenV1PrivateState: TestTokenV1PrivateState = {};

// TestToken declares no witnesses. Compact-js' `Contract.Witnesses<C>` for
// an empty-witness contract resolves to `never`, so `withWitnesses` requires
// `never` as input. We pass an empty object cast to `never` to satisfy the
// type system AND fulfil the Witnesses slot in the CompiledContract's
// remaining-requirements union (which `findDeployedContract` validates).

export const TestTokenV1PrivateStateId = 'testTokenV1PrivateState';

export type TestTokenV1Contract = TestTokenV1<TestTokenV1PrivateState>;

/**
 * Union of the contract's provable-circuit names, derived from the artifact —
 * gives `MidnightProviders` a precise PCK type so consumers (deployContract,
 * findDeployedContract) can narrow without casts.
 */
export type TestTokenV1CircuitKeys = ContractNs.ProvableCircuitId<TestTokenV1Contract>;

export type TestTokenV1Providers = MidnightProviders<
  TestTokenV1CircuitKeys,
  typeof TestTokenV1PrivateStateId,
  TestTokenV1PrivateState
>;

export type DeployedTestTokenV1 = DeployedContract<TestTokenV1Contract>;
export type TestTokenV1Handle =
  | DeployedTestTokenV1
  | FoundContract<TestTokenV1Contract>;

export const compiledTestTokenV1 = CompiledContract.make(
  'TestTokenV1',
  TestTokenV1<TestTokenV1PrivateState>,
).pipe(
  CompiledContract.withWitnesses({} as never),
  CompiledContract.withCompiledFileAssets(contractAssetsPath('TestTokenV1')),
);

export interface DeployTestTokenV1Opts {
  /** ERC20-style name. Default: `'TestToken'`. */
  name?: string;
  /** ERC20-style symbol. Default: `'TT'`. */
  symbol?: string;
  /** ERC20-style decimals. Default: `6`. */
  decimals?: number;
  /**
   * Whether to bootstrap `DEFAULT_ADMIN_ROLE` on the `ADMIN` alias from the
   * pool by calling `_grantRole` from the deployer wallet. Default: `true`.
   * Set to `false` for specs that want to assert "no admin yet" semantics.
   */
  bootstrapAdmin?: boolean;
  /**
   * Wallet pool to source alias signers from. Default: the process-shared
   * pool from `fixtures/walletPool.ts` — alias wallets are built once per
   * process and reused across specs. Pass a fresh `new WalletPool(env)` for
   * specs that need wallet-state isolation; the kit's `teardown()` will
   * stop the pool only when it owns it.
   */
  pool?: WalletPool;
}

export interface TestTokenV1Kit {
  /** Original `DeployedContract` handle bound to the genesis/deployer wallet. */
  deployed: DeployedTestTokenV1;
  /** Genesis-wallet providers (the deployer's bundle). */
  providers: TestTokenV1Providers;
  /** Genesis-wallet (the deployer). */
  wallet: MidnightWalletProvider;
  /** Hex-encoded on-chain address of the deployed contract. */
  readonly contractAddress: string;
  /**
   * Multi-signer helper — `signers.eitherFor('ADMIN' | 'ALICE' | 'BOB')` for
   * AccessControl/Ownable args, `signers.signerFor(alias)` for raw wallets,
   * `signers.contractAddressEither(label)` for ContractAddress destinations.
   * Default is the process-shared instance; specs that opt into isolation
   * pass `{ pool: new WalletPool(env) }` and own its lifecycle.
   */
  signers: Signers;

  /** Fetch the latest public ledger via the indexer. */
  readLedger(): Promise<TestTokenV1Ledger>;

  /**
   * Return a `FoundContract` handle bound to the wallet of `alias`. Subsequent
   * `.callTx.foo(...)` calls run as that alias and have its `coinPublicKey`
   * available to `ownPublicKey()` inside circuits. Cached per alias.
   */
  as(alias: string): Promise<TestTokenV1Handle>;

  teardown(): Promise<void>;
}

/**
 * Deploy a fresh `TestToken` to the local node and return a kit object that
 * specs use for assertions, transactions, and teardown.
 *
 * Single-signer for the deployer (TEST_MNEMONIC genesis wallet); multi-signer
 * for in-test calls via `kit.signers` (process-shared by default).
 */
export async function deployTestTokenV1(
  opts: DeployTestTokenV1Opts = {},
): Promise<TestTokenV1Kit> {
  setupNetwork();
  const env = networkConfig();
  const wallet = await buildWallet(env);

  // `buildProviders`'s `CircuitKey` generic is phantom — the narrow type
  // doesn't fully propagate through every internal provider construction —
  // so cast at the site to the concrete `TestTokenV1Providers` we control.
  const providers = buildProviders<
    TestTokenV1CircuitKeys,
    typeof TestTokenV1PrivateStateId,
    TestTokenV1PrivateState
  >(
    wallet,
    moduleRootPath('TestTokenV1'),
    `testTokenV1-${Date.now()}`,
  ) as TestTokenV1Providers;

  const name = opts.name ?? 'TestToken';
  const symbol = opts.symbol ?? 'TT';
  const decimals = BigInt(opts.decimals ?? 6);

  // Default to the process-shared signers/pool. A spec-supplied pool gets
  // its own `Signers` so opt-in isolation also gets the EOA helpers.
  const signers = opts.pool ? new Signers(opts.pool) : getSharedSigners(env);

  // Deployer is the initial Ownable owner. Ownable rejects ContractAddress
  // and the zero address at init, so a real ZswapCoinPublicKey is required.
  // The deployer wallet is built above, separate from the signer pool, so
  // it has the same shape as `Caller` but isn't sourced from `signers`.
  const deployerOwner = {
    is_left: true,
    left: { bytes: encodeCoinPublicKey(wallet.getCoinPublicKey()) },
    right: { bytes: new Uint8Array(32) },
  };

  const deployed = await deployModule<TestTokenV1Contract>(
    providers,
    compiledTestTokenV1,
    TestTokenV1PrivateStateId,
    TestTokenV1PrivateState,
    [name, symbol, decimals, deployerOwner],
  );

  const contractAddress = deployed.deployTxData.public.contractAddress;

  // Per-alias FoundContract handle cache. Keyed by alias; value is a Promise
  // so parallel `as(alias)` calls dedupe to a single findDeployedContract.
  const handleCache = new Map<string, Promise<TestTokenV1Handle>>();

  async function buildHandle(alias: string): Promise<TestTokenV1Handle> {
    const aliasWallet = await signers.signerFor(alias);
    const aliasProviders = buildProviders<
      TestTokenV1CircuitKeys,
      typeof TestTokenV1PrivateStateId,
      TestTokenV1PrivateState
    >(
      aliasWallet,
      moduleRootPath('TestTokenV1'),
      `testTokenV1-${alias.toLowerCase()}-${Date.now()}`,
    ) as TestTokenV1Providers;
    return findDeployedContract<TestTokenV1Contract>(aliasProviders, {
      compiledContract: compiledTestTokenV1,
      contractAddress,
      privateStateId: TestTokenV1PrivateStateId,
      initialPrivateState: TestTokenV1PrivateState,
    });
  }

  const kit: TestTokenV1Kit = {
    deployed,
    providers,
    wallet,
    contractAddress,
    signers,

    async readLedger(): Promise<TestTokenV1Ledger> {
      const state = await providers.publicDataProvider.queryContractState(
        contractAddress,
      );
      if (!state) {
        throw new Error(
          `readLedger: no ContractState available for ${contractAddress}`,
        );
      }
      return testTokenLedger(state.data);
    },

    async as(alias: string): Promise<TestTokenV1Handle> {
      let cached = handleCache.get(alias);
      if (!cached) {
        cached = buildHandle(alias);
        handleCache.set(alias, cached);
      }
      return cached;
    },

    async teardown(): Promise<void> {
      // Pool lifecycle is managed externally — the shared pool is torn
      // down in vitest's `globalTeardown`; a spec-supplied pool is the
      // spec's responsibility. Only stop the deployer wallet here.
      await wallet.stop();
    },
  };

  // Bootstrap admin role on the ADMIN alias unless explicitly disabled.
  // Done from the deployer (genesis wallet); uses the unsafe `_grantRole`
  // wrapper exposed on `MockComposite`/`TestToken` for test setup.
  if (opts.bootstrapAdmin !== false) {
    const adminEither = await signers.eitherFor('ADMIN');
    const ledger0 = await kit.readLedger();
    await deployed.callTx._grantRole(
      ledger0.AccessControl_DEFAULT_ADMIN_ROLE,
      adminEither,
    );
  }

  return kit;
}
