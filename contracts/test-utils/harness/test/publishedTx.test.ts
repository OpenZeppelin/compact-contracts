/**
 * Tests for the published-transaction transport, `fetch` stubbed.
 *
 * The point of interest is the timeout contract. `awaitPublishedTxs` documents
 * "give up after this long", and enforcing that needs a bound on each request as
 * well as between polls, since `publishedTxsSince` issues one request per block.
 * A hung socket used to outlive the deadline entirely.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  awaitPublishedTxs,
  BlockNotIndexed,
  DeadlinePassed,
  IndexerTimeout,
  indexerHead,
  publishedTxsSince,
} from '../publishedTx.js';

// ---------------------------------------------------------------------------
// Stubbing the indexer
// ---------------------------------------------------------------------------

const realFetch = globalThis.fetch;

/** A GraphQL 200 carrying `data`. */
const ok = (data: unknown): Response =>
  ({
    ok: true,
    status: 200,
    json: async () => ({ data }),
  }) as unknown as Response;

/** The contract under observation. Stub blocks carry calls to this address. */
const ADDR = '0xc0ffee';

const head = (height: number | null) => ({
  block: height === null ? null : { height },
});

const blockWith = (
  height: number,
  actions: readonly Record<string, unknown>[],
) => ({
  block: {
    height,
    transactions: [
      {
        hash: `0xtx${height}`,
        raw: `0xraw${height}`,
        contractActions: actions,
      },
    ],
  },
});

/** A block the indexer has, carrying nothing. */
const emptyBlock = (height: number) => ({
  block: { height, transactions: [] },
});

/** One call to `ADDR`, the shape a spec is waiting for. */
const ourCall = { address: ADDR, entryPoint: 'transfer', state: '0xs' };

/** The call the specs below wait for. */
const TRANSFER = { entryPoint: 'transfer' };

/** A call to `ADDR` under another entry point. */
const callTo = (entryPoint: string) => ({
  address: ADDR,
  entryPoint,
  state: '0xs',
});

/** A height the indexer reports as head but has no block for yet. */
const notIndexed = { block: null };

/**
 * Routes a stubbed request by its query. `heights` answers Head; `block`
 * answers a per-block read from the height it was asked for.
 */
const indexerStub = (
  heightFor: () => number | null,
  block: (height: number) => unknown,
) =>
  vi.fn((_url: string, init?: unknown) => {
    const body = JSON.parse(String((init as { body?: string })?.body));
    if (body.query.includes('Head')) {
      return Promise.resolve(ok(head(heightFor())));
    }
    return Promise.resolve(ok(block(body.variables.offset.height)));
  });

/** What undici raises when an `AbortSignal.timeout` fires, without the wait. */
const timedOut = (): Promise<Response> => {
  const error = new Error('The operation was aborted due to timeout');
  error.name = 'TimeoutError';
  return Promise.reject(error);
};

/** Never settles until aborted, which is what a stuck indexer looks like. */
const hang = (init?: { signal?: AbortSignal }): Promise<Response> =>
  new Promise((_resolve, reject) => {
    init?.signal?.addEventListener('abort', () => {
      // What undici raises when an `AbortSignal.timeout` fires.
      const error = new Error('The operation was aborted due to timeout');
      error.name = 'TimeoutError';
      reject(error);
    });
  });

/**
 * Headers arrived, the body never does: `json()` settles only when the request
 * signal aborts, with the abort itself as the rejection.
 */
const stalledBody = (init?: { signal?: AbortSignal }): Response =>
  ({
    ok: true,
    status: 200,
    json: () =>
      new Promise((_resolve, reject) => {
        init?.signal?.addEventListener('abort', () => {
          const error = new Error('This operation was aborted');
          error.name = 'AbortError';
          reject(error);
        });
      }),
  }) as unknown as Response;

let fetchMock: ReturnType<typeof vi.fn>;

beforeEach(() => {
  fetchMock = vi.fn();
  globalThis.fetch = fetchMock as unknown as typeof fetch;
});

afterEach(() => {
  globalThis.fetch = realFetch;
  vi.useRealTimers();
});

// ---------------------------------------------------------------------------
// The timeout contract
// ---------------------------------------------------------------------------

