import { CompiledContract } from '@midnight-ntwrk/compact-js';
import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import {
  type DeployedContract,
  type FoundContract,
  findDeployedContract,
} from '@midnight-ntwrk/midnight-js-contracts';
import type { MidnightProviders } from '@midnight-ntwrk/midnight-js-types';
import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';
import {
  Contract as ShieldedMultiSigSchnorrV1,
  type Ledger as ShieldedMultiSigSchnorrV1Ledger,
  ledger as multisigLedger,
} from '../../../artifacts/ShieldedMultiSigSchnorrV1/contract/index.js';
import {
  type JubjubKeypair,
  jubjubKeypairFromSecret,
} from '../../../src/crypto/utils/jubjubSchnorr.js';
import { JUBJUB_SCALAR_ORDER } from '../../../src/crypto/utils/jubjub.js';
import {
  contractAssetsPath,
  deployModule,
  moduleRootPath,
} from '../_harness/deploy.js';
import { networkConfig, setupNetwork } from '../_harness/network.js';
import { buildProviders } from '../_harness/providers.js';
import { buildWallet } from '../_harness/wallet.js';
import {
  PREFUNDED_HEX_SEEDS,
  type WalletPool,
} from '../_harness/walletPool.js';
import { getSharedSigners, Signers } from './walletPool.js';

/**
 * Three-person multisig fixture.
 *
 * Conceptual model:
 *   - Each of three real people (`ADMIN`, `ALICE`, `BOB`) has a Midnight
 *     wallet (sourced from the dev-preset prefunded pool). That wallet
 *     pays for the gas of any tx they submit.
 *   - Each person ALSO holds an independent Jubjub keypair (their
 *     "multisig signing key"), generated deterministically per-alias for
 *     test reproducibility. The Jubjub secret never leaves their machine
 *     in real-world usage.
 *   - The contract is deployed by the genesis (deployer) wallet with the
 *     three Jubjub public keys bound at construction.
 *   - Any of the three (or any other wallet) can submit `execute` once
 *     they have collected three valid Schnorr signatures over the action
 *     message hash.
 *
 * The fixture wires this together: `kit.aliasJubjub.{ADMIN,ALICE,BOB}`
 * gives the multisig signing keypairs; `kit.as(alias)` returns a handle
 * bound to that alias's wallet so the spec can submit `execute` as that
 * person.
 */
export type ShieldedMultiSigSchnorrV1PrivateState = Record<string, never>;
export const ShieldedMultiSigSchnorrV1PrivateState: ShieldedMultiSigSchnorrV1PrivateState = {};
export const ShieldedMultiSigSchnorrV1PrivateStateId =
  'shieldedMultiSigSchnorrV1PrivateState';

export type ShieldedMultiSigSchnorrV1Contract =
  ShieldedMultiSigSchnorrV1<ShieldedMultiSigSchnorrV1PrivateState>;
export type ShieldedMultiSigSchnorrV1CircuitKeys =
  ContractNs.ProvableCircuitId<ShieldedMultiSigSchnorrV1Contract>;
export type ShieldedMultiSigSchnorrV1Providers = MidnightProviders<
  ShieldedMultiSigSchnorrV1CircuitKeys,
  typeof ShieldedMultiSigSchnorrV1PrivateStateId,
  ShieldedMultiSigSchnorrV1PrivateState
>;
export type DeployedShieldedMultiSigSchnorrV1 =
  DeployedContract<ShieldedMultiSigSchnorrV1Contract>;
export type ShieldedMultiSigSchnorrV1Handle =
  | DeployedShieldedMultiSigSchnorrV1
  | FoundContract<ShieldedMultiSigSchnorrV1Contract>;

export const compiledShieldedMultiSigSchnorrV1 = CompiledContract.make(
  'ShieldedMultiSigSchnorrV1',
  ShieldedMultiSigSchnorrV1<ShieldedMultiSigSchnorrV1PrivateState>,
).pipe(
  CompiledContract.withWitnesses({} as never),
  CompiledContract.withCompiledFileAssets(
    contractAssetsPath('ShieldedMultiSigSchnorrV1'),
  ),
);

/**
 * Domain tag baked into the seed→Jubjub-secret derivation. Distinct domains
 * ensure that the same wallet seed re-used for different signature-gated
 * protocols produces unrelated Jubjub keys.
 */
