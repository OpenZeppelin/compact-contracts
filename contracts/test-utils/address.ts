import {
  convertFieldToBytes,
  type EncodedContractAddress,
  encodeCoinPublicKey,
  isContractAddress,
} from '@midnight-ntwrk/compact-runtime';
import { encodeContractAddress } from '@midnight-ntwrk/ledger-v8';

type ZswapCoinPublicKey = { bytes: Uint8Array };

type ContractAddress = { bytes: Uint8Array };

type UserAddress = { bytes: Uint8Array };

type Either<A, B> = { is_left: boolean; left: A; right: B };

/**
 * @description Converts an ASCII string to its hexadecimal representation,
 * left-padded with zeros to a specified length. Useful for generating
 * fixed-size hex strings for encoding.
 * @param str ASCII string to convert.
 * @param len Total desired length of the resulting hex string. Defaults to 64.
 * @returns Hexadecimal string representation of `str`, padded to `length` characters.
 */
export const toHexPadded = (str: string, len = 64) =>
  Buffer.from(str, 'ascii').toString('hex').padStart(len, '0');

/**
 * @description Generates ZswapCoinPublicKey from `str` for testing purposes.
 * @param str String to hexify and encode.
 * @returns Encoded `ZswapCoinPublicKey`.
 */
export const encodeToPK = (str: string): ZswapCoinPublicKey => ({
  bytes: encodeCoinPublicKey(toHexPadded(str)),
});

/**
 * @description Generates ContractAddress from 32-byte hex `str` for testing purposes.
 * @param str String to hexify and encode.
 * @throws {Error} Thrown when function fails to generate a valid ContractAddress
 * @returns EncodedContractAddress.
 */
export const encodeToAddress = (str: string): EncodedContractAddress => {
  const generatedAddress = toHexPadded(str);
  if (isContractAddress(generatedAddress)) {
    return {
      bytes: encodeContractAddress(generatedAddress),
    } as EncodedContractAddress;
  }
  throw new Error(
    'Invalid Input: `generatedAddress` must be a valid `ContractAddress`',
  );
};

/**
 * @description Generates an Either object for ZswapCoinPublicKey for testing.
 *              For use when an Either argument is expected.
 * @param str String to hexify and encode.
 * @returns Defined Either object for ZswapCoinPublicKey.
 */
export const createEitherTestUser = (
  str: string,
): Either<ZswapCoinPublicKey, ContractAddress> => ({
  is_left: true,
  left: encodeToPK(str),
  right: encodeToAddress(''),
});

/**
 * @description Generates an Either object for ContractAddress for testing.
 *              For use when an Either argument is expected.
 * @param str String to hexify and encode.
 * @returns Defined Either object for ContractAddress.
 */
export const createEitherTestContractAddress = (str: string) => ({
  is_left: false,
  left: encodeToPK(''),
  right: encodeToAddress(str),
});

const baseGeneratePubKeyPair = (
  str: string,
  asEither: boolean,
): [
  string,
  ZswapCoinPublicKey | Either<ZswapCoinPublicKey, ContractAddress>,
] => {
  const pk = toHexPadded(str);
  const zpk = asEither ? createEitherTestUser(str) : encodeToPK(str);
  return [pk, zpk];
};

export const generatePubKeyPair = (str: string) =>
  baseGeneratePubKeyPair(str, false) as [string, ZswapCoinPublicKey];

export const generateEitherPubKeyPair = (str: string) =>
  baseGeneratePubKeyPair(str, true) as [
    string,
    Either<ZswapCoinPublicKey, ContractAddress>,
  ];

export const zeroUint8Array = (length = 32) =>
  convertFieldToBytes(length, 0n, '');

export const ZERO_KEY = {
  is_left: true,
  left: { bytes: zeroUint8Array() },
  right: encodeToAddress(''),
};

export const ZERO_ADDRESS = {
  is_left: false,
  left: encodeToPK(''),
  right: { bytes: zeroUint8Array() },
};

/**
 * @description Generates a UserAddress from `str` for testing purposes.
 *              UserAddress is the unshielded recipient form (a 32-byte value).
 * @param str String to hexify into the address bytes.
 * @returns Encoded `UserAddress`.
 */
export const encodeToUserAddress = (str: string): UserAddress => {
  const bytes = Uint8Array.from(Buffer.from(toHexPadded(str), 'hex'));
  if (bytes.length !== 32) {
    throw new Error('Invalid Input: `UserAddress` must be exactly 32 bytes');
  }
  return { bytes };
};

/**
 * @description Generates an Either object bound to a UserAddress for testing.
 *              For use when an `Either<ContractAddress, UserAddress>` argument
 *              (the unshielded recipient) is expected.
 * @param str String to hexify and encode into the user address.
 * @returns Defined Either object for UserAddress.
 */
export const createEitherTestUserAddress = (
  str: string,
): Either<ContractAddress, UserAddress> => ({
  is_left: false,
  left: encodeToAddress(''),
  right: encodeToUserAddress(str),
});

export const ZERO_USER_ADDRESS: Either<ContractAddress, UserAddress> = {
  is_left: false,
  left: encodeToAddress(''),
  right: { bytes: zeroUint8Array() },
};

/**
 * @description Generates an Either bound to a ContractAddress for testing.
 *              For use when an `Either<ContractAddress, UserAddress>` argument
 *              (the unshielded recipient) is expected with the contract arm.
 * @param str String to hexify and encode into the contract address.
 * @returns Defined Either object for the contract arm.
 */
export const createEitherTestUnshieldedContract = (
  str: string,
): Either<ContractAddress, UserAddress> => ({
  is_left: true,
  left: encodeToAddress(str),
  right: encodeToUserAddress(''),
});

export const ZERO_UNSHIELDED_CONTRACT: Either<ContractAddress, UserAddress> = {
  is_left: true,
  left: { bytes: zeroUint8Array() },
  right: encodeToUserAddress(''),
};
