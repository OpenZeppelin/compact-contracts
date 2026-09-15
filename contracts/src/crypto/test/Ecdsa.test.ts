import { secp256k1 } from '@noble/curves/secp256k1.js';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type EcdsaSignature,
  highSTwin,
  SECP256K1_N,
  sign,
  signerFromLabel,
} from '#test-utils/fixtures/ecdsa.js';
import { EcdsaSimulator } from './simulators/EcdsaSimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

// n is odd, so this floors to (n - 1) / 2.
const HALF_N = SECP256K1_N / 2n;

const bigIntToBytesBE = (value: bigint): Uint8Array => {
  const out = new Uint8Array(32);
  let acc = value;
  for (let i = 31; i >= 0; i--) {
    out[i] = Number(acc & 0xffn);
    acc >>= 8n;
  }
  return out;
};

/** The 64-byte `r‖s` encoding noble's verifier accepts. */
const compact = (sig: EcdsaSignature): Uint8Array => {
  const out = new Uint8Array(64);
  out.set(bigIntToBytesBE(sig.r), 0);
  out.set(bigIntToBytesBE(sig.s), 32);
  return out;
};

const b32 = (fill: number): Uint8Array => new Uint8Array(32).fill(fill);

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const DIGEST = b32(0x42);
const OTHER_DIGEST = b32(0x43);

const SIGNER = signerFromLabel('ecdsa-low-s');
const OTHER_SIGNER = signerFromLabel('ecdsa-low-s-other');

// 0x04 || X || Y, the form noble's verifier takes.
const SIGNER_PK_BYTES = secp256k1.getPublicKey(SIGNER.secretKey, false);

const LOW_S_SIG = sign(SIGNER, DIGEST);
const HIGH_S_SIG = highSTwin(LOW_S_SIG);

const IDENTITY = { x: 0n, y: 0n, identity: true };

let contract: EcdsaSimulator;

describe('Ecdsa', () => {
  beforeAll(async () => {
    contract = await EcdsaSimulator.create();
  });

  // -------------------------------------------------------------------------
  // isLowS
  //
  // The half-order split: scalars up to and including n/2 are canonical, the
  // rest are the mauled twins.
  // -------------------------------------------------------------------------
  describe('isLowS', () => {
    it('accepts the zero scalar', () => {
      expect(EcdsaSimulator.isLowS(0n)).toBe(true);
    });

    it('accepts the smallest non-zero scalar', () => {
      expect(EcdsaSimulator.isLowS(1n)).toBe(true);
    });

    it('accepts s just below n/2', () => {
      expect(EcdsaSimulator.isLowS(HALF_N - 1n)).toBe(true);
    });

    it('accepts s = n/2', () => {
      expect(EcdsaSimulator.isLowS(HALF_N)).toBe(true);
    });

    it('rejects s = n/2 + 1', () => {
      expect(EcdsaSimulator.isLowS(HALF_N + 1n)).toBe(false);
    });

    it('rejects the largest scalar', () => {
      expect(EcdsaSimulator.isLowS(SECP256K1_N - 1n)).toBe(false);
    });
  });

  // -------------------------------------------------------------------------
  // assertLowS
  // -------------------------------------------------------------------------
  describe('assertLowS', () => {
    it('accepts a signature at the boundary', async () => {
      await contract.assertLowS({ r: 1n, s: HALF_N });
    });

    it('rejects a signature one past the boundary', async () => {
      await expect(
        contract.assertLowS({ r: 1n, s: HALF_N + 1n }),
      ).rejects.toThrow('Ecdsa: high-s signature');
    });
  });

  // -------------------------------------------------------------------------
  // secp256k1EcdsaVerifyLowS
  //
  // Returns a Boolean on every path; the low-s gate never asserts here.
  // -------------------------------------------------------------------------
  describe('secp256k1EcdsaVerifyLowS', () => {
    it('accepts a valid low-s signature', async () => {
      expect(
        await contract.secp256k1EcdsaVerifyLowS(
          DIGEST,
          LOW_S_SIG,
          SIGNER.publicKey,
        ),
      ).toBe(true);
    });

    // Precondition for the case below: the twin is a valid plain-ECDSA
    // signature, so a `false` there isolates the low-s gate.
    it('the high-s twin still verifies under plain ECDSA', () => {
      expect(
        secp256k1.verify(compact(HIGH_S_SIG), DIGEST, SIGNER_PK_BYTES, {
          lowS: false,
          prehash: false,
        }),
      ).toBe(true);
    });

    it('rejects the high-s twin of a valid signature', async () => {
      expect(
        await contract.secp256k1EcdsaVerifyLowS(
          DIGEST,
          HIGH_S_SIG,
          SIGNER.publicKey,
        ),
      ).toBe(false);
    });

    it('rejects a signature over a different digest', async () => {
      expect(
        await contract.secp256k1EcdsaVerifyLowS(
          OTHER_DIGEST,
          LOW_S_SIG,
          SIGNER.publicKey,
        ),
      ).toBe(false);
    });

    it('rejects a valid signature checked against another key', async () => {
      expect(
        await contract.secp256k1EcdsaVerifyLowS(
          DIGEST,
          LOW_S_SIG,
          OTHER_SIGNER.publicKey,
        ),
      ).toBe(false);
    });

    // The identity contributes nothing to `u1*G + u2*pk`, so the recovered
    // x-coordinate is that of `u1*G` and simply misses `r`. No trap.
    it('rejects the identity point as the public key', async () => {
      expect(
        await contract.secp256k1EcdsaVerifyLowS(DIGEST, LOW_S_SIG, IDENTITY),
      ).toBe(false);
    });
  });
});
