import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ForwarderPrivateSimulator } from '../simulators/presets/ForwarderPrivateSimulator.js';

const PARENT_BYTES = utils.createEitherTestUser('PARENT').left.bytes;
const OP_SECRET = new Uint8Array(32).fill(0xaa);
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

// The drain parent is a `ZswapCoinPublicKey` (`{ bytes }`); the commitment is
// over its raw 32 bytes (`calculateParentCommitment(parent.bytes, opSecret)`).
function key(bytes: Uint8Array) {
  return { bytes };
}

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
  it('should store the parentCommitment passed to the constructor', async () => {
    const c = commitment(PARENT_BYTES, OP_SECRET);
    const fwd = await ForwarderPrivateSimulator.create(c);
    expect(await fwd.getParentCommitment()).toEqual(c);
  });

  it('should expose deposit and forward to _deposit', async () => {
    const fwd = await ForwarderPrivateSimulator.create(
      commitment(PARENT_BYTES, OP_SECRET),
    );
    await fwd.deposit(makeCoin(COLOR, AMOUNT));
  });

  it('should expose drain and forward to _drain', async () => {
    const fwd = await ForwarderPrivateSimulator.create(
      commitment(PARENT_BYTES, OP_SECRET),
    );
    await fwd.deposit(makeCoin(COLOR, AMOUNT));
    const result = await fwd.drain(
      makeQualifiedCoin(COLOR, AMOUNT, 0n),
      key(PARENT_BYTES),
      OP_SECRET,
      AMOUNT,
    );
    expect(result.sent.value).toEqual(AMOUNT);
  });

  it('should expose calculateParentCommitment as a static pure helper', () => {
    const c1 = commitment(PARENT_BYTES, OP_SECRET);
    const c2 = commitment(PARENT_BYTES, OP_SECRET);
    expect(c1).toEqual(c2);
  });

  it('should propagate the zero-commitment guard from the module', async () => {
    await expect(
      ForwarderPrivateSimulator.create(new Uint8Array(32)),
    ).rejects.toThrow('ForwarderPrivate: zero commitment');
  });

  it('should expose the public ledger state', async () => {
    const fwd = await ForwarderPrivateSimulator.create(
      commitment(PARENT_BYTES, OP_SECRET),
    );
    expect(await fwd.getPublicState()).toBeDefined();
  });
});
