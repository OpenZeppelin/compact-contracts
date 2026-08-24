import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { ConfidentialFungibleTokenPublicSupplySimulator } from '../fixtures/confidentialFungibleTokenPublicSupply.js';

/**
 * Integration spec for the assembled ConfidentialFungibleToken + PublicSupply
 * contract (`_mocks/ComposedConfidentialFungibleTokenPublicSupply`).
 *
 * The token base and the supply extension are unit-tested in isolation. This
 * suite exercises the one property neither can: the COMPOSITION. Every
 * supply-changing op the consuming contract assembles pairs a value op with its
 * accounting block —
 *
 *   mint(a, v)      = _addSupply(v); _mint(a, v)
 *   burn(v)         = _burn(v);      _subSupply(v)
 *   burnFrom(f, v)  = _burnFrom(f, v); _subSupply(v)
 *
 * so `totalSupply` must move in lockstep with the confidential balance change.
 * Balances stay hidden; `totalSupply` (the public aggregate) is what we assert.
 *
 * Backend split (`--project integration` vs `integration-live`), in file order:
 *   1. The LIVE block is the block-limit canary. It asserts the composed deploy
 *      is rejected, which turns "no green functional live integration coverage"
 *      into a verified claim rather than an assumption. True as of ledger v8; see
 *      the note above it.
 *   2. The functional block is DRY-ONLY, for two reasons: the deploy in (1) is
 *      rejected, and it drives confidential identities through `switchIdentity` /
 *      `cachePlaintext`, which the live backend throws on.
 */

// Mirrors the base suite's deterministic identity setup.
const createTestKey = (label: string): Uint8Array => {
  const key = new Uint8Array(32);
  key.set(new TextEncoder().encode(label).slice(0, 32));
  return key;
};

const buildAccountIdHash = (sk: Uint8Array): Uint8Array => {
  const rt = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(rt, [sk]);
};

const makeUser = (label: string) => {
  const secretKey = createTestKey(`${label}_SK`);
  const encryptionKey = createTestKey(`${label}_EK`);
  const accountId = buildAccountIdHash(secretKey);
  return { secretKey, encryptionKey, accountId };
};

const ALICE = makeUser('ALICE');
const BOB = makeUser('BOB');

const NAME = 'ConfidentialToken';
const SYMBOL = 'CT';
const DECIMALS = 6n;

let cft: ConfidentialFungibleTokenPublicSupplySimulator;

const deploy = () =>
  ConfidentialFungibleTokenPublicSupplySimulator.create(NAME, SYMBOL, DECIMALS);

// ---------------------------------------------------------------------------
// Live: block-limit canary. This block comes FIRST because it is the boundary
// condition that explains the rest of the file — it is the reason the functional
// suite below is dry-only.
//
// The base `ConfidentialFungibleToken` already bundles four k=16 circuits' IR
// into one deploy tx, which overruns the per-tx block byte budget — its own live
// block asserts that rejection (`src/token/test/ConfidentialFungibleToken.test.ts`).
// This composition adds the PublicSupply extension on top, so it is strictly
// larger and hits the same wall.
//
// Rather than skip and hide that, ASSERT the rejection. A green skip would let
// the branch claim live coverage it does not have.
//
// Scoped to ledger v8 (`@midnight-ntwrk/ledger-v8` 8.1.0). The budget is a ledger
// property, not a contract property, so a ledger bump can move it. If this block
// goes red, the composed deploy fits now: drop it and invert the guards below.
// ---------------------------------------------------------------------------

