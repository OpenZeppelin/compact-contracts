/**
 * Properties of the AuthPrfAddr module over generated secret keys and salts.
 *
 * The unit and compatibility suites state each claim at fixed points. This
 * states them where nobody chose: `deriveAccount` equals the `persistentHash`
 * reference, `authenticate` returns the account of the witness key, and the
 * key and the salt each move the account.
 *
 * Runs on either backend. `authenticate` is an impure circuit on its mock, so
 * each call is a transaction on live, and the properties run twice there.
 */

import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeAll, describe, expect, it } from 'vitest';
import { AuthPrfAddrSimulator } from './simulators/AuthPrfAddrSimulator.js';

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

/** `Bytes<32>`: a secret key or a salt. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** Which one of the two inputs a separation property moves. */
const component = () => fc.constantFrom('secretKey', 'salt');

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const TAG = new Uint8Array(32);
TAG.set(new TextEncoder().encode('AuthPrfAddr:account'));

const reference = (sk: Uint8Array, salt: Uint8Array): Uint8Array =>
  persistentHash(new CompactTypeVector(3, new CompactTypeBytes(32)), [
    TAG,
    salt,
    sk,
  ]);

const PROPERTY_RUNS = isLiveBackend() ? 2 : 100;

let auth: AuthPrfAddrSimulator;

beforeAll(async () => {
  auth = await AuthPrfAddrSimulator.create();
});

// ---------------------------------------------------------------------------
// Layout
// ---------------------------------------------------------------------------

describe('AuthPrfAddr property: layout', () => {
  it('should match the reference for any secret key and salt', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), bytes32(), async (sk, salt) => {
        expect(await auth.deriveAccount(sk, salt)).toEqual({
          is_left: true,
          left: reference(sk, salt),
          right: { bytes: new Uint8Array(32) },
        });
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });

  it('should authenticate to the account of the witness key for any secret key and salt', async () => {
    await fc.assert(
      fc.asyncProperty(bytes32(), bytes32(), async (sk, salt) => {
        await auth.updatePrivateState({ secretKey: sk });

        expect((await auth.authenticate(salt)).account).toEqual(
          await auth.deriveAccount(sk, salt),
        );
      }),
      { numRuns: PROPERTY_RUNS },
    );
  });
});

// ---------------------------------------------------------------------------
// Separation
// ---------------------------------------------------------------------------

/**
 * Each run draws two values for one input and holds the other fixed, so a
 * failure names the input that did not separate.
 */
describe('AuthPrfAddr property: separation', () => {
  it('should move the account when either input changes', async () => {
    await fc.assert(
      fc.asyncProperty(
        component(),
        bytes32(),
        bytes32(),
        bytes32(),
        async (moved, sk, salt, other) => {
          fc.pre(hex(other) !== hex({ secretKey: sk, salt }[moved]));
          const next = {
            sk: moved === 'secretKey' ? other : sk,
            salt: moved === 'salt' ? other : salt,
          };

          expect(await auth.deriveAccount(sk, salt)).not.toEqual(
            await auth.deriveAccount(next.sk, next.salt),
          );
        },
      ),
      { numRuns: PROPERTY_RUNS },
    );
  });
});
