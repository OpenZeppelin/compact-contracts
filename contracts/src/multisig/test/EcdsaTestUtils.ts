/**
 * Test helpers for the ECDSA-backed multisig presets.
 *
 * Two responsibilities:
 *  1. Produce real secp256k1 key pairs and ECDSA signatures in the shape the
 *     compiled circuits expect: a `Secp256k1Point` public key and an `{ r, s }`
 *     signature of scalar field elements.
 *  2. Reconstruct, byte-for-byte, the message digest each circuit hashes and
 *     verifies. This mirrors what a real operator must do off-chain: it reuses
 *     the runtime's own `persistentHash` / `convertBigintToBytes` primitives
 *     with `CompactType`s built identically to the generated artifact, so the
 *     digest matches the in-circuit computation.
 */
import {
  type CompactType,
  CompactTypeBoolean,
  CompactTypeBytes,
  CompactTypeEnum,
  CompactTypeVector,
  convertBigintToBytes,
  persistentHash,
  type Secp256k1Point,
} from '@midnight-ntwrk/compact-runtime';
import { secp256k1 } from '@noble/curves/secp256k1.js';

// ─── Keys & signatures ──────────────────────────────────────────

/** An ECDSA signature as the circuits consume it: two secp256k1 scalars. */
export interface EcdsaSignature {
  r: bigint;
  s: bigint;
}

/** A secp256k1 signer: its secret key plus the public key as a circuit point. */
export interface Signer {
  secretKey: Uint8Array;
  publicKey: Secp256k1Point;
}

const bytesToBigIntBE = (bytes: Uint8Array): bigint => {
  let acc = 0n;
  for (const b of bytes) acc = (acc << 8n) | BigInt(b);
  return acc;
};

/** Derives a signer from a 32-byte secret key. */
export function makeSigner(secretKey: Uint8Array): Signer {
  const uncompressed = secp256k1.getPublicKey(secretKey, false); // 0x04 || X || Y
  return {
    secretKey,
    publicKey: {
      x: bytesToBigIntBE(uncompressed.slice(1, 33)),
      y: bytesToBigIntBE(uncompressed.slice(33, 65)),
      identity: false,
    },
  };
}

/** Deterministic signer from an ASCII label, for stable fixtures. */
export function signerFromLabel(label: string): Signer {
  const secretKey = new Uint8Array(32);
  secretKey.set(new TextEncoder().encode(label).slice(0, 32));
  secretKey[31] ||= 1; // avoid the zero scalar
  return makeSigner(secretKey);
}

/**
 * Signs a 32-byte digest, returning `{ r, s }`. The digest is the pre-hashed
 * message, exactly as `secp256k1EcdsaVerify` interprets `msgHash`.
 */
export function sign(signer: Signer, digest: Uint8Array): EcdsaSignature {
  const sig = secp256k1.sign(digest, signer.secretKey, {
    prehash: false,
    lowS: true,
  });
  // @noble/curves v1 returns a `Signature`; v2 returns compact r‖s bytes.
  if (sig instanceof Uint8Array) {
    return {
      r: bytesToBigIntBE(sig.slice(0, 32)),
      s: bytesToBigIntBE(sig.slice(32, 64)),
    };
  }
  return { r: sig.r, s: sig.s };
}

// ─── Digest reconstruction ──────────────────────────────────────

const B32 = new CompactTypeBytes(32);

const vecType = (n: number): CompactType<Uint8Array[]> =>
  new CompactTypeVector(n, B32) as unknown as CompactType<Uint8Array[]>;

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