describe.runIf(isLiveBackend())(
  'ConfidentialFungibleToken + PublicSupply composition: live deploy',
  () => {
    it('deploy is rejected for exceeding the ledger block byte budget', async () => {
      // Fresh funded node, well-formed tx: the only reason the deploy can be
      // rejected here is the block byte budget. Assert it, verbatim.
      let error: unknown;
      try {
        await deploy();
      } catch (e) {
        error = e;
      }
      expect(
        error,
        'the composed deploy SUCCEEDED, so it no longer exceeds the block budget: ' +
          'delete this block and invert the guards in this file, to run the ' +
          'functional suite live instead.',
      ).toBeDefined();
      const detail = [
        (error as Error)?.message,
        (error as { cause?: unknown })?.cause,
        String(error),
      ]
        .map((x) => String(x ?? ''))
        .join(' | ');
      // The node's exact words, as of ledger v8. Asserted in full rather than a
      // loose `/block limits/` match, which an unrelated deploy failure could
      // satisfy and report as a false green.
      expect(
        detail,
        'the deploy was rejected, but not for the block budget. Either the cause ' +
          'is unrelated (funding, proving, a submission bounce), or a ledger bump ' +
          'reworded the message. Re-verify against the node before relaxing this.',
      ).toContain(
        '1010: Invalid Transaction: Transaction would exhaust the block limits',
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Dry: the functional composition suite. Cannot run live on two counts — the
// deploy above is rejected, and every flow here mutates private state mid-test
// (`switchIdentity` / `cachePlaintext`), which the live backend throws on
// ('private-state mutation unsupported on live backend'). Going green live needs
// both a deploy that fits AND a deploy-seeded, memo-decrypt rewrite.
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ConfidentialFungibleToken + PublicSupply composition',
  () => {
    beforeEach(async () => {
      cft = await deploy();
    });

    const registerAll = async () => {
      for (const u of [ALICE, BOB]) {
        await cft.privateState.switchIdentity(u.secretKey, u.encryptionKey);
        await cft.register();
      }
    };

    // Mints `amount` to Alice, sweeps it into spendable, and caches the swept
    // balance so it can later be debited (burned). Leaves Alice active.
    const fundAlice = async (amount: bigint) => {
      await registerAll();
      await cft.privateState.switchIdentity(
        ALICE.secretKey,
        ALICE.encryptionKey,
      );
      await cft.mint(ALICE.accountId, amount);
      await cft.sweep();
      await cft.privateState.cachePlaintext(
        await cft.balanceOf(ALICE.accountId),
        amount,
      );
    };

    describe('mint', () => {
      it('increases totalSupply by exactly the minted value', async () => {
        await registerAll();
        expect(await cft.totalSupply()).toBe(0n);

        await cft.mint(ALICE.accountId, 100n);
        expect(await cft.totalSupply()).toBe(100n);

        await cft.mint(ALICE.accountId, 50n);
        expect(await cft.totalSupply()).toBe(150n);
      });

      it('accumulates supply across recipients', async () => {
        await registerAll();
        await cft.mint(ALICE.accountId, 100n);
        await cft.mint(BOB.accountId, 50n);
        expect(await cft.totalSupply()).toBe(150n);
      });
    });

    describe('mint + burn round-trip', () => {
      it('mints a genuinely spendable balance and burns it back to zero supply', async () => {
        await fundAlice(100n);
        expect(await cft.totalSupply()).toBe(100n);

        // The mint credited Alice the full 100: burning 100 only proves out if her
        // spendable balance truly encrypts >= 100. It also drops supply to 0.
        await cft.burn(100n);
        expect(await cft.totalSupply()).toBe(0n);
      });
    });

    describe('burn', () => {
      it('moves totalSupply in lockstep with the caller debit', async () => {
        await fundAlice(100n);

        await cft.burn(40n);
        expect(await cft.totalSupply()).toBe(60n);

        // Alice's spendable is now 60; burning it drops supply to 0 in lockstep.
        await cft.privateState.cachePlaintext(
          await cft.balanceOf(ALICE.accountId),
          60n,
        );
        await cft.burn(60n);
        expect(await cft.totalSupply()).toBe(0n);
      });

      it('reverts a burn that exceeds the caller balance, leaving supply intact', async () => {
        await fundAlice(100n);

        await expect(cft.burn(101n)).rejects.toThrow(
          'ConfidentialFungibleToken: insufficient balance',
        );
        // The value op reverted before the supply decrement, so supply is unchanged.
        expect(await cft.totalSupply()).toBe(100n);
      });
    });

    describe('burnFrom', () => {
      it('drops totalSupply by spending the spender allowance', async () => {
        // Alice mints 100 and approves Bob for 40.
        await fundAlice(100n);
        await cft.approve(BOB.accountId, 40n);
        expect(await cft.totalSupply()).toBe(100n);

        // Bob decrypts his escrow copy (40), then burns 25 of the allowance.
        await cft.privateState.switchIdentity(BOB.secretKey, BOB.encryptionKey);
        const escrow = await cft.allowance(ALICE.accountId, BOB.accountId);
        await cft.privateState.cachePlaintext(escrow.spenderCt, 40n);

        await cft.burnFrom(ALICE.accountId, 25n);
        expect(await cft.totalSupply()).toBe(75n);
      });
    });

    describe('supply invariant', () => {
      it('totalSupply equals net minted across a mint/burn sequence', async () => {
        await registerAll();
        await cft.mint(ALICE.accountId, 100n);
        await cft.mint(BOB.accountId, 50n);
        expect(await cft.totalSupply()).toBe(150n);

        // Alice sweeps her 100 and burns 40: net minted is now 110.
        await cft.privateState.switchIdentity(
          ALICE.secretKey,
          ALICE.encryptionKey,
        );
        await cft.sweep();
        await cft.privateState.cachePlaintext(
          await cft.balanceOf(ALICE.accountId),
          100n,
        );
        await cft.burn(40n);

        expect(await cft.totalSupply()).toBe(110n);
      });
    });
  },
);
