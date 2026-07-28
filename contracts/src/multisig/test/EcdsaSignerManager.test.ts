import { beforeEach, describe, expect, it } from 'vitest';
import {
  EcdsaSignerManagerSimulator,
  sortByCommitmentField,
} from './simulators/EcdsaSignerManagerSimulator.js';

const THRESHOLD = 2n;
const THRESHOLD_3 = 3n;

// Instance salt and ECDSA public keys (Bytes<64>) used to derive commitments.
const SALT = new Uint8Array(32).fill(7);
const PK1 = new Uint8Array(64).fill(1);
const PK2 = new Uint8Array(64).fill(2);
const PK3 = new Uint8Array(64).fill(3);
const PK_UNKNOWN = new Uint8Array(64).fill(9);

// A dummy signature and message hash. The ECDSA check is stubbed, so the
// signature bytes are irrelevant to verification today.
const SIG = new Uint8Array(64).fill(0);
const MSG = new Uint8Array(32).fill(5);

const COMMITMENT1 = EcdsaSignerManagerSimulator.calculateSignerId(PK1, SALT);
const COMMITMENT2 = EcdsaSignerManagerSimulator.calculateSignerId(PK2, SALT);
const COMMITMENT3 = EcdsaSignerManagerSimulator.calculateSignerId(PK3, SALT);
const SIGNERS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

let verifier: EcdsaSignerManagerSimulator;
let verifier3: EcdsaSignerManagerSimulator;

/** Present keys sorted by ascending commitment (Field order), as verify requires. */
function sortedPair(
  a: Uint8Array,
  b: Uint8Array,
): {
  pubkeys: [Uint8Array, Uint8Array];
  signatures: [Uint8Array, Uint8Array];
} {
  const { pubkeys, signatures } = sortByCommitmentField(
    SALT,
    [a, b],
    [SIG, SIG],
  );
  return {
    pubkeys: [pubkeys[0]!, pubkeys[1]!],
    signatures: [signatures[0]!, signatures[1]!],
  };
}

function sortedTriple(
  a: Uint8Array,
  b: Uint8Array,
  c: Uint8Array,
): {
  pubkeys: [Uint8Array, Uint8Array, Uint8Array];
  signatures: [Uint8Array, Uint8Array, Uint8Array];
} {
  const { pubkeys, signatures } = sortByCommitmentField(
    SALT,
    [a, b, c],
    [SIG, SIG, SIG],
  );
  return {
    pubkeys: [pubkeys[0]!, pubkeys[1]!, pubkeys[2]!],
    signatures: [signatures[0]!, signatures[1]!, signatures[2]!],
  };
}

describe('EcdsaSignerManager', () => {
  beforeEach(async () => {
    verifier = await EcdsaSignerManagerSimulator.create(
      SALT,
      SIGNERS,
      THRESHOLD,
    );
    verifier3 = await EcdsaSignerManagerSimulator.create(
      SALT,
      SIGNERS,
      THRESHOLD_3,
    );
  });

  describe('initialization', () => {
    it('should register all signer commitments', async () => {
      expect(await verifier.getSignerCount()).toEqual(3n);
      expect(await verifier.getThreshold()).toEqual(2n);
      expect(await verifier.isSigner(COMMITMENT1)).toEqual(true);
      expect(await verifier.isSigner(COMMITMENT2)).toEqual(true);
      expect(await verifier.isSigner(COMMITMENT3)).toEqual(true);
    });

    it('should not recognize an unregistered commitment', async () => {
      const unknown = EcdsaSignerManagerSimulator.calculateSignerId(
        PK_UNKNOWN,
        SALT,
      );
      expect(await verifier.isSigner(unknown)).toEqual(false);
    });
  });

  describe('_calculateSignerId', () => {
    it('should be deterministic for the same key and salt', () => {
      expect(
        EcdsaSignerManagerSimulator.calculateSignerId(PK1, SALT),
      ).toStrictEqual(COMMITMENT1);
    });

    it('should produce a different commitment for a different salt', () => {
      const otherSalt = new Uint8Array(32).fill(8);
      expect(
        EcdsaSignerManagerSimulator.calculateSignerId(PK1, otherSalt),
      ).not.toStrictEqual(COMMITMENT1);
    });

    it('should produce a different commitment for a different key', () => {
      expect(COMMITMENT1).not.toStrictEqual(COMMITMENT2);
    });
  });

  describe('verify', () => {
    it('should pass with two distinct registered signers (sorted)', async () => {
      const { pubkeys, signatures } = sortedPair(PK1, PK2);
      await verifier.verify(MSG, pubkeys, signatures);
    });

    it('should reject an adjacent duplicate signer', async () => {
      await expect(
        verifier.verify(MSG, [PK1, PK1], [SIG, SIG]),
      ).rejects.toThrow('EcdsaSignerManager: duplicate or unsorted signer');
    });

    it('should reject an unregistered signer', async () => {
      const { pubkeys, signatures } = sortedPair(PK_UNKNOWN, PK2);
      // Order may place unknown first or second; either fails membership or order
      await expect(verifier.verify(MSG, pubkeys, signatures)).rejects.toThrow();
    });
  });

  describe('verify3 (issue #629 — non-adjacent duplicates)', () => {
    it('should pass with three distinct registered signers sorted by commitment', async () => {
      const { pubkeys, signatures } = sortedTriple(PK1, PK2, PK3);
      await verifier3.verify3(MSG, pubkeys, signatures);
    });

    it('should reject non-adjacent duplicate presentation [A, B, A]', async () => {
      // Deliberately unsorted path that previously counted A twice under
      // adjacent-only checks. Strictly-increasing Field order rejects this.
      await expect(
        verifier3.verify3(MSG, [PK1, PK2, PK1], [SIG, SIG, SIG]),
      ).rejects.toThrow('EcdsaSignerManager: duplicate or unsorted signer');
    });

    it('should reject adjacent duplicate in a 3-signer presentation', async () => {
      await expect(
        verifier3.verify3(MSG, [PK1, PK1, PK2], [SIG, SIG, SIG]),
      ).rejects.toThrow('EcdsaSignerManager: duplicate or unsorted signer');
    });
  });
});
