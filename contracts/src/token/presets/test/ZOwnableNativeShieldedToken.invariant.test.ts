/**
 * Invariants of the preset that hold across operations: which ledger keys each
 * circuit may move, how `_totalMinted` accumulates, and, under generated
 * operation sequences, that the ledger agrees with a shadow model of the owner
 * after every step.
 *
 * The footprint and accounting groups run on both backends. The sequence group
 * is dry only: every step is a transaction on live.
 */

import { randomBytes } from 'node:crypto';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import fc from 'fast-check';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import * as utils from '#test-utils/fixtures/address.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import type {
  ledger,
  ShieldedCoinInfo,
  ZswapCoinPublicKey,
} from '../../../../artifacts/MockZOwnableNativeShieldedToken/contract/index.js';
import { ZOwnablePKPrivateState } from '../../../access/test/witnesses/ZOwnablePKWitnesses.js';
import {
  buildCommitmentFromId,
  createIdHash,
  ZOwnableNativeShieldedTokenSimulator,
} from './simulators/ZOwnableNativeShieldedTokenSimulator.js';

type Sim = ZOwnableNativeShieldedTokenSimulator;
type Ledger = ReturnType<typeof ledger>;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

// ZOwnablePK authorizes by `ownPublicKey()`, so each role needs its own pooled
// wallet slot; any other alias collapses to the deployer on live.
const OWNER = 'SIGNER1';
const NEW_OWNER = 'SIGNER2';
const UNAUTHORIZED = 'SIGNER3';

const Z_OWNER = shieldedTestKey(OWNER).left;
const Z_NEW_OWNER = shieldedTestKey(NEW_OWNER).left;

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
const BAD_NONCE = Buffer.alloc(32, 'BAD_NONCE');

const ZERO_32 = utils.zeroUint8Array();
const ZERO_KEY: ZswapCoinPublicKey = { bytes: ZERO_32 };
const SUPPLY_KEY = ZERO_32;

const AMOUNT = 1_000n;
const PARTIAL = 600n;

const NOT_OWNER = 'ZOwnablePK: caller is not the owner';

// Burned coins come from the owner's wallet, so on live they are minted to it.
const RECIPIENT = utils.encodeToPK('RECIPIENT');
const REFUND_TO = utils.encodeToPK('REFUND_TO');
const recipient = () => (isLiveBackend() ? Z_OWNER : RECIPIENT);
const refundTo = () => (isLiveBackend() ? Z_OWNER : REFUND_TO);

// Live persists commitments across runs, so a fixed mint nonce would collide.
const mintNonce = (label: string): Uint8Array =>
  isLiveBackend() ? Uint8Array.from(randomBytes(32)) : b32(label);

const AT_SELF = isLiveBackend()
  ? {}
  : { contractAddress: utils.toHexPadded('ZOWNABLE_NST') };

let token: Sim;
let ownerId: Uint8Array;

const deploy = (): Promise<Sim> => {
  const privateState = ZOwnablePKPrivateState.generate();
  ownerId = createIdHash(Z_OWNER, privateState.secretNonce);
  return ZOwnableNativeShieldedTokenSimulator.create(
    ownerId,
    INSTANCE_SALT,
    TOKEN_DOMAIN,
    NAME,
    SYMBOL,
    DECIMALS,
    true,
    { privateState, ...AT_SELF },
  );
};

const literalCoin = (color: Uint8Array, value: bigint): ShieldedCoinInfo => ({
  nonce: b32('coin'),
  color,
  value,
});

/** A coin of this token's color the owner can burn: minted on live, a literal on dry. */
const ownerCoin = async (t: Sim, value: bigint): Promise<ShieldedCoinInfo> => {
  if (isLiveBackend()) {
    return t.as(OWNER).mint(Z_OWNER, value, mintNonce('owner-coin'));
  }
  return literalCoin(await t.tokenColor(), value);
};

/** `getPublicState()` as plain data, Maps flattened to their entries. */
const footprint = (state: Ledger) => ({
  _ownerCommitment: state._ownerCommitment,
  _counter: state._counter,
  _instanceSalt: state._instanceSalt,
  _ownableIsInitialized: state._ownableIsInitialized,
  _domain: state._domain,
  _name: state._name,
  _symbol: state._symbol,
  _decimals: state._decimals,
  _isInitialized: state._isInitialized,
  _totalMinted: [...state._totalMinted],
  _totalBurned: [...state._totalBurned],
});

const snapshot = async (t: Sim) => footprint(await t.getPublicState());

// ---------------------------------------------------------------------------
// Ledger footprint
// ---------------------------------------------------------------------------

