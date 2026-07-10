import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import {
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
  encodeShieldedCoinInfo as makeCoin,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { ShieldedStatelessMultisigSimulator } from './simulators/ShieldedStatelessMultisigSimulator.js';

const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
// A shielded token type the deployer wallet holds on live (genesis-minted);
// `fill(1)` would be unfunded on live. On dry the color is arbitrary.
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;

const PK1 = new Uint8Array(64).fill(0x11);
const PK2 = new Uint8Array(64).fill(0x22);
const PK3 = new Uint8Array(64).fill(0x33);
const NON_SIGNER_PK = new Uint8Array(64).fill(0x99);

const COMMITMENT1 = ShieldedStatelessMultisigSimulator.calculateSignerId(
  PK1,
  INSTANCE_SALT,
);
const COMMITMENT2 = ShieldedStatelessMultisigSimulator.calculateSignerId(
  PK2,
  INSTANCE_SALT,
);
const COMMITMENT3 = ShieldedStatelessMultisigSimulator.calculateSignerId(
  PK3,
  INSTANCE_SALT,
);
const SIGNER_COMMITMENTS = [COMMITMENT1, COMMITMENT2, COMMITMENT3];

// ECDSA verification is stubbed in the contract (`stubVerifySignature` returns
// true), so any 64-byte value passes. Authorization is enforced only by
// signer-commitment membership and duplicate detection — both caller-agnostic,
// so this spec runs unchanged on live (no `ownPublicKey`-based caller identity).
const DUMMY_SIG = new Uint8Array(64).fill(0xff);

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

let multisig: ShieldedStatelessMultisigSimulator;

// A fresh 2-of-3 stateless multisig. Mutating groups build one per test
// (`beforeEach`); the read-only `view` group shares one deploy (`beforeAll`).
const freshMultisig = () =>
  ShieldedStatelessMultisigSimulator.create(
    INSTANCE_SALT,
    SIGNER_COMMITMENTS,
    2n,
  );

describe('ShieldedStatelessMultisig', () => {
  describe('constructor', () => {
    it('should initialize with 2-of-3 threshold', async () => {
      multisig = await ShieldedStatelessMultisigSimulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      expect(await multisig.getSignerCount()).toEqual(3n);
      expect(await multisig.getThreshold()).toEqual(2n);
    });

    it('should initialize with 1-of-3 threshold', async () => {
      multisig = await ShieldedStatelessMultisigSimulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        1n,
      );
      expect(await multisig.getThreshold()).toEqual(1n);
    });

    it('should fail with zero threshold', async () => {
      await expect(
        ShieldedStatelessMultisigSimulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          0n,
        ),
      ).rejects.toThrow('SignerManager: threshold must be > 0');
    });

    it('should fail with threshold greater than 2', async () => {
      await expect(
        ShieldedStatelessMultisigSimulator.create(
          INSTANCE_SALT,
          SIGNER_COMMITMENTS,
          3n,
        ),
      ).rejects.toThrow(
        'ShieldedStatelessMultisig: threshold cannot exceed 2 (execute verifies at most 2 signatures)',
      );
    });

    it('should register all signer commitments', async () => {
      multisig = await ShieldedStatelessMultisigSimulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      for (const commitment of SIGNER_COMMITMENTS) {
        expect(await multisig.isSigner(commitment)).toEqual(true);
      }
    });

    it('should reject a non-signer commitment', async () => {
      multisig = await ShieldedStatelessMultisigSimulator.create(
        INSTANCE_SALT,
        SIGNER_COMMITMENTS,
        2n,
      );
      const unknown = ShieldedStatelessMultisigSimulator.calculateSignerId(
        NON_SIGNER_PK,
        INSTANCE_SALT,
      );
      expect(await multisig.isSigner(unknown)).toEqual(false);
    });
  });

  describe('when initialized', () => {
    describe('view', () => {
      beforeAll(async () => {
        multisig = await freshMultisig();
      });

      it('getNonce should start at 0', async () => {
        expect(await multisig.getNonce()).toEqual(0n);
      });

      it('getSignerCount should return 3', async () => {
        expect(await multisig.getSignerCount()).toEqual(3n);
      });

      it('getThreshold should match constructor arg', async () => {
        expect(await multisig.getThreshold()).toEqual(2n);
      });
    });

    describe('deposit', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      it('should accept deposits without reverting', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
      });
    });

    describe('execute', () => {
      beforeEach(async () => {
        multisig = await freshMultisig();
      });

      it('should reject duplicate signer', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        await expect(
          multisig.execute(to, 100n, coin, [PK1, PK1], [DUMMY_SIG, DUMMY_SIG]),
        ).rejects.toThrow('Multisig: duplicate signer');
      });

      it('should reject a non-signer pubkey', async () => {
        const to = makeRecipient(new Uint8Array(32).fill(7));
        const coin = makeQualifiedCoin(COLOR, AMOUNT, 0n);
        await expect(
          multisig.execute(
            to,
            100n,
            coin,
            [PK1, NON_SIGNER_PK],
            [DUMMY_SIG, DUMMY_SIG],
          ),
        ).rejects.toThrow('SignerManager: not a signer');
      });
    });
  });
});
