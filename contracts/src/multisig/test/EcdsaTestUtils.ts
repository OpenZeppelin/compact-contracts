/**
 * Reconstructs, byte-for-byte, the message digest each multisig circuit hashes
 * and verifies. This mirrors what a real operator must do off-chain.
 *
 * The reconstruction goes through ethers' `TypedDataEncoder` rather than a
 * hand-rolled implementation, so these specs check the circuits against an
 * EIP-712 implementation written by neither this repository nor this file. A
 * disagreement means the contract does not match what an EVM signer produces,
 * rather than merely that two of our own encoders drifted apart.
 *
 * Key and signature fixtures live in `#test-utils/fixtures/ecdsa.js`.
 */
import { TypedDataEncoder } from 'ethers';

// ─── Domain ─────────────────────────────────────────────────────

/** `Uint8Array` -> `0x`-prefixed hex, the form ethers' encoders take. */
export const hexOf = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

/** The inverse: `0x`-prefixed hex -> `Uint8Array`. */
export const bytesOf = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex.slice(2), 'hex'));

/**
 * The domain each preset fixes at deployment. `chainId` and
 * `verifyingContract` are absent: no network id is available in-circuit, and a
 * 32-byte Midnight address does not fit `verifyingContract`'s `address` type.
 * The contract's own address is bound inside every operation struct instead,
 * which is what separates deployments -- addresses carry per-deployment
 * randomness and cannot be predicted.
 */
const domain = (name: string, instanceSalt: Uint8Array) => ({
  name,
  version: '1',
  salt: hexOf(instanceSalt),
});

// ─── Recipients ─────────────────────────────────────────────────

/** An `Either<ZswapCoinPublicKey, ContractAddress>` as the artifact encodes it. */
export interface EitherRecipient {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
}

/** A `Proposal_Recipient` as the artifact encodes it: kind enum + address. */
export interface KindRecipient {
  kind: number;
  address: Uint8Array;
}

// ─── Per-preset message hashes ──────────────────────────────────

const MINT_TYPES = {
  Mint: [
    { name: 'contractAddress', type: 'bytes32' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
  ],
};

const MINT_TO_SELF_TYPES = {
  MintToSelf: [
    { name: 'contractAddress', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
  ],
};

const BURN_TYPES = {
  Burn: [
    { name: 'contractAddress', type: 'bytes32' },
    { name: 'refundTo', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
  ],
};

const BURN_FROM_SELF_TYPES = {
  BurnFromSelf: [
    { name: 'contractAddress', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'amount', type: 'uint256' },
  ],
};

const EXECUTE_TYPES = {
  Execute: [
    { name: 'contractAddress', type: 'bytes32' },
    { name: 'nonce', type: 'uint256' },
    { name: 'recipientKind', type: 'uint8' },
    { name: 'recipient', type: 'bytes32' },
    { name: 'coinColor', type: 'bytes32' },
    { name: 'amount', type: 'uint256' },
  ],
};

/** NativeShieldedTokenIssuer `mint` digest. `recipient` is the coin public key's bytes. */
export function mintMsgHash(params: {
  contractAddress: Uint8Array;
  instanceSalt: Uint8Array;
  recipient: Uint8Array;
  opNonce: bigint;
  amount: bigint;
}): Uint8Array {
  return bytesOf(
    TypedDataEncoder.hash(
      domain('NativeShieldedTokenIssuer', params.instanceSalt),
      MINT_TYPES,
      {
        contractAddress: hexOf(params.contractAddress),
        recipient: hexOf(params.recipient),
        nonce: params.opNonce,
        amount: params.amount,
      },
    ),
  );
}

/** NativeShieldedTokenIssuer `mintToSelf` digest. */
export function mintToSelfMsgHash(params: {
  contractAddress: Uint8Array;
  instanceSalt: Uint8Array;
  opNonce: bigint;
  amount: bigint;
}): Uint8Array {
  return bytesOf(
    TypedDataEncoder.hash(
      domain('NativeShieldedTokenIssuer', params.instanceSalt),
      MINT_TO_SELF_TYPES,
      {
        contractAddress: hexOf(params.contractAddress),
        nonce: params.opNonce,
        amount: params.amount,
      },
    ),
  );
}

/** NativeShieldedTokenIssuer `burn` digest. `refundTo` is the coin public key's bytes. */
export function burnMsgHash(params: {
  contractAddress: Uint8Array;
  instanceSalt: Uint8Array;
  refundTo: Uint8Array;
  opNonce: bigint;
  amount: bigint;
}): Uint8Array {
  return bytesOf(
    TypedDataEncoder.hash(
      domain('NativeShieldedTokenIssuer', params.instanceSalt),
      BURN_TYPES,
      {
        contractAddress: hexOf(params.contractAddress),
        refundTo: hexOf(params.refundTo),
        nonce: params.opNonce,
        amount: params.amount,
      },
    ),
  );
}

/** NativeShieldedTokenIssuer `burnFromSelf` digest. */
export function burnFromSelfMsgHash(params: {
  contractAddress: Uint8Array;
  instanceSalt: Uint8Array;
  opNonce: bigint;
  amount: bigint;
}): Uint8Array {
  return bytesOf(
    TypedDataEncoder.hash(
      domain('NativeShieldedTokenIssuer', params.instanceSalt),
      BURN_FROM_SELF_TYPES,
      {
        contractAddress: hexOf(params.contractAddress),
        nonce: params.opNonce,
        amount: params.amount,
      },
    ),
  );
}

/** ShieldedMultiSigV2 `execute` digest. `contractAddress` is `kernel.self().bytes`. */
export function executeMsgHash(params: {
  contractAddress: Uint8Array;
  instanceSalt: Uint8Array;
  nonce: bigint;
  to: KindRecipient;
  coinColor: Uint8Array;
  amount: bigint;
}): Uint8Array {
  return bytesOf(
    TypedDataEncoder.hash(
      domain('ShieldedMultiSigV2', params.instanceSalt),
      EXECUTE_TYPES,
      {
        contractAddress: hexOf(params.contractAddress),
        nonce: params.nonce,
        recipientKind: params.to.kind,
        recipient: hexOf(params.to.address),
        coinColor: hexOf(params.coinColor),
        amount: params.amount,
      },
    ),
  );
}
