/**
 * Live transport for the transactions a spec's calls actually published.
 *
 * The dry backend hands a spec `proofData.publicTranscript`, a faithful preimage
 * of what a transaction will carry. This is the other end of that claim: the
 * serialized transaction as the indexer stored it, which is what a real
 * observer sees. A privacy spec asserts against this rather than a proxy.
 *
 * Deliberately isolated the way `ledgerEvents.ts` is: one query, `fetch` only,
 * so an indexer schema change is a one-file fix.
 */

import { PORTS } from './network.js';

/** A transaction as published, plus the contract calls it carried. */
export interface PublishedTx {
  readonly hash: string;
  /** The whole serialized transaction, hex. Everything an observer receives. */
  readonly raw: string;
  /** Per contract call: the entry point invoked and the resulting state. */
  readonly calls: ReadonlyArray<{
    readonly address: string;
    readonly entryPoint: string;
    readonly state: string;
  }>;
}

interface GqlHead {
  block: { height: number } | null;
}

interface GqlBlock {
  block: {
    height: number;
    transactions: ReadonlyArray<{
      hash: string;
      raw: string;
      contractActions: ReadonlyArray<{
        address?: string;
        entryPoint?: string;
        state?: string;
      }>;
    }>;
  } | null;
}

const HEAD_QUERY = 'query Head { block { height } }';

// `entryPoint` lives on the ContractCall variant of the ContractAction
// interface, so it needs an inline fragment; a deploy in the same block
// contributes no entry point.
const BLOCK_TXS_QUERY = `query BlockTxs($offset: BlockOffset) {
  block(offset: $offset) {
    height
    transactions {
      hash
      raw
      contractActions {
        address
        state
        ... on ContractCall { entryPoint }
      }
    }
  }
}`;

const url = (): string => `http://127.0.0.1:${PORTS.indexer}/api/v4/graphql`;

/** Ceiling for a single request. The indexer is local; 10s means it is stuck. */
const REQUEST_TIMEOUT_MS = 10_000;

/** How long to wait between polls. */
const POLL_INTERVAL_MS = 1_000;

/**
 * Ran out of time, either on one request or on the caller's whole deadline.
 *
 * Kept distinct from a protocol failure so {@link awaitPublishedTxs} can poll
 * through transient slowness while a real indexer error still surfaces at once.
 */
export class IndexerTimeout extends Error {}

/** The caller's deadline ran out before a request was sent; nothing was asked of the indexer. */
export class DeadlinePassed extends IndexerTimeout {}

/** The head is past a block the indexer cannot serve yet. Retryable. */
export class BlockNotIndexed extends IndexerTimeout {}

/** The call a spec waits for: its entry point at the contract under test. */
export interface AwaitedCall {
  readonly entryPoint: string;
}

const bare = (address: string): string => address.replace(/^0x/, '');

/**
 * How long one request may take: its own ceiling, or whatever is left of the
 * caller's deadline, whichever is smaller.
 *
 * Bounding by the remainder is the point. A fixed per-request ceiling would still
 * let `publishedTxsSince` overrun, since it issues one request per block.
 */
function requestBudget(deadline: number | undefined): number {
  if (deadline === undefined) {
    return REQUEST_TIMEOUT_MS;
  }
  const remaining = deadline - Date.now();
  if (remaining <= 0) {
    throw new DeadlinePassed(
      'indexer: deadline passed before the next request',
    );
  }
  return Math.min(remaining, REQUEST_TIMEOUT_MS);
}

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
  deadline?: number,
): Promise<T> {
  const budget = requestBudget(deadline);
  // Without this a hung socket outlives any caller deadline: `fetch` has no
  // total-response timeout, and undici's body timeout is far longer than the
  // poll budget callers ask for.
  const signal = AbortSignal.timeout(budget);
  const timedOut = (cause: unknown): boolean =>
    signal.aborted ||
    (cause instanceof Error &&
      (cause.name === 'TimeoutError' || cause.name === 'AbortError'));

  let res: Response;
  try {
    res = await fetch(url(), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ query, variables }),
      signal,
    });
  } catch (cause) {
    if (timedOut(cause)) {
      throw new IndexerTimeout(`indexer ${url()}: no response in ${budget}ms`, {
        cause,
      });
    }
    throw cause;
  }
  if (!res.ok) {
    throw new Error(`indexer ${url()}: HTTP ${res.status}`);
  }
  // The signal also cuts a body read short, so that abort is a timeout too.
  let body: { data?: T; errors?: unknown };
  try {
    body = (await res.json()) as { data?: T; errors?: unknown };
  } catch (cause) {
    if (timedOut(cause)) {
      throw new IndexerTimeout(
        `indexer ${url()}: body not received in ${budget}ms`,
        { cause },
      );
    }
    throw cause;
  }
  if (body.errors) {
    throw new Error(`indexer gql errors: ${JSON.stringify(body.errors)}`);
  }
  if (!body.data) {
    throw new Error('indexer gql: empty data');
  }
  return body.data;
}

/**
 * The chain head height as the indexer sees it (0 before the first block).
 *
 * @param deadline - Absolute epoch-ms bound. Omit to use the request ceiling.
 */
