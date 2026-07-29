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

async function gql<T>(
  query: string,
  variables: Record<string, unknown>,
): Promise<T> {
  const res = await fetch(url(), {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ query, variables }),
  });
  if (!res.ok) {
    throw new Error(`indexer ${url()}: HTTP ${res.status}`);
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

/** The chain head height as the indexer sees it (0 before the first block). */
export async function indexerHead(): Promise<number> {
  const data = await gql<GqlHead>(HEAD_QUERY, {});
  return data.block?.height ?? 0;
}

/**
 * Every transaction the indexer has in blocks after `height`, oldest first.
 *
 * @param height - Exclusive lower bound, normally the head captured before the
 * call under test.
 * @param contractAddress - When given, keeps only transactions carrying a
 * contract action at that address.
 */
export async function publishedTxsSince(
  height: number,
  contractAddress?: string,
): Promise<PublishedTx[]> {
  const head = await indexerHead();
  const found: PublishedTx[] = [];

  for (let h = height + 1; h <= head; h++) {
    const data = await gql<GqlBlock>(BLOCK_TXS_QUERY, {
      offset: { height: h },
    });
    for (const tx of data.block?.transactions ?? []) {
      const calls = tx.contractActions
        .filter((action) => action.entryPoint !== undefined)
        .map((action) => ({
          address: action.address ?? '',
          entryPoint: action.entryPoint ?? '',
          state: action.state ?? '',
        }));
      if (contractAddress !== undefined) {
        const wanted = contractAddress.replace(/^0x/, '');
        if (!calls.some((call) => call.address.replace(/^0x/, '') === wanted)) {
          continue;
        }
      }
      found.push({ hash: tx.hash, raw: tx.raw, calls });
    }
  }
  return found;
}

/**
 * Polls until at least `min` transactions have been indexed after `height`.
 *
 * A call resolves once the node finalizes it, which can be a beat ahead of the
 * indexer having the block; without this a spec reads an empty window and
 * asserts nothing.
 *
 * @param height - Exclusive lower bound, the head captured before the call.
 * @param min - How many transactions to wait for.
 * @param timeoutMs - Give up after this long.
 */
export async function awaitPublishedTxs(
  height: number,
  min = 1,
  timeoutMs = 120_000,
): Promise<PublishedTx[]> {
  const deadline = Date.now() + timeoutMs;
  let seen: PublishedTx[] = [];
  while (Date.now() < deadline) {
    seen = await publishedTxsSince(height);
    if (seen.length >= min) {
      return seen;
    }
    await new Promise((resolve) => setTimeout(resolve, 1_000));
  }
  throw new Error(
    `indexer: expected ${min} transaction(s) after block ${height}, saw ${seen.length}`,
  );
}
