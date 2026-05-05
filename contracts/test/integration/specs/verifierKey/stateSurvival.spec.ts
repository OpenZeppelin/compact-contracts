import type { Contract as ContractNs } from '@midnight-ntwrk/compact-js';
import type {
  ContractAddress,
  Either,
  ZswapCoinPublicKey,
} from '../../../../artifacts/TestTokenV1/contract/index.js';
import type { TestTokenV1Contract } from '../../fixtures/testTokenV1.js';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { readCmaCounter, rotateCircuitVK } from '../../_harness/cma.js';
import { deployTestTokenV1, type TestTokenV1Kit } from '../../fixtures/testTokenV1.js';

/**
 * Spec: VK rotation preserves heterogeneous ledger state across modules.
 *
 * The CMA `VerifierKeyRemove` + `VerifierKeyInsert` round-trip is supposed to
 * be a no-op on contract state — only the verifier-key table changes. We
 * exercise that claim against a TestToken contract whose ledger holds a
 * heterogeneous mix:
 *
 *   - `Initializable.isInitialized = true`            (constructor-set Boolean)
 *   - `Pausable.isPaused = true`                       (toggled via `pause()`)
 *   - `FungibleToken.totalSupply = 100`                (after `_mint`)
 *   - `FungibleToken.balances[BOB] = 100`              (the minted recipient)
 *   - `AccessControl.operatorRoles[MINTER][ALICE] = true` (via `grantRole`)
 *
 * For each rotation we assert ALL of those values are unchanged AND that the
 * CMA replay-protection counter advanced by exactly 2 (one SingleUpdate per
 * remove + one per insert).
 */

const MINTER_ROLE = new Uint8Array(32);
'MINTER'.split('').forEach((c, i) => {
  MINTER_ROLE[i] = c.charCodeAt(0);
});

interface Snapshot {
  initialized: boolean;
  paused: boolean;
  totalSupply: bigint;
  bobBalance: bigint;
  aliceHasMinter: boolean;
  counter: bigint;
}

describe('TestToken — VK rotation preserves heterogeneous ledger state', () => {
  let kit: TestTokenV1Kit;
  let alice: Either<ZswapCoinPublicKey, ContractAddress>;
  let bob: Either<ZswapCoinPublicKey, ContractAddress>;

  async function snapshot(): Promise<Snapshot> {
    const ledger = await kit.readLedger();
    const counter = await readCmaCounter(kit.providers, kit.contractAddress);
    const operatorRoles = ledger.AccessControl__operatorRoles;
    const balances = ledger.FungibleToken__balances;
    return {
      initialized: ledger.Initializable__isInitialized,
      paused: ledger.Pausable__isPaused,
      totalSupply: ledger.FungibleToken__totalSupply,
      bobBalance: balances.member(bob) ? balances.lookup(bob) : 0n,
      aliceHasMinter: operatorRoles.member(MINTER_ROLE)
        ? operatorRoles.lookup(MINTER_ROLE).member(alice) &&
          operatorRoles.lookup(MINTER_ROLE).lookup(alice)
        : false,
      counter,
    };
  }

  beforeAll(async () => {
    kit = await deployTestTokenV1();
    alice = await kit.aliasFor('ALICE');
    bob = await kit.aliasFor('BOB');

    // Build heterogeneous initial state.
    const admin = await kit.as('ADMIN');
    await admin.callTx.grantRole(MINTER_ROLE, alice);
    await kit.deployed.callTx._mint(bob, 100n);
    await kit.deployed.callTx.pause();

    // Sanity — assert pre-rotation state matches expectations before we
    // start rotating. If these fail, something is wrong with setup, not
    // with the CMA pathway.
    const s = await snapshot();
    expect(s).toMatchObject({
      initialized: true,
      paused: true,
      totalSupply: 100n,
      bobBalance: 100n,
      aliceHasMinter: true,
    });
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  async function expectStatePreserved(
    circuitName: ContractNs.ProvableCircuitId<TestTokenV1Contract>,
  ) {
    const before = await snapshot();
    await rotateCircuitVK(kit.providers, kit.deployed, circuitName);
    const after = await snapshot();
    expect(after).toMatchObject({
      initialized: before.initialized,
      paused: before.paused,
      totalSupply: before.totalSupply,
      bobBalance: before.bobBalance,
      aliceHasMinter: before.aliceHasMinter,
    });
    expect(after.counter).toBe(before.counter + 2n);
  }

  it('should preserve every ledger field and advance the counter by 2 when rotating the `pause` VK', async () => {
    await expectStatePreserved('pause');
  });

  it('should preserve every ledger field and advance the counter by 2 when rotating the `_mint` VK', async () => {
    await expectStatePreserved('_mint');
  });

  it('should preserve every ledger field and advance the counter by 2 when rotating the `grantRole` VK', async () => {
    await expectStatePreserved('grantRole');
  });

  it('should preserve every ledger field and advance the counter by 2 when rotating the `transfer` VK', async () => {
    await expectStatePreserved('transfer');
  });
});
