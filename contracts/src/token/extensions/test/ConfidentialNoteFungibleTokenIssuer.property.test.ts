/**
 * Properties of the issuer key and the gate over generated secrets and salts.
 *
 * The unit suite states each claim at hand-picked points. This states the same
 * claims where nobody chose, and a failure shrinks to the smallest
 * counterexample.
 *
 * Runs on either backend. `derivePk` is pure and evaluates locally even on
 * live, so its properties run 100 times anywhere. The gate properties deploy
 * the standalone mock per run, and every call is a transaction on live, so
 * they run twice there.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { pureCircuits as composed } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssued/contract/index.js';
import { pureCircuits as issuer } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import { ConfidentialNoteFungibleTokenIssuerSimulator } from './simulators/ConfidentialNoteFungibleTokenIssuerSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

/** `Bytes<32>`, the declared width of a secret. */
const secret = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** A `Bytes<32>` salt `initialize` accepts: anything but zero. */
const salt = () =>
  fc
    .uint8Array({ minLength: 32, maxLength: 32 })
    .filter((bytes) => bytes.some((byte) => byte !== 0));

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const PROPERTY_RUNS = isLiveBackend() ? 2 : 25;

const NOT_ISSUER =
  'ConfidentialNoteFungibleTokenIssuer: caller is not the issuer';

// ---------------------------------------------------------------------------
// derivePk
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer property: derivePk', () => {
  it('should be deterministic for any secret and salt', () => {
    fc.assert(
      fc.property(secret(), salt(), (sk, s) => {
        expect(issuer.derivePk(sk, s)).toBe(issuer.derivePk(sk, s));
      }),
    );
  });

  it('should differ across salts for any secret', () => {
    fc.assert(
      fc.property(secret(), salt(), salt(), (sk, a, b) => {
        fc.pre(hex(a) !== hex(b));

        expect(issuer.derivePk(sk, a)).not.toBe(issuer.derivePk(sk, b));
      }),
    );
  });

  it('should differ across secrets for any salt', () => {
    fc.assert(
      fc.property(secret(), secret(), salt(), (a, b, s) => {
        fc.pre(hex(a) !== hex(b));

        expect(issuer.derivePk(a, s)).not.toBe(issuer.derivePk(b, s));
      }),
    );
  });

  it("should differ from the core's derivePk for any secret and salt", () => {
    fc.assert(
      fc.property(secret(), salt(), (sk, s) => {
        expect(issuer.derivePk(sk, s)).not.toBe(composed.derivePk(sk, s));
      }),
    );
  });

  it('should never derive the zero key', () => {
    fc.assert(
      fc.property(secret(), salt(), (sk, s) => {
        expect(issuer.derivePk(sk, s)).not.toBe(0n);
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// assertOnlyIssuer
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer property: assertOnlyIssuer', () => {
  it('should pass for the matching secret and no other, for any salt', async () => {
    await fc.assert(
      fc.asyncProperty(secret(), secret(), salt(), async (sk, other, s) => {
        fc.pre(hex(sk) !== hex(other));
        const token = await ConfidentialNoteFungibleTokenIssuerSimulator.create(
          { wallet: { secretKey: sk }, instanceSalt: s },
        );

        await token.assertOnlyIssuer();
        token.wallet.secretKey = other;
        await expectRejection(token.assertOnlyIssuer(), NOT_ISSUER);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should not pass for a secret whose key was derived under another salt', async () => {
    await fc.assert(
      fc.asyncProperty(secret(), salt(), salt(), async (sk, a, b) => {
        fc.pre(hex(a) !== hex(b));
        const token = await ConfidentialNoteFungibleTokenIssuerSimulator.create(
          {
            wallet: { secretKey: sk },
            instanceSalt: b,
            issuerPk: issuer.derivePk(sk, a),
          },
        );

        await expectRejection(token.assertOnlyIssuer(), NOT_ISSUER);
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
