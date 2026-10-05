/**
 * Compatibility claims for the ZOwnableNativeShieldedToken preset.
 *
 * Every other suite compares the preset against itself, so all of them stay
 * green when the wire format moves. This suite pins absolute values and the
 * shape of the published state, the two things an outside party depends on: a
 * client computes `ownerId` off-chain and reads the ledger by slot.
 *
 * A failure here is a decision, not a test to fix: revert, or accept the
 * format change deliberately and regenerate every value in the same commit.
 */

import { isLiveBackend } from '@openzeppelin/compact-simulator';
import { beforeAll, describe, expect, it } from 'vitest';
import {
  type CircuitInfo,
  type CompactTypeInfo,
  circuitSurface,
  type Exhaustive,
  ledgerSlots,
  type NameOf,
  readContractInfo,
} from '#test-utils/compiler/contractInfo.js';
import * as utils from '#test-utils/fixtures/address.js';
import { shieldedTestKey } from '#test-utils/fixtures/shieldedKey.js';
import type {
  Circuits,
  Ledger,
  ProvableCircuits,
  PureCircuits,
} from '../../../../artifacts/MockZOwnableNativeShieldedToken/contract/index.js';
import { pureCircuits } from '../../../../artifacts/MockZOwnableNativeShieldedToken/contract/index.js';
import { ZOwnablePKPrivateState } from '../../../access/test/witnesses/ZOwnablePKWitnesses.js';
import {
  buildCommitmentFromId,
  createIdHash,
  ZOwnableNativeShieldedTokenSimulator,
} from './simulators/ZOwnableNativeShieldedTokenSimulator.js';

type Sim = ZOwnableNativeShieldedTokenSimulator;

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

const OWNER = 'SIGNER1';
const NEW_OWNER = 'SIGNER2';

const b32 = (label: string): Uint8Array => {
  const u = new Uint8Array(32);
  u.set(new TextEncoder().encode(label).slice(0, 32));
  return u;
};

/** Lowercase `0x…` rendering, so a failed vector prints readably. */
const hex = (bytes: Uint8Array): string =>
  `0x${Buffer.from(bytes).toString('hex')}`;

const INSTANCE_SALT = new Uint8Array(32).fill(0x5a);
const TOKEN_DOMAIN = b32('zownable-nst:token');
const NAME = 'Ownable Shielded Token';
const SYMBOL = 'OST';
const DECIMALS = 2n;
const INIT_COUNTER = 1n;

// Literal inputs, independent of any wallet fixture, so the digests below are
// the same on every backend.
const FIXED_PK = utils.eitherUserFromCoinPublicKey(
  '1111111111111111111111111111111111111111111111111111111111111111',
);
const FIXED_NONCE = new Uint8Array(32).fill(0x22);

const AT_SELF = isLiveBackend()
  ? {}
  : { contractAddress: utils.toHexPadded('ZOWNABLE_NST') };

const deploy = (ownerId: Uint8Array): Promise<Sim> =>
  ZOwnableNativeShieldedTokenSimulator.create(
    ownerId,
    INSTANCE_SALT,
    TOKEN_DOMAIN,
    NAME,
    SYMBOL,
    DECIMALS,
    true,
    { privateState: ZOwnablePKPrivateState.generate(), ...AT_SELF },
  );

// ---------------------------------------------------------------------------
// Digests
// ---------------------------------------------------------------------------

/**
 * `ownerId = H([pk, nonce])` and the commitment
 * `H([id, salt, counter, "ZOwnablePK:shield:"])`, both `persistentHash` over a
 * `Vector<Bytes<32>>`. Preimage order and the domain tag are part of the format.
 */
