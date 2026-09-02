/**
 * Reconstructs, byte-for-byte, the message digest each multisig circuit hashes
 * and verifies. This mirrors what a real operator must do off-chain: it reuses
 * the runtime's own `persistentHash` / `convertBigintToBytes` primitives with
 * `CompactType`s built identically to the generated artifact, so the digest
 * matches the in-circuit computation.
 *
 * Key and signature fixtures live in `#test-utils/fixtures/ecdsa.js`.
 */
import {
  type CompactType,
  CompactTypeBoolean,
  CompactTypeBytes,
  CompactTypeEnum,
  CompactTypeVector,
  convertBigintToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';

// ─── Digest reconstruction ──────────────────────────────────────

const B32 = new CompactTypeBytes(32);

const vecType = (n: number): CompactType<Uint8Array[]> =>
  new CompactTypeVector(n, B32);

/** `pad(32, s)`: ASCII bytes of `s`, right-padded with zeros to 32 bytes. */
export function domainBytes(s: string): Uint8Array {
  const out = new Uint8Array(32);
  out.set(new TextEncoder().encode(s));
  return out;
}

const u256 = (value: bigint): Uint8Array =>
  convertBigintToBytes(32, value, 'EcdsaTestUtils');

/** `persistentHash<Vector<n, Bytes<32>>>(items)`. */
const persistentVec = (items: Uint8Array[]): Uint8Array =>
  persistentHash(vecType(items.length), items);

/** An `Either<ZswapCoinPublicKey, ContractAddress>` as the artifact encodes it. */
export interface EitherRecipient {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
}

// Mirrors the generated `_Either_0` descriptor: bool ‖ left.bytes ‖ right.bytes.
const EitherType: CompactType<EitherRecipient> = {
  alignment: () =>
    CompactTypeBoolean.alignment()
      .concat(B32.alignment())
      .concat(B32.alignment()),
  fromValue: (value) => ({
    is_left: CompactTypeBoolean.fromValue(value),
    left: { bytes: B32.fromValue(value) },
    right: { bytes: B32.fromValue(value) },
  }),
  toValue: (value) =>
    CompactTypeBoolean.toValue(value.is_left)
      .concat(B32.toValue(value.left.bytes))
      .concat(B32.toValue(value.right.bytes)),
};

// Matches `Utils_canonicalize`: zero out the unused arm.
const canonicalize = (r: EitherRecipient): EitherRecipient =>
  r.is_left
    ? { is_left: true, left: r.left, right: { bytes: new Uint8Array(32) } }
    : { is_left: false, left: { bytes: new Uint8Array(32) }, right: r.right };

/** The mint's `recipientHash`. */
export function recipientHash(recipient: EitherRecipient): Uint8Array {
  return persistentHash(EitherType, canonicalize(recipient));
}

// ─── Per-preset message hashes ──────────────────────────────────

/** ShieldedMultiSigV3 `mint` digest. `contractAddress` is `kernel.self().bytes`. */
export function mintMsgHash(params: {
  contractAddress: Uint8Array;
  recipient: EitherRecipient;
  opNonce: bigint;
  amount: bigint;
}): Uint8Array {
  return persistentVec([
    domainBytes('multisig:mint:'),
    params.contractAddress,
    recipientHash(params.recipient),
    u256(params.opNonce),
    u256(params.amount),
  ]);
}

/** ShieldedMultiSigV3 `burn` digest. */
export function burnMsgHash(params: {
  contractAddress: Uint8Array;
  opNonce: bigint;
  amount: bigint;
}): Uint8Array {
  return persistentVec([
    domainBytes('multisig:burn:'),
    params.contractAddress,
    u256(params.opNonce),
    u256(params.amount),
  ]);
}

/** A `Proposal_Recipient` as the artifact encodes it: kind enum + address. */
export interface KindRecipient {
  kind: number;
  address: Uint8Array;
}

// Mirrors the generated `_Recipient_0` descriptor: CompactTypeEnum(2, 1) ‖ Bytes<32>.
const RecipientKindEnum = new CompactTypeEnum(2, 1);
const RecipientType: CompactType<KindRecipient> = {
  alignment: () => RecipientKindEnum.alignment().concat(B32.alignment()),
  fromValue: (value) => ({
    kind: RecipientKindEnum.fromValue(value),
    address: B32.fromValue(value),
  }),
  toValue: (value) =>
    RecipientKindEnum.toValue(value.kind).concat(B32.toValue(value.address)),
};

/** ShieldedMultiSigV2 `execute` digest. `contractAddress` is `kernel.self().bytes`. */
export function executeMsgHash(params: {
  contractAddress: Uint8Array;
  nonce: bigint;
  to: KindRecipient;
  coinColor: Uint8Array;
  amount: bigint;
}): Uint8Array {
  return persistentVec([
    domainBytes('multisig:execute:'),
    params.contractAddress,
    u256(params.nonce),
    persistentHash(RecipientType, params.to),
    params.coinColor,
    u256(params.amount),
  ]);
}
