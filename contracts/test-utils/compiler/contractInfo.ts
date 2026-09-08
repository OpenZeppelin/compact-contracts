/**
 * Reads and types `contract-info.json`, the compiler's description of a
 * contract's published surface: ledger slots and their indices, and which
 * circuits a client can call. Emitted on every build, `--skip-zk` included.
 *
 * Declared rather than imported because no package describes this file. The near
 * misses: `CompactType<A>` (`compact-runtime`) is a runtime codec, not a static
 * shape; `SparseCompactADT` (same package) is tagged `'cell' | 'set' | 'list' |
 * 'map'`, a partial vocabulary for finding contract references. Every variant
 * below is derived from the 472 compiled artifacts in this monorepo, and
 * {@link readContractInfo} rejects anything outside them.
 *
 * Circuit complexity (k, rows) is not here; see
 * OpenZeppelin/compact-contracts#750.
 */

import { readFileSync } from 'node:fs';

// ---------------------------------------------------------------------------
// Type descriptors
// ---------------------------------------------------------------------------

/**
 * Every `type-name` the compiler emits.
 *
 * `List` and `Map` appear here as well as in {@link LedgerStorage} because a
 * `Map` slot's value may itself be a collection, written as a type descriptor.
 *
 * The array is the single source: the type is derived from it and so is the
 * runtime check, so the two cannot drift. On an unrecognized name, add the
 * variant here. Widening to `string` defeats the point.
 */
const COMPACT_TYPE_NAMES = [
  'Alias',
  'Boolean',
  'Bytes',
  'Enum',
  'Field',
  'List',
  'Map',
  'Opaque',
  'Struct',
  'Tuple',
  'Uint',
  'Vector',
] as const;

export type CompactTypeName = (typeof COMPACT_TYPE_NAMES)[number];

/** A struct field, or a circuit or witness parameter. */
export interface NamedCompactType {
  readonly name: string;
  readonly type: CompactTypeInfo;
}

/** `Field`, the native scalar. A `bigint` at runtime. */
export interface FieldTypeInfo {
  readonly 'type-name': 'Field';
}

/** `Boolean`. A `boolean` at runtime. */
export interface BooleanTypeInfo {
  readonly 'type-name': 'Boolean';
}

/** `Bytes<length>`. A `Uint8Array` at runtime. */
export interface BytesTypeInfo {
  readonly 'type-name': 'Bytes';
  readonly length: number;
}

/**
 * `Uint<n>`, given as an inclusive maximum.
 *
 * CAUTION: a JSON number, so anything above 2^53 is already imprecise. `Uint<128>`
 * reads back as `3.402823669209385e+38` and fails a `BigInt` round trip. Fine to
 * compare against another parse of the same file; never an exact bound.
 */
export interface UintTypeInfo {
  readonly 'type-name': 'Uint';
  readonly maxval: number;
}

/**
 * `Opaque<"...">`, passed through uninterpreted.
 *
 * `tsType` stays `string` because it is author-supplied, unlike the rest of this
 * union. Seen here: `'string'`, and `'JubjubPoint'` (the `compact-runtime`
 * interface of that name).
 */
export interface OpaqueTypeInfo {
  readonly 'type-name': 'Opaque';
  readonly tsType: string;
}

/** `Vector<length, T>`, fixed-length and homogeneous. */
export interface VectorTypeInfo {
  readonly 'type-name': 'Vector';
  readonly length: number;
  readonly type: CompactTypeInfo;
}

/** A tuple: fixed-length, heterogeneous. */
export interface TupleTypeInfo {
  readonly 'type-name': 'Tuple';
  readonly types: readonly CompactTypeInfo[];
}

/** A named struct. `elements` order is the encoding. */
export interface StructTypeInfo {
  readonly 'type-name': 'Struct';
  readonly name: string;
  readonly elements: readonly NamedCompactType[];
}

/** A named enum. `elements` holds the ordered variant names. */
export interface EnumTypeInfo {
  readonly 'type-name': 'Enum';
  readonly name: string;
  readonly elements: readonly string[];
}