describe('ZOwnableNativeShieldedToken invariants: ledger footprint', () => {
  beforeEach(async () => {
    token = await deploy();
  });

  it('mint changes only _totalMinted', async () => {
    const before = await snapshot(token);
    await token.as(OWNER).mint(recipient(), AMOUNT, mintNonce('fp'));
    expect(await snapshot(token)).toStrictEqual({
      ...before,
      _totalMinted: [[SUPPLY_KEY, AMOUNT]],
    });
  });

  it('burn changes nothing', async () => {
    const coin = await ownerCoin(token, AMOUNT);
    const before = await snapshot(token);
    await token.as(OWNER).burn(coin, PARTIAL, refundTo());
    expect(await snapshot(token)).toStrictEqual(before);
  });

  it('transferOwnership changes only _ownerCommitment and _counter', async () => {
    const newOwnerId = createIdHash(Z_NEW_OWNER, b32('fp-new'));
    const before = await snapshot(token);
    await token.as(OWNER).transferOwnership(newOwnerId);
    expect(await snapshot(token)).toStrictEqual({
      ...before,
      _ownerCommitment: buildCommitmentFromId(
        newOwnerId,
        INSTANCE_SALT,
        INIT_COUNTER + 1n,
      ),
      _counter: INIT_COUNTER + 1n,
    });
  });

  it('renounceOwnership changes only _ownerCommitment', async () => {
    const before = await snapshot(token);
    await token.as(OWNER).renounceOwnership();
    expect(await snapshot(token)).toStrictEqual({
      ...before,
      _ownerCommitment: ZERO_32,
    });
  });
});

// ---------------------------------------------------------------------------
// Minted-total accounting
// ---------------------------------------------------------------------------

describe('ZOwnableNativeShieldedToken invariants: minted total', () => {
  beforeEach(async () => {
    token = await deploy();
  });

  it('totalMinted sums the successful mints', async () => {
    await token.as(OWNER).mint(recipient(), AMOUNT, mintNonce('a'));
    await token.as(OWNER).mint(recipient(), PARTIAL, mintNonce('b'));
    expect(await token.totalMinted()).toStrictEqual(AMOUNT + PARTIAL);
    expect(
      (await token.getPublicState())._totalMinted.lookup(SUPPLY_KEY),
    ).toStrictEqual(AMOUNT + PARTIAL);
  });

  it('reverted mints leave totalMinted unchanged', async () => {
    await token.as(OWNER).mint(recipient(), AMOUNT, mintNonce('ok'));
    await expect(
      token.as(UNAUTHORIZED).mint(recipient(), AMOUNT, mintNonce('unauth')),
    ).rejects.toThrow(NOT_OWNER);
    await expect(
      token.as(OWNER).mint(ZERO_KEY, AMOUNT, mintNonce('zero-key')),
    ).rejects.toThrow('NativeShieldedToken: invalid recipient');
    expect(await token.totalMinted()).toStrictEqual(AMOUNT);
  });

  it('burns leave totalMinted unchanged and _totalBurned empty', async () => {
    const coin = await token
      .as(OWNER)
      .mint(recipient(), AMOUNT, mintNonce('to-burn'));
    const change = await token.as(OWNER).burn(coin, PARTIAL, refundTo());
    await token.as(OWNER).burn(change.value, AMOUNT - PARTIAL, refundTo());
    expect(await token.totalMinted()).toStrictEqual(AMOUNT);
    const state = await token.getPublicState();
    expect(state._totalBurned.isEmpty()).toStrictEqual(true);
    expect(state._totalBurned.size()).toStrictEqual(0n);
  });
});

// ---------------------------------------------------------------------------
// Generated operation sequences
// ---------------------------------------------------------------------------

type OwnerOpKind = 'mint' | 'burn' | 'transferOwnership' | 'renounceOwnership';

type Op =
  | { readonly kind: 'mint'; readonly amount: bigint }
  | { readonly kind: 'burn'; readonly index: number; readonly pct: bigint }
  | { readonly kind: 'transferOwnership'; readonly to: 'other' | 'same' }
  | { readonly kind: 'renounceOwnership' }
  | {
      readonly kind: 'unauthorized';
      readonly op: OwnerOpKind;
      readonly how: 'wrong wallet' | 'wrong nonce';
    };

// Small amounts keep `_totalMinted` far from Uint<128>; the bound has its own
// case in the unit suite.
const amount = () => fc.bigInt({ min: 0n, max: 1n << 32n });

const OWNER_OP_KINDS: OwnerOpKind[] = [
  'mint',
  'burn',
  'transferOwnership',
  'renounceOwnership',
];

