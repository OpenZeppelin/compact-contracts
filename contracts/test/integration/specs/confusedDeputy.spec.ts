import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import { derivePrincipal, pad32 } from '#test-utils/fixtures/principal.js';
import { ComposedConfusedDeputySimulator } from '../fixtures/composedConfusedDeputy.js';

/**
 * Integration spec for audit L-06 / platform L-03: module composability leading to
 * confused-deputy behavior.
 *
 * The finding. Each module derived its own caller from its own witness, inside a
 * non-exported circuit. Nothing forces two witness calls in one transaction to agree,
 * and the composing contract had no sound value to compare against, so one circuit
 * could authorize through one module and take effect through another under a
 * different identity. The authorization held on its own. The effect held on its own.
 * Only the pairing went unconstrained.
 *
 * The fix. `access/Caller` holds the one identity authority. A top-level contract
 * derives the caller once and hands the `AuthenticatedCaller` to every module.
 * `ComposedConfusedDeputy` is that top-level contract, driving a gate module
 * (Ownable) and an effect module (FungibleToken).
 *
 * What this file covers:
 *
 *  1. `correctTransfer`. One authentication feeds both modules, so the gate and the
 *     debit name one principal. This is the shape an integrator writes.
 *  2. `deputisedTransfer`. The divergence remains reachable, because Compact structs
 *     are not opaque and a contract can assemble an `AuthenticatedCaller` it never
 *     derived. Reaching it now takes a visible `fabricated()` call instead of
 *     falling out of two modules reading two witnesses. Pinned here so the boundary
 *     of the fix cannot drift without a test failing.
 *
 * Dry-only. This tests composition semantics and constructs the simulator directly,
 * so nothing here deploys.
 */

const DOMAIN = pad32('ConfusedDeputy:test');

const zeroBytes = utils.zeroUint8Array();

const eitherAccountId = (accountId: Uint8Array) => ({
  is_left: true,
  left: accountId,
  right: { bytes: zeroBytes },
});

const makeUser = (label: string) => {
  const secretKey = pad32(label);
  const principal = derivePrincipal(secretKey, DOMAIN);
  return { secretKey, principal, either: eitherAccountId(principal) };
};

const OWNER = makeUser('OWNER');
const VICTIM = makeUser('VICTIM');
const RECIPIENT = makeUser('RECIPIENT');

const deploy = () =>
  ComposedConfusedDeputySimulator.create(OWNER.either, DOMAIN, OWNER.secretKey);

describe.skipIf(isLiveBackend())(
  'module composability and confused deputies (audit L-06)',
  () => {
    describe('the fix: one authentication drives every module', () => {
      it('should authenticate the caller as the principal derived off-chain', async () => {
        const c = await deploy();

        // Binds the in-circuit derivation to the TypeScript mirror. The
        // constructor named this principal as the owner before the contract
        // existed, which works only because the derivation is pure.
        expect(await c.callerPrincipal()).toStrictEqual(OWNER.principal);
        expect(await c.owner()).toStrictEqual(OWNER.either);
      });

      it('should debit the same principal the owner gate passed for', async () => {
        const c = await deploy();
        await c.ftMint(OWNER.either, 100n);
        await c.ftMint(VICTIM.either, 100n);

        await c.correctTransfer(RECIPIENT.either, 40n);

        // The gate said the caller owns the contract. The debit landed on the owner.
        expect(await c.ftBalanceOf(OWNER.either)).toBe(60n);
        expect(await c.ftBalanceOf(RECIPIENT.either)).toBe(40n);
        // No third party was touched.
        expect(await c.ftBalanceOf(VICTIM.either)).toBe(100n);
      });

      it('should reject a caller the gate module does not authorize', async () => {
        const c = await deploy();
        await c.ftMint(OWNER.either, 100n);
        await c.privateState.injectSecretKey(VICTIM.secretKey);

        await expect(c.correctTransfer(RECIPIENT.either, 10n)).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });

      it('should carry one identity across both modules when the caller changes', async () => {
        const c = await deploy();
        await c.ftMint(OWNER.either, 100n);

        // Act as VICTIM and the gate and the debit move together, because both
        // read the same authenticated value.
        await c.privateState.injectSecretKey(OWNER.secretKey);
        expect(await c.callerPrincipal()).toStrictEqual(OWNER.principal);

        await c.privateState.injectSecretKey(VICTIM.secretKey);
        expect(await c.callerPrincipal()).toStrictEqual(VICTIM.principal);
        await expect(c.correctTransfer(RECIPIENT.either, 10n)).rejects.toThrow(
          'Ownable: caller is not the owner',
        );
      });
    });

    describe('the residual: a hostile composer can still fabricate a caller', () => {
      it('should debit a principal the gate never authenticated', async () => {
        const c = await deploy();
        await c.ftMint(OWNER.either, 100n);
        await c.ftMint(VICTIM.either, 100n);

        // The owner gate passes for OWNER, and VICTIM takes the debit, because
        // the effect module got a struct this contract built instead of the one it
        // derived.
        await c.deputisedTransfer(VICTIM.principal, RECIPIENT.either, 70n);

        expect(await c.ftBalanceOf(VICTIM.either)).toBe(30n);
        expect(await c.ftBalanceOf(RECIPIENT.either)).toBe(70n);
        // The authorized principal paid nothing.
        expect(await c.ftBalanceOf(OWNER.either)).toBe(100n);
      });

      it('should still enforce the gate on the real caller', async () => {
        const c = await deploy();
        await c.ftMint(VICTIM.either, 100n);
        await c.privateState.injectSecretKey(VICTIM.secretKey);

        // Fabricating the effect's caller leaves the gate's caller alone, so an
        // unauthorized sender never reaches the effect.
        await expect(
          c.deputisedTransfer(VICTIM.principal, RECIPIENT.either, 10n),
        ).rejects.toThrow('Ownable: caller is not the owner');
      });

      it('should not let a fabricated caller spend a balance it does not have', async () => {
        const c = await deploy();
        await c.ftMint(VICTIM.either, 5n);

        // The fabrication changes whose balance moves. The effect module still
        // checks the balance it debits.
        await expect(
          c.deputisedTransfer(VICTIM.principal, RECIPIENT.either, 10n),
        ).rejects.toThrow('FungibleToken: insufficient balance');
      });
    });
  },
);
