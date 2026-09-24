import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import { OUTSIDE_TIME_TO_DISMISS } from '#test-utils/fixtures/nodeRejections.js';
import { ForwarderUnshieldedSimulator } from './simulators/ForwarderUnshieldedSimulator.js';

// The constructor takes a `UserAddress` (the supported arm). The `_parent`
// ledger field stays a generic `Either`; `initialize` stores the address in the
// `right` arm, which is what `getParent` reads back. A contract-address parent
// is not expressible today (see the module header). An unshielded recipient is
// a public address, so the parent stays synthetic on live (no encryption key).
const PARENT = utils.createEitherTestUserAddress('PARENT').right;
const ZERO_ADDR = utils.ZERO_USER_ADDRESS.right;
// On live the deployer wallet only holds the native unshielded token
// (`0x00…00`), so the forward has funds to draw; dry mints any color freely.
const COLOR = isLiveBackend() ? new Uint8Array(32) : new Uint8Array(32).fill(1);
const AMOUNT = 1000n;

describe('ForwarderUnshieldedExample', () => {
  it('should store the parent passed to the constructor in the right arm', async () => {
    const fwd = await ForwarderUnshieldedSimulator.create(PARENT);
    const parent = await fwd.getParent();
    expect(parent.is_left).toBe(false);
    expect(parent.right).toEqual(PARENT);
  });

  it.skipIf(isLiveBackend())(
    'should expose deposit and forward to _deposit',
    async () => {
      const fwd = await ForwarderUnshieldedSimulator.create(PARENT);
      await fwd.deposit(COLOR, AMOUNT);
    },
  );

  // Receiving and forwarding in one call takes longer to dismiss than the
  // ledger allows for the transaction's size.
  // TODO: delete once live accepts this, and run the test above live too.
  it.runIf(isLiveBackend())(
    'deposit is rejected for exceeding the ledger time-to-dismiss budget',
    async () => {
      const fwd = await ForwarderUnshieldedSimulator.create(PARENT);
      await expect(fwd.deposit(COLOR, AMOUNT)).rejects.toThrow(
        OUTSIDE_TIME_TO_DISMISS,
      );
    },
  );

  it('should propagate the zero-parent guard from the module', async () => {
    await expect(
      ForwarderUnshieldedSimulator.create(ZERO_ADDR),
    ).rejects.toThrow('ForwarderUnshielded: zero parent');
  });

  it('should expose the public ledger state', async () => {
    const fwd = await ForwarderUnshieldedSimulator.create(PARENT);
    expect(await fwd.getPublicState()).toBeDefined();
  });
});
