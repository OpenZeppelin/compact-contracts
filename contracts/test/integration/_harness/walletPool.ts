import type { LocalNetworkConfig } from './network.js';
import { OwnWalletProvider } from './ownWallet.js';

/**
 * Multi-signer wallet pool for the native shielded token integration specs.
 *
 * Approach: leverage the four pre-funded genesis seeds that the dev-preset
 * Midnight node exposes. Each alias maps to one of those raw 32-byte seeds;
 * building a wallet from the seed yields an already-funded provider. No
 * derive-and-fund-from-genesis tx is needed — much faster setup.
 *
 * Limitation: only 3 named aliases are available beyond the deployer (the
 * dev preset funds `0x…0001`–`0x…0004`; `0x…0001` is the deployer via
 * `buildWallet`, leaving `0x…0002`–`0x…0004` for the pool). Adding more
 * aliases requires rotating the same seeds or a derive-and-fund flow.
 *
 * Uses `OwnWalletProvider` (no testkit-js dependency).
 */

/** Hex 32-byte seeds prefunded by the dev-preset Midnight node. */
export const PREFUNDED_HEX_SEEDS: Record<string, string> = {
  ADMIN: '0000000000000000000000000000000000000000000000000000000000000002',
  ALICE: '0000000000000000000000000000000000000000000000000000000000000003',
  BOB: '0000000000000000000000000000000000000000000000000000000000000004',
};

export type PoolAlias = keyof typeof PREFUNDED_HEX_SEEDS;

export class WalletPool {
  private cache = new Map<string, Promise<OwnWalletProvider>>();

  constructor(private readonly env: LocalNetworkConfig) {}

  /**
   * Build (and start) the wallet for `alias`. Promise-cached so parallel
   * `signerFor` calls dedupe. Throws if `alias` isn't a known prefunded slot.
   */
  signerFor(alias: string): Promise<OwnWalletProvider> {
    const seed = PREFUNDED_HEX_SEEDS[alias as PoolAlias];
    if (seed === undefined) {
      throw new Error(
        `WalletPool: unknown alias '${alias}'. Available: ${Object.keys(PREFUNDED_HEX_SEEDS).join(', ')}`,
      );
    }
    let cached = this.cache.get(alias);
    if (!cached) {
      cached = OwnWalletProvider.build(
        this.env,
        { seedHex: seed },
        { waitForFunds: true },
      );
      this.cache.set(alias, cached);
    }
    return cached;
  }

  /**
   * Stop every cached wallet and clear the cache. Call from `afterAll()`.
   */
  async reset(): Promise<void> {
    const entries = Array.from(this.cache.values());
    this.cache.clear();
    await Promise.all(
      entries.map(async (p) => {
        const w = await p;
        await w.stop();
      }),
    );
  }
}
