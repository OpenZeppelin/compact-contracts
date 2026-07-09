import { describe, expect, it } from 'vitest';
import {
  contractOwner,
  getQualifiedShieldedCoinInfo,
} from '#test-utils/live/shieldedCoinTracker.js';
import {
  GENESIS_SHIELDED_COLORS,
  makeShieldedCoin as makeCoin,
  shieldedTestParentKey,
} from '#test-utils/liveShielded.js';
import { ForwarderPrivateSimulator } from '../simulators/presets/ForwarderPrivateSimulator.js';

// The drain parent is a `ZswapCoinPublicKey` (`{ bytes }`); the commitment is
// over its raw 32 bytes (`calculateParentCommitment(parent.bytes, opSecret)`).
// On live it is the deployer's own key (the drain sends the note to it, so its
// encryption key must resolve on-chain).
const PARENT_BYTES = shieldedTestParentKey().bytes;
const OP_SECRET = new Uint8Array(32).fill(0xaa);
// A shielded token type the deployer wallet holds on live (genesis-minted).
const COLOR = GENESIS_SHIELDED_COLORS.shieldedCoin1;
const AMOUNT = 1000n;

function key(bytes: Uint8Array) {
  return { bytes };
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
    // Deposit a real coin, then recover its `mt_index` from the coin tracker
    // (the contract keeps no record of it) before spending it.
    const deposited = makeCoin(COLOR, AMOUNT);
    await fwd.deposit(deposited);
    const coin = await getQualifiedShieldedCoinInfo(
      contractOwner(fwd),
      deposited,
    );
    const result = await fwd.drain(coin, key(PARENT_BYTES), OP_SECRET, AMOUNT);
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