describe('ZOwnableNativeShieldedToken compatibility: digests', () => {
  const PINNED_OWNER_ID =
    '0x5189c77d29fe5d546a045ec46986852785fea5c13ac7da9c115ff5fb6edf817c';
  const PINNED_COMMITMENT =
    '0x8846dff25a674300484d7a76e4b0a1911bf7dd7b830dde1613a89617026205d7';

  it('computes the pinned ownerId for a known key and nonce', () => {
    expect(hex(pureCircuits._computeOwnerId(FIXED_PK, FIXED_NONCE))).toBe(
      PINNED_OWNER_ID,
    );
    expect(hex(createIdHash(FIXED_PK.left, FIXED_NONCE))).toBe(PINNED_OWNER_ID);
  });

  it('commits the pinned ownerId to the pinned digest at deploy', async () => {
    const ownerId = pureCircuits._computeOwnerId(FIXED_PK, FIXED_NONCE);
    expect(
      hex(buildCommitmentFromId(ownerId, INSTANCE_SALT, INIT_COUNTER)),
    ).toBe(PINNED_COMMITMENT);

    const token = await deploy(ownerId);
    expect(hex(await token.owner())).toBe(PINNED_COMMITMENT);
    expect(hex((await token.getPublicState())._ownerCommitment)).toBe(
      PINNED_COMMITMENT,
    );
  });

  it.each([
    { label: 'the owner key', alias: OWNER, nonce: b32('nonce-a') },
    { label: 'the new-owner key', alias: NEW_OWNER, nonce: b32('nonce-b') },
    {
      label: 'an all-0xff nonce',
      alias: OWNER,
      nonce: new Uint8Array(32).fill(0xff),
    },
  ])(
    '_computeOwnerId matches createIdHash for $label',
    async ({ alias, nonce }) => {
      const pk = shieldedTestKey(alias);
      const token = await deploy(createIdHash(pk.left, nonce));
      expect(await token._computeOwnerId(pk, nonce)).toStrictEqual(
        createIdHash(pk.left, nonce),
      );
    },
  );
});

// ---------------------------------------------------------------------------
// Token color
// ---------------------------------------------------------------------------

/**
 * `tokenType(_domain, kernel.self())` binds the color to the contract address.
 * Dry deploys at a fixed address, so the color is a constant there; live
 * assigns a fresh address per deploy, so the pin is dry only.
 */
describe.skipIf(isLiveBackend())(
  'ZOwnableNativeShieldedToken compatibility: token color',
  () => {
    const PINNED_COLOR =
      '0x398d5cb0dce01e60c6962a2c64e718474c469958a8957252a53516e6fa4dc91b';

    it('derives the pinned color for the fixed domain at the fixed address', async () => {
      const first = await deploy(createIdHash(FIXED_PK.left, FIXED_NONCE));
      const second = await deploy(createIdHash(FIXED_PK.left, FIXED_NONCE));
      expect(hex(await first.tokenColor())).toBe(PINNED_COLOR);
      expect(hex(await second.tokenColor())).toBe(PINNED_COLOR);
    });
  },
);

// ---------------------------------------------------------------------------
// Published surface
// ---------------------------------------------------------------------------

const MOCK = 'MockZOwnableNativeShieldedToken';
const EXAMPLE = 'ZOwnableNativeShieldedTokenExample';

const BYTES_32: CompactTypeInfo = { 'type-name': 'Bytes', length: 32 };
const BOOLEAN: CompactTypeInfo = { 'type-name': 'Boolean' };
const STRING: CompactTypeInfo = { 'type-name': 'Opaque', tsType: 'string' };
const UNIT: CompactTypeInfo = { 'type-name': 'Tuple', types: [] };
// JSON numbers, so `2^n - 1` reads back rounded to `2^n`.
const UINT_8: CompactTypeInfo = { 'type-name': 'Uint', maxval: 255 };
const UINT_64: CompactTypeInfo = {
  'type-name': 'Uint',
  maxval: Number((1n << 64n) - 1n),
};
const UINT_128: CompactTypeInfo = {
  'type-name': 'Uint',
  maxval: Number((1n << 128n) - 1n),
};
const COIN_PUBLIC_KEY: CompactTypeInfo = {
  'type-name': 'Struct',
  name: 'ZswapCoinPublicKey',
  elements: [{ name: 'bytes', type: BYTES_32 }],
};
const CONTRACT_ADDRESS: CompactTypeInfo = {
  'type-name': 'Struct',
  name: 'ContractAddress',
  elements: [{ name: 'bytes', type: BYTES_32 }],
};
const COIN_INFO: CompactTypeInfo = {
  'type-name': 'Struct',
  name: 'ShieldedCoinInfo',
  elements: [
    { name: 'nonce', type: BYTES_32 },
    { name: 'color', type: BYTES_32 },
    { name: 'value', type: UINT_128 },
  ],
};
const MAYBE_COIN_INFO: CompactTypeInfo = {
  'type-name': 'Struct',
  name: 'Maybe',
  elements: [
    { name: 'is_some', type: BOOLEAN },
    { name: 'value', type: COIN_INFO },
  ],
};
const EITHER_KEY_OR_ADDRESS: CompactTypeInfo = {
  'type-name': 'Struct',
  name: 'Either',
  elements: [
    { name: 'is_left', type: BOOLEAN },
    { name: 'left', type: COIN_PUBLIC_KEY },
    { name: 'right', type: CONTRACT_ADDRESS },
  ],
};

