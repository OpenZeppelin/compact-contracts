import type { MidnightWalletProvider } from '@midnight-ntwrk/testkit-js';

/**
 * The pooled test wallets for the live backend: build each seed once, publish
 * its coin public key, and resolve one wallet per caller alias.
 *
 * This module is deliberately free of any testkit *runtime* dependency (it only
 * imports testkit types, which are erased). Building a wallet — the part that
 * touches testkit / the node — is injected as a {@link WalletBuilder}, so the
 * pool's orchestration can be unit-tested with a fake builder and no node. The
 * real builder ({@link FundedWallet.build}) is wired in by `live.setup.ts`.
 */

/** The wallet surface the pool needs from whatever the builder returns. */
export interface PooledWallet {
  readonly provider: MidnightWalletProvider;
  /** Encoded coin public key, published as `MIDNIGHT_<ALIAS>_COIN_PK`. */
  readonly coinPublicKey: string;
  stop(): Promise<void>;
}

/** Builds (and funds) one pooled wallet for an alias. Injected for testability. */
export type WalletBuilder = (
  alias: string,
  seed: string,
) => Promise<PooledWallet>;

const seed = (lastByte: number): string =>
  `${'0'.repeat(62)}${lastByte.toString(16).padStart(2, '0')}`;

/**
 * How many live workers the wallet partition supports. Bounded by the
 * genesis-funded deployer seeds `midnight-node --preset=dev` provides
 * (`0x..01`–`0x..03`): each worker's deployer must be a genesis seed, because
 * only those carry the NIGHT + genesis shielded coins the deposit specs spend.
 */
export const MAX_LIVE_WORKERS = 3;

/**
 * The pooled wallet seeds for one live worker `w` (1-based). Each worker gets a
 * disjoint set so up to {@link MAX_LIVE_WORKERS} `unit-live` files can run
 * concurrently against the shared node without sharing a wallet's UTXOs/nonces:
 *
 *   - `deployer` is genesis seed `0x..0w` — one of the three seeds the dev
 *     preset funds with NIGHT + the genesis shielded coins deposit specs spend
 *     (so it MUST be a genesis seed; hence the 3-worker cap). It pays for every
 *     deploy and is the default caller. Worker 1's deployer honours
 *     `MIDNIGHT_WALLET_SEED`.
 *   - `SIGNER1`–`SIGNER3` are derived seeds `0x..(0x10·w + slot)` (worker 1:
 *     `0x11`–`0x13`, worker 2: `0x21`–`0x23`, worker 3: `0x31`–`0x33`) — disjoint
 *     from the genesis seeds (`0x01`–`0x04`) and from other workers'. They start
 *     empty and are topped up from the worker's deployer at live setup (see
 *     `funding.ts`); signers only pay fees, never spend shielded coins, so they
 *     need no genesis grant. They back distinct on-chain identities, so a
 *     multisig spec's `.as('SIGNER1')` submits from a wallet whose
 *     `ownPublicKey()` differs from the others (the only way to exercise
 *     multi-signer authorization on live — one wallet can't impersonate three).
 */
export function walletSeedsFor(
  worker: number,
): Readonly<Record<string, string>> {
  const deployer =
    worker === 1
      ? (process.env.MIDNIGHT_WALLET_SEED ?? seed(worker))
      : seed(worker);
  return {
    deployer,
    SIGNER1: seed(0x10 * worker + 1),
    SIGNER2: seed(0x10 * worker + 2),
    SIGNER3: seed(0x10 * worker + 3),
  };
}

/**
 * Worker 1's pooled seeds — the default single-worker pool. A stable symbol for
 * callers that don't partition by worker; the live setup builds its pool from
 * {@link walletSeedsFor} keyed on the worker's `VITEST_POOL_ID`.
 */
export const WALLET_SEEDS: Readonly<Record<string, string>> = walletSeedsFor(1);

/** The env var carrying an alias's coin public key (e.g. `MIDNIGHT_SIGNER1_COIN_PK`,
 * `MIDNIGHT_DEPLOYER_COIN_PK`). Specs read these to build a live signer set. */
export const coinPkEnv = (alias: string): string =>
  `MIDNIGHT_${alias === 'deployer' ? 'DEPLOYER' : alias}_COIN_PK`;

/**
 * Owns the pooled wallets for a worker. Builds each seed once (concurrently) via
 * the injected builder, publishes each coin public key, resolves a wallet per
 * caller alias (unknown alias → deployer fallback), and tears them all down.
 */
export class WalletPool {
  private readonly wallets = new Map<string, PooledWallet>();
  private ready?: Promise<void>;

  constructor(
    private readonly seeds: Readonly<Record<string, string>>,
    private readonly buildWallet: WalletBuilder,
  ) {}

  /**
   * Build every pooled wallet once, concurrently, and publish each coin public
   * key. Idempotent; a no-op-cost await after the first call.
   */
  ensureReady(): Promise<void> {
    if (!this.ready) {
      this.ready = Promise.all(
        Object.entries(this.seeds).map(async ([alias, walletSeed]) => {
          const wallet = await this.buildWallet(alias, walletSeed);
          process.env[coinPkEnv(alias)] = wallet.coinPublicKey;
          this.wallets.set(alias, wallet);
        }),
      ).then(() => undefined);
    }
    return this.ready;
  }

  /** Whether `alias` names a pooled wallet (vs. falling back to the deployer). */
  isKnownAlias(alias: string | null | undefined): boolean {
    return !!alias && this.seeds[alias] !== undefined;
  }

  /**
   * The wallet provider for a caller alias (requires {@link ensureReady}). An
   * unknown alias falls back to the deployer, so `.as('OTHER')` acts as a funded
   * non-signer caller rather than erroring.
   */
  walletFor(alias: string | null | undefined): MidnightWalletProvider {
    const key = this.isKnownAlias(alias) ? (alias as string) : 'deployer';
    const wallet = this.wallets.get(key) ?? this.wallets.get('deployer');
    if (!wallet) {
      throw new Error(
        'live wallets not initialized — call ensureReady() in the test:live setup',
      );
    }
    return wallet.provider;
  }

  /** Stop every built wallet and clear the pool (for a `globalTeardown`). */
  async reset(): Promise<void> {
    const all = Array.from(this.wallets.values());
    this.wallets.clear();
    this.ready = undefined;
    await Promise.all(all.map((w) => w.stop()));
  }
}
