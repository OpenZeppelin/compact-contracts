import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import { UnshieldedTreasurySimulator } from './simulators/UnshieldedTreasurySimulator.js';

// On live the deployer wallet only holds the native unshielded token
// (`0x00…00`), so a deposit must draw that; on dry any color mints freely.
const COLOR = isLiveBackend() ? new Uint8Array(32) : new Uint8Array(32).fill(1);
const OTHER_COLOR = new Uint8Array(32).fill(9);
const RECIPIENT = utils.createEitherTestUserAddress('RECIPIENT');
const AMOUNT = 1000n;

let treasury: UnshieldedTreasurySimulator;

/**
 * Separates a contract/protocol rejection from harness flakiness.
 */
const INFRA =
  /sync timeout|timeout after|ECONNREFUSED|socket hang up|fetch failed/i;

interface Outcome {
  readonly kind: 'ok' | 'rejected' | 'infra';
  readonly message: string;
}

async function outcomeOf(op: () => Promise<unknown>): Promise<Outcome> {
  try {
    await op();
    return { kind: 'ok', message: '' };
  } catch (e) {
    const message = (e as Error).message ?? String(e);
    return { kind: INFRA.test(message) ? 'infra' : 'rejected', message };
  }
}

/** Fails loudly on infrastructure errors instead of scoring them as a verdict. */
function verdict(o: Outcome, label: string): Outcome {
  if (o.kind === 'infra') {
    throw new Error(
      `${label}: inconclusive — harness failure, not a protocol verdict: ${o.message.slice(0, 200)}`,
    );
  }
  console.log(
    `  ${label} -> ${o.kind === 'ok' ? 'ACCEPTED' : `REJECTED: ${o.message.slice(0, 160)}`}`,
  );
  return o;
}

