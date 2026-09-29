/**
 * The preset's claims over generated inputs, so they hold where nobody chose
 * and a failure shrinks to the smallest counterexample.
 *
 * The pure block runs on either backend. The deploy-driven blocks are dry:
 * every run is its own deploy and one to six transactions.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { describe, expect, it } from 'vitest';
import { zeroUint8Array } from '#test-utils/fixtures/address.js';
import { shieldedTestSigner } from '#test-utils/fixtures/shieldedKey.js';
import {
  type ContractAddress,
  type Either,
  pureCircuits,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockZOwnableNativeShieldedToken/contract/index.js';
import {
  buildCommitmentFromId,
  createIdHash,
  ZOwnableNativeShieldedTokenSimulator,
} from './simulators/ZOwnableNativeShieldedTokenSimulator.js';

type Sim = ZOwnableNativeShieldedTokenSimulator;

const OWNER = 'SIGNER1';
const NEW_OWNER = 'SIGNER2';
const Z_OWNER = shieldedTestSigner(OWNER).left;
const Z_NEW_OWNER = shieldedTestSigner(NEW_OWNER).left;

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

const INSTANCE_SALT = new Uint8Array(32).fill(0x5a);
const TOKEN_DOMAIN = b32('zownable-nst:token');
const NAME = 'Ownable Shielded Token';
const SYMBOL = 'OST';
const DECIMALS = 2n;
const INIT_COUNTER = 1n;
const ZERO_32 = zeroUint8Array();
const RECIPIENT: ZswapCoinPublicKey = { bytes: b32('RECIPIENT') };
const REFUND_TO: ZswapCoinPublicKey = { bytes: b32('REFUND_TO') };
const MAX_U64 = (1n << 64n) - 1n;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

// ---------------------------------------------------------------------------
// Generators, each pinned to the circuit's own type
// ---------------------------------------------------------------------------

/** `Bytes<32>`: a nonce, a salt, or a coin public key. */
const bytes32 = () => fc.uint8Array({ minLength: 32, maxLength: 32 });

/** A coin public key the circuits accept: never the zero key. */
const nonZeroKey = () =>
  bytes32()
    .filter((bytes) => bytes.some((b) => b !== 0))
    .map((bytes): ZswapCoinPublicKey => ({ bytes }));

/** `Uint<64>`, the declared width of a mint or burn amount. */
const amount = () => fc.bigInt({ min: 0n, max: MAX_U64 });

const asEither = (
  pk: ZswapCoinPublicKey,
): Either<ZswapCoinPublicKey, ContractAddress> => ({
  is_left: true,
  left: pk,
  right: { bytes: ZERO_32 },
});

const deploy = (
  secretNonce: Uint8Array,
  instanceSalt: Uint8Array = INSTANCE_SALT,
): Promise<Sim> =>
  ZOwnableNativeShieldedTokenSimulator.create(
    createIdHash(Z_OWNER, secretNonce),
    instanceSalt,
    TOKEN_DOMAIN,
    NAME,
    SYMBOL,
    DECIMALS,
    true,
    { privateState: { secretNonce: Buffer.from(secretNonce) } },
  );

// Run counts are small: each run deploys and proves its own circuits.
const RUNS = { numRuns: 8 };

// ---------------------------------------------------------------------------
// _computeOwnerId
// ---------------------------------------------------------------------------

describe('ZOwnableNativeShieldedToken property: _computeOwnerId', () => {
  it('matches createIdHash for any key and nonce', () => {
    fc.assert(
      fc.property(nonZeroKey(), bytes32(), (pk, nonce) => {
        expect(hex(pureCircuits._computeOwnerId(asEither(pk), nonce))).toBe(
          hex(createIdHash(pk, nonce)),
        );
      }),
    );
  });

  it('differs whenever the nonce differs', () => {
    fc.assert(
      fc.property(nonZeroKey(), bytes32(), bytes32(), (pk, a, b) => {
        fc.pre(hex(a) !== hex(b));
        expect(hex(pureCircuits._computeOwnerId(asEither(pk), a))).not.toBe(
          hex(pureCircuits._computeOwnerId(asEither(pk), b)),
        );
      }),
    );
  });

  it('differs whenever the key differs', () => {
    fc.assert(
      fc.property(bytes32(), nonZeroKey(), nonZeroKey(), (nonce, a, b) => {
        fc.pre(hex(a.bytes) !== hex(b.bytes));
        expect(hex(pureCircuits._computeOwnerId(asEither(a), nonce))).not.toBe(
          hex(pureCircuits._computeOwnerId(asEither(b), nonce)),
        );
      }),
    );
  });
});

// ---------------------------------------------------------------------------
// owner
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken property: owner',
  () => {
    it('commits the deploy id at counter 1 for any salt and nonce', async () => {
      await fc.assert(
        fc.asyncProperty(bytes32(), bytes32(), async (salt, secretNonce) => {
          const token = await deploy(secretNonce, salt);
          expect(await token.owner()).toStrictEqual(
            buildCommitmentFromId(
              createIdHash(Z_OWNER, secretNonce),
              salt,
              INIT_COUNTER,
            ),
          );
        }),
        RUNS,
      );
    });
  },
);

