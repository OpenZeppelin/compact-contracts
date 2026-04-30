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
  Contract as TestToken,
  type ContractAddress as ContractAddressT,
  type Either,
  type Ledger as TestTokenLedger,
  type ZswapCoinPublicKey,
  ledger as testTokenLedger,
} from '../../../artifacts/TestToken/contract/index.js';
import {
  contractAssetsPath,
  deployModule,
  moduleRootPath,
} from '../_harness/deploy.js';
import { networkConfig, setupNetwork } from '../_harness/network.js';
import { buildProviders } from '../_harness/providers.js';
import { buildWallet } from '../_harness/wallet.js';
import { WalletPool } from '../_harness/walletPool.js';

/**
 * TestToken has no witness needs (all five composed modules — Initializable,
 * Pausable, AccessControl, FungibleToken, Utils — declare empty private
 * states). A single empty record satisfies the runtime.
 */
export type TestTokenPrivateState = Record<string, never>;
export const TestTokenPrivateState: TestTokenPrivateState = {};

// TestToken declares no witnesses. Compact-js' `Contract.Witnesses<C>` for
// an empty-witness contract resolves to `never`, so `withWitnesses` requires
// `never` as input. We pass an empty object cast to `never` to satisfy the
// type system AND fulfil the Witnesses slot in the CompiledContract's
// remaining-requirements union (which `findDeployedContract` validates).

export const TestTokenPrivateStateId = 'testTokenPrivateState';

export type TestTokenContract = TestToken<TestTokenPrivateState>;

/**
 * Union of the contract's provable-circuit names, derived from the artifact —
 * gives `MidnightProviders` a precise PCK type so consumers (deployContract,
 * findDeployedContract) can narrow without casts.
 */
export type TestTokenCircuitKeys = ContractNs.ProvableCircuitId<TestTokenContract>;

export type TestTokenProviders = MidnightProviders<
  TestTokenCircuitKeys,
  typeof TestTokenPrivateStateId,
  TestTokenPrivateState
>;

export type DeployedTestToken = DeployedContract<TestTokenContract>;
export type TestTokenHandle =
  | DeployedTestToken
  | FoundContract<TestTokenContract>;

export const compiledTestToken = CompiledContract.make(
  'TestToken',
  TestToken<TestTokenPrivateState>,
).pipe(
  CompiledContract.withWitnesses({} as never),
  CompiledContract.withCompiledFileAssets(contractAssetsPath('TestToken')),
);

export interface DeployTestTokenOpts {
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
}

export interface TestTokenKit {
  /** Original `DeployedContract` handle bound to the genesis/deployer wallet. */
  deployed: DeployedTestToken;
  /** Genesis-wallet providers (the deployer's bundle). */
  providers: TestTokenProviders;
  /** Genesis-wallet (the deployer). */
  wallet: MidnightWalletProvider;
  /** Hex-encoded on-chain address of the deployed contract. */
  readonly contractAddress: string;
  /** Multi-signer pool — `ADMIN`, `ALICE`, `BOB` aliases prefunded by genesis. */
  pool: WalletPool;

  /** Fetch the latest public ledger via the indexer. */
  readLedger(): Promise<TestTokenLedger>;

  /**
   * Return a `FoundContract` handle bound to the wallet of `alias`. Subsequent
   * `.callTx.foo(...)` calls run as that alias and have its `coinPublicKey`
   * available to `ownPublicKey()` inside circuits. Cached per alias.
   */
  as(alias: string): Promise<TestTokenHandle>;

  /**
   * Return the alias's coin public key wrapped as
   * `Either<ZswapCoinPublicKey, ContractAddress>`, ready to pass into
   * AccessControl-style circuit args.
   */
  aliasFor(
    alias: string,
  ): Promise<Either<ZswapCoinPublicKey, ContractAddressT>>;

  teardown(): Promise<void>;
}

/** Zero ContractAddress used as the `right` side of a left-tagged Either. */
const ZERO_CONTRACT_ADDRESS: ContractAddressT = { bytes: new Uint8Array(32) };