const byName = <T extends { name: string }>(left: T, right: T): number =>
  left.name.localeCompare(right.name);

describe('ZOwnableNativeShieldedToken compatibility: published surface', () => {
  let mock: ReturnType<typeof readContractInfo>;

  beforeAll(() => {
    mock = readContractInfo(MOCK);
  });

  /**
   * `index` is the slot a client reads and `exported` whether it can. Asserted
   * whole, so an added or removed slot fails too.
   *
   * The two `_isInitialized` slots are the composed modules' own names; the
   * generated reader aliases the first to `_ownableIsInitialized`.
   */
  it('keeps the pinned ledger layout', () => {
    expect(ledgerSlots(mock)).toStrictEqual([
      {
        name: '_isInitialized',
        index: 0,
        exported: true,
        storage: 'Cell',
        type: BOOLEAN,
      },
      {
        name: '_ownerCommitment',
        index: 1,
        exported: true,
        storage: 'Cell',
        type: BYTES_32,
      },
      { name: '_counter', index: 2, exported: true, storage: 'Counter' },
      {
        name: '_instanceSalt',
        index: 3,
        exported: true,
        storage: 'Cell',
        type: BYTES_32,
      },
      {
        name: '_domain',
        index: 4,
        exported: true,
        storage: 'Cell',
        type: BYTES_32,
      },
      {
        name: '_isInitialized',
        index: 5,
        exported: true,
        storage: 'Cell',
        type: BOOLEAN,
      },
      {
        name: '_name',
        index: 6,
        exported: true,
        storage: 'Cell',
        type: STRING,
      },
      {
        name: '_symbol',
        index: 7,
        exported: true,
        storage: 'Cell',
        type: STRING,
      },
      {
        name: '_decimals',
        index: 8,
        exported: true,
        storage: 'Cell',
        type: UINT_8,
      },
      {
        name: '_totalMinted',
        index: 9,
        exported: true,
        storage: 'Map',
        key: BYTES_32,
        value: UINT_128,
      },
      {
        name: '_totalBurned',
        index: 10,
        exported: true,
        storage: 'Map',
        key: BYTES_32,
        value: UINT_128,
      },
    ]);
  });

  /**
   * Keyed on `Circuits`, the generated type, so a circuit added, removed or
   * renamed fails to compile. Argument order and result type are the circuit
   * signature.
   */
  const SURFACE: Exhaustive<
    NameOf<Circuits<never>>,
    Omit<CircuitInfo, 'name'>
  > = {
    _computeOwnerId: {
      pure: true,
      proof: false,
      arguments: [
        { name: 'pk', type: EITHER_KEY_OR_ADDRESS },
        { name: 'nonce', type: BYTES_32 },
      ],
      'result-type': BYTES_32,
    },
    burn: {
      pure: false,
      proof: true,
      arguments: [
        { name: 'coin', type: COIN_INFO },
        { name: 'amount', type: UINT_64 },
        { name: 'refundTo', type: COIN_PUBLIC_KEY },
      ],
      'result-type': MAYBE_COIN_INFO,
    },
    decimals: {
      pure: false,
      proof: true,
      arguments: [],
      'result-type': UINT_8,
    },
    mint: {
      pure: false,
      proof: true,
      arguments: [
        { name: 'recipient', type: COIN_PUBLIC_KEY },
        { name: 'amount', type: UINT_64 },
        { name: 'nonce', type: BYTES_32 },
      ],
      'result-type': COIN_INFO,
    },
    name: { pure: false, proof: true, arguments: [], 'result-type': STRING },
    owner: { pure: false, proof: true, arguments: [], 'result-type': BYTES_32 },
    renounceOwnership: {
      pure: false,
      proof: true,
      arguments: [],
      'result-type': UNIT,
    },
    symbol: { pure: false, proof: true, arguments: [], 'result-type': STRING },
    tokenColor: {
      pure: false,
      proof: true,
      arguments: [],
      'result-type': BYTES_32,
    },
    totalMinted: {
      pure: false,
      proof: true,
      arguments: [],
      'result-type': UINT_128,
    },
    transferOwnership: {
      pure: false,
      proof: true,
      arguments: [{ name: 'newOwnerId', type: BYTES_32 }],
      'result-type': UNIT,
    },
  };

  it('keeps the pinned circuit surface', () => {
    const expected = Object.entries(SURFACE)
      .map(([name, info]) => ({ name, ...info }))
      .sort(byName);

    expect([...mock.circuits].sort(byName)).toStrictEqual(expected);
  });

  it('declares only the owner nonce witness', () => {
    expect(mock.witnesses).toStrictEqual([
      { name: 'wit_secretNonce', arguments: [], 'result type': BYTES_32 },
    ]);
  });

  /**
   * The JSON and the generated `.d.ts` describe the same contract independently,
   * so they have to agree on what a deployed instance accepts and what runs
   * off-chain for free.
   */
  it('agrees with the generated circuit types on what is callable', () => {
    const surface = circuitSurface(mock);

    const provable: Exhaustive<NameOf<ProvableCircuits<never>>> = {
      burn: true,
      decimals: true,
      mint: true,
      name: true,
      owner: true,
      renounceOwnership: true,
      symbol: true,
      tokenColor: true,
      totalMinted: true,
      transferOwnership: true,
    };
    const pure: Exhaustive<NameOf<PureCircuits>> = { _computeOwnerId: true };

    expect(
      surface.filter(({ proof }) => proof).map(({ name }) => name),
    ).toStrictEqual(Object.keys(provable).sort());
    expect(
      surface.filter(({ pure }) => pure).map(({ name }) => name),
    ).toStrictEqual(Object.keys(pure).sort());
    // Every impure circuit here touches the ledger, so all of them are provable.
    expect(surface.filter(({ pure, proof }) => !pure && !proof)).toStrictEqual(
      [],
    );
  });

  /**
   * `Ledger` is the generated reader and holds only exported slots. The mock
   * re-exports the ownable flag as `_ownableIsInitialized`, so slot 0 is read
   * under that alias.
   */
  it('exports exactly the slots the generated Ledger type exposes', () => {
    const READER_ALIAS: Record<number, string> = { 0: '_ownableIsInitialized' };
    const exported = ledgerSlots(mock)
      .filter(({ exported }) => exported)
      .map(({ index, name }) => READER_ALIAS[index] ?? name);

    const declared: Exhaustive<NameOf<Ledger>> = {
      _counter: true,
      _decimals: true,
      _domain: true,
      _instanceSalt: true,
      _isInitialized: true,
      _name: true,
      _ownableIsInitialized: true,
      _ownerCommitment: true,
      _symbol: true,
      _totalBurned: true,
      _totalMinted: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });

  /**
   * The example re-exports the preset minus the metadata getters, whose slots
   * `ledger()` reads for free. The mock's extra `isInit` constructor argument
   * is not in `contract-info.json`.
   */
  it('gives the example the mock surface minus the metadata getters', () => {
    const METADATA_GETTERS = new Set(['name', 'symbol', 'decimals']);
    const example = readContractInfo(EXAMPLE);
    expect([...example.circuits].sort(byName)).toStrictEqual(
      mock.circuits
        .filter(({ name }) => !METADATA_GETTERS.has(name))
        .sort(byName),
    );
    expect(example.witnesses).toStrictEqual(mock.witnesses);
    expect(ledgerSlots(example)).toStrictEqual(ledgerSlots(mock));
  });
});
