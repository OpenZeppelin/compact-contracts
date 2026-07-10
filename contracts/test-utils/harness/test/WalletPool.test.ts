import { isLiveBackend } from '@openzeppelin/compact-simulator';
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from 'vitest';
import { DustFundingError } from '../dust.js';
import {
  coinPkEnv,
  MAX_LIVE_WORKERS,
  type PooledWallet,
  WALLET_SEEDS,
  type WalletBuilder,
  WalletPool,
  walletSeedsFor,
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

  describe('walletSeedsFor / WALLET_SEEDS', () => {
    // A 64-hex seed with the given last byte(s), mirroring WalletPool's `seed`.
    const s = (hex: string): string => '0'.repeat(64 - hex.length) + hex;
    // The exact-value assertions assume the deployer isn't pinned; save/restore
    // any real override so the suite stays hermetic.
    const savedSeed = process.env.MIDNIGHT_WALLET_SEED;
    beforeEach(() => {
      delete process.env.MIDNIGHT_WALLET_SEED;
    });
    afterAll(() => {
      if (savedSeed === undefined) delete process.env.MIDNIGHT_WALLET_SEED;
      else process.env.MIDNIGHT_WALLET_SEED = savedSeed;
    });

    it('should give each worker a genesis deployer and derived signers', () => {
      expect(walletSeedsFor(1)).toStrictEqual({
        deployer: s('01'),
        SIGNER1: s('11'),
        SIGNER2: s('12'),
        SIGNER3: s('13'),
      });
      expect(walletSeedsFor(2)).toStrictEqual({
        deployer: s('02'),
        SIGNER1: s('21'),
        SIGNER2: s('22'),
        SIGNER3: s('23'),
      });
      expect(walletSeedsFor(3)).toStrictEqual({
        deployer: s('03'),
        SIGNER1: s('31'),
        SIGNER2: s('32'),
        SIGNER3: s('33'),
      });
    });

    it('should produce 64-hex seeds disjoint across workers', () => {
      const all: string[] = [];
      for (let w = 1; w <= MAX_LIVE_WORKERS; w++) {
        for (const value of Object.values(walletSeedsFor(w))) {
          expect(value).toMatch(/^[0-9a-f]{64}$/);
          all.push(value);
        }
      }
      expect(new Set(all).size).toBe(all.length);
    });

    it('should keep signer seeds out of the genesis set', () => {
      const genesis = new Set(['01', '02', '03', '04'].map(s));
      for (let w = 1; w <= MAX_LIVE_WORKERS; w++) {
        const { deployer: _deployer, ...signers } = walletSeedsFor(w);
        for (const value of Object.values(signers)) {
          expect(genesis.has(value)).toBe(false);
        }
      }
    });

    it('should override only worker 1 deployer via MIDNIGHT_WALLET_SEED', () => {
      const pinned = 'ff'.repeat(32);
      process.env.MIDNIGHT_WALLET_SEED = pinned;
      expect(walletSeedsFor(1).deployer).toBe(pinned);
      expect(walletSeedsFor(2).deployer).toBe(s('02'));
      expect(walletSeedsFor(3).deployer).toBe(s('03'));
    });

    it('WALLET_SEEDS should be the worker-1 pool', () => {
      expect(Object.keys(WALLET_SEEDS).sort()).toEqual([
        'SIGNER1',
        'SIGNER2',
        'SIGNER3',
        'deployer',
      ]);
      const w1 = walletSeedsFor(1);
      expect(WALLET_SEEDS.SIGNER1).toBe(w1.SIGNER1);
      expect(WALLET_SEEDS.SIGNER2).toBe(w1.SIGNER2);
      expect(WALLET_SEEDS.SIGNER3).toBe(w1.SIGNER3);
      expect(WALLET_SEEDS.deployer).toMatch(/^[0-9a-f]{64}$/);
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
    // Mirror the live setup: build this worker's own disjoint partition.
    const worker = Number(process.env.VITEST_POOL_ID ?? '1');
    const seeds = walletSeedsFor(worker);
    const logger = createLogger(`logs/live-harness-w${worker}.log`);
    pool = new WalletPool(seeds, (alias, walletSeed) =>
      FundedWallet.build(env, alias, walletSeed, logger),
    );
    // Throws DustFundingError (naming the alias) if a seed can't pay fees.
    await pool.ensureReady();
    // Snapshot the published keys now, before the dry afterEach clears any.
    published = Object.fromEntries(
      Object.keys(seeds).map((alias) => [alias, process.env[coinPkEnv(alias)]]),
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
