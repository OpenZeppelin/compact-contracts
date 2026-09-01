import { keccak_256 } from '@noble/hashes/sha3.js';
import fc from 'fast-check';
import { hashMessage, hexToBytes, keccak256, toHex } from 'viem';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  BURN_TYPE_STRING,
  EIP712_DOMAIN_TYPE_STRING,
  EIP712_VERSION,
  EXECUTE_TYPE_STRING,
  keccakAscii,
  MINT_TYPE_STRING,
  toBigEndianBytes32,
  toEthSignedMessageHash,
  toTypedDataHash,
  viemDomainSeparator,
} from '../../multisig/test/Eip712TestUtils.js';
import { MessageHashUtilsSimulator } from './simulators/MessageHashUtilsSimulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const MAX_U64 = (1n << 64n) - 1n;
const MAX_U128 = (1n << 128n) - 1n;

// Boundaries of the big-endian word encoder: zero, one, the byte carry, and the
// widest value `Uint<128>` admits.
const BIG_ENDIAN_VECTORS = [0n, 1n, 255n, 256n, MAX_U64, MAX_U128];

// Every type string the presets hash, so a stray character in any of them
// surfaces as a typehash mismatch rather than a digest mismatch.
const TYPE_STRINGS = [
  EIP712_DOMAIN_TYPE_STRING,
  MINT_TYPE_STRING,
  BURN_TYPE_STRING,
  EXECUTE_TYPE_STRING,
];

const DOMAIN_SEPARATOR = new Uint8Array(32).fill(0x33);
const STRUCT_HASH = new Uint8Array(32).fill(0x44);
const MESSAGE_HASH = new Uint8Array(32).fill(0xab);

const DOMAIN_NAME = 'MessageHashUtils';
const DOMAIN_SALT = new Uint8Array(32).fill(0x55);

let contract: MessageHashUtilsSimulator;

/**
 * Big-endian 32-byte encoding built from the hex representation, independent of
 * the shift-based encoder under test.
 */
const manualBigEndianBytes32 = (value: bigint): Uint8Array =>
  Uint8Array.from(Buffer.from(value.toString(16).padStart(64, '0'), 'hex'));

const concatBytes = (...parts: Uint8Array[]): Uint8Array => {
  const out = new Uint8Array(parts.reduce((n, p) => n + p.length, 0));
  let offset = 0;
  for (const part of parts) {
    out.set(part, offset);
    offset += part.length;
  }
  return out;
};

/** `Vector<32, Uint<8>>` as the artifact returns it. */
const wordToBytes = (word: bigint[]): Uint8Array =>
  Uint8Array.from(word, Number);

describe('MessageHashUtils', () => {
  // The reconstruction helpers mirror the module's encoding through
  // compact-runtime. viem and noble derive the same values from the EIP-191 /
  // EIP-712 specs with no shared code.
  describe('reference agreement', () => {
    describe('toBigEndianBytes32', () => {
      it.each(BIG_ENDIAN_VECTORS)('encodes %s big-endian', (value) => {
        expect(toBigEndianBytes32(value)).toStrictEqual(
          manualBigEndianBytes32(value),
        );
      });

      it('rejects a value wider than 32 bytes', () => {
        expect(() => toBigEndianBytes32(1n << 256n)).toThrow(RangeError);
      });

      it('matches the manual encoding across the Uint<128> range', () => {
        fc.assert(
          fc.property(fc.bigInt({ min: 0n, max: MAX_U128 }), (value) => {
            expect(toBigEndianBytes32(value)).toStrictEqual(
              manualBigEndianBytes32(value),
            );
          }),
        );
      });
    });

    describe('typeHashFromAscii', () => {
      it.each(TYPE_STRINGS)('hashes %s', (typeString) => {
        expect(keccakAscii(typeString)).toStrictEqual(
          hexToBytes(keccak256(toHex(typeString))),
        );
      });
    });

    describe('toEthSignedMessageHash', () => {
      it('matches viem hashMessage over a raw 32-byte hash', () => {
        expect(toEthSignedMessageHash(MESSAGE_HASH)).toStrictEqual(
          hexToBytes(hashMessage({ raw: MESSAGE_HASH })),
        );
      });
    });

    describe('toTypedDataHash', () => {
      it('matches keccak256 of 0x1901, the domain separator and the struct hash', () => {
        expect(toTypedDataHash(DOMAIN_SEPARATOR, STRUCT_HASH)).toStrictEqual(
          keccak_256(
            concatBytes(
              Uint8Array.from([0x19, 0x01]),
              DOMAIN_SEPARATOR,
              STRUCT_HASH,
            ),
          ),
        );
      });

      it('binds the domain separator and the struct hash in order', () => {
        expect(
          toTypedDataHash(DOMAIN_SEPARATOR, STRUCT_HASH),
        ).not.toStrictEqual(toTypedDataHash(STRUCT_HASH, DOMAIN_SEPARATOR));
      });
    });
  });

  describe('circuits', () => {
    beforeAll(async () => {
      contract = await MessageHashUtilsSimulator.create();
    });

    describe('toBigEndianBytes32', () => {
      it.each(BIG_ENDIAN_VECTORS)('encodes %s big-endian', async (value) => {
        expect(
          wordToBytes(await contract.toBigEndianBytes32(value)),
        ).toStrictEqual(manualBigEndianBytes32(value));
      });

      it('matches the manual encoding across the Uint<128> range', async () => {
        await fc.assert(
          fc.asyncProperty(
            fc.bigInt({ min: 0n, max: MAX_U128 }),
            async (value) => {
              expect(
                wordToBytes(await contract.toBigEndianBytes32(value)),
              ).toStrictEqual(manualBigEndianBytes32(value));
            },
          ),
          { numRuns: 25 },
        );
      });
    });

    describe('typeHashFromAscii', () => {
      it.each(TYPE_STRINGS)('hashes %s', async (typeString) => {
        expect(
          await contract.typeHashFromAscii(
            new TextEncoder().encode(typeString),
          ),
        ).toStrictEqual(hexToBytes(keccak256(toHex(typeString))));
      });
    });

    describe('toEthSignedMessageHash', () => {
      it('matches viem hashMessage over a raw 32-byte hash', async () => {
        expect(
          await contract.toEthSignedMessageHash(MESSAGE_HASH),
        ).toStrictEqual(hexToBytes(hashMessage({ raw: MESSAGE_HASH })));
      });
    });

    describe('toTypedDataHash', () => {
      it('matches keccak256 of 0x1901, the domain separator and the struct hash', async () => {
        expect(
          await contract.toTypedDataHash(DOMAIN_SEPARATOR, STRUCT_HASH),
        ).toStrictEqual(
          keccak_256(
            concatBytes(
              Uint8Array.from([0x19, 0x01]),
              DOMAIN_SEPARATOR,
              STRUCT_HASH,
            ),
          ),
        );
      });
    });

    describe('domainSeparator', () => {
      it('matches viem hashDomain for a name, version and salt', async () => {
        expect(
          await contract.domainSeparator(
            keccakAscii(DOMAIN_NAME),
            keccakAscii(EIP712_VERSION),
            DOMAIN_SALT,
          ),
        ).toStrictEqual(
          viemDomainSeparator({ name: DOMAIN_NAME, salt: DOMAIN_SALT }),
        );
      });
    });
  });
});
