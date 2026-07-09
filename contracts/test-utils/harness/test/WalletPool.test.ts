import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { DustFundingError } from '../dust.js';
import {
  coinPkEnv,
  type PooledWallet,
  WALLET_SEEDS,
  type WalletBuilder,
  WalletPool,
} from '../WalletPool.js';

// A testkit-free stand-in for a built wallet. `provider` is a sentinel we can
// identify by alias so `walletFor` resolution is checkable without a node.
interface FakeWallet extends PooledWallet {
  stopped: boolean;
}
function fakeWallet(alias: string): FakeWallet {
  return {
    provider: { alias } as unknown as PooledWallet['provider'],
    coinPublicKey: `pk-${alias}`,
    stopped: false,
    stop() {
      this.stopped = true;
      return Promise.resolve();
    },
  };
}

/** A builder that records what it built, so tests can assert dedup + teardown. */
function recordingBuilder(): {
  build: WalletBuilder;
  built: string[];
  created: Map<string, FakeWallet>;
} {
  const built: string[] = [];
  const created = new Map<string, FakeWallet>();
  const build: WalletBuilder = async (alias) => {
    built.push(alias);
    const w = fakeWallet(alias);
    created.set(alias, w);
    return w;
  };
  return { build, built, created };
}

const providerAlias = (p: PooledWallet['provider']): string =>
  (p as unknown as { alias: string }).alias;

const SEEDS = { deployer: 's-dep', SIGNER1: 's-1', SIGNER2: 's-2' };

// The pool publishes MIDNIGHT_<ALIAS>_COIN_PK into process.env — clear them so
// tests don't leak the fake keys into each other or the live projects.
afterEach(() => {
  for (const alias of Object.keys(SEEDS)) delete process.env[coinPkEnv(alias)];
});

describe('WalletPool', () => {
  describe('ensureReady', () => {
    it('should build every seed once and publish each coin public key', async () => {
      const { build, built } = recordingBuilder();
      await new WalletPool(SEEDS, build).ensureReady();

      expect([...built].sort()).toEqual(['SIGNER1', 'SIGNER2', 'deployer']);
      expect(process.env[coinPkEnv('deployer')]).toBe('pk-deployer');
      expect(process.env[coinPkEnv('SIGNER1')]).toBe('pk-SIGNER1');
      expect(process.env[coinPkEnv('SIGNER2')]).toBe('pk-SIGNER2');
    });

    it('should not rebuild wallets on a second call', async () => {
      const { build, built } = recordingBuilder();
      const pool = new WalletPool(SEEDS, build);
      await pool.ensureReady();
      await pool.ensureReady();
      expect(built.length).toBe(3);
    });

    it('should propagate a builder failure such as an unfunded seed', async () => {
      // The real builder throws DustFundingError when a seed can't pay fees;
      // ensureReady must surface it so the live setup fails fast.
      const build: WalletBuilder = (alias) => {
        if (alias === 'SIGNER1') throw new DustFundingError('SIGNER1', 0n);
        return Promise.resolve(fakeWallet(alias));
      };
      await expect(new WalletPool(SEEDS, build).ensureReady()).rejects.toThrow(
        DustFundingError,
      );
    });
  });

  describe('walletFor', () => {
    it('should resolve a known alias to its own wallet', async () => {
      const { build } = recordingBuilder();
      const pool = new WalletPool(SEEDS, build);
      await pool.ensureReady();
      expect(providerAlias(pool.walletFor('SIGNER1'))).toBe('SIGNER1');
    });

    it('should fall back to the deployer for an unknown or empty alias', async () => {
      const { build } = recordingBuilder();
      const pool = new WalletPool(SEEDS, build);
      await pool.ensureReady();
      expect(providerAlias(pool.walletFor('OTHER'))).toBe('deployer');
      expect(providerAlias(pool.walletFor(null))).toBe('deployer');
      expect(providerAlias(pool.walletFor(undefined))).toBe('deployer');
    });

    it('should throw before the pool is ready', () => {
      const { build } = recordingBuilder();
      expect(() => new WalletPool(SEEDS, build).walletFor('SIGNER1')).toThrow(
        /not initialized/,
      );
    });
  });

  describe('isKnownAlias', () => {
    it('should recognize a pooled seed', () => {
      const { build } = recordingBuilder();
      const pool = new WalletPool(SEEDS, build);
      expect(pool.isKnownAlias('SIGNER1')).toBe(true);
      expect(pool.isKnownAlias('deployer')).toBe(true);
    });

    it('should not recognize an unknown or empty alias', () => {
      const { build } = recordingBuilder();
      const pool = new WalletPool(SEEDS, build);
      expect(pool.isKnownAlias('OTHER')).toBe(false);
      expect(pool.isKnownAlias(null)).toBe(false);
      expect(pool.isKnownAlias(undefined)).toBe(false);
    });
  });

  describe('reset', () => {
    it('should stop every wallet and empty the pool', async () => {
      const { build, created } = recordingBuilder();
      const pool = new WalletPool(SEEDS, build);
      await pool.ensureReady();

      await pool.reset();

      for (const w of created.values()) expect(w.stopped).toBe(true);
      expect(() => pool.walletFor('SIGNER1')).toThrow(/not initialized/);
    });
  });

  describe('WALLET_SEEDS defaults', () => {
    it('should expose the deployer plus three signer slots', () => {
      expect(Object.keys(WALLET_SEEDS).sort()).toEqual([
        'SIGNER1',
        'SIGNER2',
        'SIGNER3',
        'deployer',
      ]);
    });

    it('should map the deployer alias to the DEPLOYER env var', () => {
      expect(coinPkEnv('deployer')).toBe('MIDNIGHT_DEPLOYER_COIN_PK');
      expect(coinPkEnv('SIGNER1')).toBe('MIDNIGHT_SIGNER1_COIN_PK');
    });
  });
});

