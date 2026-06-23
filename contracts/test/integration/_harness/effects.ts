/**
 * Decoders for the Zswap effects a contract call records in its transcript.
 *
 * The indexer does not expose structured effects, but `callTx`'s finalized
 * public result carries the deserialized `Transaction` at `.public.tx`. Walk
 * `tx.intents.values() -> intent.actions -> ContractCall.{guaranteed,fallible}Transcript
 * -> effects` (ledger-v8) to read what a third party could reconstruct from
 * public data: minted amounts per token-color domain (`shieldedMints`) and the
 * coin commitments a receive/spend claimed.
 *
 * Types are intentionally loose: the ledger-v8 objects are WASM-backed and not
 * part of this repo's typed surface.
 */

// biome-ignore lint/suspicious/noExplicitAny: WASM-backed ledger-v8 objects
type Any = any;

/** Hex-encode a Uint8Array (effects map keys are hex strings already; coin
 * commitments / public keys come back as bytes or hex depending on the type). */
export function toHex(v: Uint8Array | string): string {
  if (typeof v === 'string') return v;
  return Buffer.from(v).toString('hex');
}

/** Every ContractCall transcript (guaranteed + fallible) in a finalized tx. */
function* transcripts(finalizedPublic: Any): Generator<Any> {
  const tx = finalizedPublic?.tx;
  if (!tx?.intents?.values) return;
  for (const intent of tx.intents.values()) {
    const actions: Any[] = intent?.actions ?? [];
    for (const action of actions) {
      const g = safeGet(() => action.guaranteedTranscript);
      const f = safeGet(() => action.fallibleTranscript);
      if (g) yield g;
      if (f) yield f;
    }
  }
}

function safeGet<T>(fn: () => T): T | undefined {
  try {
    return fn();
  } catch {
    return undefined;
  }
}

/**
 * Sum of `shieldedMints` per token-color domain across all contract calls in
 * the tx. Keys are 32-byte domain separators (hex); values are minted u64s.
 * This is the "independently verifiable from public shieldedMints" quantity.
 */
export function decodeShieldedMints(finalizedPublic: Any): Map<string, bigint> {
  const out = new Map<string, bigint>();
  for (const t of transcripts(finalizedPublic)) {
    const sm = safeGet(() => t?.effects?.shieldedMints);
    if (sm?.forEach) {
      sm.forEach((v: bigint, k: Uint8Array | string) => {
        const key = toHex(k);
        out.set(key, (out.get(key) ?? 0n) + BigInt(v));
      });
    }
  }
  return out;
}

/** Total minted across all colors in the tx. */
export function totalShieldedMinted(finalizedPublic: Any): bigint {
  let sum = 0n;
  for (const v of decodeShieldedMints(finalizedPublic).values()) sum += v;
  return sum;
}

/** The coin commitments claimed by `receiveShielded` across the tx. */
export function decodeClaimedReceives(finalizedPublic: Any): string[] {
  const out: string[] = [];
  for (const t of transcripts(finalizedPublic)) {
    const cr = safeGet(() => t?.effects?.claimedShieldedReceives);
    if (Array.isArray(cr)) {
      for (const c of cr) out.push(commitmentHex(c));
    } else if (cr?.forEach) {
      cr.forEach((c: Any) => out.push(commitmentHex(c)));
    }
  }
  return out;
}

/** A flat, lower-cased hex dump of every byte-ish field reachable in the tx's
 * contract-call effects + transcripts. Used by privacy assertions to prove a
 * value (e.g. a recipient public key) does NOT appear anywhere in public data. */
export function publicEffectsHexBlob(finalizedPublic: Any): string {
  const parts: string[] = [];
  const push = (v: Any) => {
    if (v == null) return;
    if (v instanceof Uint8Array) parts.push(toHex(v));
    else if (typeof v === 'string') parts.push(v.toLowerCase());
    else if (typeof v?.toString === 'function') {
      const s = v.toString();
      if (typeof s === 'string') parts.push(s.toLowerCase());
    }
  };
  for (const t of transcripts(finalizedPublic)) {
    const eff = safeGet(() => t?.effects);
    push(safeGet(() => t?.toString()));
    if (eff) {
      for (const field of [
        'claimedNullifiers',
        'claimedShieldedReceives',
        'claimedShieldedSpends',
        'shieldedMints',
      ]) {
        const col = safeGet(() => eff[field]);
        if (Array.isArray(col)) for (const c of col) push(c);
        else if (col?.forEach) col.forEach((v: Any, k: Any) => {
          push(k);
          push(v);
        });
      }
    }
  }
  // Also include the whole serialized tx as a backstop.
  push(safeGet(() => Buffer.from(finalizedPublic.tx.serialize()).toString('hex')));
  return parts.join('|');
}

function commitmentHex(c: Any): string {
  if (c instanceof Uint8Array) return toHex(c);
  if (typeof c === 'string') return c.toLowerCase();
  const s = safeGet(() => c?.toString());
  return typeof s === 'string' ? s.toLowerCase() : String(c);
}
