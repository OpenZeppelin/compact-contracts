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
  beforeEach(() => {
    treasury = new ShieldedTreasurySimulator();
  });

  describe('UINT128_MAX', () => {
    it('should return max uint128 value', () => {
      const max = ShieldedTreasurySimulator.UINT128_MAX();
      expect(max).toEqual((1n << 128n) - 1n);
    });
  });

  describe('initial state', () => {
    it('should return 0 balance for unknown color', () => {
      expect(treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    it('should return 0 received total for unknown color', () => {
      expect(treasury.getReceivedTotal(COLOR)).toEqual(0n);
    });

    it('should return 0 sent total for unknown color', () => {
      expect(treasury.getSentTotal(COLOR)).toEqual(0n);
    });

    it('should return 0 receivedMinusSent for unknown color', () => {
      expect(treasury.getReceivedMinusSent(COLOR)).toEqual(0n);
    });
  });

  describe('_deposit', () => {
    it('should deposit and update balance', () => {
      treasury._deposit(makeCoin(COLOR, AMOUNT));
      expect(treasury.getTokenBalance(COLOR)).toEqual(AMOUNT);
    });

    it('should track received total', () => {
      treasury._deposit(makeCoin(COLOR, AMOUNT));
      expect(treasury.getReceivedTotal(COLOR)).toEqual(AMOUNT);
    });

    it('should accumulate multiple deposits', () => {
      treasury._deposit(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)));
      treasury._deposit(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(2)));
      expect(treasury.getTokenBalance(COLOR)).toEqual(AMOUNT * 2n);
      expect(treasury.getReceivedTotal(COLOR)).toEqual(AMOUNT * 2n);
    });

    it('should track balances per color independently', () => {
      treasury._deposit(makeCoin(COLOR, AMOUNT));
      treasury._deposit(makeCoin(COLOR2, AMOUNT * 2n));
      expect(treasury.getTokenBalance(COLOR)).toEqual(AMOUNT);
      expect(treasury.getTokenBalance(COLOR2)).toEqual(AMOUNT * 2n);
    });

    it('should allow zero value deposit', () => {
      treasury._deposit(makeCoin(COLOR, 0n));
      expect(treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    it('should maintain receivedMinusSent consistency', () => {
      treasury._deposit(makeCoin(COLOR, AMOUNT));
      expect(treasury.getReceivedMinusSent(COLOR)).toEqual(AMOUNT);
    });
  });

  describe('_send', () => {
    beforeEach(() => {
      treasury._deposit(makeCoin(COLOR, AMOUNT));
    });

    it('should send partial amount', () => {
      treasury._send(Z_RECIPIENT, COLOR, 400n);
      expect(treasury.getTokenBalance(COLOR)).toEqual(AMOUNT - 400n);
    });

    it('should send full balance', () => {
      treasury._send(Z_RECIPIENT, COLOR, AMOUNT);
      expect(treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    it('should track sent total', () => {
      treasury._send(Z_RECIPIENT, COLOR, 400n);
      expect(treasury.getSentTotal(COLOR)).toEqual(400n);
    });

    it('should maintain receivedMinusSent after send', () => {
      treasury._send(Z_RECIPIENT, COLOR, 400n);
      expect(treasury.getReceivedMinusSent(COLOR)).toEqual(AMOUNT - 400n);
    });

    it('should fail with insufficient balance', () => {
      expect(() => {
        treasury._send(Z_RECIPIENT, COLOR, AMOUNT + 1n);
      }).toThrow('ShieldedTreasury: coin value insufficient');
    });

    it('should fail for unknown color', () => {
      expect(() => {
        treasury._send(Z_RECIPIENT, COLOR2, 1n);
      }).toThrow('ShieldedTreasury: no balance');
    });
  });

  describe('accounting consistency', () => {
    it('should keep receivedMinusSent equal to balance', () => {
      treasury._deposit(makeCoin(COLOR, 500n));
      treasury._send(Z_RECIPIENT, COLOR, 200n);
      treasury._deposit(makeCoin(COLOR, 300n, new Uint8Array(32).fill(3)));

      const balance = treasury.getTokenBalance(COLOR);
      const rms = treasury.getReceivedMinusSent(COLOR);
      expect(balance).toEqual(600n);
      expect(rms).toEqual(600n);
    });

    it('should accumulate sent total across sends', () => {
      treasury._deposit(makeCoin(COLOR, 1000n));
      treasury._send(Z_RECIPIENT, COLOR, 200n);
      treasury._send(Z_RECIPIENT, COLOR, 300n);
      expect(treasury.getSentTotal(COLOR)).toEqual(500n);
    });
  });
});
