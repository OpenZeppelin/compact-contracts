/**
 * Byte-exact EIP-712 digest reconstruction for the stateless multisig presets.
 *
 * Two independent layers:
 *  1. The runtime layer rebuilds each digest from compact-runtime's own
 *     `keccak256` over hand-built `CompactType` descriptors that mirror the
 *     structs the circuits hash, so a match pins the in-circuit encoding.
 *  2. The viem layer derives the same digest from the EIP-712 spec alone and
 *     shares no code with compact-runtime. It is what an HSM operator runs.
 *
 * Specs assert all three agree: viem == this file == circuit.
 */
import {
  type CompactType,
  CompactTypeBytes,
  CompactTypeUnsignedInteger,
  CompactTypeVector,
  keccak256,
} from '@midnight-ntwrk/compact-runtime';
import {
  bytesToHex,
  getTypesForEIP712Domain,
  type Hex,
  hashDomain,
  hashTypedData,
  hexToBytes,
  type TypedDataDomain,
} from 'viem';

// ─── Schema ───────────────────────────────────────────────────────

/** EIP-712 domain subset: no `chainId`, and the 32-byte address is the salt. */
export const EIP712_DOMAIN_TYPE_STRING =
  'EIP712Domain(string name,string version,bytes32 salt)';

export const MINT_TYPE_STRING =
  'Mint(uint8 recipientType,bytes32 recipient,uint256 nonce,uint256 amount)';

export const BURN_TYPE_STRING = 'Burn(uint256 nonce,uint256 amount)';

export const EXECUTE_TYPE_STRING =
  'Execute(uint8 recipientKind,bytes32 recipient,bytes32 color,uint256 nonce,uint256 amount)';