/** A named alias. Transparent to the encoding. */
export interface AliasTypeInfo {
  readonly 'type-name': 'Alias';
  readonly name: string;
  readonly type: CompactTypeInfo;
}

/** A `List` in type position, i.e. as a `Map` slot's value. */
export interface ListTypeInfo {
  readonly 'type-name': 'List';
  readonly type: CompactTypeInfo;
}

/** A `Map` in type position, i.e. as an outer `Map` slot's value. */
export interface MapTypeInfo {
  readonly 'type-name': 'Map';
  readonly key: CompactTypeInfo;
  readonly value: CompactTypeInfo;
}

/**
 * Any Compact type, discriminated on `type-name`, so `length` is reachable only
 * on `Bytes` and `Vector`, `maxval` only on `Uint`, and so on.
 */
export type CompactTypeInfo =
  | AliasTypeInfo
  | BooleanTypeInfo
  | BytesTypeInfo
  | EnumTypeInfo
  | FieldTypeInfo
  | ListTypeInfo
  | MapTypeInfo
  | OpaqueTypeInfo
  | StructTypeInfo
  | TupleTypeInfo
  | UintTypeInfo
  | VectorTypeInfo;

// ---------------------------------------------------------------------------
// Ledger slots
// ---------------------------------------------------------------------------

/** Every ledger ADT the compiler emits as a slot's `storage`. */
const LEDGER_STORAGE_KINDS = [
  'Cell',
  'Counter',
  'HistoricMerkleTree',
  'List',
  'Map',
  'MerkleTree',
  'Set',
] as const;

export type LedgerStorage = (typeof LEDGER_STORAGE_KINDS)[number];

/** What every ledger slot carries, whatever its storage kind. */
interface LedgerSlotBase {
  readonly name: string;
  /** The storage slot, fixed by declaration order. Reordering repoints readers. */
  readonly index: number;
  /** Whether the slot appears in the generated `ledger()` reader. */
  readonly exported: boolean;
}

/** A single value. */
export interface CellSlot extends LedgerSlotBase {
  readonly storage: 'Cell';
  readonly type: CompactTypeInfo;
}

/** A monotonic counter. Carries NO `type`: the element type is implied. */
export interface CounterSlot extends LedgerSlotBase {
  readonly storage: 'Counter';
}

/** A set of values. */
export interface SetSlot extends LedgerSlotBase {
  readonly storage: 'Set';
  readonly type: CompactTypeInfo;
}

/** An ordered list of values. */
export interface ListSlot extends LedgerSlotBase {
  readonly storage: 'List';
  readonly type: CompactTypeInfo;
}

/**
 * A key-value map. Carries `key` and `value` INSTEAD OF `type`; reading `.type`
 * on a map slot is the mistake this union makes impossible.
 */
export interface MapSlot extends LedgerSlotBase {
  readonly storage: 'Map';
  readonly key: CompactTypeInfo;
  readonly value: CompactTypeInfo;
}

/**
 * A Merkle tree accepting only the CURRENT root, so any insert invalidates every
 * in-flight proof. Contrast {@link HistoricMerkleTreeSlot}.
 */
export interface MerkleTreeSlot extends LedgerSlotBase {
  readonly storage: 'MerkleTree';
  /** Capacity is `2^depth` leaves, and is part of the serialized form. */
  readonly depth: number;
  readonly type: CompactTypeInfo;
}

/**
 * A Merkle tree accepting any recently-current root, which is what lets a spend
 * land while others insert.
 */
export interface HistoricMerkleTreeSlot extends LedgerSlotBase {
  readonly storage: 'HistoricMerkleTree';
  /** Capacity is `2^depth` leaves, and is part of the serialized form. */
  readonly depth: number;
  readonly type: CompactTypeInfo;
}

/**
 * One ledger field, discriminated on `storage`.
 *
 * A union because the variants genuinely differ: `Counter` has no element type,
 * `Map` splits it into `key`/`value`, and only trees carry `depth`.
 */
