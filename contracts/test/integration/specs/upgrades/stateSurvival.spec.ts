import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCmaCounter, rotateCircuitVK } from '../../_harness/cma.js';
import { eitherFor } from '../../_harness/identity.js';
import {
  deployTestTokenV1,
  type TestTokenV1Contract,
  type TestTokenV1Kit,
} from '../../fixtures/testTokenV1.js';

/**
 * A verifier-key round-trip touches the key table and nothing else. The
 * contract carries a deliberately heterogeneous ledger — a constructor-set
 * flag, a toggled flag, a scalar, a balance map and a nested role map — and
 * every rotation must leave all of it intact while advancing the counter once
 * per update.
 */
const MINTER_ROLE = new Uint8Array(32);
MINTER_ROLE.set(new TextEncoder().encode('MINTER'));

const ALICE = eitherFor('ALICE');
const BOB = eitherFor('BOB');

interface Snapshot {
  initialized: boolean;
  paused: boolean;
  totalSupply: bigint;
  bobBalance: bigint;
  aliceHasMinter: boolean;
  counter: bigint;
}

describe.runIf(isLiveBackend())(
  'TestToken — ledger state across VK rotation',
  () => {
    let v1: TestTokenV1Kit;

    async function snapshot(): Promise<Snapshot> {
      const ledger = await v1.readLedger();
      const roles = ledger.AccessControl__operatorRoles;
      const balances = ledger.FungibleToken__balances;
      return {
        initialized: ledger.Initializable__isInitialized,
        paused: ledger.Pausable__isPaused,
        totalSupply: ledger.FungibleToken__totalSupply,
        bobBalance: balances.member(BOB) ? balances.lookup(BOB) : 0n,
        aliceHasMinter:
          roles.member(MINTER_ROLE) &&
          roles.lookup(MINTER_ROLE).member(ALICE) &&
          roles.lookup(MINTER_ROLE).lookup(ALICE),
        counter: await readCmaCounter(v1.providers, v1.contractAddress),
      };
    }

    beforeAll(async () => {
      v1 = await deployTestTokenV1();

      const admin = await v1.as('ADMIN');
      await admin.callTx.grantRole(MINTER_ROLE, ALICE);
      await v1.deployed.callTx._mint(BOB, 100n);
      await v1.deployed.callTx.pause();

      // A failure here is a broken setup, not a broken upgrade path.
      expect(await snapshot()).toMatchObject({
        initialized: true,
        paused: true,
        totalSupply: 100n,
        bobBalance: 100n,
        aliceHasMinter: true,
      });
    });

    afterAll(async () => {
      await v1?.teardown();
    });

    async function expectStatePreserved(
      circuitName: ContractNs.ProvableCircuitId<TestTokenV1Contract>,
    ) {
      const before = await snapshot();
      await rotateCircuitVK(v1.providers, v1.deployed, circuitName);
      const after = await snapshot();
      expect(after).toStrictEqual({
        ...before,
        counter: before.counter + 2n,
      });
    }

    it.each(['pause', '_mint', 'grantRole', 'transfer'] as const)(
      'preserves every ledger field when rotating the `%s` VK',
      async (circuitName) => {
        await expectStatePreserved(circuitName);
      },
    );
  },
);
