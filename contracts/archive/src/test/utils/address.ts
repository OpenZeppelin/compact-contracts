import {
  convert_bigint_to_Uint8Array,
  encodeCoinPublicKey,
} from '@midnight-ntwrk/compact-runtime';
import { encodeContractAddress } from '@midnight-ntwrk/ledger';
import type * as Compact from '../../artifacts/MockShieldedToken/contract/index.cjs';

const PREFIX_ADDRESS = '0200';

export const pad = (s: string, n: number): Uint8Array => {
  const encoder = new TextEncoder();
  const utf8Bytes = encoder.encode(s);
  if (n < utf8Bytes.length) {
    throw new Error(`The padded length n must be at least ${utf8Bytes.length}`);
  }
  const paddedArray = new Uint8Array(n);
  paddedArray.set(utf8Bytes);
  return paddedArray;
};

/**
 * @description Generates ZswapCoinPublicKey from `str` for testing purposes.
 * @param str String to hexify and encode.
 * @returns Encoded `ZswapCoinPublicKey`.
 */
export const encodeToPK = (str: string): Compact.ZswapCoinPublicKey => {
  const toHex = Buffer.from(str, 'ascii').toString('hex');
  return { bytes: encodeCoinPublicKey(String(toHex).padStart(64, '0')) };
};

/**
 * @description Generates ContractAddress from `str` for testing purposes.
 *              Prepends 32-byte hex with PREFIX_ADDRESS before encoding.
 * @param str String to hexify and encode.
 * @returns Encoded `ZswapCoinPublicKey`.
 */
export const encodeToAddress = (str: string): Compact.ContractAddress => {
  const toHex = Buffer.from(str, 'ascii').toString('hex');
  const fullAddress = PREFIX_ADDRESS + String(toHex).padStart(64, '0');
  return { bytes: encodeContractAddress(fullAddress) };
};

/**
 * @description Generates an Either object for ZswapCoinPublicKey for testing.
 *              For use when an Either argument is expected.
 * @param str String to hexify and encode.
 * @returns Defined Either object for ZswapCoinPublicKey.
 */
export const createEitherTestUser = (str: string) => {
  return {
    is_left: true,
    left: encodeToPK(str),
    right: encodeToAddress(''),
  };
};

/**
 * @description Generates an Either object for ContractAddress for testing.
 *              For use when an Either argument is expected.
 * @param str String to hexify and encode.
 * @returns Defined Either object for ContractAddress.
 */
export const createEitherTestContractAddress = (str: string) => {
  return {
    is_left: false,
    left: encodeToPK(''),
    right: encodeToAddress(str),
  };
};

export const ZERO_KEY = {
  is_left: true,
  left: { bytes: convert_bigint_to_Uint8Array(32, BigInt(0)) },
  right: encodeToAddress(''),
};

export const ZERO_ADDRESS = {
  is_left: false,
  left: encodeToPK(''),
  right: { bytes: convert_bigint_to_Uint8Array(32, BigInt(0)) },
};