export type LedgerSlot =
  | CellSlot
  | CounterSlot
  | HistoricMerkleTreeSlot
  | ListSlot
  | MapSlot
  | MerkleTreeSlot
  | SetSlot;

// ---------------------------------------------------------------------------
// Circuits, witnesses, and the file as a whole
// ---------------------------------------------------------------------------

/** One circuit the contract exposes. */
export interface CircuitInfo {
  readonly name: string;
  /** A pure circuit reads no state and is callable off-chain for free. */
  readonly pure: boolean;
  /**
   * Whether the circuit gets a verifier key, and so whether a deployed instance
   * can be called at all. False for an empty public transcript: reading witnesses
   * without touching the ledger leaves nothing to verify. Impure does not imply
   * provable.
   */
  readonly proof: boolean;
  readonly arguments: readonly NamedCompactType[];
  readonly 'result-type': CompactTypeInfo;
}

/**
 * One witness the caller must supply. Note `'result type'` with a SPACE, where
 * {@link CircuitInfo} uses a hyphen. That is the compiler's inconsistency.
 */
export interface WitnessInfo {
  readonly name: string;
  readonly arguments: readonly NamedCompactType[];
  readonly 'result type': CompactTypeInfo;
}

/** The whole of `contract-info.json`. */
export interface ContractInfo {
  readonly 'compiler-version': string;
  readonly 'language-version': string;
  readonly 'runtime-version': string;
  readonly circuits: readonly CircuitInfo[];
  readonly witnesses: readonly WitnessInfo[];
  /** Child contracts. `unknown` because it is empty in all 472 artifacts here. */
  readonly contracts: readonly unknown[];
  /**
   * The public ledger, in declaration order. Always present; `[]` when the
   * contract declares no ledger state.
   */
  readonly ledger: readonly LedgerSlot[];
}

/** A circuit reduced to the three facts that decide how a client may call it. */
export type CircuitSurface = Pick<CircuitInfo, 'name' | 'pure' | 'proof'>;

// ---------------------------------------------------------------------------
// Binding a pin to the compiler's other output
// ---------------------------------------------------------------------------

/**
 * Names from the generated `contract/index.d.ts`, the compiler's other output.
 *
 * It exports `PureCircuits`, `ProvableCircuits<PS>` (callable on a deployed
 * instance), `ImpureCircuits<PS>`, `Circuits<PS>`, `Ledger` (exported slots only),
 * and `Witnesses<PS>`, all keyed by name. Keying a pin off those makes a rename a
 * compile error rather than a runtime surprise.
 */
export type NameOf<T> = keyof T & string;

/**
 * A record that must mention every name in `Names` and no others, so a missing
 * key, a stray key, and a typo are all compile errors.
 *
 * `Exclude<NameOf<ImpureCircuits<PS>>, NameOf<ProvableCircuits<PS>>>` gives the
 * impure-but-not-callable set without restating it.
 */
export type Exhaustive<Names extends string, Value = true> = Record<
  Names,
  Value
>;

// ---------------------------------------------------------------------------
// Reading
// ---------------------------------------------------------------------------

const TYPE_NAMES: ReadonlySet<string> = new Set(COMPACT_TYPE_NAMES);
const STORAGE_KINDS: ReadonlySet<string> = new Set(LEDGER_STORAGE_KINDS);

const REQUIRED_STRINGS = [
  'compiler-version',
  'language-version',
  'runtime-version',
] as const;

const REQUIRED_ARRAYS = [
  'circuits',
  'witnesses',
  'contracts',
  'ledger',
] as const;

/**
 * Rejects any `type-name` or `storage` outside the declared unions, wherever it
 * is nested.
 *
 * A blanket walk rather than a shape-aware one: descriptors nest through
 * structs, vectors, tuples, aliases and map values, and a walk keeps working
 * when the compiler adds another position.
 */
