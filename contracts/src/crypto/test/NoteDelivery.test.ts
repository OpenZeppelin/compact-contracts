import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import { pureCircuits } from '../../../artifacts/MockNoteDelivery/contract/index.js';

// Recipient encryption key: encSk (scalar) -> encPk = g^encSk.
const encSk = 555666777n;
const encPk = ecMulGenerator(encSk);

describe('NoteDelivery', () => {
  it('recipient recovers BOTH value and nonce from the delivery', () => {
    const [note, delivery] = pureCircuits.deliver(encPk, 4200n, 314159n);
    const recovered = pureCircuits.recover(delivery, encSk);
    expect(recovered.value).toBe(note.value); // value delivered
    expect(recovered.nonce).toBe(note.nonce); // nonce delivered (derived, matches)
    expect(note.value).toBe(4200n);
  });

  it('the derived nonce is what the sender committed', () => {
    // The sender commits `note.nonce`; the recipient must derive the identical
    // value, else the recovered note would not match any commitment.
    const [note, delivery] = pureCircuits.deliver(encPk, 1n, 42n);
    expect(pureCircuits.recover(delivery, encSk).nonce).toBe(note.nonce);
  });

  it('a wrong encryption key recovers neither value nor nonce', () => {
    const [note, delivery] = pureCircuits.deliver(encPk, 4200n, 314159n);
    const wrong = pureCircuits.recover(delivery, 999999n);
    expect(wrong.value).not.toBe(note.value);
    expect(wrong.nonce).not.toBe(note.nonce);
  });

  it('distinct ephemerals yield distinct notes + deliveries', () => {
    const [n1, d1] = pureCircuits.deliver(encPk, 100n, 1n);
    const [n2, d2] = pureCircuits.deliver(encPk, 100n, 2n);
    expect(n1.nonce).not.toBe(n2.nonce); // fresh nonce per payment
    expect(d1.ephemeral).not.toEqual(d2.ephemeral);
    expect(d1.valueCt).not.toBe(d2.valueCt);
    // Both still recover correctly for the true recipient.
    expect(pureCircuits.recover(d1, encSk).value).toBe(100n);
    expect(pureCircuits.recover(d2, encSk).value).toBe(100n);
  });
});

describe('NoteDelivery: explicit-nonce delivery (deliverNote/recoverNote)', () => {
  const note = { value: 4200n, nonce: 271828182845n };

  it('recipient recovers the exact (value, nonce) of an existing note', () => {
    const delivery = pureCircuits.deliverNote(encPk, note, 314159n);
    expect(pureCircuits.recoverNote(delivery, encSk)).toStrictEqual({
      value: note.value,
      nonce: note.nonce,
    });
  });

  it('a wrong encryption key recovers neither field', () => {
    const delivery = pureCircuits.deliverNote(encPk, note, 314159n);
    const wrong = pureCircuits.recoverNote(delivery, 999999n);
    expect(wrong.value).not.toBe(note.value);
    expect(wrong.nonce).not.toBe(note.nonce);
  });

  it('rejects the identity recipient key and a zero ephemeral', () => {
    const identity = ecMulGenerator(0n);
    expect(() => pureCircuits.deliverNote(identity, note, 314159n)).toThrow(
      'identity pk',
    );
    expect(() => pureCircuits.deliverNote(encPk, note, 0n)).toThrow(
      'zero ephemeral',
    );
  });
});