describe('awaitPublishedTxs timeout', () => {
  it('should give up on a stuck indexer instead of hanging', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) => hang(init),
    );

    const started = Date.now();
    await expect(awaitPublishedTxs(0, ADDR, TRANSFER, 300)).rejects.toThrow(
      /timed out waiting for a call to "transfer" at 0xc0ffee after block 0 \(entry points seen there: none\)/,
    );

    // The assertion that matters: bounded by the caller's deadline, not by
    // undici's far longer body timeout.
    expect(Date.now() - started).toBeLessThan(3_000);
  });

  // Without the cause, a spec that fails here sees only "saw 0" and cannot
  // tell a stuck indexer from a contract that published nothing.
  it('should keep the timeout as the cause of the failure', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) => hang(init),
    );

    try {
      await awaitPublishedTxs(0, ADDR, TRANSFER, 300);
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).cause).toBeInstanceOf(IndexerTimeout);
      expect(((error as Error).cause as Error).message).toMatch(/no response/);
    }
  });

  // A stale cause would send a reader after a healthy indexer.
  it('should report a short window, not a timeout, once the indexer answers again', async () => {
    let call = 0;
    fetchMock.mockImplementation((_url: string, init?: unknown) => {
      call += 1;
      if (call === 1) {
        return timedOut();
      }
      const body = JSON.parse(String((init as { body?: string })?.body));
      return Promise.resolve(
        body.query.includes('Head') ? ok(head(1)) : ok(emptyBlock(1)),
      );
    });

    try {
      await awaitPublishedTxs(0, ADDR, TRANSFER, 1_500);
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).message).toMatch(
        /expected a call to "transfer" at 0xc0ffee after block 0 \(entry points seen there: none\)/,
      );
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it('classifies a body read cut short by the signal as a timeout', async () => {
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) =>
        Promise.resolve(stalledBody(init)),
    );

    try {
      await awaitPublishedTxs(0, ADDR, TRANSFER, 300);
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).message).toMatch(
        /timed out waiting for a call to "transfer"/,
      );
      expect((error as Error).cause).toBeInstanceOf(IndexerTimeout);
      expect(((error as Error).cause as Error).message).toMatch(
        /body not received/,
      );
    }
  });

  it('keeps polling after a body read times out', async () => {
    let call = 0;
    fetchMock.mockImplementation((_url: string, init?: unknown) => {
      call += 1;
      if (call === 1) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: () => timedOut(),
        } as unknown as Response);
      }
      const body = JSON.parse(String((init as { body?: string })?.body));
      return Promise.resolve(
        body.query.includes('Head') ? ok(head(1)) : ok(blockWith(1, [ourCall])),
      );
    });

    const txs = await awaitPublishedTxs(0, ADDR, TRANSFER, 30_000);

    expect(txs.map((tx) => tx.hash)).toStrictEqual(['0xtx1']);
    expect(fetchMock.mock.calls.length).toBeGreaterThan(1);
  });

  it('should pass an abort signal on every request', async () => {
    fetchMock.mockResolvedValue(ok(head(0)));

    await indexerHead();

    const init = fetchMock.mock.calls[0]?.[1] as { signal?: AbortSignal };
    expect(init.signal).toBeInstanceOf(AbortSignal);
  });

  it('should stop issuing per-block requests once the deadline passes', async () => {
    // A head far ahead of the lower bound: unbounded, this would be 5000 requests.
    fetchMock.mockImplementation(
      (_url: string, init?: { signal?: AbortSignal }) => {
        const body = JSON.parse(String((init as { body?: string })?.body));
        return body.query.includes('Head')
          ? Promise.resolve(ok(head(5_000)))
          : hang(init);
      },
    );

    await expect(awaitPublishedTxs(0, ADDR, TRANSFER, 300)).rejects.toThrow(
      /timed out waiting for a call to "transfer"/,
    );

    // One head plus a bounded handful of block reads, nowhere near 5000.
    expect(fetchMock.mock.calls.length).toBeLessThan(20);
  });

  it('reports a short window when the deadline passes between the check and the request', async () => {
    fetchMock.mockResolvedValue(ok(head(0)));
    // Clock reads in order: the deadline is set, the loop check sees it not yet
    // reached, and the request budget sees it gone. Every later read stays there.
    const started = 1_000_000;
    const now = vi
      .spyOn(Date, 'now')
      .mockReturnValueOnce(started)
      .mockReturnValueOnce(started + 299)
      .mockReturnValue(started + 300);

    try {
      await expect(awaitPublishedTxs(0, ADDR, TRANSFER, 300)).rejects.toThrow(
        /expected a call to "transfer" at 0xc0ffee after block 0 \(entry points seen there: none\)/,
      );
      expect(fetchMock).not.toHaveBeenCalled();
    } finally {
      now.mockRestore();
    }
  });

  it('rejects with DeadlinePassed when the deadline is already gone', async () => {
    await expect(publishedTxsSince(0, ADDR, Date.now() - 1)).rejects.toThrow(
      DeadlinePassed,
    );
  });
});

