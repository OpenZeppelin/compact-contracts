import { randomBytes } from 'node:crypto';
import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import { shieldedTestSigner } from '#test-utils/fixtures/shieldedKey.js';
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

// ZOwnablePK authorizes by `ownPublicKey()`, so each role needs its own pooled
// wallet slot; any other alias collapses to the deployer on live.
const OWNER = 'SIGNER1';
const NEW_OWNER = 'SIGNER2';
const UNAUTHORIZED = 'SIGNER3';

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
const BAD_NONCE = Buffer.alloc(32, 'BAD_NONCE');

const ZERO_32 = utils.zeroUint8Array();
const ZERO_KEY: ZswapCoinPublicKey = { bytes: ZERO_32 };
const SUPPLY_KEY = ZERO_32;

const AMOUNT = 1_000n;
const PARTIAL = 600n;
const MAX_U64 = (1n << 64n) - 1n;
const U64_BOUND = 1n << 64n;

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
let secretNonce: Buffer;
let ownerId: Uint8Array;

const deploy = (isInit = true): Promise<Sim> => {
  const privateState = ZOwnablePKPrivateState.generate();
  secretNonce = privateState.secretNonce;
  ownerId = createIdHash(Z_OWNER, secretNonce);
  return ZOwnableNativeShieldedTokenSimulator.create(
    ownerId,
    INSTANCE_SALT,
    TOKEN_DOMAIN,
    NAME,
    SYMBOL,
    DECIMALS,
    isInit,
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

type OwnerOp = {
  circuit: string;
  call: (t: Sim, caller: string) => Promise<unknown>;
};

// `as()` is single-use, so every argument that needs a circuit call is
// resolved before `as(caller)`.
const OWNER_OPS: OwnerOp[] = [
  {
    circuit: 'mint',
    call: (t, caller) =>
      t.as(caller).mint(recipient(), AMOUNT, mintNonce('auth')),
  },
  {
    circuit: 'burn',
    call: async (t, caller) => {
      const coin = literalCoin(await t.tokenColor(), AMOUNT);
      return t.as(caller).burn(coin, AMOUNT, refundTo());
    },
  },
  {
    circuit: 'transferOwnership',
    call: (t, caller) =>
      t.as(caller).transferOwnership(createIdHash(Z_NEW_OWNER, b32('new'))),
  },
  {
    circuit: 'renounceOwnership',
    call: (t, caller) => t.as(caller).renounceOwnership(),
  },
];

const WRONG_IDENTITIES = [
  {
    identity: 'wrong wallet, right nonce',
    caller: UNAUTHORIZED,
    badNonce: false,
  },
  { identity: 'right wallet, wrong nonce', caller: OWNER, badNonce: true },
  {
    identity: 'wrong wallet, wrong nonce',
    caller: UNAUTHORIZED,
    badNonce: true,
  },
];

describe('ZOwnableNativeShieldedToken', () => {
  describe('constructor', () => {
    it('reverts on a zero ownerId', async () => {
      await expect(
        ZOwnableNativeShieldedTokenSimulator.create(
          ZERO_32,
          INSTANCE_SALT,
          TOKEN_DOMAIN,
          NAME,
          SYMBOL,
          DECIMALS,
          true,
          AT_SELF,
        ),
      ).rejects.toThrow('ZOwnablePK: invalid id');
    });

    it('writes every ledger key from the constructor args', async () => {
      token = await deploy();
      expect(await snapshot(token)).toStrictEqual({
        _ownerCommitment: buildCommitmentFromId(
          ownerId,
          INSTANCE_SALT,
          INIT_COUNTER,
        ),
        _counter: INIT_COUNTER,
        _instanceSalt: INSTANCE_SALT,
        _ownableIsInitialized: true,
        _domain: TOKEN_DOMAIN,
        _name: NAME,
        _symbol: SYMBOL,
        _decimals: DECIMALS,
        _isInitialized: true,
        _totalMinted: [],
        _totalBurned: [],
      });
      const state = await token.getPublicState();
      expect(state._totalMinted.isEmpty()).toStrictEqual(true);
      expect(state._totalBurned.isEmpty()).toStrictEqual(true);
    });

    it('leaves both modules uninitialized when isInit is false', async () => {
      token = await deploy(false);
      const state = await token.getPublicState();
      expect(state._ownableIsInitialized).toStrictEqual(false);
      expect(state._isInitialized).toStrictEqual(false);
      expect(state._ownerCommitment).toStrictEqual(ZERO_32);
      expect(state._counter).toStrictEqual(0n);
      expect(state._totalMinted.isEmpty()).toStrictEqual(true);
      expect(state._totalBurned.isEmpty()).toStrictEqual(true);
    });
  });

  describe('before initialize', () => {
    beforeEach(async () => {
      token = await deploy(false);
    });

    // Arguments that would fail a token check prove the gate runs first.
    const ownableGated: [
      circuit: string,
      call: (t: Sim) => Promise<unknown>,
    ][] = [
      ['mint', (t) => t.as(OWNER).mint(ZERO_KEY, AMOUNT, b32('pre'))],
      [
        'burn',
        (t) =>
          t
            .as(OWNER)
            .burn(
              literalCoin(b32('wrong-color'), AMOUNT),
              AMOUNT + 1n,
              ZERO_KEY,
            ),
      ],
      ['transferOwnership', (t) => t.as(OWNER).transferOwnership(ZERO_32)],
      ['renounceOwnership', (t) => t.as(OWNER).renounceOwnership()],
      ['owner', (t) => t.owner()],
    ];

    it.each(ownableGated)('%s reverts', async (_circuit, call) => {
      await expect(call(token)).rejects.toThrow(
        'ZOwnablePK: contract not initialized',
      );
    });

    const tokenGated: [circuit: string, call: (t: Sim) => Promise<unknown>][] =
      [
        ['name', (t) => t.name()],
        ['symbol', (t) => t.symbol()],
        ['decimals', (t) => t.decimals()],
        ['tokenColor', (t) => t.tokenColor()],
      ];

    it.each(tokenGated)('%s reverts', async (_circuit, call) => {
      await expect(call(token)).rejects.toThrow(
        'NativeShieldedToken: contract not initialized',
      );
    });

    it('totalMinted returns 0', async () => {
      expect(await token.totalMinted()).toStrictEqual(0n);
    });

    it('_computeOwnerId still computes the id', async () => {
      expect(
        await token._computeOwnerId(shieldedTestSigner(OWNER), secretNonce),
      ).toStrictEqual(createIdHash(Z_OWNER, secretNonce));
    });
  });

  describe('_computeOwnerId', () => {
    beforeEach(async () => {
      token = await deploy();
    });

    it('reverts for a contract address', async () => {
      await expect(
        token._computeOwnerId(
          utils.createEitherTestContractAddress('CONTRACT'),
          secretNonce,
        ),
      ).rejects.toThrow(
        'ZOwnablePK: contract address owners are not yet supported',
      );
    });
  });

  describe('views', () => {
    beforeEach(async () => {
      token = await deploy();
    });

    it('returns the constructor metadata', async () => {
      expect(await token.name()).toStrictEqual(NAME);
      expect(await token.symbol()).toStrictEqual(SYMBOL);
      expect(await token.decimals()).toStrictEqual(DECIMALS);
    });

    it('returns a non-zero, stable tokenColor', async () => {
      const color = await token.tokenColor();
      expect(color).toHaveLength(32);
      expect(color).not.toStrictEqual(ZERO_32);
      expect(await token.tokenColor()).toStrictEqual(color);
    });

    it('owner returns the stored commitment', async () => {
      const expected = buildCommitmentFromId(
        ownerId,
        INSTANCE_SALT,
        INIT_COUNTER,
      );
      expect(await token.owner()).toStrictEqual(expected);
      expect((await token.getPublicState())._ownerCommitment).toStrictEqual(
        expected,
      );
    });

    it('totalMinted returns 0 before any mint', async () => {
      expect(await token.totalMinted()).toStrictEqual(0n);
    });
  });

  describe('authorization', () => {
    beforeEach(async () => {
      token = await deploy();
    });

    // The wallet cases pin harness behaviour: on chain `ownPublicKey()` is
    // prover-supplied, so only the nonce cases are a real guarantee.
    const matrix = OWNER_OPS.flatMap((op) =>
      WRONG_IDENTITIES.map((id) => ({ ...op, ...id })),
    );

    it.each(matrix)(
      '$circuit rejects $identity and leaves the ledger unchanged',
      async ({ call, caller, badNonce }) => {
        const before = await snapshot(token);
        if (badNonce) await token.privateState.injectSecretNonce(BAD_NONCE);
        await expect(call(token, caller)).rejects.toThrow(
          'ZOwnablePK: caller is not the owner',
        );
        expect(await snapshot(token)).toStrictEqual(before);
      },
    );

    it('rejects an unauthorized mint to the zero key with the ownership error', async () => {
      await expect(
        token.as(UNAUTHORIZED).mint(ZERO_KEY, AMOUNT, b32('zero')),
      ).rejects.toThrow('ZOwnablePK: caller is not the owner');
    });

    it('rejects an unauthorized burn of a wrong-color coin with the ownership error', async () => {
      await expect(
        token
          .as(UNAUTHORIZED)
          .burn(literalCoin(b32('wrong-color'), AMOUNT), AMOUNT, refundTo()),
      ).rejects.toThrow('ZOwnablePK: caller is not the owner');
    });
  });

  describe('mint', () => {
    beforeEach(async () => {
      token = await deploy();
    });

    it('returns the coin for the given color, amount and nonce', async () => {
      const nonce = mintNonce('mint');
      const coin = await token.as(OWNER).mint(recipient(), AMOUNT, nonce);
      expect(coin).toStrictEqual({
        nonce,
        color: await token.tokenColor(),
        value: AMOUNT,
      });
    });

    it('returns distinct coins of one color for two mints', async () => {
      const first = await token
        .as(OWNER)
        .mint(recipient(), AMOUNT, mintNonce('first'));
      const second = await token
        .as(OWNER)
        .mint(recipient(), AMOUNT, mintNonce('second'));
      expect(first).not.toStrictEqual(second);
      expect(first.color).toStrictEqual(second.color);
    });

    it('mints a zero amount', async () => {
      const coin = await token
        .as(OWNER)
        .mint(recipient(), 0n, mintNonce('zero'));
      expect(coin.value).toStrictEqual(0n);
      expect(await token.totalMinted()).toStrictEqual(0n);
      expect((await snapshot(token))._totalMinted).toStrictEqual([
        [SUPPLY_KEY, 0n],
      ]);
    });

    it('mints the maximum Uint<64> amount and rejects one above it', async () => {
      const coin = await token
        .as(OWNER)
        .mint(recipient(), MAX_U64, mintNonce('max'));
      expect(coin.value).toStrictEqual(MAX_U64);
      await expect(
        token.as(OWNER).mint(recipient(), U64_BOUND, mintNonce('over')),
      ).rejects.toThrow('Uint<0..18446744073709551616>');
    });

    it('reverts on a zero recipient', async () => {
      await expect(
        token.as(OWNER).mint(ZERO_KEY, AMOUNT, mintNonce('zero-key')),
      ).rejects.toThrow('NativeShieldedToken: invalid recipient');
    });
  });

  describe('burn', () => {
    beforeEach(async () => {
      token = await deploy();
    });

    it('returns none on a full burn', async () => {
      const coin = await ownerCoin(token, AMOUNT);
      const result = await token.as(OWNER).burn(coin, AMOUNT, refundTo());
      expect(result.is_some).toStrictEqual(false);
    });

    it('returns the change on a partial burn', async () => {
      const coin = await ownerCoin(token, AMOUNT);
      const color = await token.tokenColor();
      const result = await token.as(OWNER).burn(coin, PARTIAL, refundTo());
      expect(result.is_some).toStrictEqual(true);
      expect(result.value.value).toStrictEqual(AMOUNT - PARTIAL);
      expect(result.value.color).toStrictEqual(color);
    });

    it('returns the whole coin value on a zero burn', async () => {
      const coin = await ownerCoin(token, AMOUNT);
      const result = await token.as(OWNER).burn(coin, 0n, refundTo());
      expect(result.is_some).toStrictEqual(true);
      expect(result.value.value).toStrictEqual(AMOUNT);
    });

    it('reverts on a wrong-color coin', async () => {
      await expect(
        token
          .as(OWNER)
          .burn(literalCoin(b32('wrong-color'), AMOUNT), AMOUNT, refundTo()),
      ).rejects.toThrow('NativeShieldedToken: wrong token');
    });

    it('reverts when amount exceeds the coin value', async () => {
      const coin = literalCoin(await token.tokenColor(), AMOUNT);
      await expect(
        token.as(OWNER).burn(coin, AMOUNT + 1n, refundTo()),
      ).rejects.toThrow('NativeShieldedToken: insufficient coin value');
    });

    it('reverts on a zero refundTo', async () => {
      const coin = literalCoin(await token.tokenColor(), AMOUNT);
      await expect(
        token.as(OWNER).burn(coin, PARTIAL, ZERO_KEY),
      ).rejects.toThrow('NativeShieldedToken: invalid refund target');
    });

    it('burns a minted coin and then its change', async () => {
      const coin = await token
        .as(OWNER)
        .mint(recipient(), AMOUNT, mintNonce('minted'));
      const change = await token.as(OWNER).burn(coin, PARTIAL, refundTo());
      expect(change.is_some).toStrictEqual(true);
      const rest = await token
        .as(OWNER)
        .burn(change.value, AMOUNT - PARTIAL, refundTo());
      expect(rest.is_some).toStrictEqual(false);
    });

    it('burns a MAX_U64 coin in full', async () => {
      const coin = await ownerCoin(token, MAX_U64);
      const result = await token.as(OWNER).burn(coin, MAX_U64, refundTo());
      expect(result.is_some).toStrictEqual(false);
    });

    it('rejects a burn amount above Uint<64>', async () => {
      const coin = literalCoin(await token.tokenColor(), MAX_U64);
      await expect(
        token.as(OWNER).burn(coin, U64_BOUND, refundTo()),
      ).rejects.toThrow('Uint<0..18446744073709551616>');
    });
  });

  describe('transferOwnership', () => {
    let newOwnerNonce: Buffer;
    let newOwnerId: Uint8Array;

    beforeEach(async () => {
      token = await deploy();
      newOwnerNonce = ZOwnablePKPrivateState.generate().secretNonce;
      newOwnerId = createIdHash(Z_NEW_OWNER, newOwnerNonce);
    });

    it('commits the new id at the next counter', async () => {
      await token.as(OWNER).transferOwnership(newOwnerId);
      const expected = buildCommitmentFromId(
        newOwnerId,
        INSTANCE_SALT,
        INIT_COUNTER + 1n,
      );
      expect(await token.owner()).toStrictEqual(expected);
      expect((await token.getPublicState())._counter).toStrictEqual(
        INIT_COUNTER + 1n,
      );
    });

    it.each(OWNER_OPS)('$circuit rejects the old owner', async ({ call }) => {
      await token.as(OWNER).transferOwnership(newOwnerId);
      await expect(call(token, OWNER)).rejects.toThrow(
        'ZOwnablePK: caller is not the owner',
      );
    });

    it('lets the new owner mint and transfer again', async () => {
      await token.as(OWNER).transferOwnership(newOwnerId);
      await token.privateState.injectSecretNonce(newOwnerNonce);
      expect(await token.privateState.getCurrentSecretNonce()).toStrictEqual(
        newOwnerNonce,
      );
      const coin = await token
        .as(NEW_OWNER)
        .mint(recipient(), AMOUNT, mintNonce('new'));
      expect(coin.value).toStrictEqual(AMOUNT);
      await token.privateState.injectSecretNonce(newOwnerNonce);
      await token.as(NEW_OWNER).transferOwnership(ownerId);
      expect(await token.owner()).toStrictEqual(
        buildCommitmentFromId(ownerId, INSTANCE_SALT, INIT_COUNTER + 2n),
      );
    });

    it('rotates the owner nonce on the same wallet', async () => {
      const freshNonce = ZOwnablePKPrivateState.generate().secretNonce;
      await token
        .as(OWNER)
        .transferOwnership(createIdHash(Z_OWNER, freshNonce));
      await expect(
        token.as(OWNER).mint(recipient(), AMOUNT, mintNonce('stale')),
      ).rejects.toThrow('ZOwnablePK: caller is not the owner');
      await token.privateState.injectSecretNonce(freshNonce);
      const coin = await token
        .as(OWNER)
        .mint(recipient(), AMOUNT, mintNonce('fresh'));
      expect(coin.value).toStrictEqual(AMOUNT);
    });

    it('reverts on a zero newOwnerId', async () => {
      await expect(token.as(OWNER).transferOwnership(ZERO_32)).rejects.toThrow(
        'ZOwnablePK: invalid id',
      );
    });

    it('reverts for an unauthorized caller', async () => {
      await expect(
        token.as(UNAUTHORIZED).transferOwnership(newOwnerId),
      ).rejects.toThrow('ZOwnablePK: caller is not the owner');
    });
  });

  describe('renounceOwnership', () => {
    beforeEach(async () => {
      token = await deploy();
    });

    it('zeroes the owner and keeps the counter', async () => {
      await token.as(OWNER).renounceOwnership();
      expect(await token.owner()).toStrictEqual(ZERO_32);
      expect((await token.getPublicState())._counter).toStrictEqual(
        INIT_COUNTER,
      );
    });

    const lockedOut = OWNER_OPS.flatMap((op) =>
      [OWNER, NEW_OWNER, UNAUTHORIZED].map((caller) => ({ ...op, caller })),
    );

    it.each(lockedOut)(
      '$circuit rejects $caller afterwards',
      async ({ call, caller }) => {
        await token.as(OWNER).renounceOwnership();
        await expect(call(token, caller)).rejects.toThrow(
          'ZOwnablePK: caller is not the owner',
        );
      },
    );

    it('keeps the views and totalMinted', async () => {
      await token.as(OWNER).mint(recipient(), AMOUNT, mintNonce('pre'));
      const color = await token.tokenColor();
      await token.as(OWNER).renounceOwnership();
      expect(await token.name()).toStrictEqual(NAME);
      expect(await token.symbol()).toStrictEqual(SYMBOL);
      expect(await token.decimals()).toStrictEqual(DECIMALS);
      expect(await token.tokenColor()).toStrictEqual(color);
      expect(await token.totalMinted()).toStrictEqual(AMOUNT);
      expect(await token.owner()).toStrictEqual(ZERO_32);
    });
  });
});
