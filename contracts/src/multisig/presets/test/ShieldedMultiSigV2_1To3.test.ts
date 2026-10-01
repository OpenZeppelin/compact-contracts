import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, beforeEach, describe, expect, it } from 'vitest';
import { sign, signerFromLabel } from '#test-utils/fixtures/ecdsa.js';
import {
  GENESIS_NATIVE_SHIELDED_TOKEN_COLORS,
  encodeShieldedCoinInfo as makeCoin,
} from '#test-utils/fixtures/nativeShieldedToken.js';
import { executeMsgHash } from '../../test/EcdsaTestUtils.js';
import { ShieldedMultiSigV2_1To3Simulator } from './simulators/ShieldedMultiSigV2_1To3Simulator.js';

const RecipientKind = { ShieldedUser: 0 };

const INSTANCE_SALT = new Uint8Array(32).fill(0xaa);
const COLOR = GENESIS_NATIVE_SHIELDED_TOKEN_COLORS.nativeShieldedToken1;
const AMOUNT = 1000n;

const S1 = signerFromLabel('v2-signer-1');
const S2 = signerFromLabel('v2-signer-2');
const S3 = signerFromLabel('v2-signer-3');
const OUTSIDER = signerFromLabel('v2-outsider');

const SIGNER_COMMITMENTS = [S1, S2, S3].map((s) =>
  ShieldedMultiSigV2_1To3Simulator.calculateSignerId(
    s.publicKey,
    INSTANCE_SALT,
  ),
);

const TO = {
  kind: RecipientKind.ShieldedUser,
  address: new Uint8Array(32).fill(7),
};
const COIN = {
  nonce: new Uint8Array(32).fill(0),
  color: COLOR,
  value: AMOUNT,
  mt_index: 0n,
};

const hexBytes = (hex: string): Uint8Array =>
  Uint8Array.from(Buffer.from(hex, 'hex'));

let multisig: ShieldedMultiSigV2_1To3Simulator;

/** The digest the contract computes for sending `amount` of `COIN` to `TO` at its current nonce. */
async function executeDigest(
  m: ShieldedMultiSigV2_1To3Simulator,
  amount: bigint,
): Promise<Uint8Array> {
  return executeMsgHash({
    contractAddress: Uint8Array.from(Buffer.from(m.contractAddress, 'hex')),
    instanceSalt: INSTANCE_SALT,
    nonce: await m.getNonce(),
    to: TO,
    coinColor: COIN.color,
    amount,
  });
}

const freshMultisig = () =>
  ShieldedMultiSigV2_1To3Simulator.create(INSTANCE_SALT, SIGNER_COMMITMENTS);

describe('ShieldedMultiSigV2 1-of-3', () => {
  describe('view', () => {
    beforeAll(async () => {
      multisig = await freshMultisig();
    });

    it('getSignerCount returns 3', async () => {
      expect(await multisig.getSignerCount()).toEqual(3n);
    });

    it('getThreshold returns 1', async () => {
      expect(await multisig.getThreshold()).toEqual(1n);
    });
  });

  describe('execute', () => {
    beforeEach(async () => {
      multisig = await freshMultisig();
    });

    // TODO: run on live once the harness can fund and track a deposited coin.
    describe.skipIf(isLiveBackend())('happy path (dry only)', () => {
      // Both output nonces derive from the deposited coin.
      const EXPECTED_SEND_RESULT = {
        change: {
          is_some: true,
          value: {
            nonce: hexBytes(
              '1d62fa499a81ab6b63c7e8fb768dcb46729383838adec43fa70b2381e0765400',
            ),
            color: COLOR,
            value: 900n,
          },
        },
        sent: {
          nonce: hexBytes(
            'f0925e45d140674d1bbc00240a017b3d9635b803ee6e75a61569afd28440cf00',
          ),
          color: COLOR,
          value: 100n,
        },
      };

      it.each([
        { label: 'S1', signer: S1 },
        { label: 'S2', signer: S2 },
        { label: 'S3', signer: S3 },
      ])('executes a send signed by $label alone', async ({ signer }) => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        const digest = await executeDigest(multisig, 100n);

        expect(
          await multisig.execute(
            TO,
            100n,
            COIN,
            [signer.publicKey],
            [sign(signer, digest)],
          ),
        ).toStrictEqual(EXPECTED_SEND_RESULT);
        expect(await multisig.getNonce()).toEqual(1n);
      });
    });

    it('rejects a lone signature from a non-signer', async () => {
      const digest = await executeDigest(multisig, 100n);
      await expect(
        multisig.execute(
          TO,
          100n,
          COIN,
          [OUTSIDER.publicKey],
          [sign(OUTSIDER, digest)],
        ),
      ).rejects.toThrow('Signer: not a signer');
    });

    it('rejects a lone signature over a different digest', async () => {
      const wrongDigest = await executeDigest(multisig, 999n);
      await expect(
        multisig.execute(
          TO,
          100n,
          COIN,
          [S1.publicKey],
          [sign(S1, wrongDigest)],
        ),
      ).rejects.toThrow('EcdsaMultisig: invalid signature');
    });
  });
});