// ---------------------------------------------------------------------------
// Protocol failures still surface at once
// ---------------------------------------------------------------------------

describe('protocol failures', () => {
  it('should surface an HTTP error rather than polling through it', async () => {
    fetchMock.mockResolvedValue({
      ok: false,
      status: 503,
    } as unknown as Response);

    await expect(awaitPublishedTxs(0, ADDR, TRANSFER, 30_000)).rejects.toThrow(
      /HTTP 503/,
    );
    // Not retried: one call, and the deadline was never consulted.
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it('should surface GraphQL errors', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({ errors: [{ message: 'unknown field' }] }),
    } as unknown as Response);

    await expect(indexerHead()).rejects.toThrow(/unknown field/);
  });

  it('should surface an empty data payload', async () => {
    fetchMock.mockResolvedValue({
      ok: true,
      status: 200,
      json: async () => ({}),
    } as unknown as Response);

    await expect(indexerHead()).rejects.toThrow(/empty data/);
  });
});

// ---------------------------------------------------------------------------
// Reading a window
// ---------------------------------------------------------------------------

describe('publishedTxsSince', () => {
  it('should report 0 for a head the indexer has no block for', async () => {
    fetchMock.mockResolvedValue(ok(head(null)));

    expect(await indexerHead()).toBe(0);
  });

  it('should keep only actions carrying an entry point', async () => {
    fetchMock.mockImplementation((_url: string, init?: unknown) => {
      const body = JSON.parse(String((init as { body?: string })?.body));
      return Promise.resolve(
        body.query.includes('Head')
          ? ok(head(1))
          : ok(
              blockWith(1, [
                // A deploy in the same block contributes no entry point.
                { address: '0xdeployed', state: '0xs' },
                { address: '0xcalled', entryPoint: 'transfer', state: '0xs' },
              ]),
            ),
      );
    });

    const [tx] = await publishedTxsSince(0);

    expect(tx?.calls).toStrictEqual([
      { address: '0xcalled', entryPoint: 'transfer', state: '0xs' },
    ]);
  });

  it('should filter by contract address, ignoring a 0x prefix', async () => {
    fetchMock.mockImplementation((_url: string, init?: unknown) => {
      const body = JSON.parse(String((init as { body?: string })?.body));
      return Promise.resolve(
        body.query.includes('Head')
          ? ok(head(1))
          : ok(
              blockWith(1, [
                { address: 'abc123', entryPoint: 'transfer', state: '0xs' },
              ]),
            ),
      );
    });

    expect(await publishedTxsSince(0, '0xabc123')).toHaveLength(1);
    expect(await publishedTxsSince(0, '0xdeadbeef')).toHaveLength(0);
  });

  it('rejects a window holding a block the indexer has not stored', async () => {
    fetchMock = indexerStub(
      () => 2,
      (height) => (height === 1 ? blockWith(1, [ourCall]) : notIndexed),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const reading = publishedTxsSince(0);

    await expect(reading).rejects.toThrow(BlockNotIndexed);
    await expect(reading).rejects.toThrow(
      'indexer: block 2 not indexed yet (head 2)',
    );
  });

  it('rejects a block returned at another height as a protocol failure', async () => {
    fetchMock = indexerStub(
      () => 1,
      () => blockWith(7, [ourCall]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const reading = publishedTxsSince(0);

    await expect(reading).rejects.toThrow(
      'indexer: asked for block 1, got block 7',
    );
    await expect(reading).rejects.not.toBeInstanceOf(IndexerTimeout);
  });
});

// ---------------------------------------------------------------------------
// Polling until the awaited call lands
// ---------------------------------------------------------------------------

describe('awaitPublishedTxs polling', () => {
  it('should return the txs once the indexer catches up', async () => {
    // The lag this function exists to absorb: the node finalized the call, the
    // indexer has not got the block yet.
    let indexedHead = 0;
    fetchMock = indexerStub(
      () => indexedHead,
      (height) => blockWith(height, [ourCall]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;
    setTimeout(() => {
      indexedHead = 1;
    }, 50);

    const txs = await awaitPublishedTxs(0, ADDR, TRANSFER, 30_000);

    expect(txs).toHaveLength(1);
    expect(txs[0]?.hash).toBe('0xtx1');
  });

  it('should read every block in the window, oldest first', async () => {
    fetchMock = indexerStub(
      () => 3,
      (height) => blockWith(height, [ourCall]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const txs = await awaitPublishedTxs(0, ADDR, TRANSFER, 30_000);

    expect(txs.map((tx) => tx.hash)).toStrictEqual(['0xtx1', '0xtx2', '0xtx3']);
  });

  it('should ignore txs from another contract', async () => {
    // A concurrent spec's traffic. Counting it would let this call return
    // before the contract under test published anything.
    fetchMock = indexerStub(
      () => 1,
      (height) =>
        blockWith(height, [
          { address: '0xsomeoneelse', entryPoint: 'transfer', state: '0xs' },
        ]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(awaitPublishedTxs(0, ADDR, TRANSFER, 300)).rejects.toThrow(
      /expected a call to "transfer" at 0xc0ffee after block 0 \(entry points seen there: none\)/,
    );
  });

  it('waits past an earlier call to the same contract under another entry point', async () => {
    // The head was read before the indexer had the mint, so the window opens
    // on it.
    let headReads = 0;
    fetchMock = indexerStub(
      () => {
        headReads += 1;
        return headReads === 1 ? 1 : 2;
      },
      (height) => blockWith(height, [callTo(height === 1 ? 'mint' : 'burn')]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const txs = await awaitPublishedTxs(
      0,
      ADDR,
      { entryPoint: 'burn' },
      30_000,
    );

    expect(txs.map((tx) => tx.hash)).toStrictEqual(['0xtx2']);
    expect(headReads).toBe(2);
  });

  it('names the entry points seen when the awaited call never lands', async () => {
    fetchMock = indexerStub(
      () => 1,
      (height) => blockWith(height, [callTo('mint')]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await awaitPublishedTxs(0, ADDR, { entryPoint: 'burn' }, 300);
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).message).toBe(
        'indexer: expected a call to "burn" at 0xc0ffee after block 0 ' +
          '(entry points seen there: mint)',
      );
      expect((error as Error).cause).toBeUndefined();
    }
  });

  it('keeps polling through a block not indexed yet, then returns it', async () => {
    let blockReads = 0;
    fetchMock = indexerStub(
      () => 1,
      (height) => {
        blockReads += 1;
        return blockReads === 1 ? notIndexed : blockWith(height, [ourCall]);
      },
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    const txs = await awaitPublishedTxs(0, ADDR, TRANSFER, 30_000);

    expect(txs.map((tx) => tx.hash)).toStrictEqual(['0xtx1']);
    expect(blockReads).toBe(2);
  });

  it('fails with the not-indexed cause when the block never appears', async () => {
    fetchMock = indexerStub(
      () => 1,
      () => notIndexed,
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    try {
      await awaitPublishedTxs(0, ADDR, TRANSFER, 300);
      expect.unreachable('expected a throw');
    } catch (error) {
      expect((error as Error).message).toBe(
        'indexer: timed out waiting for a call to "transfer" at 0xc0ffee ' +
          'after block 0 (entry points seen there: none); ' +
          'last request: indexer: block 1 not indexed yet (head 1)',
      );
      expect((error as Error).cause).toBeInstanceOf(BlockNotIndexed);
    }
  });

  it('fails at once on a block returned at another height', async () => {
    fetchMock = indexerStub(
      () => 1,
      () => blockWith(7, [ourCall]),
    );
    globalThis.fetch = fetchMock as unknown as typeof fetch;

    await expect(awaitPublishedTxs(0, ADDR, TRANSFER, 30_000)).rejects.toThrow(
      'indexer: asked for block 1, got block 7',
    );
    // Not retried: one head read, one block read.
    expect(fetchMock).toHaveBeenCalledTimes(2);
  });
});
