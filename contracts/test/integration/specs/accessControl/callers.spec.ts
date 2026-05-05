import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { deployTestTokenV1, type TestTokenV1Kit } from '../../fixtures/testTokenV1.js';

/**
 * Spec: AccessControl gating across multiple signers.
 *
 * Given a TestToken deployed with the genesis wallet, with `DEFAULT_ADMIN_ROLE`
 * pre-bootstrapped to ALIAS=`ADMIN`, when callers from the wallet pool invoke
 * role-management circuits, then:
 *
 *  - ADMIN can grant a role and have it observed by `hasRole`,
 *  - ADMIN can revoke a role and `hasRole` flips back,
 *  - BOB (no admin) is rejected by the chain when attempting `grantRole`.
 *
 * This is the first multi-signer integration test in the suite. It proves the
 * `WalletPool` + `kit.as(alias)` plumbing actually routes the right
 * `coinPublicKey` into circuits via `ownPublicKey()` — without that, the
 * gate on `assertOnlyRole(getRoleAdmin(role))` would either be permissive
 * (genesis wallet always wins) or always fail (no caller match).
 */

// MINTER_ROLE — arbitrary 32-byte role id; specs use the same constant
// across files. Keccak("MINTER") would be canonical; here we just use a
// distinguishable byte pattern so the value is recognisable in logs.
const MINTER_ROLE = new Uint8Array(32);
MINTER_ROLE[0] = 0x4d; // 'M'
MINTER_ROLE[1] = 0x49; // 'I'
MINTER_ROLE[2] = 0x4e; // 'N'
MINTER_ROLE[3] = 0x54; // 'T'
MINTER_ROLE[4] = 0x45; // 'E'
MINTER_ROLE[5] = 0x52; // 'R'

describe('AccessControl — multi-signer role gating', () => {
  let kit: TestTokenV1Kit;

  beforeAll(async () => {
    kit = await deployTestTokenV1();
  });

  afterAll(async () => {
    await kit?.teardown();
  });

  it('should grant DEFAULT_ADMIN_ROLE to ADMIN during fixture bootstrap', async () => {
    const ledger = await kit.readLedger();
    const admin = await kit.aliasFor('ADMIN');
    const adminHandle = await kit.as('ADMIN');
    const has = await adminHandle.callTx.hasRole(
      ledger.AccessControl_DEFAULT_ADMIN_ROLE,
      admin,
    );
    expect(has.private.result).toBe(true);
  });

  it('should let ADMIN grant MINTER_ROLE to ALICE', async () => {
    const adminHandle = await kit.as('ADMIN');
    const alice = await kit.aliasFor('ALICE');
    await adminHandle.callTx.grantRole(MINTER_ROLE, alice);
    const has = await adminHandle.callTx.hasRole(MINTER_ROLE, alice);
    expect(has.private.result).toBe(true);
  });

  it('should let ADMIN revoke MINTER_ROLE from ALICE', async () => {
    const adminHandle = await kit.as('ADMIN');
    const alice = await kit.aliasFor('ALICE');
    await adminHandle.callTx.revokeRole(MINTER_ROLE, alice);
    const has = await adminHandle.callTx.hasRole(MINTER_ROLE, alice);
    expect(has.private.result).toBe(false);
  });

  it('should reject BOB attempting to grant a role (BOB lacks admin)', async () => {
    const bobHandle = await kit.as('BOB');
    const alice = await kit.aliasFor('ALICE');
    await expect(
      bobHandle.callTx.grantRole(MINTER_ROLE, alice),
    ).rejects.toThrow('AccessControl: unauthorized account');
  });
});
