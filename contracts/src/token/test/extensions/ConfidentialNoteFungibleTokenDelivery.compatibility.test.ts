/**
 * Compatibility claims for the ConfidentialNoteFungibleTokenDelivery extension.
 *
 * A wallet depends on three things the other suites compare only against
 * themselves: the `Delivery` layout, the two pad tags, and the modular pad.
 * Move any of them and every entry already on chain opens to garbage. This
 * suite pins absolute values and the published surface, as the core's does.
 *
 * A FAILURE HERE IS NOT A TEST TO FIX. Revert, or accept deliberately and
 * regenerate in the same commit; post-release it is a migration.
 *
 * PROVENANCE. Every value below was recorded under compiler 0.34.0 (language
 * 0.26.0, runtime 0.19.0), the CI compiler.
 */

import { readFileSync } from 'node:fs';
import { ecMulGenerator } from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import {
  type CircuitSurface,
  circuitSurface,
  type Exhaustive,
  ledgerSlots,
  type NameOf,
  readContractInfo,
} from '#test-utils/compiler/contractInfo.js';
import type {
  Circuits as ComposedCircuits,
  Ledger as ComposedLedger,
  ProvableCircuits as ComposedProvableCircuits,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivered/contract/index.js';
import {
  type Circuits,
  pureCircuits as delivery,
  type Ledger,
  type ProvableCircuits,
} from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivery/contract/index.js';
import {
  ConfidentialNoteFungibleTokenDeliverySimulator,
  type Delivery,
} from '../simulators/ConfidentialNoteFungibleTokenDeliverySimulator.js';

// ---------------------------------------------------------------------------
// Fixtures
// ---------------------------------------------------------------------------

/** Deterministic 32 bytes from a label. */
const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const MAX_U248 = (1n << 248n) - 1n;

/** Stands in for wallet randomness, the only non-deterministic input. */
const FIXED_SEED = bytes32('FIXED-DELIVERY-SEED');

const EK = 111222333444555n;
const ENC_PK = ecMulGenerator(EK);
const SLOT = bytes32('CNFT:delivery:golden');
const NOTE = { value: 100n, nonce: 7n };

/** `_deliver(ENC_PK, 100, 7, SLOT)` under `FIXED_SEED`. */
const PINNED_ENTRY: Delivery = {
  ephemeralPk: {
    x: 31804913055194654303877129211186036351174861101361331048496997384954870532572n,
    y: 49071666282472517019600583881624425187740365028560409349039196107197062350317n,
  },
  valueCt:
    206676096594307997876952792156695848246238757323467825016412089835309650539n,
  nonceCt:
    424513903576667245712514399151509395236832224355128561822482626326299682614n,
};

const EXTENSION_SOURCE = readFileSync(
  new URL(
    '../../extensions/ConfidentialNoteFungibleTokenDelivery.compact',
    import.meta.url,
  ),
  'utf8',
);

const CORE_SOURCE = readFileSync(
  new URL('../../ConfidentialNoteFungibleToken.compact', import.meta.url),
  'utf8',
);

/** The distinct `pad(32, "...")` literals in a source, in order of appearance. */
const tagsOf = (source: string): string[] => [
  ...new Set(
    [...source.matchAll(/pad\(32, "([^"]+)"\)/g)].map(([, tag]) => tag),
  ),
];

// ---------------------------------------------------------------------------
// Wire format
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenDelivery compatibility: wire format', () => {
  let token: ConfidentialNoteFungibleTokenDeliverySimulator;

  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenDeliverySimulator.create({
      wallet: { deliverySeed: FIXED_SEED },
    });
  });

  // Deploys, since the pad runs inside a circuit. On live it proves the
  // deployed bytecode pads as the local artifact does.
  it('should pad a known note to the pinned entry', async () => {
    await token._deliver(ENC_PK, NOTE.value, NOTE.nonce, SLOT);
    const [entry] = [...(await token.getPublicState()).Delivery__deliveries];

    expect(entry).toStrictEqual(PINNED_ENTRY);
  });

  // Pure, so it pins the recipient side on its own: the shared point, both
  // tags and the modular pad, without a deployment.
  it('should open the pinned entry to the known note', () => {
    expect(delivery.recoverNote(PINNED_ENTRY, EK)).toStrictEqual(NOTE);
  });

  it('should keep the pinned domain tags', () => {
    expect(tagsOf(EXTENSION_SOURCE)).toStrictEqual([
      'CNFT:delivery:e',
      'CNFT:delivery:value',
      'CNFT:delivery:nonce',
    ]);
  });

  it('should share no tag with the core', () => {
    const coreTags = new Set(tagsOf(CORE_SOURCE));

    expect(coreTags.size).toBeGreaterThan(0);
    for (const tag of tagsOf(EXTENSION_SOURCE)) {
      expect(coreTags.has(tag)).toBe(false);
    }
  });
});

// ---------------------------------------------------------------------------
// Published surface: the extension alone
// ---------------------------------------------------------------------------

/**
 * The slot type as the compiler reports it. `maxval` arrives as a JSON number,
 * so it is only the nearest double to `2^248 - 1`.
 */