export const MINT_TYPES = {
  Mint: [
    { name: 'recipientType', type: 'uint8' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
  ],
} as const;

export const BURN_TYPES = {
  Burn: [
    { name: 'nonce', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
  ],
} as const;

export const EXECUTE_TYPES = {
  Execute: [
    { name: 'recipientKind', type: 'uint8' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'color', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
  ],
} as const;

export const EIP712_VERSION = '1';
export const V3_DOMAIN_NAME = 'ShieldedMultiSigV3';
export const V2_DOMAIN_NAME = 'ShieldedMultiSigV2';

/** Signer-commitment domain, shared by both presets. */
export const SIGNER_DOMAIN = 'multisig:signer:';

/** `Either.is_left` flattened into the `recipientType` field. */
export const RecipientType = { CoinPublicKey: 0, Contract: 1 } as const;

// ─── Runtime type descriptors ─────────────────────────────────────

const B2 = new CompactTypeBytes(2);
const B24 = new CompactTypeBytes(24);
const B32 = new CompactTypeBytes(32);
const B64 = new CompactTypeBytes(64);
const U8 = new CompactTypeUnsignedInteger(255n, 1);
const BE_WORD = new CompactTypeVector(32, U8);

const bytesType = (length: number): CompactTypeBytes =>
  new CompactTypeBytes(length);

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** ASCII bytes of `s`, right-padded with zeros to `length` (Compact `pad`). */
export const padAscii = (length: number, s: string): Uint8Array => {
  const out = new Uint8Array(length);
  out.set(new TextEncoder().encode(s));
  return out;
};

/**
 * `keccak256<Bytes<n>>(pad(n, s))` with `n` the exact byte length, mirroring
 * `MessageHashUtils.typeHashFromAscii`. Also the EIP-712 hash of a `string`
 * member, which is keccak of its unpadded UTF-8 bytes.
 */
export const keccakAscii = (s: string): Uint8Array => {
  const ascii = new TextEncoder().encode(s);
  return keccak256(bytesType(ascii.length), ascii);
};

// ─── 32-byte words ────────────────────────────────────────────────

/** EVM `uint256`: 32 big-endian bytes. Compact-runtime's own integer encoding is little-endian, so it is never used here. */
export const toBigEndianBytes32 = (value: bigint): Uint8Array => {
  if (value < 0n) throw new RangeError('toBigEndianBytes32: negative value');
  const out = new Uint8Array(32);
  let rest = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(rest & 0xffn);
    rest >>= 8n;
  }
  if (rest !== 0n) throw new RangeError('toBigEndianBytes32: value >= 2^256');
  return out;
};

/**
 * One field of a hashed digest struct. `bytes32` fields are `Bytes<32>` in
 * Compact; `uint256` fields are `Vector<32, Uint<8>>`, since no
 * `Vector<32, Uint<8>> -> Bytes<32>` cast exists.
 */
export type Word =
  | { kind: 'bytes32'; bytes: Uint8Array }
  | { kind: 'uint256'; bytes: Uint8Array };

export const bytes32Word = (bytes: Uint8Array): Word => {
  if (bytes.length !== 32)
    throw new RangeError(`bytes32Word: expected 32 bytes, got ${bytes.length}`);
  return { kind: 'bytes32', bytes };
};

export const uint256Word = (value: bigint): Word => ({
  kind: 'uint256',
  bytes: toBigEndianBytes32(value),
});

const wordType = (word: Word): CompactType<unknown> =>
  word.kind === 'bytes32'
    ? (B32 as unknown as CompactType<unknown>)
    : (BE_WORD as unknown as CompactType<unknown>);

const wordValue = (word: Word): unknown =>
  word.kind === 'bytes32'
    ? word.bytes
    : Array.from(word.bytes, (byte) => BigInt(byte));

/** Descriptor for a struct of 32-byte words: packed concatenation, no padding. */
const wordsType = (words: Word[]): CompactType<Word[]> => ({
  alignment: () =>
    words
      .map((word) => wordType(word).alignment())
      .reduce((left, right) => left.concat(right)),
  fromValue: (value) =>
    words.map((word) => ({
      kind: word.kind,
      bytes: wordType(word).fromValue(value) as Uint8Array,
    })) as Word[],
  toValue: (value) =>
    value
      .map((word) => wordType(word).toValue(wordValue(word)))
      .reduce((left, right) => left.concat(right)),
});

/** `keccak256` over the packed words, mirroring `MessageHashUtils.hashWords`. */
export const hashWords = (words: Word[]): Uint8Array =>
  keccak256(wordsType(words), words);

/** EIP-712 `hashStruct`: keccak of the typehash followed by the members. */
export const hashStruct = (typeString: string, members: Word[]): Uint8Array =>
  hashWords([bytes32Word(keccakAscii(typeString)), ...members]);

// ─── Envelopes ────────────────────────────────────────────────────

interface TypedDataEnvelope {
  x19: bigint;
  x01: bigint;
  domainSeparator: Uint8Array;
  structHash: Uint8Array;
}

const TypedDataEnvelopeType: CompactType<TypedDataEnvelope> = {
  alignment: () =>
    U8.alignment()
      .concat(U8.alignment())
      .concat(B32.alignment())
      .concat(B32.alignment()),
  fromValue: (value) => ({
    x19: U8.fromValue(value),
    x01: U8.fromValue(value),
    domainSeparator: B32.fromValue(value),
    structHash: B32.fromValue(value),
  }),
  toValue: (value) =>
    U8.toValue(value.x19)
      .concat(U8.toValue(value.x01))
      .concat(B32.toValue(value.domainSeparator))
      .concat(B32.toValue(value.structHash)),
};

/** EIP-712 final digest: `keccak(0x19 ‖ 0x01 ‖ ds ‖ hs)`. */
export const toTypedDataHash = (
  domainSeparatorHash: Uint8Array,
  structHash: Uint8Array,
): Uint8Array =>
  keccak256(TypedDataEnvelopeType, {
    x19: 25n,
    x01: 1n,
    domainSeparator: domainSeparatorHash,
    structHash,
  });

interface EthSignedEnvelope {
  x19: bigint;
  label: Uint8Array;
  newline: bigint;
  length: Uint8Array;
  messageHash: Uint8Array;
}

const EthSignedEnvelopeType: CompactType<EthSignedEnvelope> = {
  alignment: () =>
    U8.alignment()
      .concat(B24.alignment())
      .concat(U8.alignment())
      .concat(B2.alignment())
      .concat(B32.alignment()),
  fromValue: (value) => ({
    x19: U8.fromValue(value),
    label: B24.fromValue(value),
    newline: U8.fromValue(value),
    length: B2.fromValue(value),
    messageHash: B32.fromValue(value),
  }),
  toValue: (value) =>
    U8.toValue(value.x19)
      .concat(B24.toValue(value.label))
      .concat(U8.toValue(value.newline))
      .concat(B2.toValue(value.length))
      .concat(B32.toValue(value.messageHash)),
};

/** EIP-191 personal-sign digest over a 32-byte message hash. */
export const toEthSignedMessageHash = (messageHash: Uint8Array): Uint8Array =>
  keccak256(EthSignedEnvelopeType, {
    x19: 25n,
    label: new TextEncoder().encode('Ethereum Signed Message:'),
    newline: 10n,
    length: new TextEncoder().encode('32'),
    messageHash,
  });

// ─── Signer commitment ────────────────────────────────────────────

interface SignerCommitmentInput {
  pk: Uint8Array;
  salt: Uint8Array;
  domain: Uint8Array;
}

const SignerCommitmentInputType: CompactType<SignerCommitmentInput> = {
  alignment: () =>
    B64.alignment().concat(B32.alignment()).concat(B32.alignment()),
  fromValue: (value) => ({
    pk: B64.fromValue(value),
    salt: B32.fromValue(value),
    domain: B32.fromValue(value),
  }),
  toValue: (value) =>
    B64.toValue(value.pk)
      .concat(B32.toValue(value.salt))
      .concat(B32.toValue(value.domain)),
};

/**
 * `_calculateSignerId`: an on-chain commitment, not an EIP-712 digest. Keccak
 * so a deployer can precompute it with viem or noble alone.
 */
export const signerCommitment = (
  pk: Uint8Array,
  salt: Uint8Array,
  domain: string = SIGNER_DOMAIN,
): Uint8Array =>
  keccak256(SignerCommitmentInputType, {
    pk,
    salt,
    domain: padAscii(32, domain),
  });

/** The raw preimage `pk ‖ salt ‖ pad(32, domain)`, for a noble cross-check. */
export const signerCommitmentPreimage = (
  pk: Uint8Array,
  salt: Uint8Array,
  domain: string = SIGNER_DOMAIN,
): Uint8Array => concatBytes(pk, salt, padAscii(32, domain));

// ─── Domain separator ─────────────────────────────────────────────

export interface DomainParams {
  name: string;
  /** `kernel.self().bytes` — the instance binding, EIP-712 `salt`. */
  salt: Uint8Array;
  version?: string;
}

export const domainSeparator = ({
  name,
  salt,
  version = EIP712_VERSION,
}: DomainParams): Uint8Array =>
  hashStruct(EIP712_DOMAIN_TYPE_STRING, [
    bytes32Word(keccakAscii(name)),
    bytes32Word(keccakAscii(version)),
    bytes32Word(salt),
  ]);

export const viemDomain = ({
  name,
  salt,
  version = EIP712_VERSION,
}: DomainParams): TypedDataDomain => ({
  name,
  version,
  salt: bytesToHex(salt),
});

export const viemDomainSeparator = (params: DomainParams): Uint8Array => {
  const domain = viemDomain(params);
  return hexToBytes(
    hashDomain({
      domain,
      types: { EIP712Domain: getTypesForEIP712Domain({ domain }) },
    }),
  );
};

// ─── Recipients ───────────────────────────────────────────────────

/** An `Either<ZswapCoinPublicKey, ContractAddress>` as the artifact encodes it. */
export interface EitherRecipient {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
}

/**
 * The canonicalized Either flattened to the two EIP-712 members: a discriminant
 * and the active arm's bytes. The inactive arm never reaches the digest.
 */
export const flattenRecipient = (
  recipient: EitherRecipient,
): { recipientType: number; recipient: Uint8Array } =>
  recipient.is_left
    ? {
        recipientType: RecipientType.CoinPublicKey,
        recipient: recipient.left.bytes,
      }
    : {
        recipientType: RecipientType.Contract,
        recipient: recipient.right.bytes,
      };

// ─── V3 mint ──────────────────────────────────────────────────────

export interface MintDigestParams {
  /** `kernel.self().bytes` of the signing instance. */
  contractAddress: Uint8Array;
  recipient: EitherRecipient;
  nonce: bigint;
  amount: bigint;
}

const mintDomain = (params: MintDigestParams): DomainParams => ({
  name: V3_DOMAIN_NAME,
  salt: params.contractAddress,
});

export const mintStructHash = (params: MintDigestParams): Uint8Array => {
  const { recipientType, recipient } = flattenRecipient(params.recipient);
  return hashStruct(MINT_TYPE_STRING, [
    uint256Word(BigInt(recipientType)),
    bytes32Word(recipient),
    uint256Word(params.nonce),
    uint256Word(params.amount),
  ]);
};

export const mintDigest = (params: MintDigestParams): Uint8Array =>
  toTypedDataHash(domainSeparator(mintDomain(params)), mintStructHash(params));

export const viemMintDigest = (params: MintDigestParams): Uint8Array => {
  const { recipientType, recipient } = flattenRecipient(params.recipient);
  return hexToBytes(
    hashTypedData({
      domain: viemDomain(mintDomain(params)),
      types: MINT_TYPES,
      primaryType: 'Mint',
      message: {
        recipientType,
        recipient: bytesToHex(recipient) as Hex,
        nonce: params.nonce,
        amount: params.amount,
      },
    }),
  );
};

// ─── V3 burn ──────────────────────────────────────────────────────

export interface BurnDigestParams {
  contractAddress: Uint8Array;
  nonce: bigint;
  amount: bigint;
}

const burnDomain = (params: BurnDigestParams): DomainParams => ({
  name: V3_DOMAIN_NAME,
  salt: params.contractAddress,
});

export const burnStructHash = (params: BurnDigestParams): Uint8Array =>
  hashStruct(BURN_TYPE_STRING, [
    uint256Word(params.nonce),
    uint256Word(params.amount),
  ]);

export const burnDigest = (params: BurnDigestParams): Uint8Array =>
  toTypedDataHash(domainSeparator(burnDomain(params)), burnStructHash(params));

export const viemBurnDigest = (params: BurnDigestParams): Uint8Array =>
  hexToBytes(
    hashTypedData({
      domain: viemDomain(burnDomain(params)),
      types: BURN_TYPES,
      primaryType: 'Burn',
      message: { nonce: params.nonce, amount: params.amount },
    }),
  );

// ─── V2 execute ───────────────────────────────────────────────────

export interface ExecuteDigestParams {
  contractAddress: Uint8Array;
  /** `Proposal_Recipient.kind`: 0 shielded user, 1 unshielded user, 2 contract. */
  recipientKind: number;
  recipient: Uint8Array;
  color: Uint8Array;
  nonce: bigint;
  amount: bigint;
}

const executeDomain = (params: ExecuteDigestParams): DomainParams => ({
  name: V2_DOMAIN_NAME,
  salt: params.contractAddress,
});

export const executeStructHash = (params: ExecuteDigestParams): Uint8Array =>
  hashStruct(EXECUTE_TYPE_STRING, [
    uint256Word(BigInt(params.recipientKind)),
    bytes32Word(params.recipient),
    bytes32Word(params.color),
    uint256Word(params.nonce),
    uint256Word(params.amount),
  ]);

export const executeDigest = (params: ExecuteDigestParams): Uint8Array =>
  toTypedDataHash(
    domainSeparator(executeDomain(params)),
    executeStructHash(params),
  );

export const viemExecuteDigest = (params: ExecuteDigestParams): Uint8Array =>
  hexToBytes(
    hashTypedData({
      domain: viemDomain(executeDomain(params)),
      types: EXECUTE_TYPES,
      primaryType: 'Execute',
      message: {
        recipientKind: params.recipientKind,
        recipient: bytesToHex(params.recipient) as Hex,
        color: bytesToHex(params.color) as Hex,
        nonce: params.nonce,
        amount: params.amount,
      },
    }),
  );
