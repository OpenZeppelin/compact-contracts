import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import {
  type DeployedContract,
  type FoundContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { OwnWalletProvider } from '../_harness/ownWallet.js';
import {
  Contract as NativeShieldedTokenV1,
  type Ledger as NativeShieldedTokenV1Ledger,
  ledger as nativeShieldedTokenLedger,
} from '../../../artifacts/NativeShieldedTokenV1/contract/index.js';
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
 * NativeShieldedTokenV1 composes the `NativeShieldedToken` (Fungible) module
 * with the `NativeShieldedTokenDerivedNonce` extension; neither declares a
 * witness, so a single empty record satisfies the runtime.
 */
export type NativeShieldedTokenV1PrivateState = Record<string, never>;
export const NativeShieldedTokenV1PrivateState: NativeShieldedTokenV1PrivateState =
  {};

export const NativeShieldedTokenV1PrivateStateId =
  'nativeShieldedTokenV1PrivateState';

export type NativeShieldedTokenV1Contract =
  NativeShieldedTokenV1<NativeShieldedTokenV1PrivateState>;

/** Union of the contract's provable-circuit names, derived from the artifact. */
export type NativeShieldedTokenV1CircuitKeys =
  ContractNs.ProvableCircuitId<NativeShieldedTokenV1Contract>;

export type NativeShieldedTokenV1Providers = MidnightProviders<
  NativeShieldedTokenV1CircuitKeys,
  typeof NativeShieldedTokenV1PrivateStateId,
  NativeShieldedTokenV1PrivateState
>;

export type DeployedNativeShieldedTokenV1 =
  DeployedContract<NativeShieldedTokenV1Contract>;
export type NativeShieldedTokenV1Handle =
  | DeployedNativeShieldedTokenV1
  | FoundContract<NativeShieldedTokenV1Contract>;

// NativeShieldedTokenV1 declares no witnesses. Compact-js' `Contract.Witnesses<C>`
// for an empty-witness contract resolves to `never`, so `withWitnesses`
// requires `never`. We pass an empty object cast to `never` to satisfy the
// type system and fill the Witnesses slot the CompiledContract validates.
export const compiledNativeShieldedTokenV1 = CompiledContract.make(
  'NativeShieldedTokenV1',
  NativeShieldedTokenV1<NativeShieldedTokenV1PrivateState>,
).pipe(
  CompiledContract.withWitnesses({} as never),
  CompiledContract.withCompiledFileAssets(
    contractAssetsPath('NativeShieldedTokenV1'),
  ),
);

/**
 * Default domain separator and nonce-chain seed for the deployable. Both are
 * fixed 32-byte values; the seed is non-zero (a zero seed is rejected by the
 * derived-nonce module's `initialize`).
 */
/** Encode an ASCII label into a fixed 32-byte array (truncated to fit). */
function bytes32(label: string): Uint8Array {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(label).slice(0, 32));
  return b;
}

export const DEFAULT_DOMAIN: Uint8Array = bytes32('nst:default-domain');

export const DEFAULT_NONCE_SEED: Uint8Array = bytes32('nst:nonce-seed');

export interface DeployNativeShieldedTokenV1Opts {
  /** Token name. Default: `'Native Shielded Token'`. */
  name?: string;
  /** Token symbol. Default: `'NST'`. */
  symbol?: string;
  /** Token decimals. Default: `6`. */
  decimals?: number;
  /** Domain separator (fixes the token's color). Default: `DEFAULT_DOMAIN`. */
  domain?: Uint8Array;
  /** Nonce-chain seed (must be non-zero). Default: `DEFAULT_NONCE_SEED`. */
  nonceSeed?: Uint8Array;
  /**
   * Wallet pool to source alias signers from. Default: the process-shared pool
   * from `fixtures/walletPool.ts`. Pass a fresh `new WalletPool(env)` for specs
   * that need wallet-state isolation; the kit's `teardown()` stops the pool
   * only when it owns it.
   */
  pool?: WalletPool;
}

export interface NativeShieldedTokenV1Kit {
  /** Original `DeployedContract` handle bound to the genesis/deployer wallet. */
  deployed: DeployedNativeShieldedTokenV1;
  /** Genesis-wallet providers (the deployer's bundle). */
  providers: NativeShieldedTokenV1Providers;
  /** Genesis-wallet (the deployer). */
  wallet: OwnWalletProvider;
  /** Hex-encoded on-chain address of the deployed contract. */
  readonly contractAddress: string;
  /** The domain separator the contract was deployed with. */
  readonly domain: Uint8Array;
  /**
   * Multi-signer helper — `signers.eitherFor('ADMIN' | 'ALICE' | 'BOB')` for
   * recipient/refund args, `signers.signerFor(alias)` for raw wallets,
   * `signers.contractAddressEither(label)` for ContractAddress destinations.
   */
  signers: Signers;