const JUBJUB_DERIVATION_DOMAIN = 'Multisig:JubjubV1';

/**
 * Derive an alias's Jubjub multisig secret from their MN wallet seed.
 *
 * `secret = persistentHash([seedBytes, domainBytes]) mod JUBJUB_SCALAR_ORDER`
 *
 * This mirrors the realistic "one user, one mnemonic, two keys" UX: the user
 * holds a single root seed, derives their MN wallet key for tx-signing /
 * gas-paying, and (via this function) deterministically derives a separate
 * Jubjub keypair for multisig governance signatures. The MN wallet and the
 * Jubjub multisig keypair are bound to the same person but live in separate
 * key-domains.
 */
function jubjubSecretFromAliasSeed(aliasSeedHex: string): bigint {
  if (aliasSeedHex.length !== 64) {
    throw new Error(
      `jubjubSecretFromAliasSeed: expected 64-char hex seed, got ${aliasSeedHex.length}`,
    );
  }
  const seedBytes = hexToBytes32(aliasSeedHex);
  const domainBytes = padRight32(JUBJUB_DERIVATION_DOMAIN);
  const rt = new CompactTypeVector(2, new CompactTypeBytes(32));
  const out = persistentHash(rt, [seedBytes, domainBytes]);
  // Interpret the 32-byte hash output big-endian as a bigint, then reduce
  // into the Jubjub scalar field.
  let x = 0n;
  for (const b of out) x = (x << 8n) | BigInt(b);
  return x % JUBJUB_SCALAR_ORDER;
}

function hexToBytes32(hex: string): Uint8Array {
  const out = new Uint8Array(32);
  for (let i = 0; i < 32; i++) {
    out[i] = Number.parseInt(hex.substr(i * 2, 2), 16);
  }
  return out;
}

function padRight32(s: string): Uint8Array {
  const enc = new TextEncoder().encode(s);
  if (enc.length > 32) throw new Error('domain tag too long');
  const out = new Uint8Array(32);
  out.set(enc, 0);
  return out;
}

export type AliasJubjubKeypairs = Record<'ADMIN' | 'ALICE' | 'BOB', JubjubKeypair>;

function buildAliasJubjubKeypairs(): AliasJubjubKeypairs {
  return {
    ADMIN: jubjubKeypairFromSecret(
      jubjubSecretFromAliasSeed(PREFUNDED_HEX_SEEDS.ADMIN!),
    ),
    ALICE: jubjubKeypairFromSecret(
      jubjubSecretFromAliasSeed(PREFUNDED_HEX_SEEDS.ALICE!),
    ),
    BOB: jubjubKeypairFromSecret(
      jubjubSecretFromAliasSeed(PREFUNDED_HEX_SEEDS.BOB!),
    ),
  };
}

export interface ShieldedMultiSigSchnorrV1Kit {
  /** The deploy handle bound to the genesis wallet. */
  deployed: DeployedShieldedMultiSigSchnorrV1;
  /** Genesis-wallet providers (the deployer's bundle). */
  providers: ShieldedMultiSigSchnorrV1Providers;
  /** Genesis (deployer) wallet. */
  wallet: MidnightWalletProvider;
  /** Hex-encoded on-chain address. */
  readonly contractAddress: string;
  /** Wallet-pool wrapper exposing `signerFor`, `eitherFor`, etc. */
  signers: Signers;
  /**
   * Per-alias Jubjub multisig signing keypairs. The public keys here are
   * exactly what the contract was deployed with — `aliasJubjub.ALICE.publicKey`
   * is the pubkey at index 1 of the constructor's `signerPubkeys` arg.
   */
  aliasJubjub: AliasJubjubKeypairs;
  /** Fetch the latest public ledger via the indexer. */
  readLedger(): Promise<ShieldedMultiSigSchnorrV1Ledger>;
  /**
   * Return a `FoundContract` handle bound to the wallet of `alias`
   * (`'ADMIN' | 'ALICE' | 'BOB'`). Subsequent `.callTx.execute(...)` calls
   * run as that alias and have its wallet pay gas. Cached per alias.
   */
  as(alias: string): Promise<ShieldedMultiSigSchnorrV1Handle>;
  teardown(): Promise<void>;
}

