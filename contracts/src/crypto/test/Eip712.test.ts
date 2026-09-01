import { encodeContractAddress } from '@midnight-ntwrk/compact-runtime';
import { keccak_256 } from '@noble/hashes/sha3.js';
import { hashTypedData, hexToBytes } from 'viem';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BURN_TYPE_STRING,
  BURN_TYPES,
  EIP712_VERSION,
  hashStruct,
  keccakAscii,
  uint256Word,
  viemDomain,
  viemDomainSeparator,
} from '../../multisig/test/Eip712TestUtils.js';
import { Eip712Simulator } from './simulators/Eip712Simulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DOMAIN_NAME = 'Eip712Mock';

// The dry default address is all zeros, which a module that ignored the salt
// would still satisfy. Pin distinctive ones instead, and read the salt back off
// the instance so the reference tracks whatever address the backend assigned.
const CONTRACT_ADDRESS = '77'.repeat(32);
const OTHER_CONTRACT_ADDRESS = '88'.repeat(32);

// An arbitrary typed struct, reusing the presets' `Burn` schema so the viem
// comparison exercises a type string that also ships in the library.
const BURN_NONCE = 3n;
const BURN_AMOUNT = 4_200n;

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

let contract: Eip712Simulator;
let salt: Uint8Array;

const freshEip712 = (contractAddress: string) =>
  Eip712Simulator.create(
    keccakAscii(DOMAIN_NAME),
    keccakAscii(EIP712_VERSION),
    { contractAddress },
  );

describe('Eip712', () => {
  beforeAll(async () => {
    contract = await freshEip712(CONTRACT_ADDRESS);
    salt = encodeContractAddress(contract.contractAddress);
  });

  describe('_domainSeparatorV4', () => {
    it('matches viem hashDomain over name, version and the contract address', async () => {
      expect(await contract._domainSeparatorV4()).toStrictEqual(
        viemDomainSeparator({ name: DOMAIN_NAME, salt }),
      );
    });

    it('is stable across reads', async () => {
      expect(await contract._domainSeparatorV4()).toStrictEqual(
        await contract._domainSeparatorV4(),
      );
    });

    it('binds the deploying contract address', async () => {
      const other = await freshEip712(OTHER_CONTRACT_ADDRESS);
      expect(await contract._domainSeparatorV4()).not.toStrictEqual(
        await other._domainSeparatorV4(),
      );
    });
  });

  describe('_hashTypedDataV4', () => {
    it('matches keccak256 of 0x1901, the domain separator and the struct hash', async () => {
      const structHash = hashStruct(BURN_TYPE_STRING, [
        uint256Word(BURN_NONCE),
        uint256Word(BURN_AMOUNT),
      ]);
      const domainSeparator = await contract._domainSeparatorV4();

      expect(await contract._hashTypedDataV4(structHash)).toStrictEqual(
        keccak_256(
          concatBytes(
            Uint8Array.from([0x19, 0x01]),
            domainSeparator,
            structHash,
          ),
        ),
      );
    });

    it('matches viem hashTypedData for the same typed struct', async () => {
      const structHash = hashStruct(BURN_TYPE_STRING, [
        uint256Word(BURN_NONCE),
        uint256Word(BURN_AMOUNT),
      ]);

      expect(await contract._hashTypedDataV4(structHash)).toStrictEqual(
        hexToBytes(
          hashTypedData({
            domain: viemDomain({ name: DOMAIN_NAME, salt }),
            types: BURN_TYPES,
            primaryType: 'Burn',
            message: { nonce: BURN_NONCE, amount: BURN_AMOUNT },
          }),
        ),
      );
    });

    it('binds the struct hash', async () => {
      const first = hashStruct(BURN_TYPE_STRING, [
        uint256Word(BURN_NONCE),
        uint256Word(BURN_AMOUNT),
      ]);
      const second = hashStruct(BURN_TYPE_STRING, [
        uint256Word(BURN_NONCE + 1n),
        uint256Word(BURN_AMOUNT),
      ]);

      expect(await contract._hashTypedDataV4(first)).not.toStrictEqual(
        await contract._hashTypedDataV4(second),
      );
    });
  });
});
