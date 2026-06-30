import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ShieldedTreasurySimulator } from './simulators/ShieldedTreasurySimulator.js';

const COLOR = new Uint8Array(32).fill(1);
const COLOR2 = new Uint8Array(32).fill(2);
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

let treasury: ShieldedTreasurySimulator;

describe('ShieldedTreasury', () => {
  beforeEach(async () => {
    treasury = await ShieldedTreasurySimulator.create();
  });

  describe('initial state', () => {
    it('should return 0 balance for unknown color', async () => {
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    it('should return 0 received total for unknown color', async () => {
      expect(await treasury.getReceivedTotal(COLOR)).toEqual(0n);
    });

    it('should return 0 sent total for unknown color', async () => {
      expect(await treasury.getSentTotal(COLOR)).toEqual(0n);
    });

    it('should return 0 receivedMinusSent for unknown color', async () => {
      expect(await treasury.getReceivedMinusSent(COLOR)).toEqual(0n);
    });
  });

  describe('_deposit', () => {
    it('should deposit and update balance', async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT);
    });

    it('should track received total', async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
      expect(await treasury.getReceivedTotal(COLOR)).toEqual(AMOUNT);
    });

    it('should accumulate multiple deposits', async () => {
      await treasury._deposit(
        makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)),
      );
      await treasury._deposit(
        makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(2)),
      );
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT * 2n);
      expect(await treasury.getReceivedTotal(COLOR)).toEqual(AMOUNT * 2n);
    });

    it('should track balances per color independently', async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
      await treasury._deposit(makeCoin(COLOR2, AMOUNT * 2n));
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT);
      expect(await treasury.getTokenBalance(COLOR2)).toEqual(AMOUNT * 2n);
    });

    it('should allow zero value deposit', async () => {
      await treasury._deposit(makeCoin(COLOR, 0n));
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
      expect(await treasury.getReceivedTotal(COLOR)).toEqual(0n);
    });

    it('should maintain receivedMinusSent consistency', async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
      expect(await treasury.getReceivedMinusSent(COLOR)).toEqual(AMOUNT);
    });
  });

  describe('_send', () => {
    beforeEach(async () => {
      await treasury._deposit(makeCoin(COLOR, AMOUNT));
    });

    it('should send partial amount', async () => {
      await treasury._send(Z_RECIPIENT, COLOR, 400n);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT - 400n);
    });

    it('should send full balance', async () => {
      await treasury._send(Z_RECIPIENT, COLOR, AMOUNT);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    it('should track sent total', async () => {
      await treasury._send(Z_RECIPIENT, COLOR, 400n);
      expect(await treasury.getSentTotal(COLOR)).toEqual(400n);
    });

    it('should maintain receivedMinusSent after send', async () => {
      await treasury._send(Z_RECIPIENT, COLOR, 400n);
      expect(await treasury.getReceivedMinusSent(COLOR)).toEqual(AMOUNT - 400n);
    });

    it('should fail with insufficient balance', async () => {
      await expect(
        treasury._send(Z_RECIPIENT, COLOR, AMOUNT + 1n),
      ).rejects.toThrow('ShieldedTreasury: coin value insufficient');
    });

    it('should fail for unknown color', async () => {
      await expect(treasury._send(Z_RECIPIENT, COLOR2, 1n)).rejects.toThrow(
        'ShieldedTreasury: no balance',
      );
    });
  });

  describe('accounting consistency', () => {
    it('should keep receivedMinusSent equal to balance', async () => {
      await treasury._deposit(makeCoin(COLOR, 500n));
      await treasury._send(Z_RECIPIENT, COLOR, 200n);
      await treasury._deposit(
        makeCoin(COLOR, 300n, new Uint8Array(32).fill(3)),
      );

      const balance = await treasury.getTokenBalance(COLOR);
      const rms = await treasury.getReceivedMinusSent(COLOR);
      expect(balance).toEqual(600n);
      expect(rms).toEqual(600n);
    });

    it('should accumulate sent total across sends', async () => {
      await treasury._deposit(makeCoin(COLOR, 1000n));
      await treasury._send(Z_RECIPIENT, COLOR, 200n);
      await treasury._send(Z_RECIPIENT, COLOR, 300n);
      expect(await treasury.getSentTotal(COLOR)).toEqual(500n);
    });
  });
});
