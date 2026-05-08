import {
  CompactTypeBytes,
  CompactTypeVector,
  constructJubjubPoint,
  convertFieldToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type JubjubKeypair,
  type JubjubSchnorrSignature,
  jubjubKeypairFromSecret,
  jubjubSignDeterministic,
} from '../../crypto/utils/jubjubSchnorr.js';
import { ShieldedMultiSigSchnorrV1Simulator } from './simulators/ShieldedMultiSigSchnorrV1Simulator.js';

const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

const SECRET_1 = 0x1111111111111111111111111111111111111111111111111111111111111111n;
const SECRET_2 = 0x2222222222222222222222222222222222222222222222222222222222222222n;
const SECRET_3 = 0x3333333333333333333333333333333333333333333333333333333333333333n;
const SECRET_OUTSIDER = 0x9999999999999999999999999999999999999999999999999999999999999999n;
const NONCE_BASE = 0x4242424242424242424242424242424242424242424242424242424242424242n;

let KP1: JubjubKeypair;
let KP2: JubjubKeypair;
let KP3: JubjubKeypair;
let KP_OUT: JubjubKeypair;
let IDENTITY: ReturnType<typeof constructJubjubPoint>;

beforeEach(() => {
  KP1 = jubjubKeypairFromSecret(SECRET_1);
  KP2 = jubjubKeypairFromSecret(SECRET_2);
  KP3 = jubjubKeypairFromSecret(SECRET_3);
  KP_OUT = jubjubKeypairFromSecret(SECRET_OUTSIDER);
  IDENTITY = constructJubjubPoint(0n, 1n);
});

function makeRecipient(address: Uint8Array): {
  kind: number;
  address: Uint8Array;
} {
  return { kind: RecipientKind.ShieldedUser, address };
}

function makeQualifiedCoin(
  color: Uint8Array,
  value: bigint,
  mtIndex: bigint,
  nonce?: Uint8Array,
): {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mt_index: bigint;
} {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
    mt_index: mtIndex,
  };
}

/**
 * Reproduce the on-chain `execute` message hash off-chain so we can produce
 * Schnorr signatures over the same digest. MUST byte-match
 * `persistentHash<Vector<4, Bytes<32>>>([nonce, to.address, coin.color, amount])`
 * in `ShieldedMultiSigSchnorrV1.execute`.
 */
function executeMessageHash(
  currentNonce: bigint,
  toAddress: Uint8Array,
  coinColor: Uint8Array,
  amount: bigint,
): Uint8Array {
  const rt = new CompactTypeVector(4, new CompactTypeBytes(32));
  return persistentHash(rt, [
    convertFieldToBytes(32, currentNonce, ''),
    toAddress,
    coinColor,
    convertFieldToBytes(32, amount, ''),
  ]);
}

/**
 * Build the ApprovedSig list for a 3-signer execute by hashing the message,
 * deterministically signing under each keypair, and bundling them in the
 * caller-supplied order.
 */
function buildApprovedSigs(
  signers: JubjubKeypair[],
  msgHash: Uint8Array,
  nonceSeeds: bigint[],
): Array<{ pubkey: ReturnType<typeof constructJubjubPoint>; signature: JubjubSchnorrSignature }> {
  if (signers.length !== 3) {
    throw new Error('preset is K=3; pass exactly three signers');
  }
  return signers.map((kp, i) => ({
    pubkey: kp.publicKey,
    signature: jubjubSignDeterministic(kp.secret, msgHash, nonceSeeds[i]!),
  }));
}

