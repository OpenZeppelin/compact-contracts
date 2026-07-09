import {
  decodeShieldedCoinInfo,
  type EncodedQualifiedShieldedCoinInfo,
  type EncodedShieldedCoinInfo,
} from '@midnight-ntwrk/compact-runtime';
import { coinCommitment, ZswapOutput } from '@midnight-ntwrk/ledger-v8';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { fetchCoinEvents, indexerHead } from './ledgerEvents.js';

/**
 * The owner of a shielded coin, for resolving its commitment: a contract (by
 * address) or a wallet (by coin public key). Both arms use the same global
 * event index — the owner only decides how the coin's commitment is computed.
 */
export type ShieldedOwner =
  | { readonly kind: 'contract'; readonly address: string }
  | { readonly kind: 'wallet'; readonly coinPublicKey: string };

/**
 * Resolves a shielded coin — contract- or wallet-owned — to its
 * `QualifiedShieldedCoinInfo`: the coin plus its `mt_index`, the coin-commitment
 * tree position required to spend it on-chain.
 *
 * It reads the index (never computes it) by indexing the indexer's global zswap
 * ledger-event stream, whose output events carry each coin's owner and index. So
 * it follows every coin the chain emits — across any transaction — not one offer.
 *
 * Resolves coins whose fields (nonce/color/value) are known. Auto-discovering an
 * unknown wallet coin (ciphertext-only) is the wallet SDK's job.
 */
export class ShieldedCoinTracker {
  private readonly outputs = new Map<
    string,
    { contract: string | undefined; mtIndex: bigint }
  >();
  private lastHeight: number;

  private constructor(
    private readonly url: string,
    head: number,
  ) {
    this.lastHeight = head;
  }

  /** Builds a tracker anchored at the current chain head. */
  static async create(url: string): Promise<ShieldedCoinTracker> {
    return new ShieldedCoinTracker(url, await indexerHead(url));
  }

  /**
   * Pulls new ledger events up to the current head into the index. Re-reads the
   * anchor block (idempotent) so a coin inserted in the same block the tracker
   * was created in is never missed.
   */
  private async sync(): Promise<void> {
    const head = await indexerHead(this.url);
    if (head < this.lastHeight) return;
    for (const event of await fetchCoinEvents(
      this.url,
      this.lastHeight,
      head,
    )) {
      this.outputs.set(event.commitment, {
        contract: event.contract,
        mtIndex: event.mtIndex,
      });
    }
    this.lastHeight = head + 1;
  }

  /** The on-chain commitment for `coin` under `owner`. */
  private commitmentFor(
    owner: ShieldedOwner,
    coin: EncodedShieldedCoinInfo,
  ): string {
    const runtimeCoin = decodeShieldedCoinInfo(coin);
    return owner.kind === 'contract'
      ? ZswapOutput.newContractOwned(runtimeCoin, undefined, owner.address)
          .commitment
      : coinCommitment(runtimeCoin, owner.coinPublicKey);
  }

  /**
   * Syncs (retrying to absorb indexer lag) until `coin`'s output is indexed, then
   * returns it with its `mt_index`. Call after the transaction that created the
   * coin. Throws if it never appears (never created on-chain, or wrong fields).
   */
  async resolve(
    owner: ShieldedOwner,
    coin: EncodedShieldedCoinInfo,
    {
      retries = 20,
      delayMs = 500,
    }: { retries?: number; delayMs?: number } = {},
  ): Promise<EncodedQualifiedShieldedCoinInfo> {
    const commitment = this.commitmentFor(owner, coin);
    for (let attempt = 0; attempt < retries; attempt++) {
      await this.sync();
      const record = this.outputs.get(commitment);
      if (record) return { ...coin, mt_index: record.mtIndex };
      await new Promise((resolve) => setTimeout(resolve, delayMs));
    }
    throw new Error(
      `coin tracker: no indexed commitment for coin under ${owner.kind} (synced through height ${this.lastHeight - 1}) — was it created on-chain?`,
    );
  }
}

let trackerPromise: Promise<ShieldedCoinTracker> | undefined;

/**
 * The process-wide {@link ShieldedCoinTracker}, anchored at the chain head on
 * first use. The indexer URL is derived from `MIDNIGHT_INDEXER_PORT` (default
 * `8088`), matching the harness. Depends only on the indexer over `fetch`, so it
 * is decoupled from the testkit live harness (a dry spec can import this module
 * without pulling in testkit — it just never calls this on dry).
 */
export function getShieldedCoinTracker(): Promise<ShieldedCoinTracker> {
  if (!trackerPromise) {
    const port = process.env.MIDNIGHT_INDEXER_PORT ?? '8088';
    trackerPromise = ShieldedCoinTracker.create(
      `http://127.0.0.1:${port}/api/v4/graphql`,
    );
  }
  return trackerPromise;
}

/** A {@link ShieldedOwner} for a deployed simulator (a contract), read from its
 * backend address. Works on both backends (dry has an address too). */
export const contractOwner = (sim: {
  readonly _backend: { readonly contractAddress: string };
}): ShieldedOwner => ({
  kind: 'contract',
  address: sim._backend.contractAddress,
});

/**
 * Gets the qualified coin — the coin plus its `mt_index` (the position needed to
 * spend it) — for a coin the spec just created under `owner`, so one spec runs on
 * both backends. Dry: a placeholder `0n` the in-memory runtime ignores. Live: the
 * real global index, looked up from the tracker's index of the indexer's event
 * stream. Call after the transaction that created the coin.
 */
export async function getQualifiedShieldedCoinInfo(
  owner: ShieldedOwner,
  coin: EncodedShieldedCoinInfo,
): Promise<EncodedQualifiedShieldedCoinInfo> {
  if (!isLiveBackend()) return { ...coin, mt_index: 0n };
  return (await getShieldedCoinTracker()).resolve(owner, coin);
}
