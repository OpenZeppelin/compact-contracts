import {
  CompactTypeBytes,
  CompactTypeVector,
  convertBigintToBytes,
  keccak256,
} from '@midnight-ntwrk/compact-runtime';
import { keccak_256 } from '@noble/hashes/sha3.js';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { EvmAbiSimulator } from './simulators/EvmAbiSimulator.js';

// ---------------------------------------------------------------------------
// Oracles
// ---------------------------------------------------------------------------

// An independent `abi.encode(uint256)`: the value big-endian in a 32-byte word.
// Deliberately not a restatement of the circuit's byte shuffle. It is written
// from the ABI spec so the test can disagree with the implementation.
const abiEncodeUint256 = (value: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let acc = value;
  for (let i = 31; i >= 0 && acc > 0n; i--) {
    out[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return out;
};

const abiEncodeBool = (value: boolean): Uint8Array => {
  const out = new Uint8Array(32);
  out[31] = value ? 1 : 0;
  return out;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const U64_MAX = (1n << 64n) - 1n;
const U128_MAX = (1n << 128n) - 1n;

let contract: EvmAbiSimulator;

describe('EvmAbi', () => {
  beforeAll(async () => {
    contract = await EvmAbiSimulator.create();
  });

  describe('uint8Word', () => {
    it.each([0n, 1n, 42n, 255n])(
      'agrees with abi.encode(uint8) for %s',
      async (v) => {
        expect(hex(await contract.uint8Word(v))).toEqual(
          hex(abiEncodeUint256(v)),
        );
      },
    );

    it('is what boolWord delegates to', async () => {
      expect(hex(await contract.boolWord(true))).toEqual(
        hex(await contract.uint8Word(1n)),
      );
      expect(hex(await contract.boolWord(false))).toEqual(
        hex(await contract.uint8Word(0n)),
      );
    });
  });

  describe('uint64Word', () => {
    it('encodes zero as an empty word', async () => {
      expect(hex(await contract.uint64Word(0n))).toEqual(
        hex(new Uint8Array(32)),
      );
    });

    it('places the value big-endian, in the low 8 bytes', async () => {
      const word = await contract.uint64Word(0x0102030405060708n);

      // 24 zero bytes, then the value most-significant byte first.
      expect(hex(word)).toEqual(`${'00'.repeat(24)}0102030405060708`);
    });

    it('encodes one with the set bit in the least significant byte', async () => {
      const word = await contract.uint64Word(1n);

      expect(word[31]).toEqual(1);
      expect(hex(word.slice(0, 31))).toEqual('00'.repeat(31));
    });

    it('preserves interior zero bytes', async () => {
      const word = await contract.uint64Word(0x0100000000000001n);

      expect(hex(word)).toEqual(`${'00'.repeat(24)}0100000000000001`);
    });

    it('encodes the maximum Uint<64>', async () => {
      const word = await contract.uint64Word(U64_MAX);

      expect(hex(word)).toEqual(`${'00'.repeat(24)}${'ff'.repeat(8)}`);
    });

    it('does not match the native little-endian cast', async () => {
      const value = 0x0102030405060708n;

      const word = await contract.uint64Word(value);
      const nativeCast = convertBigintToBytes(32, value, 'EvmAbi.test');

      expect(hex(word)).not.toEqual(hex(nativeCast));
      expect(hex(word.slice(24))).toEqual(
        hex(nativeCast.slice(0, 8).reverse()),
      );
    });

    it('agrees with abi.encode(uint256) over the whole Uint<64> range', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 0n, max: U64_MAX }),
          async (value) => {
            const word = await contract.uint64Word(value);
            expect(hex(word)).toEqual(hex(abiEncodeUint256(value)));
          },
        ),
        { numRuns: 64 },
      );
    });
  });

  describe('uint128Word', () => {
    it('places the value big-endian, in the low 16 bytes', async () => {
      const word =
        await contract.uint128Word(0x0102030405060708090a0b0c0d0e0f10n);

      expect(hex(word)).toEqual(
        `${'00'.repeat(16)}0102030405060708090a0b0c0d0e0f10`,
      );
    });

    it('encodes the maximum Uint<128>', async () => {
      expect(hex(await contract.uint128Word(U128_MAX))).toEqual(
        `${'00'.repeat(16)}${'ff'.repeat(16)}`,
      );
    });

    it('agrees with uint64Word on values that fit in 64 bits', async () => {
      const value = 0xdeadbeefcafen;

      expect(hex(await contract.uint128Word(value))).toEqual(
        hex(await contract.uint64Word(value)),
      );
    });

    it('agrees with abi.encode(uint256) across the Uint<128> range', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 0n, max: U128_MAX }),
          async (value) => {
            expect(hex(await contract.uint128Word(value))).toEqual(
              hex(abiEncodeUint256(value)),
            );
          },
        ),
        { numRuns: 64 },
      );
    });

    it.each([
      0n,
      1n,
      U64_MAX,
      1n << 64n,
      0x0102030405060708090a0b0c0d0e0f10n,
      U128_MAX,
    ])('encodes %s identically to abi.encode(uint256)', async (value) => {
      expect(hex(await contract.uint128Word(value))).toEqual(
        hex(abiEncodeUint256(value)),
      );
    });
  });

  describe('boolWord', () => {
    it('encodes true as one in the least significant byte', async () => {
      expect(hex(await contract.boolWord(true))).toEqual(
        hex(abiEncodeBool(true)),
      );
    });

    it('encodes false as an empty word', async () => {
      expect(hex(await contract.boolWord(false))).toEqual(
        hex(abiEncodeBool(false)),
      );
    });
  });

  // The property the module exists to serve: a message assembled from ABI
  // words and hashed with `keccak256` reproduces Solidity's
  // `keccak256(abi.encode(...))` byte for byte. If a toolchain bump ever
  // changes Compact's binary representation, this is what catches it.
  describe('abi.encode equivalence', () => {
    it('hashes a word vector identically to keccak256(abi.encode(...))', async () => {
      const domain = new Uint8Array(32);
      domain.set(new TextEncoder().encode('multisig:mint:'));

      const contractAddress = new Uint8Array(32).fill(0xab);
      const nonce = await contract.uint64Word(7n);
      const amount = await contract.uint64Word(1_000_000n);

      const words = [domain, contractAddress, nonce, amount];

      const inCircuit = keccak256(
        new CompactTypeVector(4, new CompactTypeBytes(32)),
        words,
      );

      // What Solidity computes for
      // keccak256(abi.encode(bytes32, bytes32, uint256, uint256)).
      const onEvm = keccak_256(Buffer.concat(words.map(Buffer.from)));

      expect(hex(inCircuit)).toEqual(hex(onEvm));
    });

    // `abi.encode` carries no type information: uint8(1), uint256(1) and
    // true all encode to the same word. So the digest cannot distinguish a
    // field's type, only its value -- which is precisely why the message
    // needs its own domain separation, and why field order is load-bearing.
    it('encodes equal values identically across types', async () => {
      const [u8, u64, u128, b] = await Promise.all([
        contract.uint8Word(1n),
        contract.uint64Word(1n),
        contract.uint128Word(1n),
        contract.boolWord(true),
      ]);

      expect(new Set([u8, u64, u128, b].map(hex)).size).toEqual(1);
    });

    it('binds each field: changing the nonce changes the digest', async () => {
      const vecType = new CompactTypeVector(2, new CompactTypeBytes(32));
      const addr = new Uint8Array(32).fill(0xab);

      const a = keccak256(vecType, [addr, await contract.uint64Word(1n)]);
      const b = keccak256(vecType, [addr, await contract.uint64Word(2n)]);

      expect(hex(a)).not.toEqual(hex(b));
    });
  });
});