  /** Fetch the latest public ledger via the indexer. */
  readLedger(): Promise<NativeShieldedTokenV1Ledger>;

  /**
   * Return a `FoundContract` handle bound to the wallet of `alias`. Subsequent
   * `.callTx.foo(...)` calls run as that alias. Cached per alias.
   */
  as(alias: string): Promise<NativeShieldedTokenV1Handle>;

  teardown(): Promise<void>;
}

/**
 * Deploy a fresh `NativeShieldedTokenV1` to the local node and return a kit for
 * assertions, transactions, and teardown.
 *
 * Single-signer for the deployer (TEST_MNEMONIC genesis wallet); multi-signer
 * for in-test calls via `kit.signers` (process-shared by default). The module
 * is unrestricted, so any alias can mint and burn — there is no admin bootstrap.
 */
export async function deployNativeShieldedTokenV1(
  opts: DeployNativeShieldedTokenV1Opts = {},
): Promise<NativeShieldedTokenV1Kit> {
  setupNetwork();
  const env = networkConfig();
  const wallet = await buildWallet(env);

  const providers = buildProviders<
    NativeShieldedTokenV1CircuitKeys,
    typeof NativeShieldedTokenV1PrivateStateId,
    NativeShieldedTokenV1PrivateState
  >(
    wallet,
    moduleRootPath('NativeShieldedTokenV1'),
    `nativeShieldedTokenV1-${Date.now()}`,
  ) as NativeShieldedTokenV1Providers;

  const name = opts.name ?? 'Native Shielded Token';
  const symbol = opts.symbol ?? 'NST';
  const decimals = BigInt(opts.decimals ?? 6);
  const domain = opts.domain ?? DEFAULT_DOMAIN;
  const nonceSeed = opts.nonceSeed ?? DEFAULT_NONCE_SEED;

  const signers = opts.pool ? new Signers(opts.pool) : getSharedSigners(env);

  const deployed = await deployModule<NativeShieldedTokenV1Contract>(
    providers,
    compiledNativeShieldedTokenV1,
    NativeShieldedTokenV1PrivateStateId,
    NativeShieldedTokenV1PrivateState,
    [domain, nonceSeed, name, symbol, decimals],
  );

  const contractAddress = deployed.deployTxData.public.contractAddress;

  const handleCache = new Map<string, Promise<NativeShieldedTokenV1Handle>>();

  async function buildHandle(
    alias: string,
  ): Promise<NativeShieldedTokenV1Handle> {
    const aliasWallet = await signers.signerFor(alias);
    const aliasProviders = buildProviders<
      NativeShieldedTokenV1CircuitKeys,
      typeof NativeShieldedTokenV1PrivateStateId,
      NativeShieldedTokenV1PrivateState
    >(
      aliasWallet,
      moduleRootPath('NativeShieldedTokenV1'),
      `nativeShieldedTokenV1-${alias.toLowerCase()}-${Date.now()}`,
    ) as NativeShieldedTokenV1Providers;
    return findDeployedContract<NativeShieldedTokenV1Contract>(aliasProviders, {
      compiledContract: compiledNativeShieldedTokenV1,
      contractAddress,
      privateStateId: NativeShieldedTokenV1PrivateStateId,
      initialPrivateState: NativeShieldedTokenV1PrivateState,
    });
  }

  return {
    deployed,
    providers,
    wallet,
    contractAddress,
    domain,
    signers,

    async readLedger(): Promise<NativeShieldedTokenV1Ledger> {
      const state =
        await providers.publicDataProvider.queryContractState(contractAddress);
      if (!state) {
        throw new Error(
          `readLedger: no ContractState available for ${contractAddress}`,
        );
      }
      return nativeShieldedTokenLedger(state.data);
    },

    async as(alias: string): Promise<NativeShieldedTokenV1Handle> {
      let cached = handleCache.get(alias);
      if (!cached) {
        cached = buildHandle(alias);
        handleCache.set(alias, cached);
      }
      return cached;
    },

    async teardown(): Promise<void> {
      // Pool lifecycle is managed externally (shared pool torn down in vitest's
      // globalTeardown; a spec-supplied pool is the spec's responsibility).
      // Only stop the deployer wallet here.
      await wallet.stop();
    },
  };
}
