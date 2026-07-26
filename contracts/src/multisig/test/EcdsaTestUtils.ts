/**
 * Test helpers for the ECDSA-backed multisig presets.
 *
 * Two responsibilities:
 *  1. Produce real secp256k1 key pairs and ECDSA signatures (via `@noble/curves`)
 *     in the shape the compiled circuits expect, a `Secp256k1Point` public key
 *     (`{ x, y, identity }`) and a `{ r, s }` signature of scalar field elements.
 *  2. Reconstruct, byte-for-byte, the message digest each circuit hashes and
 *     verifies. This mirrors what a real operator/HSM must do off-chain: it
 *     reuses the runtime's own `keccak256` / `persistentHash` / `convertBigintToBytes`
 *     primitives with `CompactType`s built identically to the generated artifact,
 *     so the digest is guaranteed to match the in-circuit computation.
 */
import { secp256k1 } from '@noble/curves/secp256k1.js';
import {
  CompactTypeBoolean,
  CompactTypeBytes,
  CompactTypeVector,
  type CompactType,
  convertBigintToBytes,
  keccak256,
  persistentHash,
  type Secp256k1Point,
} from '@midnight-ntwrk/compact-runtime';

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

/** Derives a signer from a 32-byte secret key (random if omitted). */
export function makeSigner(secretKey?: Uint8Array): Signer {
  const sk = secretKey ?? secp256k1.utils.randomSecretKey();
  const uncompressed = secp256k1.getPublicKey(sk, false); // 0x04 || X(32) || Y(32)
  return {
    secretKey: sk,
    publicKey: {
      x: bytesToBigIntBE(uncompressed.slice(1, 33)),
      y: bytesToBigIntBE(uncompressed.slice(33, 65)),
      identity: false,
    },
  };
}

/** Deterministic signer from an ASCII label (handy for stable test fixtures). */
export function signerFromLabel(label: string): Signer {
  const sk = new Uint8Array(32);
  const ascii = new TextEncoder().encode(label);
  sk.set(ascii.slice(0, 32));
  sk[31] ||= 1; // avoid the zero scalar
  return makeSigner(sk);
}

/**
 * Signs a 32-byte digest, returning `{ r, s }`. The digest is treated as the
 * pre-hashed message, exactly as `secp256k1EcdsaVerify` interprets `msgHash`.
 */
export function sign(signer: Signer, digest: Uint8Array): EcdsaSignature {
  // `@noble/curves` v2 returns the signature as a compact 64-byte (r‖s) array;
  // recover the scalar components the circuit expects via `Signature.fromBytes`.
  const compact = secp256k1.sign(digest, signer.secretKey, { prehash: false });
  const parsed = secp256k1.Signature.fromBytes(compact);
  return { r: parsed.r, s: parsed.s };
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

/** `keccak256<Vector<n, Bytes<32>>>(items)`. */
const keccakVec = (items: Uint8Array[]): Uint8Array =>
  keccak256(vecType(items.length), items);

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

// Matches the contract's `Utils_canonicalize`: zero out the unused side.
const canonicalize = (r: EitherRecipient): EitherRecipient =>
  r.is_left
    ? { is_left: true, left: r.left, right: { bytes: new Uint8Array(32) } }
    : { is_left: false, left: { bytes: new Uint8Array(32) }, right: r.right };

/** `keccak256<Either<...>>(canonicalize(recipient))` — the mint's recipientHash. */
export function recipientHashKeccak(recipient: EitherRecipient): Uint8Array {
  return keccak256(EitherType, canonicalize(recipient));
}

// ─── Per-preset message hashes ──────────────────────────────────

/** ShieldedMultiSigV3 `mint` digest. `contractAddress` is `kernel.self().bytes`. */
export function mintMsgHash(params: {
  contractAddress: Uint8Array;
  recipient: EitherRecipient;
  opNonce: bigint;
  amount: bigint;
}): Uint8Array {
  return keccakVec([
    domainBytes('multisig:mint:'),
    params.contractAddress,
    recipientHashKeccak(params.recipient),
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
  return keccakVec([
    domainBytes('multisig:burn:'),
    params.contractAddress,
    u256(params.opNonce),
    u256(params.amount),
  ]);
}

/** ShieldedMultiSigV2 `execute` digest (persistentHash, no domain prefix). */
export function executeMsgHash(params: {
  nonce: bigint;
  toAddress: Uint8Array;
  coinColor: Uint8Array;
  amount: bigint;
}): Uint8Array {
  return persistentVec([
    u256(params.nonce),
    params.toAddress,
    params.coinColor,
    u256(params.amount),
  ]);
}
