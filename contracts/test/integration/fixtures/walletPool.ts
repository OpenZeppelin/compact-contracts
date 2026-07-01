import { encodeCoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import type { LocalNetworkConfig } from '../_harness/network.js';
import type { OwnWalletProvider } from '../_harness/ownWallet.js';
import { WalletPool } from '../_harness/walletPool.js';

/**
 * Structural mirrors of the artifact-generated Compact types. Every
 * artifact regenerates `Either`, `ZswapCoinPublicKey`, and `ContractAddress`
 * with the same shapes, so a value built here passes through any
 * contract's `callTx.foo(eitherArg)` via TypeScript structural typing —
 * no per-artifact import required.
 */
export type ZswapCoinPublicKey = { bytes: Uint8Array };
export type ContractAddress = { bytes: Uint8Array };
export type CompactEither<A, B> = { is_left: boolean; left: A; right: B };
export type Caller = CompactEither<ZswapCoinPublicKey, ContractAddress>;

const ZERO_CONTRACT_ADDRESS: ContractAddress = { bytes: new Uint8Array(32) };
const ZERO_COIN_PUBLIC_KEY: ZswapCoinPublicKey = { bytes: new Uint8Array(32) };

/**
 * Process-singleton `WalletPool` shared across all integration specs in a run.
 *
 * Wallet startup is the slowest part of the integration suite — each
 * `OwnWalletProvider.start()` performs a full sync against the local
 * indexer/node. Sharing one pool across specs means each alias (`ADMIN`,
 * `ALICE`, `BOB`) is built and synced exactly once per process; subsequent
 * `deployNativeShieldedTokenV1` calls reuse the already-warm wallets.
 *
 * The contract is redeployed fresh per spec (each `deployNativeShieldedTokenV1` returns
 * its own `contractAddress`), so contract state never leaks across specs.
 * Wallet UTXO/dust state does carry over, which is fine: aliases are funded
 * from the dev-preset genesis and the wallet sync layer handles UTXO churn.
 *
 * Lifecycle:
 *   - First call: builds the pool against `env`, caches it.
 *   - Subsequent calls (any env): return the cached pool. The integration
 *     suite uses one `networkConfig()` per process, so env-mismatch is not
 *     a real concern; `assertSameEnv` exists as a guardrail.
 *   - `resetSharedWalletPool()` stops every cached wallet and clears the
 *     singleton. Wired into vitest's `globalTeardown` so it runs once after
 *     the whole suite, not per-spec.
 *
 * Specs that need wallet isolation (rare — e.g., asserting "no prior UTXO
 * for ALICE") can pass `{ pool: new WalletPool(env) }` to
 * `deployNativeShieldedTokenV1` and the kit's `teardown()` will own that pool's
 * lifecycle.
 */

/**
 * Pool of test signers with EOA-aware helpers. Wraps a `WalletPool` and
 * adds the conversions specs actually want at the call site:
 *
 *   - `eitherFor(alias)` — alias's coin public key wrapped as
 *     `Either<ZswapCoinPublicKey, ContractAddress>` (left side), ready to
 *     pass into recipient / refund circuit args.
 *   - `contractAddressEither(label)` — deterministic 32-byte
 *     ContractAddress wrapped as the right side of an `Either`. Used by
 *     specs that need a contract destination (e.g. a ContractAddress
 *     recipient / refund target). No contract is actually deployed
 *     at the address; it's a stable test value derived from `label`.
 *   - `signerFor(alias)` / `coinPublicKey(alias)` — escape hatches for
 *     specs that need the raw `OwnWalletProvider` or the encoded
 *     bytes outside an `Either`.
 *
 * Construct one per pool. The shared singleton is exposed via
 * `getSharedSigners(env)`.
 */
export class Signers {
  constructor(readonly pool: WalletPool) {}

  signerFor(alias: string): Promise<OwnWalletProvider> {
    return this.pool.signerFor(alias);
  }

  async coinPublicKey(alias: string): Promise<ZswapCoinPublicKey> {
    const w = await this.pool.signerFor(alias);
    return { bytes: encodeCoinPublicKey(w.getCoinPublicKey()) };
  }

  async eitherFor(alias: string): Promise<Caller> {
    const left = await this.coinPublicKey(alias);
    return { is_left: true, left, right: ZERO_CONTRACT_ADDRESS };
  }

  contractAddressEither(label: string): Caller {
    // Deterministic 32-byte ContractAddress derived from `label`. Stable
    // across runs but unique per label so different specs don't collide.
    const bytes = new Uint8Array(32);
    const seed = new TextEncoder().encode(label);
    for (let i = 0; i < bytes.length; i++) {
      bytes[i] = seed[i % seed.length] ?? 0;
    }
    return {
      is_left: false,
      left: ZERO_COIN_PUBLIC_KEY,
      right: { bytes },
    };
  }
}

let shared: WalletPool | undefined;
let sharedSigners: Signers | undefined;
let sharedEnv: LocalNetworkConfig | undefined;

export function getSharedWalletPool(env: LocalNetworkConfig): WalletPool {
  if (!shared) {
    shared = new WalletPool(env);
    sharedEnv = env;
    return shared;
  }
  assertSameEnv(sharedEnv as LocalNetworkConfig, env);
  return shared;
}

export function getSharedSigners(env: LocalNetworkConfig): Signers {
  if (!sharedSigners) sharedSigners = new Signers(getSharedWalletPool(env));
  return sharedSigners;
}

export async function resetSharedWalletPool(): Promise<void> {
  const current = shared;
  shared = undefined;
  sharedSigners = undefined;
  sharedEnv = undefined;
  if (current) await current.reset();
}

function assertSameEnv(a: LocalNetworkConfig, b: LocalNetworkConfig): void {
  // Guardrail: every spec in this suite uses the same `networkConfig()` —
  // mismatch indicates a misuse (e.g., a spec built its own env before the
  // shared pool was reset). Fail loud rather than serve a wallet bound to
  // the wrong indexer/node.
  if (
    a.indexer !== b.indexer ||
    a.indexerWS !== b.indexerWS ||
    a.node !== b.node ||
    a.proofServer !== b.proofServer
  ) {
    throw new Error(
      'getSharedWalletPool: env mismatch with cached pool. ' +
        'Call resetSharedWalletPool() before re-targeting a different stack.',
    );
  }
}