describe('UnshieldedTreasury module', () => {
  beforeEach(async () => {
    treasury = await UnshieldedTreasurySimulator.create();
  });

  describe('deposit', () => {
    it('should report a zero balance for an untouched color', async () => {
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    it('should credit the balance', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT);
    });

    it('should accumulate across deposits', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      await treasury._deposit(COLOR, AMOUNT);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT * 2n);
    });

    it('should not affect other colors', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      expect(await treasury.getTokenBalance(OTHER_COLOR)).toEqual(0n);
    });

    // Overflow needs a balance near 2^128, which only the dry backend can reach
    // (it does not enforce funding).
    it.skipIf(isLiveBackend())(
      'should reject an overflowing deposit',
      async () => {
        await treasury._deposit(COLOR, 2n ** 128n - 1n);
        await expect(treasury._deposit(COLOR, 1n)).rejects.toThrow(
          'UnshieldedTreasury: overflow',
        );
      },
    );
  });

  describe('send', () => {
    it('should debit the balance', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      await treasury._send(RECIPIENT, COLOR, AMOUNT / 2n);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT / 2n);
    });

    it('should allow sending the full balance, then reject a further send', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      await treasury._send(RECIPIENT, COLOR, AMOUNT);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
      await expect(treasury._send(RECIPIENT, COLOR, 1n)).rejects.toThrow(
        'UnshieldedTreasury: insufficient balance',
      );
    });

    it('should reject a send with no balance', async () => {
      await expect(treasury._send(RECIPIENT, COLOR, AMOUNT)).rejects.toThrow(
        'UnshieldedTreasury: insufficient balance',
      );
    });

    it('should reject a send exceeding the balance', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      await expect(
        treasury._send(RECIPIENT, COLOR, AMOUNT + 1n),
      ).rejects.toThrow('UnshieldedTreasury: insufficient balance');
    });
  });

  // Zero-amount operations are permitted (see the protocol-behavior block for
  // on-chain acceptance). These pin the accounting side: they must not drift.
  describe('zero-amount operations', () => {
    it('should be idempotent on an untouched color', async () => {
      await treasury._deposit(OTHER_COLOR, 0n);
      await treasury._deposit(OTHER_COLOR, 0n);
      expect(await treasury.getTokenBalance(OTHER_COLOR)).toEqual(0n);

      await treasury._send(RECIPIENT, OTHER_COLOR, 0n);
      await treasury._send(RECIPIENT, OTHER_COLOR, 0n);
      expect(await treasury.getTokenBalance(OTHER_COLOR)).toEqual(0n);
    });

    it('should preserve an existing balance', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      await treasury._deposit(COLOR, 0n);
      await treasury._send(RECIPIENT, COLOR, 0n);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT);
    });
  });

  // The guards read `_balances`, updated as the transaction proceeds, rather than
  // the protocol balance, which is fixed at the start of execution. Both cases
  // put two treasury calls in ONE circuit.
  describe('multiple treasury calls in one transaction', () => {
    it('should allow receiving then spending', async () => {
      await treasury.depositThenSend(COLOR, AMOUNT, RECIPIENT);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    it('should allow two sends within the balance', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      await treasury.sendTwice(COLOR, AMOUNT / 2n, AMOUNT / 4n, RECIPIENT);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT / 4n);
    });

    it('should reject two sends that together exceed the balance', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      await expect(
        treasury.sendTwice(COLOR, AMOUNT, AMOUNT, RECIPIENT),
      ).rejects.toThrow('UnshieldedTreasury: insufficient balance');
    });
  });

  // Every claim the module's docs make about the protocol, and the behaviors we
  // can only learn from a node. Live only: the dry backend serves no
  // `unshieldedBalance*` reads and validates neither funding nor recipients.
  describe.runIf(isLiveBackend())('protocol behavior', () => {
    it('balance is fixed at the start of execution', async () => {
      expect(await treasury.probeBalanceAfterReceive(COLOR, AMOUNT)).toEqual(
        false,
      );
    });

    it('deposited funds are spendable without going through _balances', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      expect(await treasury.probeBalanceGte(COLOR, AMOUNT)).toEqual(true);
      const o = verdict(
        await outcomeOf(() => treasury.sendRaw(COLOR, AMOUNT, RECIPIENT)),
        'raw spend of deposited funds',
      );
      expect(o.kind).toEqual('ok');
    });

    it('the ledger rejects sending more than the contract holds', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      const o = verdict(
        await outcomeOf(() => treasury.sendRaw(COLOR, AMOUNT * 3n, RECIPIENT)),
        'raw overspend',
      );
      expect(o.kind).toEqual('rejected');
    });

    it('a direct receive leaves _balances reading low', async () => {
      await treasury.receiveRaw(COLOR, AMOUNT);
      expect(await treasury.probeBalanceGte(COLOR, AMOUNT)).toEqual(true);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(0n);
    });

    // The other half of the desync warning: funds leaving outside `_send` leave
    // the mirror reading HIGH, and the module will then attempt a send it cannot
    // back which the ledger rejects.
    it('a direct send leaves _balances reading high', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      const raw = verdict(
        await outcomeOf(() => treasury.sendRaw(COLOR, AMOUNT, RECIPIENT)),
        'raw send',
      );
      expect(raw.kind).toEqual('ok');

      expect(await treasury.probeBalanceGte(COLOR, 1n)).toEqual(false);
      expect(await treasury.getTokenBalance(COLOR)).toEqual(AMOUNT);

      const unbacked = verdict(
        await outcomeOf(() => treasury._send(RECIPIENT, COLOR, AMOUNT)),
        'send against a stale mirror',
      );
      expect(unbacked.kind).toEqual('rejected');
    });

    it('zero-amount deposit and send are permitted', async () => {
      const d = verdict(
        await outcomeOf(() => treasury._deposit(OTHER_COLOR, 0n)),
        'zero deposit',
      );
      expect(d.kind).toEqual('ok');
      const s = verdict(
        await outcomeOf(() => treasury._send(RECIPIENT, OTHER_COLOR, 0n)),
        'zero send',
      );
      expect(s.kind).toEqual('ok');
    });

    // No unshielded equivalent of `shieldedBurnAddress` exists, and a zero
    // `NightAddress` owner is a UTXO nobody holds a key for so this destroys
    // the tokens with no `UnshieldedBurn` event.
    it('a send to the zero address is accepted and removes the funds', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      expect(await treasury.probeBalanceGte(COLOR, AMOUNT)).toEqual(true);

      const o = verdict(
        await outcomeOf(() =>
          treasury._send(utils.ZERO_USER_ADDRESS, COLOR, AMOUNT),
        ),
        'zero-recipient send',
      );
      expect(o.kind).toEqual('ok');

      // Gone from the contract entirely, not merely debited from the mirror.
      // Whether an `UnshieldedBurn` event fires is NOT covered, the harness's
      // event transport reads zswap coin commitments only.
      expect(await treasury.probeBalanceGte(COLOR, 1n)).toEqual(false);
    });

    // Pins why `_deposit` keeps its overflow bound as in-circuit arithmetic: the
    // comparison it would otherwise use works for a small operand and fails for
    // one near 2^128. If a toolchain upgrade fixes this, this test breaks and
    // says so, rather than the reasoning silently going stale.
    it('unshieldedBalanceLte works for a small operand', async () => {
      expect(await treasury.probeBalanceLte(COLOR, AMOUNT)).toEqual(true);
    });

    it('unshieldedBalanceLte fails for an operand near 2^128', async () => {
      const o = await outcomeOf(() =>
        treasury.probeBalanceLte(COLOR, 2n ** 128n - 1n - AMOUNT),
      );
      console.log(
        `  huge-operand Lte -> ${o.kind}: ${o.message.slice(0, 160)}`,
      );
      expect(o.kind).toEqual('rejected');
      expect(o.message).toMatch(/u64/);
    });

    // Creates a contract-owned UTXO that `_send` never claimed. Discriminates:
    // still credited AND spendable -> `_balances` diverged low; credited but not
    // spendable -> stranded; not credited -> destroyed.
    it('a self-send is accepted; report whether the funds survive', async () => {
      await treasury._deposit(COLOR, AMOUNT);
      const sent = verdict(
        await outcomeOf(() => treasury.sendToSelf(COLOR, AMOUNT)),
        'self-send',
      );
      expect(sent.kind).toEqual('ok');

      const stillCredited = await treasury.probeBalanceGte(COLOR, AMOUNT);
      const spend = await outcomeOf(() =>
        treasury.sendRaw(COLOR, AMOUNT, RECIPIENT),
      );
      console.log(
        `  after self-send: mirror=${await treasury.getTokenBalance(COLOR)} protocolGte=${stillCredited} rawSpend=${spend.kind}${spend.kind !== 'ok' ? `: ${spend.message.slice(0, 140)}` : ''}`,
      );
      expect(spend.kind).not.toEqual('infra');
    });
  });
});
