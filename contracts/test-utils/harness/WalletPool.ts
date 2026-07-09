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

/**
 * The pooled wallet seeds. `midnight-node --preset=dev` genesis-funds only three
 * seeds (`0x..01`–`0x..03`) with NIGHT + shielded coins; the fourth (`SIGNER3`,
 * `0x..04`) starts empty and is topped up from the deployer at live setup (see
 * `funding.ts`). `deployer` pays for every deploy and is the default caller;
 * `SIGNER1`–`SIGNER3` back distinct on-chain identities, so a multisig spec's
 * `.as('SIGNER1')` submits from a wallet whose `ownPublicKey()` differs from the
 * others (the only way to exercise multi-signer authorization on live — one
 * wallet can't impersonate three signers). Override the deployer slot via
 * `MIDNIGHT_WALLET_SEED`.
 */
const seed = (lastByte: number): string => `${'0'.repeat(63)}${lastByte}`;
export const WALLET_SEEDS: Readonly<Record<string, string>> = {
  deployer: process.env.MIDNIGHT_WALLET_SEED ?? seed(1),
  SIGNER1: seed(2),
  SIGNER2: seed(3),
  SIGNER3: seed(4),
};

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