describe('ShieldedMultiSigSchnorrV1', () => {
  let multisig: ShieldedMultiSigSchnorrV1Simulator;

  describe('constructor', () => {
    it('initialises with 1-of-3 threshold', () => {
      multisig = new ShieldedMultiSigSchnorrV1Simulator(
        [KP1.publicKey, KP2.publicKey, KP3.publicKey],
        1n,
      );
      expect(multisig.getSignerCount()).toEqual(3n);
      expect(multisig.getThreshold()).toEqual(1n);
    });

    it('initialises with 3-of-3 threshold', () => {
      multisig = new ShieldedMultiSigSchnorrV1Simulator(
        [KP1.publicKey, KP2.publicKey, KP3.publicKey],
        3n,
      );
      expect(multisig.getThreshold()).toEqual(3n);
    });

    it('rejects threshold = 0', () => {
      expect(() => {
        new ShieldedMultiSigSchnorrV1Simulator(
          [KP1.publicKey, KP2.publicKey, KP3.publicKey],
          0n,
        );
      }).toThrow(/threshold must not be zero/);
    });

    it('rejects threshold > 3', () => {
      expect(() => {
        new ShieldedMultiSigSchnorrV1Simulator(
          [KP1.publicKey, KP2.publicKey, KP3.publicKey],
          4n,
        );
      }).toThrow(/threshold cannot exceed 3/);
    });

    it('rejects an identity public key at registration', () => {
      expect(() => {
        new ShieldedMultiSigSchnorrV1Simulator(
          [KP1.publicKey, IDENTITY, KP3.publicKey],
          2n,
        );
      }).toThrow(/Jubjub: identity point not allowed/);
    });

    it('rejects duplicate signer public keys at registration', () => {
      expect(() => {
        new ShieldedMultiSigSchnorrV1Simulator(
          [KP1.publicKey, KP1.publicKey, KP3.publicKey],
          2n,
        );
      }).toThrow(/Signer: signer already active/);
    });
  });

  describe('when initialised', () => {
    beforeEach(() => {
      multisig = new ShieldedMultiSigSchnorrV1Simulator(
        [KP1.publicKey, KP2.publicKey, KP3.publicKey],
        3n,
      );
    });

    describe('view', () => {
      it('getNonce starts at 0', () => {
        expect(multisig.getNonce()).toEqual(0n);
      });

      it('getSignerCount = 3', () => {
        expect(multisig.getSignerCount()).toEqual(3n);
      });

      it('getThreshold matches constructor arg', () => {
        expect(multisig.getThreshold()).toEqual(3n);
      });

      it('isSigner(registered) returns true for each KP', () => {
        expect(multisig.isSigner(KP1.publicKey)).toBe(true);
        expect(multisig.isSigner(KP2.publicKey)).toBe(true);
        expect(multisig.isSigner(KP3.publicKey)).toBe(true);
      });

      it('isSigner(outsider) returns false', () => {
        expect(multisig.isSigner(KP_OUT.publicKey)).toBe(false);
      });
    });

    describe('execute auth failures', () => {
      const TO_ADDR = new Uint8Array(32).fill(7);
      const recipient = makeRecipient(new Uint8Array(32).fill(7));

      it('rejects duplicate signer in slot (0, 1)', () => {
        const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
        const approvals = buildApprovedSigs(
          [KP1, KP1, KP3],
          msgHash,
          [NONCE_BASE, NONCE_BASE + 1n, NONCE_BASE + 2n],
        );
        expect(() => {
          multisig.execute(
            recipient,
            AMOUNT,
            makeQualifiedCoin(COLOR, AMOUNT, 0n),
            approvals,
          );
        }).toThrow(/duplicate signer \(0, 1\)/);
      });

      it('rejects duplicate signer in slot (0, 2)', () => {
        const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
        const approvals = buildApprovedSigs(
          [KP1, KP2, KP1],
          msgHash,
          [NONCE_BASE, NONCE_BASE + 1n, NONCE_BASE + 2n],
        );
        expect(() => {
          multisig.execute(
            recipient,
            AMOUNT,
            makeQualifiedCoin(COLOR, AMOUNT, 0n),
            approvals,
          );
        }).toThrow(/duplicate signer \(0, 2\)/);
      });

      it('rejects duplicate signer in slot (1, 2)', () => {
        const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
        const approvals = buildApprovedSigs(
          [KP1, KP2, KP2],
          msgHash,
          [NONCE_BASE, NONCE_BASE + 1n, NONCE_BASE + 2n],
        );
        expect(() => {
          multisig.execute(
            recipient,
            AMOUNT,
            makeQualifiedCoin(COLOR, AMOUNT, 0n),
            approvals,
          );
        }).toThrow(/duplicate signer \(1, 2\)/);
      });

      it('rejects a non-registered pubkey', () => {
        const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
        const approvals = buildApprovedSigs(
          [KP1, KP2, KP_OUT],
          msgHash,
          [NONCE_BASE, NONCE_BASE + 1n, NONCE_BASE + 2n],
        );
        expect(() => {
          multisig.execute(
            recipient,
            AMOUNT,
            makeQualifiedCoin(COLOR, AMOUNT, 0n),
            approvals,
          );
        }).toThrow(/Signer: not a signer/);
      });

      it('rejects an identity pubkey at runtime', () => {
        // Build with KP1, KP2, KP3, then swap KP3.pubkey for the identity
        // (signature against KP3 still passes the registry check we never
        // reach because non-identity assertion fires first).
        const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
        const approvals = buildApprovedSigs(
          [KP1, KP2, KP3],
          msgHash,
          [NONCE_BASE, NONCE_BASE + 1n, NONCE_BASE + 2n],
        );
        approvals[2]!.pubkey = IDENTITY;
        expect(() => {
          multisig.execute(
            recipient,
            AMOUNT,
            makeQualifiedCoin(COLOR, AMOUNT, 0n),
            approvals,
          );
        }).toThrow(/Jubjub: identity point not allowed/);
      });

      it('rejects a tampered signature', () => {
        const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
        const approvals = buildApprovedSigs(
          [KP1, KP2, KP3],
          msgHash,
          [NONCE_BASE, NONCE_BASE + 1n, NONCE_BASE + 2n],
        );
        approvals[1]!.signature = {
          R: approvals[1]!.signature.R,
          sigma: approvals[1]!.signature.sigma + 1n,
        };
        expect(() => {
          multisig.execute(
            recipient,
            AMOUNT,
            makeQualifiedCoin(COLOR, AMOUNT, 0n),
            approvals,
          );
        }).toThrow(/Schnorr: invalid signature/);
      });

      it('rejects a signature over the wrong message (replay-protected)', () => {
        // Sign hash for amount=AMOUNT, then call execute with amount=AMOUNT+1.
        // The on-chain msgHash will differ → signatures fail to verify.
        const msgHash = executeMessageHash(0n, TO_ADDR, COLOR, AMOUNT);
        const approvals = buildApprovedSigs(
          [KP1, KP2, KP3],
          msgHash,
          [NONCE_BASE, NONCE_BASE + 1n, NONCE_BASE + 2n],
        );
        expect(() => {
          multisig.execute(
            recipient,
            AMOUNT + 1n,
            makeQualifiedCoin(COLOR, AMOUNT + 1n, 0n),
            approvals,
          );
        }).toThrow(/Schnorr: invalid signature/);
      });
    });
  });
});
