import {
  type EnvironmentConfiguration,
  MidnightWalletProvider,
} from '@midnight-ntwrk/testkit-js';
import pino, { type Logger } from 'pino';

/**
 * Multi-signer wallet pool for AccessControl + caller-override CMA tests.
 *
 * Approach: leverage the four pre-funded genesis seeds that
 * `LocalTestEnvironment` exposes for the dev-preset Midnight node.
 * Each alias is mapped to one of those seeds; building a wallet from
 * the seed yields an already-funded `MidnightWalletProvider`. No
 * derivation-and-fund-from-genesis tx is needed — much faster setup.
 *
 * Limitation: only 3 named aliases are available beyond the deployer
 * (LocalTestEnvironment supports `MAX_NUMBER_OF_WALLETS = 4`; we use
 * `0x…0001` for the deployer wallet via the existing `buildWallet`
 * helper, leaving `0x…0002`–`0x…0004` for the pool). Adding more
 * aliases requires either rotating the same seeds across tests or a
 * derive-and-fund flow (a deferred concern, out of scope here).
 */

/** Hex 32-byte seeds prefunded by the dev-preset Midnight node. */
export const PREFUNDED_HEX_SEEDS: Record<string, string> = {
  ADMIN: '0000000000000000000000000000000000000000000000000000000000000002',
  ALICE: '0000000000000000000000000000000000000000000000000000000000000003',
  BOB: '0000000000000000000000000000000000000000000000000000000000000004',
};

export type PoolAlias = keyof typeof PREFUNDED_HEX_SEEDS;

let sharedLogger: Logger | undefined;
function poolLogger(): Logger {
  if (!sharedLogger) {
    sharedLogger = pino({ level: process.env.LOG_LEVEL ?? 'warn' });
  }
  return sharedLogger;
}

export class WalletPool {
  private cache = new Map<string, Promise<MidnightWalletProvider>>();

  constructor(private readonly env: EnvironmentConfiguration) {}

  /**
   * Build (and start) the wallet for `alias`. Promise-cached so parallel
   * `signerFor` calls dedupe. Throws if `alias` isn't a known prefunded slot.
   */
  signerFor(alias: string): Promise<MidnightWalletProvider> {
    const seed = PREFUNDED_HEX_SEEDS[alias as PoolAlias];
    if (seed === undefined) {
      throw new Error(
        `WalletPool: unknown alias '${alias}'. Available: ${Object.keys(PREFUNDED_HEX_SEEDS).join(', ')}`,
      );
    }
    let cached = this.cache.get(alias);
    if (!cached) {
      cached = (async () => {
        const wallet = await MidnightWalletProvider.build(
          poolLogger(),
          this.env,
          seed,
        );
        await wallet.start(true);
        return wallet;
      })();
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
