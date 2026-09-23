import { secp256k1 } from '@noble/curves/secp256k1.js';
import { keccak256, TypedDataEncoder, toUtf8Bytes } from 'ethers';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { signerFromLabel } from '#test-utils/fixtures/ecdsa.js';
import { Eip712Simulator } from './simulators/Eip712Simulator.js';

// ---------------------------------------------------------------------------
// Oracle
// ---------------------------------------------------------------------------

// ethers is the oracle throughout

const NAME = 'ShieldedMultiSigV3';
const VERSION = '1';
const SALT = `0x${'aa'.repeat(32)}`;

/** The domain this module can express: no chainId, no verifyingContract. */
const DOMAIN = { name: NAME, version: VERSION, salt: SALT };

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');
const strip = (h: string): string => h.slice(2);
const bytes = (h: string): Uint8Array =>
  Uint8Array.from(Buffer.from(strip(h), 'hex'));
const b32 = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

const HASHED_NAME = bytes(keccak256(toUtf8Bytes(NAME)));
const HASHED_VERSION = bytes(keccak256(toUtf8Bytes(VERSION)));

let contract: Eip712Simulator;

describe('Eip712', () => {
  beforeAll(async () => {
    contract = await Eip712Simulator.create();
  });

  describe('domainSeparator', () => {
    it('matches ethers TypedDataEncoder.hashDomain', async () => {
      expect(
        hex(
          await contract.domainSeparator(
            HASHED_NAME,
            HASHED_VERSION,
            bytes(SALT),
          ),
        ),
      ).toEqual(strip(TypedDataEncoder.hashDomain(DOMAIN)));
    });

    it('separates deployments by salt', async () => {
      const a = await contract.domainSeparator(
        HASHED_NAME,
        HASHED_VERSION,
        b32(1),
      );
      const b = await contract.domainSeparator(
        HASHED_NAME,
        HASHED_VERSION,
        b32(2),
      );

      expect(hex(a)).not.toEqual(hex(b));
    });

    it('separates applications by name', async () => {
      const other = bytes(keccak256(toUtf8Bytes('SomeOtherApp')));
      const a = await contract.domainSeparator(
        HASHED_NAME,
        HASHED_VERSION,
        bytes(SALT),
      );
      const b = await contract.domainSeparator(
        other,
        HASHED_VERSION,
        bytes(SALT),
      );

      expect(hex(a)).not.toEqual(hex(b));
    });

    it('separates versions', async () => {
      const v2 = bytes(keccak256(toUtf8Bytes('2')));
      const a = await contract.domainSeparator(
        HASHED_NAME,
        HASHED_VERSION,
        bytes(SALT),
      );
      const b = await contract.domainSeparator(HASHED_NAME, v2, bytes(SALT));

      expect(hex(a)).not.toEqual(hex(b));
    });

    it('agrees with ethers across arbitrary salts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          async (raw) => {
            const salt = Uint8Array.from(raw);
            const expected = TypedDataEncoder.hashDomain({
              ...DOMAIN,
              salt: `0x${hex(salt)}`,
            });
            expect(
              hex(
                await contract.domainSeparator(
                  HASHED_NAME,
                  HASHED_VERSION,
                  salt,
                ),
              ),
            ).toEqual(strip(expected));
          },
        ),
        { numRuns: 32 },
      );
    });
  });

  describe('type hash', () => {
    it('matches keccak256 of the EIP712Domain type string', () => {
      const typeString =
        'EIP712Domain(string name,string version,bytes32 salt)';

      expect(keccak256(toUtf8Bytes(typeString))).toEqual(
        '0x599a80fcaa47b95e2323ab4d34d34e0cc9feda4b843edafcc30c7bdf60ea15bf',
      );
    });

    it('matches the domain field set ethers encodes', () => {
      // `hashDomain` picks its type string from the fields present, so a domain
      // carrying exactly name/version/salt must reproduce our string.
      const encoded = TypedDataEncoder.from({
        EIP712Domain: [
          { name: 'name', type: 'string' },
          { name: 'version', type: 'string' },
          { name: 'salt', type: 'bytes32' },
        ],
      }).encodeType('EIP712Domain');

      expect(encoded).toEqual(
        'EIP712Domain(string name,string version,bytes32 salt)',
      );
    });
  });

  describe('hashTypedData', () => {
    // A representative operation struct, encoded the way the presets do:
    // a type hash followed by fixed 32-byte words.
    const TYPES = {
      Mint: [
        { name: 'contractAddress', type: 'bytes32' },
        { name: 'recipient', type: 'bytes32' },
        { name: 'isContract', type: 'bool' },
        { name: 'nonce', type: 'uint256' },
        { name: 'amount', type: 'uint256' },
      ],
    };
    const VALUE = {
      contractAddress: `0x${'cc'.repeat(32)}`,
      recipient: `0x${'dd'.repeat(32)}`,
      isContract: false,
      nonce: 7n,
      amount: 1_000_000n,
    };

    it('matches ethers TypedDataEncoder.hash end to end', async () => {
      const separator = bytes(TypedDataEncoder.hashDomain(DOMAIN));
      const structHash = bytes(
        TypedDataEncoder.hashStruct('Mint', TYPES, VALUE),
      );

      expect(hex(await contract.hashTypedData(separator, structHash))).toEqual(
        strip(TypedDataEncoder.hash(DOMAIN, TYPES, VALUE)),
      );
    });

    it('rejects a zero domain separator', async () => {
      const structHash = bytes(
        TypedDataEncoder.hashStruct('Mint', TYPES, VALUE),
      );

      await expect(
        contract.hashTypedData(new Uint8Array(32), structHash),
      ).rejects.toThrow('Eip712: domain separator not set');
    });

    it('is not the bare struct hash', async () => {
      const separator = bytes(TypedDataEncoder.hashDomain(DOMAIN));
      const structHash = bytes(
        TypedDataEncoder.hashStruct('Mint', TYPES, VALUE),
      );

      expect(
        hex(await contract.hashTypedData(separator, structHash)),
      ).not.toEqual(hex(structHash));
    });

    it('binds the digest to the domain separator', async () => {
      const structHash = bytes(
        TypedDataEncoder.hashStruct('Mint', TYPES, VALUE),
      );
      const ours = bytes(TypedDataEncoder.hashDomain(DOMAIN));
      const theirs = bytes(
        TypedDataEncoder.hashDomain({ ...DOMAIN, name: 'SomeOtherApp' }),
      );

      expect(hex(await contract.hashTypedData(ours, structHash))).not.toEqual(
        hex(await contract.hashTypedData(theirs, structHash)),
      );
    });

    it('agrees with ethers across arbitrary struct hashes', async () => {
      const separator = bytes(TypedDataEncoder.hashDomain(DOMAIN));
      await fc.assert(
        fc.asyncProperty(
          fc.uint8Array({ minLength: 32, maxLength: 32 }),
          async (raw) => {
            const structHash = Uint8Array.from(raw);
            const expected = keccak256(
              Buffer.concat([
                Buffer.from([0x19, 0x01]),
                Buffer.from(separator),
                Buffer.from(structHash),
              ]),
            );
            expect(
              hex(await contract.hashTypedData(separator, structHash)),
            ).toEqual(strip(expected));
          },
        ),
        { numRuns: 32 },
      );
    });

    it('produces the digest an EVM typed-data signature verifies against', async () => {
      const signer = signerFromLabel('eip712-envelope');
      const digest = bytes(TypedDataEncoder.hash(DOMAIN, TYPES, VALUE));
      const sig = secp256k1.sign(digest, signer.secretKey, {
        prehash: false,
        lowS: true,
      });

      const pk = secp256k1.getPublicKey(signer.secretKey, false);
      const separator = bytes(TypedDataEncoder.hashDomain(DOMAIN));
      const structHash = bytes(
        TypedDataEncoder.hashStruct('Mint', TYPES, VALUE),
      );
      const onChain = await contract.hashTypedData(separator, structHash);

      expect(hex(onChain)).toEqual(hex(digest));
      expect(secp256k1.verify(sig, onChain, pk, { prehash: false })).toBe(true);
      expect(secp256k1.verify(sig, structHash, pk, { prehash: false })).toBe(
        false,
      );
    });
  });
});
