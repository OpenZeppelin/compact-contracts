import { beforeEach, describe, expect, it } from 'vitest';
import { ShieldedMultiSigV2Simulator } from './simulators/ShieldedMultiSigV2Simulator.js';

const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

const PK1 = new Uint8Array(64).fill(0x11);
const PK2 = new Uint8Array(64).fill(0x22);
const PK3 = new Uint8Array(64).fill(0x33);
const NON_SIGNER_PK = new Uint8Array(64).fill(0x99);

const COMMITMENT1 = ShieldedMultiSigV2Simulator.calculateSignerId(
  PK1,
  INSTANCE_SALT,
);
const COMMITMENT2 = ShieldedMultiSigV2Simulator.calculateSignerId(
  PK2,
  INSTANCE_SALT,
);
const COMMITMENT3 = ShieldedMultiSigV2Simulator.calculateSignerId(
  PK3,
  INSTANCE_SALT,
);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

const DUMMY_SIG = new Uint8Array(64).fill(0xff);

function makeRecipient(address: Uint8Array): {
  kind: number;
  address: Uint8Array;
} {
  return { kind: RecipientKind.ShieldedUser, address };
}

function makeCoin(
  color: Uint8Array,
  value: bigint,
  nonce?: Uint8Array,
): { nonce: Uint8Array; color: Uint8Array; value: bigint } {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
  };
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

let multisig: ShieldedMultiSigV2Simulator;

describe('ShieldedMultiSigV2', () => {
  describe('constructor', () => {
    it('should initialize with 2-of-3 threshold', () => {
      multisig = new ShieldedMultiSigV2Simulator(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      expect(multisig.getSignerCount()).toEqual(3n);
      expect(multisig.getThreshold()).toEqual(2n);
    });

    it('should initialize with 1-of-3 threshold', () => {
      multisig = new ShieldedMultiSigV2Simulator(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        1n,
      );
      expect(multisig.getThreshold()).toEqual(1n);
    });

    it('should fail with zero threshold', () => {
      expect(() => {
        new ShieldedMultiSigV2Simulator(INSTANCE_SALT, SIGNER_COMMITMENTS, 0n);
      }).toThrow('SignerManager: threshold must be > 0');
    });

    it('should fail with threshold greater than 2', () => {
      expect(() => {
        new ShieldedMultiSigV2Simulator(INSTANCE_SALT, SIGNER_COMMITMENTS, 3n);
      }).toThrow(
        'ShieldedMultiSigV2: threshold cannot exceed 2 (execute verifies at most 2 signatures)',
      );
    });

    it('should register all signer commitments', () => {
      multisig = new ShieldedMultiSigV2Simulator(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(multisig.isSigner(commitment)).toEqual(true);
      }
    });

    it('should reject a non-signer commitment', () => {
      multisig = new ShieldedMultiSigV2Simulator(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      const unknown = ShieldedMultiSigV2Simulator.calculateSignerId(
        NON_SIGNER_PK,
        INSTANCE_SALT,
      );
      expect(multisig.isSigner(unknown)).toEqual(false);
    });
  });

  describe('when initialized', () => {
    beforeEach(() => {
      multisig = new ShieldedMultiSigV2Simulator(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
    });

    describe('view', () => {
      it('getNonce should start at 0', () => {
        expect(multisig.getNonce()).toEqual(0n);
      });

      it('getSignerCount should return 3', () => {
        expect(multisig.getSignerCount()).toEqual(3n);
      });

      it('getThreshold should match constructor arg', () => {
        expect(multisig.getThreshold()).toEqual(2n);
      });
    });

    describe('deposit', () => {
      it('should accept deposits without reverting', () => {
        expect(() => {
          multisig.deposit(makeCoin(COLOR, AMOUNT));
        }).not.toThrow();
      });
    });

    describe('execute', () => {
      it('should reject duplicate signer', () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        expect(() => {
          multisig.execute(to, 100n, coin, [PK1, PK1], [DUMMY_SIG, DUMMY_SIG]);
        }).toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        expect(() => {
          multisig.execute(
            to,
            100n,
            coin,
            [PK1, NON_SIGNER_PK],
            [DUMMY_SIG, DUMMY_SIG],
          );
        }).toThrow('SignerManager: not a signer');
      });
    });
  });
});