// Renounce is rare so most sequences keep a live owner; a renounce early on
// turns every later step into the same rejection.
const opArb: fc.Arbitrary<Op> = fc.oneof(
  {
    arbitrary: fc.record({
      kind: fc.constant('mint' as const),
      amount: amount(),
    }),
    weight: 4,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('burn' as const),
      index: fc.nat({ max: 7 }),
      pct: fc.bigInt({ min: 0n, max: 100n }),
    }),
    weight: 3,
  },
  {
    arbitrary: fc.record({
      kind: fc.constant('transferOwnership' as const),
      to: fc.constantFrom('other' as const, 'same' as const),
    }),
    weight: 2,
  },
  { arbitrary: fc.constant({ kind: 'renounceOwnership' as const }), weight: 1 },
  {
    arbitrary: fc.record({
      kind: fc.constant('unauthorized' as const),
      op: fc.constantFrom(...OWNER_OP_KINDS),
      how: fc.constantFrom('wrong wallet' as const, 'wrong nonce' as const),
    }),
    weight: 2,
  },
);

/** A sequence that opens with a mint, so a burn has a coin to spend. */
const sequence = (maxOps: number): fc.Arbitrary<Op[]> =>
  fc
    .tuple(amount(), fc.array(opArb, { minLength: 1, maxLength: maxOps }))
    .map(([opening, rest]) => [
      { kind: 'mint' as const, amount: opening },
      ...rest,
    ]);

/** What an honest owner believes the contract holds, kept apart from the ledger. */
interface Model {
  ownerAlias: string;
  ownerNonce: Buffer;
  ownerId: Uint8Array;
  counter: bigint;
  ownerCommitment: Uint8Array;
  totalMinted: bigint;
  /** Successful mints so far; `_totalMinted` holds an entry once it is non-zero. */
  mintCount: bigint;
  renounced: boolean;
  /** Coins the owner can still burn, change coins included. */
  heldCoins: ShieldedCoinInfo[];
}

const otherWallet = (alias: string): string =>
  alias === OWNER ? NEW_OWNER : OWNER;

const walletKey = (alias: string): ZswapCoinPublicKey =>
  shieldedTestKey(alias).left;

describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken invariants: generated op sequences',
  () => {
    const freshModel = (): Model => ({
      ownerAlias: OWNER,
      ownerNonce: Buffer.alloc(0),
      ownerId: ZERO_32,
      counter: INIT_COUNTER,
      ownerCommitment: ZERO_32,
      totalMinted: 0n,
      mintCount: 0n,
      renounced: false,
      heldCoins: [],
    });

    const deployModelled = async (): Promise<Model> => {
      const privateState = ZOwnablePKPrivateState.generate();
      const model = freshModel();
      model.ownerNonce = privateState.secretNonce;
      model.ownerId = createIdHash(Z_OWNER, model.ownerNonce);
      model.ownerCommitment = buildCommitmentFromId(
        model.ownerId,
        INSTANCE_SALT,
        INIT_COUNTER,
      );
      token = await ZOwnableNativeShieldedTokenSimulator.create(
        model.ownerId,
        INSTANCE_SALT,
        TOKEN_DOMAIN,
        NAME,
        SYMBOL,
        DECIMALS,
        true,
        { privateState, ...AT_SELF },
      );
      return model;
    };

    /** The owner op `kind`, submitted by `caller` with whatever nonce is injected. */
    const submit = async (
      kind: OwnerOpKind,
      caller: string,
      model: Model,
    ): Promise<unknown> => {
      switch (kind) {
        case 'mint':
          return token.as(caller).mint(RECIPIENT, AMOUNT, mintNonce('seq'));
        case 'burn': {
          const coin = literalCoin(await token.tokenColor(), AMOUNT);
          return token.as(caller).burn(coin, AMOUNT, REFUND_TO);
        }
        case 'transferOwnership':
          return token
            .as(caller)
            .transferOwnership(
              createIdHash(walletKey(caller), model.ownerNonce),
            );
        case 'renounceOwnership':
          return token.as(caller).renounceOwnership();
      }
    };

    const expectNotOwner = async (
      kind: OwnerOpKind,
      caller: string,
      model: Model,
    ): Promise<void> => {
      await expectRejection(submit(kind, caller, model), NOT_OWNER);
    };

    /** Points the next owner call at `model`'s owner nonce. */
    const useOwnerNonce = (model: Model) =>
      token.privateState.injectSecretNonce(model.ownerNonce);

    /** Applies one operation to both the contract and the model. */
    const step = async (op: Op, model: Model): Promise<void> => {
      if (op.kind === 'unauthorized') {
        if (op.how === 'wrong nonce') {
          await token.privateState.injectSecretNonce(BAD_NONCE);
          await expectNotOwner(op.op, model.ownerAlias, model);
          await useOwnerNonce(model);
        } else {
          await expectNotOwner(op.op, UNAUTHORIZED, model);
        }
        return;
      }

      // Once renounced, the rightful owner is rejected like anyone else.
      if (model.renounced) {
        await expectNotOwner(op.kind, model.ownerAlias, model);
        return;
      }

      const owner = model.ownerAlias;

      if (op.kind === 'mint') {
        const coin = await token
          .as(owner)
          .mint(RECIPIENT, op.amount, mintNonce(`seq-${model.mintCount}`));
        expect(coin.value).toBe(op.amount);
        model.totalMinted += op.amount;
        model.mintCount += 1n;
        model.heldCoins.push(coin);
        return;
      }

      if (op.kind === 'burn') {
        if (model.heldCoins.length === 0) return;
        const index = op.index % model.heldCoins.length;
        const coin = model.heldCoins[index] as ShieldedCoinInfo;
        const amount = (coin.value * op.pct) / 100n;
        const change = await token.as(owner).burn(coin, amount, REFUND_TO);
        model.heldCoins.splice(index, 1);
        if (amount === coin.value) {
          expect(change.is_some).toBe(false);
        } else {
          expect(change.is_some).toBe(true);
          expect(change.value.value).toBe(coin.value - amount);
          model.heldCoins.push(change.value);
        }
        return;
      }

      if (op.kind === 'transferOwnership') {
        const nextAlias = op.to === 'same' ? owner : otherWallet(owner);
        const nextNonce = ZOwnablePKPrivateState.generate().secretNonce;
        const nextId = createIdHash(walletKey(nextAlias), nextNonce);
        await token.as(owner).transferOwnership(nextId);
        model.ownerAlias = nextAlias;
        model.ownerNonce = nextNonce;
        model.ownerId = nextId;
        model.counter += 1n;
        model.ownerCommitment = buildCommitmentFromId(
          nextId,
          INSTANCE_SALT,
          model.counter,
        );
        await useOwnerNonce(model);
        return;
      }

      await token.as(owner).renounceOwnership();
      model.renounced = true;
      model.ownerCommitment = ZERO_32;
    };

    /** Re-checks every invariant that must hold after each operation. */
    const checkInvariants = async (model: Model): Promise<void> => {
      const state = await token.getPublicState();
      expect(state._ownerCommitment).toStrictEqual(model.ownerCommitment);
      expect(state._counter).toBe(model.counter);
      expect([...state._totalMinted]).toStrictEqual(
        model.mintCount > 0n ? [[SUPPLY_KEY, model.totalMinted]] : [],
      );
      expect([...state._totalBurned]).toStrictEqual([]);
      expect(await token.owner()).toStrictEqual(state._ownerCommitment);
      expect(await token.totalMinted()).toBe(model.totalMinted);
      if (!model.renounced) {
        expect(model.ownerCommitment).toStrictEqual(
          buildCommitmentFromId(model.ownerId, INSTANCE_SALT, model.counter),
        );
      }
    };

    it('keeps the ledger equal to the model after every step', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(6), async (ops) => {
          const model = await deployModelled();
          await checkInvariants(model);

          for (const op of ops) {
            const before = {
              counter: model.counter,
              minted: model.totalMinted,
            };
            await step(op, model);
            await checkInvariants(model);

            // `_counter` moves only on a transfer and only forward; the minted
            // total only grows.
            const transferred =
              op.kind === 'transferOwnership' && !model.renounced;
            expect(model.counter - before.counter).toBe(transferred ? 1n : 0n);
            expect(model.totalMinted >= before.minted).toBe(true);
          }
        }),
        { numRuns: 10 },
      );
    }, 120_000);

    it('locks every identity out after renounce and keeps totalMinted', async () => {
      await fc.assert(
        fc.asyncProperty(sequence(4), async (ops) => {
          const model = await deployModelled();
          for (const op of ops) {
            await step(op, model);
          }
          if (!model.renounced) {
            await step({ kind: 'renounceOwnership' }, model);
          }
          await checkInvariants(model);

          for (const caller of [OWNER, NEW_OWNER, UNAUTHORIZED]) {
            for (const kind of OWNER_OP_KINDS) {
              await expectNotOwner(kind, caller, model);
            }
          }
          expect(await token.owner()).toStrictEqual(ZERO_32);
          expect(await token.totalMinted()).toBe(model.totalMinted);
          expect((await token.getPublicState())._counter).toBe(model.counter);
        }),
        { numRuns: 6 },
      );
    }, 120_000);
  },
);