/**
 * Deploy a fresh `TestToken` to the local node and return a kit object that
 * specs use for assertions, transactions, and teardown.
 *
 * Single-signer for the deployer (TEST_MNEMONIC genesis wallet); multi-signer
 * for in-test calls via the `WalletPool` exposed on the kit.
 */
export async function deployTestToken(
  opts: DeployTestTokenOpts = {},
): Promise<TestTokenKit> {
  setupNetwork();
  const env = networkConfig();
  const wallet = await buildWallet(env);

  // `buildProviders`'s `CircuitKey` generic is phantom — the narrow type
  // doesn't fully propagate through every internal provider construction —
  // so cast at the site to the concrete `TestTokenProviders` we control.
  const providers = buildProviders<
    TestTokenCircuitKeys,
    typeof TestTokenPrivateStateId,
    TestTokenPrivateState
  >(
    wallet,
    moduleRootPath('TestToken'),
    `testToken-${Date.now()}`,
  ) as TestTokenProviders;

  const name = opts.name ?? 'TestToken';
  const symbol = opts.symbol ?? 'TT';
  const decimals = BigInt(opts.decimals ?? 6);

  const deployed = await deployModule<TestTokenContract>(
    providers,
    compiledTestToken,
    TestTokenPrivateStateId,
    TestTokenPrivateState,
    [name, symbol, decimals],
  );

  const contractAddress = deployed.deployTxData.public.contractAddress;
  const pool = new WalletPool(env);

  // Per-alias FoundContract handle cache. Keyed by alias; value is a Promise
  // so parallel `as(alias)` calls dedupe to a single findDeployedContract.
  const handleCache = new Map<string, Promise<TestTokenHandle>>();

  async function eitherForWallet(
    w: MidnightWalletProvider,
  ): Promise<Either<ZswapCoinPublicKey, ContractAddressT>> {
    return {
      is_left: true,
      left: { bytes: encodeCoinPublicKey(w.getCoinPublicKey()) },
      right: ZERO_CONTRACT_ADDRESS,
    };
  }

  async function buildHandle(alias: string): Promise<TestTokenHandle> {
    const aliasWallet = await pool.signerFor(alias);
    const aliasProviders = buildProviders<
      TestTokenCircuitKeys,
      typeof TestTokenPrivateStateId,
      TestTokenPrivateState
    >(
      aliasWallet,
      moduleRootPath('TestToken'),
      `testToken-${alias.toLowerCase()}-${Date.now()}`,
    ) as TestTokenProviders;
    return findDeployedContract<TestTokenContract>(aliasProviders, {
      compiledContract: compiledTestToken,
      contractAddress,
      privateStateId: TestTokenPrivateStateId,
      initialPrivateState: TestTokenPrivateState,
    });
  }

  const kit: TestTokenKit = {
    deployed,
    providers,
    wallet,
    contractAddress,
    pool,

    async readLedger(): Promise<TestTokenLedger> {
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

    async as(alias: string): Promise<TestTokenHandle> {
      let cached = handleCache.get(alias);
      if (!cached) {
        cached = buildHandle(alias);
        handleCache.set(alias, cached);
      }
      return cached;
    },

    async aliasFor(
      alias: string,
    ): Promise<Either<ZswapCoinPublicKey, ContractAddressT>> {
      const w = await pool.signerFor(alias);
      return eitherForWallet(w);
    },

    async teardown(): Promise<void> {
      await pool.reset();
      await wallet.stop();
    },
  };

  // Bootstrap admin role on the ADMIN alias unless explicitly disabled.
  // Done from the deployer (genesis wallet); uses the unsafe `_grantRole`
  // wrapper exposed on `MockComposite`/`TestToken` for test setup.
  if (opts.bootstrapAdmin !== false) {
    const adminEither = await kit.aliasFor('ADMIN');
    const ledger0 = await kit.readLedger();
    await deployed.callTx._grantRole(
      ledger0.AccessControl_DEFAULT_ADMIN_ROLE,
      adminEither,
    );
  }

  return kit;
}
