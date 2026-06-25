import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { NativeShieldedTreasuryStatelessSimulator } from './simulators/NativeShieldedTreasuryStatelessSimulator.js';

const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

const Z_RECIPIENT = utils.createEitherTestUser('RECIPIENT');

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
  mtIndex = 0n,
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

let treasury: NativeShieldedTreasuryStatelessSimulator;

describe('NativeShieldedTreasuryStateless', () => {
  beforeEach(async () => {
    treasury = await NativeShieldedTreasuryStatelessSimulator.create();
  });

  describe('_deposit', () => {
    it('should accept a deposit without reverting', async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
    });

    it('should accept a zero-value deposit', async () => {
      await treasury._deposit(makeCoin(COLOR, 0n));
    });
  });

  describe('_send', () => {
    beforeEach(async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
    });

    it('should send the full coin with no change', async () => {
      const result = await treasury._send(
        makeQualifiedCoin(COLOR, AMOUNT),
        Z_RECIPIENT,
        AMOUNT,
      );
      expect(result.sent.value).toEqual(AMOUNT);
      expect(result.sent.color).toEqual(COLOR);
      expect(result.change.is_some).toEqual(false);
    });

    it('should send a partial amount and return change', async () => {
      const result = await treasury._send(
        makeQualifiedCoin(COLOR, AMOUNT),
        Z_RECIPIENT,
        400n,
      );
      expect(result.sent.value).toEqual(400n);
      expect(result.sent.color).toEqual(COLOR);
      expect(result.change.is_some).toEqual(true);
      expect(result.change.value.value).toEqual(AMOUNT - 400n);
      expect(result.change.value.color).toEqual(COLOR);
    });

    it('should reject sending more than the coin holds', async () => {
      await expect(
        treasury._send(
          makeQualifiedCoin(COLOR, AMOUNT),
          Z_RECIPIENT,
          AMOUNT + 1n,
        ),
      ).rejects.toThrow();
    });
  });
});