// Live smoke against the local stack (`make env-up`): builds the real pooled
// wallets and proves the dust fix end-to-end (the gate passes or names the
// unfunded seed). Runs only on `MIDNIGHT_BACKEND=live`; skipped on the dry run.
describe.runIf(isLiveBackend())('WalletPool (live smoke)', () => {
  let pool: WalletPool;
  let published: Record<string, string | undefined>;

  beforeAll(async () => {
    // Load the live-only deps here so the dry run never imports testkit.
    const [{ setNetworkId }, { createLogger }, { FundedWallet }, { localEnv }] =
      await Promise.all([
        import('@midnight-ntwrk/midnight-js-network-id'),
        import('@midnight-ntwrk/testkit-js'),
        import('../FundedWallet.js'),
        import('../network.js'),
      ]);
    setNetworkId('undeployed');
    const env = localEnv();
    const logger = createLogger('logs/live-harness.log');
    pool = new WalletPool(WALLET_SEEDS, (alias, walletSeed) =>
      FundedWallet.build(env, alias, walletSeed, logger),
    );
    // Throws DustFundingError (naming the alias) if a seed can't pay fees.
    await pool.ensureReady();
    // Snapshot the published keys now, before the dry afterEach clears any.
    published = Object.fromEntries(
      Object.keys(WALLET_SEEDS).map((alias) => [
        alias,
        process.env[coinPkEnv(alias)],
      ]),
    );
  });

  afterAll(async () => {
    await pool?.reset();
  });

  it('should publish a distinct, non-empty coin public key for every pooled wallet', () => {
    const keys = Object.values(published);
    for (const key of keys) {
      expect(typeof key).toBe('string');
      expect((key as string).length).toBeGreaterThan(0);
    }
    expect(new Set(keys).size).toBe(keys.length);
  });

  it('should resolve each signer to its own funded wallet matching the published key', () => {
    for (const alias of ['SIGNER1', 'SIGNER2', 'SIGNER3']) {
      expect(String(pool.walletFor(alias).getCoinPublicKey())).toBe(
        published[alias],
      );
    }
  });

  it('should fall back an unknown alias to the deployer wallet', () => {
    expect(pool.walletFor('OTHER')).toBe(pool.walletFor('deployer'));
  });

  it('should resolve a known signer to a wallet distinct from the deployer', () => {
    expect(pool.walletFor('SIGNER1')).not.toBe(pool.walletFor('deployer'));
  });
});