export async function indexerHead(deadline?: number): Promise<number> {
  const data = await gql<GqlHead>(HEAD_QUERY, {}, deadline);
  return data.block?.height ?? 0;
}

/**
 * Every transaction the indexer has in blocks after `height`, oldest first.
 *
 * @param height - Exclusive lower bound, normally the head captured before the
 * call under test.
 * @param contractAddress - When given, keeps only transactions carrying a
 * contract action at that address.
 * @param deadline - Absolute epoch-ms bound covering EVERY request this makes,
 * one per block. Omit to bound each request individually instead.
 * @throws {BlockNotIndexed} When a block at or below the head is missing: a
 * partial window would read as complete.
 * @throws When a block comes back at another height than the one asked for.
 */
export async function publishedTxsSince(
  height: number,
  contractAddress?: string,
  deadline?: number,
): Promise<PublishedTx[]> {
  const head = await indexerHead(deadline);
  const found: PublishedTx[] = [];

  for (let h = height + 1; h <= head; h++) {
    // Throws once the deadline passes, which is what bounds this loop. Better
    // than returning a truncated window the caller would read as complete.
    const data = await gql<GqlBlock>(
      BLOCK_TXS_QUERY,
      { offset: { height: h } },
      deadline,
    );
    if (data.block === null) {
      throw new BlockNotIndexed(
        `indexer: block ${h} not indexed yet (head ${head})`,
      );
    }
    if (data.block.height !== h) {
      throw new Error(
        `indexer: asked for block ${h}, got block ${data.block.height}`,
      );
    }
    for (const tx of data.block.transactions) {
      const calls = tx.contractActions
        .filter((action) => action.entryPoint !== undefined)
        .map((action) => ({
          address: action.address ?? '',
          entryPoint: action.entryPoint ?? '',
          state: action.state ?? '',
        }));
      if (contractAddress !== undefined) {
        const wanted = bare(contractAddress);
        if (!calls.some((call) => bare(call.address) === wanted)) {
          continue;
        }
      }
      found.push({ hash: tx.hash, raw: tx.raw, calls });
    }
  }
  return found;
}

/**
 * Polls until a transaction after `height` carries the awaited call, and
 * returns only the transactions carrying it.
 *
 * `height` comes from the indexer, which can lag the node, so the window can
 * hold calls the spec made before it read the head. Await an entry point the
 * spec calls once on this contract.
 *
 * @param height - Exclusive lower bound, the head captured before the call.
 * @param contractAddress - The contract the awaited call targets.
 * @param want - The call under test.
 * @param timeoutMs - Give up after this long. Enforced across requests, not only
 * between polls, so a stuck indexer cannot outlive it.
 * @throws On giving up, naming the entry points seen at the address. A
 * timed-out request or a missing block is kept as `cause`.
 */
export async function awaitPublishedTxs(
  height: number,
  contractAddress: string,
  want: AwaitedCall,
  timeoutMs = 120_000,
): Promise<PublishedTx[]> {
  const deadline = Date.now() + timeoutMs;
  const wanted = bare(contractAddress);
  let seen: PublishedTx[] = [];
  let lastTimeout: IndexerTimeout | undefined;

  while (Date.now() < deadline) {
    try {
      seen = await publishedTxsSince(height, contractAddress, deadline);
      // The indexer answered, so any earlier timeout is stale: a window
      // without the call is a missing transaction, not a stuck indexer.
      lastTimeout = undefined;
    } catch (cause) {
      // The clock crossed the deadline between the loop check and the request.
      // Nothing was asked of the indexer, so it is not a timeout to report.
      if (cause instanceof DeadlinePassed) {
        break;
      }
      // Slowness is what this function exists to absorb, so keep polling while
      // time remains. A protocol failure is a real defect: surface it at once.
      if (!(cause instanceof IndexerTimeout)) {
        throw cause;
      }
      lastTimeout = cause;
    }
    const matching = seen.filter((tx) =>
      tx.calls.some(
        (call) =>
          bare(call.address) === wanted && call.entryPoint === want.entryPoint,
      ),
    );
    if (matching.length > 0) {
      return matching;
    }
    const pause = Math.min(POLL_INTERVAL_MS, deadline - Date.now());
    if (pause <= 0) {
      break;
    }
    await new Promise((resolve) => setTimeout(resolve, pause));
  }

  const entryPoints = seen.flatMap((tx) =>
    tx.calls
      .filter((call) => bare(call.address) === wanted)
      .map((call) => call.entryPoint),
  );
  const awaited =
    `a call to "${want.entryPoint}" at ${contractAddress} after block ${height} ` +
    `(entry points seen there: ${entryPoints.join(', ') || 'none'})`;

  // A timeout and a window without the call are different failures: one says
  // the indexer stopped answering, the other that it answered and the call is
  // not there. Only the first has a cause worth keeping.
  if (lastTimeout !== undefined) {
    throw new Error(
      `indexer: timed out waiting for ${awaited}; ` +
        `last request: ${lastTimeout.message}`,
      { cause: lastTimeout },
    );
  }
  throw new Error(`indexer: expected ${awaited}`);
}
