import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ForwarderPrivateSimulator } from '../simulators/presets/ForwarderPrivateSimulator.js';

const PARENT = utils.createEitherTestUser('PARENT').left.bytes;
const OP_SECRET = new Uint8Array(32).fill(0xaa);
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

function makeCoin(color: Uint8Array, value: bigint) {
  return { nonce: new Uint8Array(32), color, value };
}

function makeQualifiedCoin(color: Uint8Array, value: bigint, mtIndex: bigint) {
  return { nonce: new Uint8Array(32), color, value, mt_index: mtIndex };
}

function commitment(parent: Uint8Array, opSecret: Uint8Array): Uint8Array {
  return ForwarderPrivateSimulator.calculateParentCommitment(parent, opSecret);
}

describe('ForwarderPrivate preset', () => {
  it('should store the parentCommitment passed to the constructor', () => {
    const c = commitment(PARENT, OP_SECRET);
    const fwd = new ForwarderPrivateSimulator(c);
    expect(fwd.getParentCommitment()).toEqual(c);
  });

  it('should expose deposit and forward to _deposit', () => {
    const fwd = new ForwarderPrivateSimulator(commitment(PARENT, OP_SECRET));
    expect(() => fwd.deposit(makeCoin(COLOR, AMOUNT))).not.toThrow();
  });

  it('should expose drain and forward to _drain', () => {
    const fwd = new ForwarderPrivateSimulator(commitment(PARENT, OP_SECRET));
    fwd.deposit(makeCoin(COLOR, AMOUNT));
    const result = fwd.drain(
      makeQualifiedCoin(COLOR, AMOUNT, 0n),
      PARENT,
      OP_SECRET,
      AMOUNT,
    );
    expect(result.sent.value).toEqual(AMOUNT);
  });

  it('should expose calculateParentCommitment as a static pure helper', () => {
    const c1 = commitment(PARENT, OP_SECRET);
    const c2 = commitment(PARENT, OP_SECRET);
    expect(c1).toEqual(c2);
  });

  it('should propagate the zero-commitment guard from the module', () => {
    expect(() => new ForwarderPrivateSimulator(new Uint8Array(32))).toThrow(
      'ForwarderPrivate: zero commitment',
    );
  });

  it('should expose the public ledger state', () => {
    const fwd = new ForwarderPrivateSimulator(commitment(PARENT, OP_SECRET));
    expect(fwd.getPublicState()).toBeDefined();
  });
});