// ---------------------------------------------------------------------------
// mint
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken property: mint',
  () => {
    it('returns the coin for any amount and nonce', async () => {
      await fc.assert(
        fc.asyncProperty(amount(), bytes32(), async (value, nonce) => {
          const token = await deploy(b32('secret'));
          const coin = await token.as(OWNER).mint(RECIPIENT, value, nonce);
          expect(coin).toStrictEqual({
            nonce,
            color: await token.tokenColor(),
            value,
          });
        }),
        RUNS,
      );
    });

    // The dry context keeps one Zswap mint effect per domain across calls, a
    // `Uint<64>` sum, so the sequence stays under it.
    it('totalMinted is the running sum for any sequence of amounts', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.array(fc.bigInt({ min: 0n, max: 1n << 60n }), {
            minLength: 1,
            maxLength: 6,
          }),
          async (amounts) => {
            const token = await deploy(b32('secret'));
            let expected = 0n;
            for (const [i, value] of amounts.entries()) {
              await token.as(OWNER).mint(RECIPIENT, value, b32(`mint-${i}`));
              expected += value;
              expect(await token.totalMinted()).toBe(expected);
            }
          },
        ),
        RUNS,
      );
    });
  },
);

// ---------------------------------------------------------------------------
// burn
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken property: burn',
  () => {
    const coinOf = async (
      token: Sim,
      value: bigint,
      nonce: Uint8Array,
    ): Promise<ShieldedCoinInfo> => ({
      nonce,
      color: await token.tokenColor(),
      value,
    });

    it('returns none when the amount is the whole coin', async () => {
      await fc.assert(
        fc.asyncProperty(amount(), bytes32(), async (value, nonce) => {
          const token = await deploy(b32('secret'));
          const coin = await coinOf(token, value, nonce);
          const result = await token.as(OWNER).burn(coin, value, REFUND_TO);
          expect(result.is_some).toBe(false);
        }),
        RUNS,
      );
    });

    it('returns the change for any amount below the coin value', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 1n, max: MAX_U64 }),
          amount(),
          bytes32(),
          async (value, raw, nonce) => {
            const burned = raw % value;
            const token = await deploy(b32('secret'));
            const coin = await coinOf(token, value, nonce);
            const result = await token.as(OWNER).burn(coin, burned, REFUND_TO);
            expect(result.is_some).toBe(true);
            expect(result.value.value).toBe(value - burned);
            expect(result.value.color).toStrictEqual(coin.color);
            expect(result.value.nonce).toHaveLength(32);
            expect(hex(result.value.nonce)).not.toBe(hex(nonce));
          },
        ),
        RUNS,
      );
    });

    it('rejects any amount above the coin value', async () => {
      await fc.assert(
        fc.asyncProperty(
          fc.bigInt({ min: 0n, max: MAX_U64 - 1n }),
          fc.bigInt({ min: 1n, max: MAX_U64 }),
          bytes32(),
          async (value, raw, nonce) => {
            const over = value + 1n + (raw % (MAX_U64 - value));
            const token = await deploy(b32('secret'));
            const coin = await coinOf(token, value, nonce);
            await expect(
              token.as(OWNER).burn(coin, over, REFUND_TO),
            ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
          },
        ),
        RUNS,
      );
    });
  },
);

// ---------------------------------------------------------------------------
// ownership
// ---------------------------------------------------------------------------

describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken property: ownership',
  () => {
    const ownerOps: [
      name: string,
      call: (token: Sim, caller: string) => Promise<unknown>,
    ][] = [
      ['mint', (t, c) => t.as(c).mint(RECIPIENT, 1n, b32('mint'))],
      [
        'burn',
        async (t, c) => {
          const color = await t.tokenColor();
          return t
            .as(c)
            .burn({ nonce: b32('coin'), color, value: 1n }, 1n, REFUND_TO);
        },
      ],
      ['transferOwnership', (t, c) => t.as(c).transferOwnership(b32('next'))],
      ['renounceOwnership', (t, c) => t.as(c).renounceOwnership()],
    ];

    it('any other nonce is rejected by every owner-gated circuit', async () => {
      await fc.assert(
        fc.asyncProperty(bytes32(), bytes32(), async (secretNonce, other) => {
          fc.pre(hex(secretNonce) !== hex(other));
          const token = await deploy(secretNonce);
          await token.privateState.injectSecretNonce(Buffer.from(other));
          for (const [name, call] of ownerOps) {
            await expect(call(token, OWNER), name).rejects.toThrow(
              'ZOwnablePK: caller is not the owner',
            );
          }
        }),
        RUNS,
      );
    });

    it('any transferred identity mints and the old one is rejected', async () => {
      await fc.assert(
        fc.asyncProperty(bytes32(), bytes32(), async (secretNonce, next) => {
          const token = await deploy(secretNonce);
          const nextId = pureCircuits._computeOwnerId(
            asEither(Z_NEW_OWNER),
            next,
          );
          await token.as(OWNER).transferOwnership(nextId);

          await expect(
            token.as(OWNER).mint(RECIPIENT, 1n, b32('old')),
          ).rejects.toThrow('ZOwnablePK: caller is not the owner');

          await token.privateState.injectSecretNonce(Buffer.from(next));
          const coin = await token
            .as(NEW_OWNER)
            .mint(RECIPIENT, 1n, b32('new'));
          expect(coin.value).toBe(1n);
          expect(await token.owner()).toStrictEqual(
            buildCommitmentFromId(nextId, INSTANCE_SALT, INIT_COUNTER + 1n),
          );
        }),
        RUNS,
      );
    });
  },
);
