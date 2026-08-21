/**
 * The parties a concurrency spec races against each other.
 *
 * Two things every such spec needs, whatever the contract: each party holds its
 * own private inputs, and each party calls through its own contract instance so
 * the witnesses answer with those inputs. The ledger they share lives in the
 * harness, not on the instances, which is what makes them concurrent rather than
 * independent.
 *
 * Secrets are derived from the party's name, not sampled, so a failing case
 * reproduces and a spec can compute the derived identities once at module level.
 */

/**
 * Deterministic bytes from a label, zero-padded.
 *
 * @param label - Party name, or any tag the spec wants to be reproducible.
 * @param size - Byte length; 32 suits a Compact `Bytes<32>` secret.
 */
export function labelledSecret(label: string, size = 32): Uint8Array {
  const bytes = new Uint8Array(size);
  const encoded = new TextEncoder().encode(label);
  if (encoded.length > size) {
    throw new Error(
      `labelledSecret: '${label}' needs ${encoded.length} bytes, limit is ${size}`,
    );
  }
  bytes.set(encoded);
  return bytes;
}

/** One party: its private inputs, and the contract instance bound to them. */
export interface Party<W, C> {
  readonly name: string;
  /** The private-input holder the witnesses read, mutable between calls. */
  readonly wallet: W;
  readonly contract: C;
}

/** How to build one party, for a given contract's witnesses. */
export interface PartyFactory<W, C> {
  /** Fresh private-input holder, seeded from `label` so it is reproducible. */
  wallet: (label: string) => W;
  /** Contract instance whose witnesses answer from `wallet`. */
  contract: (wallet: W) => C;
}

export interface PartySet<W, C> {
  readonly parties: Readonly<Record<string, Party<W, C>>>;
  /** Ready to hand straight to `createConcurrencyHarness({ contracts })`. */
  readonly contracts: Readonly<Record<string, C>>;
}

/**
 * Builds one party per name, plus the `contracts` record the harness wants.
 *
 * @param names - Actor names, used verbatim as `Call.actor`.
 * @param factory - Contract-specific wallet and contract construction.
 */
export function createParties<W, C>(
  names: readonly string[],
  factory: PartyFactory<W, C>,
): PartySet<W, C> {
  const parties: Record<string, Party<W, C>> = {};
  const contracts: Record<string, C> = {};

  for (const name of names) {
    const wallet = factory.wallet(name);
    const contract = factory.contract(wallet);
    parties[name] = { name, wallet, contract };
    contracts[name] = contract;
  }

  return { parties, contracts };
}
