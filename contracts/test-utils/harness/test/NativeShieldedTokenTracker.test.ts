import {
  decodeShieldedCoinInfo,
  type EncodedShieldedCoinInfo,
} from '@midnight-ntwrk/compact-runtime';
import { coinCommitment, ZswapOutput } from '@midnight-ntwrk/ledger-v8';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it, vi } from 'vitest';
import { fetchCoinEvents, indexerHead } from '../ledgerEvents.js';
import {
  contractOwner,
  getQualifiedShieldedCoinInfo,
  getShieldedCoinTracker,
  NativeShieldedTokenTracker,
  type ShieldedOwner,
} from '../NativeShieldedTokenTracker.js';

/**
 * The coin tracker. Two surfaces are covered:
 *
 * - The pure backend-aware helpers (`contractOwner`, the dry branch of
 *   `getQualifiedShieldedCoinInfo`) — no indexer.
 * - The index-and-resolve logic — driven with a mocked indexer event stream
 *   (`ledgerEvents`) so it runs without a node. The commitment math stays real:
 *   fabricated 32-byte coins are valid crypto inputs, so a successful resolve
 *   proves the tracker computes the same commitment the indexer would emit.
 */

// Mock only the tracker's I/O boundary (the indexer event stream). Everything
// else — commitment computation, sync/retry/lookup logic — runs for real.
vi.mock('../ledgerEvents.js', () => ({
  indexerHead: vi.fn(),
  fetchCoinEvents: vi.fn(),
}));

const mockHead = vi.mocked(indexerHead);
const mockEvents = vi.mocked(fetchCoinEvents);

describe('coin tracker (dry surface)', () => {
  describe('contractOwner', () => {
    it('should map a deployed simulator to its contract-address owner', () => {
      const owner = contractOwner({
        _backend: { contractAddress: 'deadbeef' },
      });
      expect(owner).toStrictEqual({ kind: 'contract', address: 'deadbeef' });
    });
  });

  // These assert the *dry* passthrough (a placeholder `mt_index` of `0n`, no
  // indexer). On the live backend `getQualifiedShieldedCoinInfo` instead resolves
  // a real commitment, so the dry assertions don't apply — the live path is
  // exercised by the contract live specs, not here.
  describe.skipIf(isLiveBackend())(
    'getQualifiedShieldedCoinInfo (dry backend)',
    () => {
      const coin = {
        nonce: new Uint8Array(32).fill(7),
        color: new Uint8Array(32).fill(1),
        value: 1000n,
      };

      it('should return the coin with a placeholder mt_index of 0n', async () => {
        const owner: ShieldedOwner = { kind: 'contract', address: 'abc' };
        const qualified = await getQualifiedShieldedCoinInfo(owner, coin);
        expect(qualified).toStrictEqual({ ...coin, mt_index: 0n });
      });

      it('should not consult the indexer for a wallet owner on the dry backend', async () => {
        // No indexer is running here; a dry resolve must be a pure passthrough.
        const owner: ShieldedOwner = { kind: 'wallet', coinPublicKey: 'pk' };
        const qualified = await getQualifiedShieldedCoinInfo(owner, coin);
        expect(qualified.mt_index).toBe(0n);
        expect(qualified.value).toBe(1000n);
      });
    },
  );
});

describe('coin tracker (indexed resolution)', () => {
  const URL = 'http://indexer';
  const HEAD = 5;
  const COIN: EncodedShieldedCoinInfo = {
    nonce: new Uint8Array(32).fill(7),
    color: new Uint8Array(32).fill(1),
    value: 1000n,
  };
  const WALLET_PK = 'ab'.repeat(32);
  const CONTRACT_ADDR = `${'00'.repeat(31)}01`;

  // The exact commitments the tracker computes for COIN under each owner — the
  // values a real indexer would emit. Feeding them back through the mock proves
  // resolve matches the tracker's own commitment math.
  const walletCommitment = () =>
    coinCommitment(decodeShieldedCoinInfo(COIN), WALLET_PK);
  const contractCommitment = () =>
    ZswapOutput.newContractOwned(
      decodeShieldedCoinInfo(COIN),
      undefined,
      CONTRACT_ADDR,
    ).commitment;

  beforeEach(() => {
    mockHead.mockReset().mockResolvedValue(HEAD);
    mockEvents.mockReset().mockResolvedValue([]);
  });

  it('should resolve a wallet-owned coin to its mt_index', async () => {
    mockEvents.mockResolvedValue([
      { commitment: walletCommitment(), contract: undefined, mtIndex: 42n },
    ]);
    const tracker = await NativeShieldedTokenTracker.create(URL);
    const owner: ShieldedOwner = { kind: 'wallet', coinPublicKey: WALLET_PK };
    expect(await tracker.resolve(owner, COIN)).toStrictEqual({
      ...COIN,
      mt_index: 42n,
    });
  });

  it('should resolve a contract-owned coin to its mt_index', async () => {
    mockEvents.mockResolvedValue([
      {
        commitment: contractCommitment(),
        contract: CONTRACT_ADDR,
        mtIndex: 7n,
      },
    ]);
    const tracker = await NativeShieldedTokenTracker.create(URL);
    const owner = contractOwner({
      _backend: { contractAddress: CONTRACT_ADDR },
    });
    expect(await tracker.resolve(owner, COIN)).toStrictEqual({
      ...COIN,
      mt_index: 7n,
    });
  });

  it('should read the anchor block so a coin in the creation block is not missed', async () => {
    mockEvents.mockResolvedValue([
      { commitment: walletCommitment(), contract: undefined, mtIndex: 1n },
    ]);
    const tracker = await NativeShieldedTokenTracker.create(URL);
    await tracker.resolve({ kind: 'wallet', coinPublicKey: WALLET_PK }, COIN);
    // The first sync re-reads the anchor height (from === to === HEAD), so a coin
    // inserted in the block the tracker was created in is still captured.
    expect(mockEvents).toHaveBeenCalledWith(URL, HEAD, HEAD);
  });

  it('should throw, naming the synced height, if the coin never appears', async () => {
    mockEvents.mockResolvedValue([]);
    const tracker = await NativeShieldedTokenTracker.create(URL);
    await expect(
      tracker.resolve({ kind: 'wallet', coinPublicKey: WALLET_PK }, COIN, {
        retries: 2,
        delayMs: 0,
      }),
    ).rejects.toThrow('no indexed commitment');
  });
});

describe('getShieldedCoinTracker', () => {
  beforeEach(() => {
    mockHead.mockReset().mockResolvedValue(0);
    mockEvents.mockReset().mockResolvedValue([]);
  });

  it('should memoize a single process-wide tracker', async () => {
    const first = getShieldedCoinTracker();
    const second = getShieldedCoinTracker();
    expect(first).toBe(second);
    await expect(first).resolves.toBeInstanceOf(NativeShieldedTokenTracker);
  });
});
