import { Event, type EventDetails } from '@midnight-ntwrk/ledger-v8';

/**
 * Live transport for the indexer's global zswap ledger-event stream — the source
 * of truth for a coin's real `mt_index` and its owner. Deliberately isolated: the
 * one query the tracker depends on lives here, so a schema tweak after a live
 * probe is a one-file change. Uses `fetch` only (no websocket, no new deps).
 *
 * Each `ZswapLedgerEvent.raw` is a hex `Event`; we keep the `zswapOutput` variant
 * `{ commitment, contract?, mtIndex }` — a coin entering the tree, with its owner
 * (`contract` set → contract-owned) and global index.
 */

/** A coin-commitment output: an owned coin at a known global index. */
export interface CoinOutputEvent {
  readonly commitment: string;
  readonly contract: string | undefined;
  readonly mtIndex: bigint;
}

interface GqlBlockEventsData {
  block: {
    transactions: ReadonlyArray<{
      zswapLedgerEvents: ReadonlyArray<{ raw: string }>;
    }>;
  } | null;
}

const HEAD_QUERY = 'query Head { block { height } }';

const BLOCK_EVENTS_QUERY = `query BlockEvents($offset: BlockOffset) {
  block(offset: $offset) {
    transactions { zswapLedgerEvents { raw } }
  }
}`;

async function gql<T>(
  url: string,
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`indexer ${url}: HTTP ${res.status}`);
  }
  const body = (await res.json()) as { data?: T; errors?: unknown };
  if (body.errors) {
    throw new Error(`indexer gql errors: ${JSON.stringify(body.errors)}`);
  }
  if (!body.data) {
    throw new Error('indexer gql: empty data');
  }
  return body.data;
}

/** The current chain head height as the indexer sees it (0 if none yet). */
export async function indexerHead(url: string): Promise<number> {
  const data = await gql<{ block: { height: number } | null }>(
    url,
    HEAD_QUERY,
    {},
  );
  return data.block?.height ?? 0;
}

function decodeOutput(rawHex: string): CoinOutputEvent | undefined {
  // `EventDetails` ends in a `{ tag: string }` catch-all, so a `tag` check alone
  // does not narrow field access — pin the concrete variant with `Extract`.
  const content = Event.deserialize(Buffer.from(rawHex, 'hex')).content;
  if (content.tag !== 'zswapOutput') return undefined;
  const output = content as Extract<EventDetails, { tag: 'zswapOutput' }>;
  return {
    commitment: output.commitment,
    contract: output.contract,
    mtIndex: output.mtIndex,
  };
}

/**
 * All zswap coin-commitment outputs in blocks `[fromHeight, toHeight]`
 * (inclusive), in block order. Re-reading a block is safe: downstream indexing
 * is idempotent by commitment.
 */
export async function fetchCoinEvents(
  url: string,
  fromHeight: number,
  toHeight: number,
): Promise<CoinOutputEvent[]> {
  const events: CoinOutputEvent[] = [];
  for (let height = Math.max(0, fromHeight); height <= toHeight; height++) {
    const data = await gql<GqlBlockEventsData>(url, BLOCK_EVENTS_QUERY, {
      offset: { height },
    });
    for (const tx of data.block?.transactions ?? []) {
      for (const event of tx.zswapLedgerEvents) {
        const output = decodeOutput(event.raw);
        if (output) events.push(output);
      }
    }
  }
  return events;
}
