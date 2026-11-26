import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import { ConfidentialNoteFungibleTokenMetadataSimulator } from './simulators/ConfidentialNoteFungibleTokenMetadataSimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const NAME = 'Monument Note';
const SYMBOL = 'MNT';
const DECIMALS = 18n;

const isInit = 1n;
const isBadInit = 0n;
const isDoubleInit = 2n;

let token: ConfidentialNoteFungibleTokenMetadataSimulator;

/** The module's ledger fields, in a form `toStrictEqual` compares. */
const fieldsOf = async () => {
  const state = await token.getPublicState();
  return {
    isInitialized: state.Metadata__isInitialized,
    name: state.Metadata__name,
    symbol: state.Metadata__symbol,
    decimals: state.Metadata__decimals,
  };
};

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenMetadata: initialize', () => {
  it('should initialize', async () => {
    token = await ConfidentialNoteFungibleTokenMetadataSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
      isInit,
    );

    expect(await fieldsOf()).toStrictEqual({
      isInitialized: true,
      name: NAME,
      symbol: SYMBOL,
      decimals: DECIMALS,
    });
  });

  it('should fail to initialize twice', async () => {
    await expectRejection(
      ConfidentialNoteFungibleTokenMetadataSimulator.create(
        NAME,
        SYMBOL,
        DECIMALS,
        isDoubleInit,
      ),
      'ConfidentialNoteFungibleTokenMetadata: contract already initialized',
    );
  });
});

// ---------------------------------------------------------------------------
// Getters
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenMetadata: before initialized', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenMetadataSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
      isBadInit,
    );
  });

  it('should leave the flag unset', async () => {
    expect((await fieldsOf()).isInitialized).toBe(false);
  });

  it.each(['name', 'symbol', 'decimals'] as const)(
    'should fail when calling "%s"',
    async (getter) => {
      await expectRejection(
        token[getter](),
        'ConfidentialNoteFungibleTokenMetadata: contract not initialized',
      );
    },
  );
});

describe('ConfidentialNoteFungibleTokenMetadata: when initialized', () => {
  beforeEach(async () => {
    token = await ConfidentialNoteFungibleTokenMetadataSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
      isInit,
    );
  });

  it('should return the name', async () => {
    expect(await token.name()).toBe(NAME);
  });

  it('should return the symbol', async () => {
    expect(await token.symbol()).toBe(SYMBOL);
  });

  it('should return the decimals', async () => {
    expect(await token.decimals()).toBe(DECIMALS);
  });

  it('should leave the ledger unchanged across the getters', async () => {
    const before = await fieldsOf();

    await token.name();
    await token.symbol();
    await token.decimals();

    expect(await fieldsOf()).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Edge values
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenMetadata: edge values', () => {
  it.each([
    ['empty strings and zero decimals', '', '', 0n],
    ['non-ASCII strings', 'Jeton à note ✓ 🪙', 'ÑØT€', 6n],
    ['the widest decimals', NAME, SYMBOL, 255n],
  ] as const)('should round-trip %s', async (_, name, symbol, decimals) => {
    token = await ConfidentialNoteFungibleTokenMetadataSimulator.create(
      name,
      symbol,
      decimals,
      isInit,
    );

    expect(await token.name()).toBe(name);
    expect(await token.symbol()).toBe(symbol);
    expect(await token.decimals()).toBe(decimals);
    expect(await fieldsOf()).toStrictEqual({
      isInitialized: true,
      name,
      symbol,
      decimals,
    });
  });
});