export interface DeployShieldedMultiSigSchnorrV1Opts {
  /**
   * Threshold in [1, 3]. Default 3 (full 3-of-3).
   */
  threshold?: bigint;
  /**
   * Optional spec-supplied `WalletPool`; defaults to the process-shared pool.
   * Pass a fresh `new WalletPool(env)` only when wallet-state isolation is
   * required.
   */
  pool?: WalletPool;
}

/**
 * Deploy `ShieldedMultiSigSchnorrV1` with the three alias Jubjub public
 * keys at `(index 0 = ADMIN, 1 = ALICE, 2 = BOB)`.
 */
export async function deployShieldedMultiSigSchnorrV1(
  opts: DeployShieldedMultiSigSchnorrV1Opts = {},
): Promise<ShieldedMultiSigSchnorrV1Kit> {
  setupNetwork();
  const env = networkConfig();
  const wallet = await buildWallet(env);

  const providers = buildProviders<
    ShieldedMultiSigSchnorrV1CircuitKeys,
    typeof ShieldedMultiSigSchnorrV1PrivateStateId,
    ShieldedMultiSigSchnorrV1PrivateState
  >(
    wallet,
    moduleRootPath('ShieldedMultiSigSchnorrV1'),
    `shieldedMultiSigSchnorrV1-${Date.now()}`,
  ) as ShieldedMultiSigSchnorrV1Providers;

  const aliasJubjub = buildAliasJubjubKeypairs();
  const threshold = opts.threshold ?? 3n;
  const signers = opts.pool ? new Signers(opts.pool) : getSharedSigners(env);

  const deployed = await deployModule<ShieldedMultiSigSchnorrV1Contract>(
    providers,
    compiledShieldedMultiSigSchnorrV1,
    ShieldedMultiSigSchnorrV1PrivateStateId,
    ShieldedMultiSigSchnorrV1PrivateState,
    [
      [
        aliasJubjub.ADMIN.publicKey,
        aliasJubjub.ALICE.publicKey,
        aliasJubjub.BOB.publicKey,
      ],
      threshold,
    ] as ContractNs.InitializeParameters<ShieldedMultiSigSchnorrV1Contract>,
  );

  const contractAddress = deployed.deployTxData.public.contractAddress;
  const handleCache = new Map<string, Promise<ShieldedMultiSigSchnorrV1Handle>>();

  async function buildHandle(
    alias: string,
  ): Promise<ShieldedMultiSigSchnorrV1Handle> {
    const aliasWallet = await signers.signerFor(alias);
    const aliasProviders = buildProviders<
      ShieldedMultiSigSchnorrV1CircuitKeys,
      typeof ShieldedMultiSigSchnorrV1PrivateStateId,
      ShieldedMultiSigSchnorrV1PrivateState
    >(
      aliasWallet,
      moduleRootPath('ShieldedMultiSigSchnorrV1'),
      `shieldedMultiSigSchnorrV1-${alias.toLowerCase()}-${Date.now()}`,
    ) as ShieldedMultiSigSchnorrV1Providers;
    return findDeployedContract<ShieldedMultiSigSchnorrV1Contract>(
      aliasProviders,
      {
        compiledContract: compiledShieldedMultiSigSchnorrV1,
        contractAddress,
        privateStateId: ShieldedMultiSigSchnorrV1PrivateStateId,
        initialPrivateState: ShieldedMultiSigSchnorrV1PrivateState,
      },
    );
  }

  return {
    deployed,
    providers,
    wallet,
    contractAddress,
    signers,
    aliasJubjub,

    async readLedger(): Promise<ShieldedMultiSigSchnorrV1Ledger> {
      const state = await providers.publicDataProvider.queryContractState(
        contractAddress,
      );
      if (!state) {
        throw new Error(
          `readLedger: no ContractState available for ${contractAddress}`,
        );
      }
      return multisigLedger(state.data);
    },

    async as(alias: string): Promise<ShieldedMultiSigSchnorrV1Handle> {
      let cached = handleCache.get(alias);
      if (!cached) {
        cached = buildHandle(alias);
        handleCache.set(alias, cached);
      }
      return cached;
    },

    async teardown(): Promise<void> {
      // Pool lifecycle is managed externally — the shared pool is torn
      // down in vitest's `globalTeardown`; only stop the deployer wallet
      // here.
      await wallet.stop();
    },
  };
}
