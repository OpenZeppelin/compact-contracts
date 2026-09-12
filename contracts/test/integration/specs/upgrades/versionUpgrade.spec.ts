import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { eitherContractAddress, eitherFor } from '../../_harness/identity.js';
import {
  deployTestTokenV1,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';
import { bindAsV2, v2VerifierKey } from '../../fixtures/testTokenV2.js';

/**
 * A version bump done the way a real one would be: deploy V1, rotate the
 * verifier keys of exactly the circuits whose behaviour changes, and call
 * them. Five kinds of change are covered — a tightened body, a new
 * authorization gate, a relaxed guard, a decommissioned circuit, and a
 * circuit V1 never had.
 *
 * `bindAsV2` deliberately skips the SDK's whole-key-set check, so each block
 * must rotate every circuit it calls through the V2 handle. Anything it does
 * not rotate stays on V1's key.
 */
const ALICE = eitherFor('ALICE');
const BOB = eitherFor('BOB');

/** Swap one circuit's on-chain key from V1's to V2's. */
async function rotateToV2(
  v1: TestTokenV1Kit,
  circuit: 'pause' | 'unpause' | '_mint' | 'transferOwnership',
): Promise<void> {
  const vk = await v2VerifierKey(circuit);
  await v1.deployed.circuitMaintenanceTx[circuit].removeVerifierKey();
  await v1.deployed.circuitMaintenanceTx[circuit].insertVerifierKey(vk);
}

const balanceOf = async (v1: TestTokenV1Kit, account: typeof ALICE) => {
  const balances = (await v1.readLedger()).FungibleToken__balances;
  return balances.member(account) ? balances.lookup(account) : 0n;
};

describe.runIf(isLiveBackend())(
  'TestToken upgrade — `_mint` gains a per-tx cap',
  () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
      await rotateToV2(v1, '_mint');
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('mints an amount within the cap', async () => {
      const v2 = await bindAsV2(v1, 'deployer');
      const before = await balanceOf(v1, ALICE);
      await v2.callTx._mint(ALICE, 1000n);
      expect(await balanceOf(v1, ALICE)).toBe(before + 1000n);
    });

    it('rejects an amount over the cap, which V1 would have minted', async () => {
      const v2 = await bindAsV2(v1, 'deployer');
      await expect(v2.callTx._mint(BOB, 2_000_000n)).rejects.toThrow(
        'TestTokenV2: _mint amount over per-tx cap',
      );
    });
  },
);

describe.runIf(isLiveBackend())(
  'TestToken upgrade — `pause` gains an admin gate',
  () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
      await rotateToV2(v1, 'pause');
      await rotateToV2(v1, 'unpause');
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('lets the admin pause and unpause', async () => {
      const admin = await bindAsV2(v1, 'ADMIN');
      await admin.callTx.pause();
      expect((await v1.readLedger()).Pausable__isPaused).toBe(true);
      await admin.callTx.unpause();
      expect((await v1.readLedger()).Pausable__isPaused).toBe(false);
    });

    it('rejects a caller without the admin role', async () => {
      const bob = await bindAsV2(v1, 'BOB');
      await expect(bob.callTx.pause()).rejects.toThrow(
        'AccessControl: unauthorized account',
      );
    });
  },
);

describe.runIf(isLiveBackend())(
  'TestToken upgrade — `transferOwnership` drops the ContractAddress guard',
  () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
      await rotateToV2(v1, 'transferOwnership');
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('accepts a ContractAddress destination, which V1 rejected', async () => {
      const v2 = await bindAsV2(v1, 'deployer');
      const contractDest = eitherContractAddress('upgrade-test-contract');

      await v2.callTx.transferOwnership(contractDest);

      const ownerNow = (await v1.readLedger()).Ownable__owner;
      expect(ownerNow.is_left).toBe(false);
      expect(ownerNow.right.bytes).toEqual(contractDest.right.bytes);
    });

    it('still accepts an account destination', async () => {
      // Its own deploy: the test above hands ownership to a contract address,
      // and the module cannot authenticate one as a caller.
      const fresh = await deployTestTokenV1();
      try {
        await rotateToV2(fresh, 'transferOwnership');
        const v2 = await bindAsV2(fresh, 'deployer');

        await v2.callTx.transferOwnership(ALICE);

        expect((await fresh.readLedger()).Ownable__owner.left).toEqual(
          ALICE.left,
        );
      } finally {
        await fresh.teardown();
      }
    });
  },
);

describe.runIf(isLiveBackend())(
  'TestToken upgrade — `_unsafeTransferOwnership` is decommissioned',
  () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
      // V2 dropped the circuit, so there is no key to rotate to; removing it
      // outright is the whole upgrade.
      await v1.deployed.circuitMaintenanceTx._unsafeTransferOwnership.removeVerifierKey();
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('rejects the call through the V1 handle once the key is gone', async () => {
      // V1's compiled contract still carries the circuit, but the on-chain
      // state no longer lists the operation, so the SDK aborts before
      // submitting and the caller learns the circuit is gone.
      await expect(
        v1.deployed.callTx._unsafeTransferOwnership(ALICE),
      ).rejects.toThrow(/Operation '_unsafeTransferOwnership' is undefined/);
    });

    it('does not expose the circuit on the V2 handle at all', async () => {
      const v2 = await bindAsV2(v1, 'deployer');
      const callTx = v2.callTx as Record<string, unknown>;
      expect(callTx._unsafeTransferOwnership).toBeUndefined();
    });
  },
);

describe.runIf(isLiveBackend())(
  'TestToken upgrade — `mintBatch` is a circuit V1 never had',
  () => {
    let v1: TestTokenV1Kit;

    beforeAll(async () => {
      v1 = await deployTestTokenV1();
      // V1's maintenance interface has no `mintBatch` key. Re-binding the same
      // contract as V2 yields one, and its insert carries an operation name the
      // deployed key table has never seen.
      const v2 = await bindAsV2(v1, 'deployer');
      await v2.circuitMaintenanceTx.mintBatch.insertVerifierKey(
        await v2VerifierKey('mintBatch'),
      );
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    it('mints three times the amount in one call', async () => {
      const v2 = await bindAsV2(v1, 'deployer');
      const before = await balanceOf(v1, ALICE);

      await v2.callTx.mintBatch(ALICE, 1000n);

      expect(await balanceOf(v1, ALICE)).toBe(before + 3000n);
    });

    it('leaves `_mint` on its V1 key', async () => {
      // Only `mintBatch` was inserted. V1's handle still holds the matching
      // prover key; V2's `_mint` body differs, so its proof would not verify.
      const before = await balanceOf(v1, BOB);
      await v1.deployed.callTx._mint(BOB, 50n);
      expect(await balanceOf(v1, BOB)).toBe(before + 50n);
    });
  },
);
