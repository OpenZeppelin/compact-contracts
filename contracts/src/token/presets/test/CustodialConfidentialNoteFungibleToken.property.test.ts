/**
 * Properties of the two salts, the issuer gate and holder spends over
 * generated secrets and salts.
 *
 * The unit suite states each claim at hand-picked points. This states the same
 * claims where nobody chose, and a failure shrinks to the smallest
 * counterexample.
 *
 * Runs on either backend. `deriveAccount` is pure and evaluates locally even
 * on live, so its properties run 100 times anywhere. The other properties
 * deploy the mock per run, and every call is a transaction on live, so they
 * run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as preset } from '../../../../artifacts/token/presets/test/mocks/MockCustodialConfidentialNoteFungibleToken/contract/index.js';
import { CustodialConfidentialNoteFungibleTokenSimulator } from './simulators/CustodialConfidentialNoteFungibleTokenSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

/** `Bytes<32>`, the declared width of a secret. */
const secret = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** A `Bytes<32>` salt `initialize` accepts on its own: anything but zero. */
const salt = () =>
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .filter((bytes) => bytes.some((byte) => byte !== 0));

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const PROPERTY_RUNS = isLiveBackend() ? 2 : 25;

// Generated-input tests deploy on every run, so dry runs get their own
// timeout. On live the project's timeout applies.
const GENERATED_INPUT_OPTIONS = isLiveBackend() ? {} : { timeout: 60_000 };

const ERR = {
  equalSalts: 'CustodialConfidentialNoteFungibleToken: salts must differ',
  notOwner: 'Ownable: caller is not the owner',
  rootNotRecognized: 'ConfidentialNoteFungibleToken: input root not recognized',
} as const;

/** Deploys with `sk` as the issuer under the given salts. */
const deploy = (sk: Uint8Array, issuerSalt: Uint8Array, noteSalt: Uint8Array) =>
  CustodialConfidentialNoteFungibleTokenSimulator.create({
    wallet: { secretKey: sk },
    issuerSalt,
    noteSalt,
  });

// ---------------------------------------------------------------------------
// deriveAccount
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken property: deriveAccount', () => {
  it('should give one secret distinct accounts under any two distinct salts', () => {
    fc.assert(
      fc.property(secret(), salt(), salt(), (sk, a, b) => {
        fc.pre(hex(a) !== hex(b));

        expect(preset.deriveAccount(sk, a)).not.toStrictEqual(
          preset.deriveAccount(sk, b),
        );
      }),
    );
  });

  // `mint` and `transfer` reject a `right` recipient, so every derived note
  // key has to be a `left`.
  it('should derive a left account for any secret and salt', () => {
    fc.assert(
      fc.property(secret(), salt(), (sk, s) => {
        const account = preset.deriveAccount(sk, s);

        expect(account.is_left).toBe(true);
        expect(account.right.bytes).toStrictEqual(new Uint8Array(32));
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe('CustodialConfidentialNoteFungibleToken property: initialize', () => {
  it('should store any two distinct non-zero salts', async () => {
    await fc.assert(
      fc.asyncProperty(secret(), salt(), salt(), async (sk, a, b) => {
        fc.pre(hex(a) !== hex(b));
        const token = await deploy(sk, a, b);
        const state = await token.getPublicState();

        expect(state.Token__issuerSalt).toStrictEqual(a);
        expect(state.Token__noteSalt).toStrictEqual(b);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should reject any salt used for both roles', async () => {
    await fc.assert(
      fc.asyncProperty(secret(), salt(), async (sk, s) => {
        await expectRejection(deploy(sk, s, s), ERR.equalSalts);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// The issuer gate
// ---------------------------------------------------------------------------

describe(
  'CustodialConfidentialNoteFungibleToken property: mint',
  GENERATED_INPUT_OPTIONS,
  () => {
    it('should mint for the matching secret and no other, for any salts', async () => {
      await fc.assert(
        fc.asyncProperty(
          secret(),
          secret(),
          salt(),
          salt(),
          async (sk, other, a, b) => {
            fc.pre(hex(sk) !== hex(other) && hex(a) !== hex(b));
            const token = await deploy(sk, a, b);
            const recipient = preset.deriveAccount(other, b);

            await expect(token.mint(recipient, 1n)).resolves.toMatchObject({
              value: 1n,
            });
            token.wallet.secretKey = other;
            await expectRejection(token.mint(recipient, 1n), ERR.notOwner);
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });

    it('should not mint for a secret whose id was derived under the note salt', async () => {
      await fc.assert(
        fc.asyncProperty(secret(), salt(), salt(), async (sk, a, b) => {
          fc.pre(hex(a) !== hex(b));
          const token =
            await CustodialConfidentialNoteFungibleTokenSimulator.create({
              wallet: { secretKey: sk },
              issuerSalt: a,
              noteSalt: b,
              issuer: preset.deriveAccount(sk, b),
            });

          await expectRejection(
            token.mint(preset.deriveAccount(sk, b), 1n),
            ERR.notOwner,
          );
        }),
        { numRuns: PROPERTY_RUNS },
      );
    });

    it('should move minting to any new issuer id on handover', async () => {
      await fc.assert(
        fc.asyncProperty(
          secret(),
          secret(),
          salt(),
          salt(),
          async (sk, next, a, b) => {
            fc.pre(hex(sk) !== hex(next) && hex(a) !== hex(b));
            const token = await deploy(sk, a, b);
            const recipient = preset.deriveAccount(next, b);

            await token.transferOwnership(preset.deriveAccount(next, a));

            await expectRejection(token.mint(recipient, 1n), ERR.notOwner);
            token.wallet.secretKey = next;
            await expect(token.mint(recipient, 1n)).resolves.toMatchObject({
              value: 1n,
            });
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });
  },
);

// ---------------------------------------------------------------------------
// Holder spends
// ---------------------------------------------------------------------------

describe(
  'CustodialConfidentialNoteFungibleToken property: spend',
  GENERATED_INPUT_OPTIONS,
  () => {
    it("should let the note's owner spend it and no other secret, for any secrets and salts", async () => {
      await fc.assert(
        fc.asyncProperty(
          secret(),
          secret(),
          secret(),
          salt(),
          salt(),
          async (issuer, holder, other, a, b) => {
            fc.pre(hex(holder) !== hex(other) && hex(a) !== hex(b));
            const token = await deploy(issuer, a, b);
            const owner = preset.deriveAccount(holder, b);
            const note = await token.mint(owner, 100n);
            const path = await token.pathOf(note, owner);

            token.wallet.secretKey = other;
            await expectRejection(
              token.burn(100n, note, path),
              ERR.rootNotRecognized,
            );
            token.wallet.secretKey = holder;
            await expect(token.burn(100n, note, path)).resolves.toMatchObject({
              value: 0n,
            });
          },
        ),
        { numRuns: PROPERTY_RUNS },
      );
    });
  },
);