function assertKnownTags(node: unknown, artifactName: string): void {
  if (Array.isArray(node)) {
    for (const child of node) assertKnownTags(child, artifactName);
    return;
  }
  if (typeof node !== 'object' || node === null) {
    return;
  }
  const record = node as Record<string, unknown>;

  const typeName = record['type-name'];
  if (typeof typeName === 'string' && !TYPE_NAMES.has(typeName)) {
    throw new Error(
      `readContractInfo: unrecognized type-name '${typeName}' in ` +
        `'${artifactName}'; add the variant to CompactTypeName`,
    );
  }

  const storage = record.storage;
  if (typeof storage === 'string' && !STORAGE_KINDS.has(storage)) {
    throw new Error(
      `readContractInfo: unrecognized ledger storage '${storage}' in ` +
        `'${artifactName}'; add the variant to LedgerStorage`,
    );
  }

  for (const child of Object.values(record)) {
    assertKnownTags(child, artifactName);
  }
}

/**
 * Checks the parsed JSON against the declared types, so a compiler that emits
 * something new fails here instead of surfacing as `undefined` at a use site.
 */
function assertContractInfo(
  parsed: unknown,
  artifactName: string,
): asserts parsed is ContractInfo {
  if (typeof parsed !== 'object' || parsed === null || Array.isArray(parsed)) {
    throw new Error(
      `readContractInfo: '${artifactName}' metadata is not a JSON object`,
    );
  }
  const root = parsed as Record<string, unknown>;

  for (const key of REQUIRED_STRINGS) {
    if (typeof root[key] !== 'string') {
      throw new Error(
        `readContractInfo: missing or non-string '${key}' in '${artifactName}'`,
      );
    }
  }
  for (const key of REQUIRED_ARRAYS) {
    if (!Array.isArray(root[key])) {
      throw new Error(
        `readContractInfo: missing or non-array '${key}' in '${artifactName}'`,
      );
    }
  }

  assertKnownTags(parsed, artifactName);
}

/**
 * Parses and validates one `contract-info.json` body.
 *
 * Split from {@link readContractInfo} so the validation can be exercised
 * without writing an artifact to disk.
 *
 * @param text - The file's contents.
 * @param artifactName - Names the source in any error raised.
 * @throws If the text is not JSON, or carries a tag outside
 * {@link CompactTypeName} or {@link LedgerStorage}.
 */
export function parseContractInfo(
  text: string,
  artifactName: string,
): ContractInfo {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (cause) {
    throw new Error(
      `readContractInfo: unreadable compiler metadata for '${artifactName}'. ` +
        'Compile the contract first, then re-run.',
      { cause },
    );
  }

  // Outside the catch: a validation failure is a real mismatch, not a missing
  // build, and must not be reported as one.
  assertContractInfo(parsed, artifactName);
  return parsed;
}

/**
 * Loads the compiler metadata for a built artifact. Read at call time, so
 * importing this module never requires a compiled artifact.
 *
 * @param artifactName - The directory under `contracts/artifacts`, usually a
 *   mock, e.g. `MockConfidentialNoteFungibleToken`.
 * @throws If the artifact has not been built, or if its metadata carries a tag
 * outside {@link CompactTypeName} or {@link LedgerStorage}.
 */
export function readContractInfo(artifactName: string): ContractInfo {
  const path = new URL(
    `../../artifacts/${artifactName}/compiler/contract-info.json`,
    import.meta.url,
  );

  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (cause) {
    throw new Error(
      `readContractInfo: no compiler metadata for '${artifactName}'. ` +
        'Compile the contract first, then re-run.',
      { cause },
    );
  }

  return parseContractInfo(text, artifactName);
}

/** Ledger slots in declaration order. */
export function ledgerSlots(info: ContractInfo): readonly LedgerSlot[] {
  return info.ledger;
}

/**
 * The circuit surface, sorted by name.
 *
 * Sorted because the compiler emits declaration order while dispatch is by name,
 * so reordering a `.compact` source is not a compatibility change.
 */
export function circuitSurface(info: ContractInfo): CircuitSurface[] {
  return info.circuits
    .map(({ name, pure, proof }) => ({ name, pure, proof }))
    .sort((left, right) => left.name.localeCompare(right.name));
}