const DELIVERY_SLOT_TYPE = {
  'type-name': 'Struct',
  name: 'Delivery',
  elements: [
    { name: 'ephemeralPk', type: { 'type-name': 'JubjubPoint' } },
    {
      name: 'valueCt',
      type: { 'type-name': 'Uint', maxval: Number(MAX_U248) },
    },
    {
      name: 'nonceCt',
      type: { 'type-name': 'Uint', maxval: Number(MAX_U248) },
    },
  ],
};

describe('ConfidentialNoteFungibleTokenDelivery compatibility: published surface', () => {
  const contractInfo = () =>
    readContractInfo('MockConfidentialNoteFungibleTokenDelivery');

  it('should keep the pinned ledger layout', () => {
    expect(ledgerSlots(contractInfo())).toStrictEqual([
      {
        name: '_deliveries',
        index: 0,
        exported: true,
        storage: 'List',
        type: DELIVERY_SLOT_TYPE,
      },
    ]);
  });

  const SURFACE: Exhaustive<
    NameOf<Circuits<never>>,
    Pick<CircuitSurface, 'pure' | 'proof'>
  > = {
    _deliver: { pure: false, proof: true },
    recoverNote: { pure: true, proof: false },
  };

  it('should keep the pinned circuit surface', () => {
    const expected = Object.entries(SURFACE)
      .map(([name, flags]) => ({ name, ...flags }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(circuitSurface(contractInfo())).toStrictEqual(expected);
  });

  it('should agree with the generated circuit types on what is callable', () => {
    const provable = circuitSurface(contractInfo())
      .filter(({ proof }) => proof)
      .map(({ name }) => name);

    const declared: Exhaustive<NameOf<ProvableCircuits<never>>> = {
      _deliver: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort());
  });

  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name }) => `Delivery_${name}`);

    const declared: Exhaustive<NameOf<Ledger>> = {
      Delivery__deliveries: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});

// ---------------------------------------------------------------------------
// Published surface: composed with the core
// ---------------------------------------------------------------------------

/**
 * The composition appends one slot after the core's five. A wallet reads the
 * feed by that index, so the core's layout is re-pinned here in full.
 */
describe('ConfidentialNoteFungibleTokenDelivery compatibility: composed surface', () => {
  const contractInfo = () =>
    readContractInfo('MockConfidentialNoteFungibleTokenDelivered');

  it('should keep the pinned ledger layout', () => {
    expect(ledgerSlots(contractInfo())).toStrictEqual([
      {
        name: '_isInitialized',
        index: 0,
        exported: true,
        storage: 'Cell',
        type: { 'type-name': 'Boolean' },
      },
      {
        name: '_instanceSalt',
        index: 1,
        exported: true,
        storage: 'Cell',
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_commitments',
        index: 2,
        exported: true,
        storage: 'HistoricMerkleTree',
        depth: 32,
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_nullifiers',
        index: 3,
        exported: true,
        storage: 'Set',
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_issuedNonces',
        index: 4,
        exported: true,
        storage: 'Set',
        type: { 'type-name': 'Bytes', length: 32 },
      },
      {
        name: '_deliveries',
        index: 5,
        exported: true,
        storage: 'List',
        type: DELIVERY_SLOT_TYPE,
      },
    ]);
  });

  const SURFACE: Exhaustive<
    NameOf<ComposedCircuits<never>>,
    Pick<CircuitSurface, 'pure' | 'proof'>
  > = {
    burn: { pure: false, proof: true },
    commitOf: { pure: true, proof: false },
    derivePk: { pure: true, proof: false },
    mint: { pure: false, proof: true },
    nullifierOf: { pure: true, proof: false },
    recoverNote: { pure: true, proof: false },
    transfer: { pure: false, proof: true },
  };

  it('should keep the pinned circuit surface', () => {
    const expected = Object.entries(SURFACE)
      .map(([name, flags]) => ({ name, ...flags }))
      .sort((left, right) => left.name.localeCompare(right.name));

    expect(circuitSurface(contractInfo())).toStrictEqual(expected);
  });

  it('should agree with the generated circuit types on what is callable', () => {
    const provable = circuitSurface(contractInfo())
      .filter(({ proof }) => proof)
      .map(({ name }) => name);

    const declared: Exhaustive<NameOf<ComposedProvableCircuits<never>>> = {
      burn: true,
      mint: true,
      transfer: true,
    };

    expect(provable).toStrictEqual(Object.keys(declared).sort());
  });

  it('should export exactly the slots the generated Ledger type exposes', () => {
    const exported = ledgerSlots(contractInfo())
      .filter(({ exported }) => exported)
      .map(({ name }) =>
        name === '_deliveries' ? `Delivery_${name}` : `Core_${name}`,
      );

    const declared: Exhaustive<NameOf<ComposedLedger>> = {
      Core__commitments: true,
      Core__instanceSalt: true,
      Core__isInitialized: true,
      Core__issuedNonces: true,
      Core__nullifiers: true,
      Delivery__deliveries: true,
    };

    expect(exported.sort()).toStrictEqual(Object.keys(declared).sort());
  });
});
