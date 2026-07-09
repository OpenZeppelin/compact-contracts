import { beforeEach, describe, expect, it, vi } from 'vitest';
import { UNDEPLOYED_FEE_OVERHEAD } from '../dust.js';

const NIGHT_RAW = 'night-raw-token';

// Mock testkit + ledger-v8 so we can drive FundedWallet.build with no node and
// assert the wiring that matters: the dust fee overhead is applied, the wallet
// starts without the fire-and-forget fund wait, and both balances are reported.
const m = vi.hoisted(() => {
  const start = vi.fn(async (_wait?: boolean) => {});
  const stop = vi.fn(async () => {});
  const provider = {
    start,
    stop,
    getCoinPublicKey: () => 'coin-pk-xyz',
    wallet: { id: 'facade' },
  };
  const builder = {
    withSeed: vi.fn().mockReturnThis(),
    withDustOptions: vi.fn().mockReturnThis(),
    buildWithoutStarting: vi.fn(async () => ({
      wallet: { id: 'facade' },
      seeds: { shielded: new Uint8Array([1]), dust: new Uint8Array([2]) },
      keystore: { id: 'keystore' },
    })),
  };
  // A synced-state stub whose NIGHT + dust balances tests can vary.
  const syncState = { night: 250_000_000_000_000n, dust: 0n };
  const syncWallet = vi.fn(async () => ({
    unshielded: { balances: { [NIGHT_RAW]: syncState.night } },
    dust: { balance: (_d: Date) => syncState.dust },
  }));
  return {
    start,
    stop,
    provider,
    builder,
    syncState,
    withWallet: vi.fn(async () => provider),
    waitForFunds: vi.fn(async () => 250_000_000_000_000n),
    syncWallet,
  };
});

vi.mock('@midnight-ntwrk/testkit-js', () => ({
  FluentWalletBuilder: { forEnvironment: vi.fn(() => m.builder) },
  MidnightWalletProvider: { withWallet: m.withWallet },
  DEFAULT_DUST_OPTIONS: {
    ledgerParams: {},
    additionalFeeOverhead: 0n,
    feeBlocksMargin: 5,
  },
  waitForFunds: m.waitForFunds,
  syncWallet: m.syncWallet,
}));

vi.mock('@midnight-ntwrk/midnight-js-protocol/ledger', () => ({
  unshieldedToken: () => ({ raw: NIGHT_RAW }),
}));

vi.mock('@midnight-ntwrk/ledger-v8', () => ({
  ZswapSecretKeys: { fromSeed: vi.fn(() => ({ kind: 'zswap' })) },
  DustSecretKey: { fromSeed: vi.fn(() => ({ kind: 'dust' })) },
}));

import { FundedWallet } from '../FundedWallet.js';

const ENV = {} as never; // LocalTestConfiguration is type-only in FundedWallet
const LOGGER = { info: vi.fn() } as never;
const build = () => FundedWallet.build(ENV, 'SIGNER1', 'seed-hex', LOGGER);

describe('FundedWallet.build', () => {
  beforeEach(() => {
    vi.clearAllMocks();
    m.syncState.night = 250_000_000_000_000n;
    m.syncState.dust = 0n;
    m.waitForFunds.mockResolvedValue(250_000_000_000_000n);
  });

  it('should apply the undeployed dust fee overhead', async () => {
    await build();
    expect(m.builder.withDustOptions).toHaveBeenCalledWith(
      expect.objectContaining({
        additionalFeeOverhead: UNDEPLOYED_FEE_OVERHEAD,
      }),
    );
  });

  it('should start the wallet without the fire-and-forget fund wait', async () => {
    await build();
    expect(m.start).toHaveBeenCalledWith(false);
  });

  it('should expose the provider coin public key', async () => {
    const wallet = await build();
    expect(wallet.coinPublicKey).toBe('coin-pk-xyz');
  });

  it('should delegate stop to the provider', async () => {
    const wallet = await build();
    await wallet.stop();
    expect(m.stop).toHaveBeenCalledTimes(1);
  });

  it('should report funded and carry both balances for a NIGHT-holding seed', async () => {
    m.waitForFunds.mockResolvedValueOnce(250_000_000_000_000n);
    m.syncState.dust = 0n;
    const wallet = await build();
    expect(wallet.nightBalance).toBe(250_000_000_000_000n);
    expect(wallet.isFunded).toBe(true);
  });

  it('should report unfunded when the seed holds neither NIGHT nor dust', async () => {
    m.waitForFunds.mockResolvedValueOnce(0n);
    m.syncState.dust = 0n;
    const wallet = await build();
    expect(wallet.isFunded).toBe(false);
  });

  it('should report funded on dust alone (NIGHT registered for dust generation)', async () => {
    m.waitForFunds.mockResolvedValueOnce(0n);
    m.syncState.dust = 4_600_000_000_000_000_000n;
    const wallet = await build();
    expect(wallet.nightBalance).toBe(0n);
    expect(wallet.isFunded).toBe(true);
  });

  it('should refresh both balances after a top-up', async () => {
    m.waitForFunds.mockResolvedValueOnce(0n);
    m.syncState.dust = 0n;
    const wallet = await build();
    expect(wallet.isFunded).toBe(false);

    // A top-up landed: NIGHT registered for dust, dust now present.
    m.syncState.night = 0n;
    m.syncState.dust = 4_600_000_000_000_000_000n;
    await wallet.refresh();
    expect(wallet.nightBalance).toBe(0n);
    expect(wallet.dustBalance).toBe(4_600_000_000_000_000_000n);
    expect(wallet.isFunded).toBe(true);
  });
});
