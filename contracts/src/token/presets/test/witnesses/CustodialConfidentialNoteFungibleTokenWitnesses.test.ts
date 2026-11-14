import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ledger } from '../../../../../artifacts/token/presets/test/mocks/MockCustodialConfidentialNoteFungibleToken/contract/index.js';
import {
  CustodialConfidentialNoteFungibleTokenPrivateState,
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  createCustodialWallet,
  ISSUER_SALT,
  NOTE_SALT,
  type CustodialConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from './CustodialConfidentialNoteFungibleTokenWitnesses.js';

/** The witnesses read no ledger, so an empty context is enough. */
const context = (): WitnessContext<Ledger, PrivateState> =>
  ({ privateState: {} }) as WitnessContext<Ledger, PrivateState>;

/**
 * A context whose public parts throw on access, so a witness that reads
 * anything beyond its wallet and private state fails the call.
 */
const sealedContext = (): WitnessContext<Ledger, PrivateState> => {
  const ctx = { privateState: {} };
  for (const key of ['ledger', 'contractAddress']) {
    Object.defineProperty(ctx, key, {
      get: () => {
        throw new Error(`witness read context.${key}`);
      },
    });
  }
  return ctx as WitnessContext<Ledger, PrivateState>;
};

const bytes32 = (label: string): Uint8Array => {
  const bytes = new Uint8Array(32);
  bytes.set(new TextEncoder().encode(label));
  return bytes;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const WITNESS_NAMES = ['wit_AuthPrfAddrSK', 'wit_RandPrfExpandSeed'] as const;

describe('CustodialConfidentialNoteFungibleTokenWitnesses: salts', () => {
  it('should hold two distinct non-zero 32-byte salts', () => {
    for (const salt of [ISSUER_SALT, NOTE_SALT]) {
      expect(salt.length).toBe(32);
      expect(salt.some((byte) => byte !== 0)).toBe(true);
    }
    expect(hex(ISSUER_SALT)).not.toBe(hex(NOTE_SALT));
  });
});

describe('CustodialConfidentialNoteFungibleTokenWitnesses: createCustodialWallet', () => {
  it('should hold a 32-byte secret and no planted seed', () => {
    const wallet = createCustodialWallet();

    expect(wallet.secretKey).toBeInstanceOf(Uint8Array);
    expect(wallet.secretKey.length).toBe(32);
    expect(wallet.nonceSeed).toBeUndefined();
  });

  it('should draw a distinct secret for every wallet', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 10; i++) {
      seen.add(hex(createCustodialWallet().secretKey));
    }

    expect(seen.size).toBe(10);
  });
});

describe('CustodialConfidentialNoteFungibleTokenWitnesses: private state', () => {
  it('should generate an empty private state', () => {
    expect(
      CustodialConfidentialNoteFungibleTokenPrivateState.generate(),
    ).toStrictEqual({});
  });
});

describe('CustodialConfidentialNoteFungibleTokenWitnesses: wit_AuthPrfAddrSK', () => {
  it("should return the wallet's secret", () => {
    const wallet = createCustodialWallet();
    const witnesses =
      CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet);

    const [, sk] = witnesses.wit_AuthPrfAddrSK(context());

    expect(sk).toBe(wallet.secretKey);
  });

  it('should read the wallet on every call', () => {
    const wallet: CustodialWallet = { secretKey: bytes32('FIRST') };
    const witnesses =
      CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet);

    const [, first] = witnesses.wit_AuthPrfAddrSK(context());
    wallet.secretKey = bytes32('SECOND');
    const [, second] = witnesses.wit_AuthPrfAddrSK(context());

    expect(first).toStrictEqual(bytes32('FIRST'));
    expect(second).toStrictEqual(bytes32('SECOND'));
  });
});

describe('CustodialConfidentialNoteFungibleTokenWitnesses: wit_RandPrfExpandSeed', () => {
  it('should return a fresh non-zero 32-byte seed per call when none is planted', () => {
    const witnesses = CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(
      createCustodialWallet(),
    );
    const seen = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const [, seed] = witnesses.wit_RandPrfExpandSeed(context());
      expect(seed.length).toBe(32);
      expect(seed.some((byte) => byte !== 0)).toBe(true);
      seen.add(hex(seed));
    }

    expect(seen.size).toBe(10);
  });

  it('should return the planted seed on every call', () => {
    const wallet = createCustodialWallet();
    wallet.nonceSeed = bytes32('PLANTED');
    const witnesses =
      CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet);

    const [, first] = witnesses.wit_RandPrfExpandSeed(context());
    const [, second] = witnesses.wit_RandPrfExpandSeed(context());

    expect(first).toBe(wallet.nonceSeed);
    expect(second).toBe(wallet.nonceSeed);
  });

  it('should go back to fresh seeds once the planted seed is cleared', () => {
    const wallet = createCustodialWallet();
    wallet.nonceSeed = bytes32('PLANTED');
    const witnesses =
      CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet);

    wallet.nonceSeed = undefined;
    const [, seed] = witnesses.wit_RandPrfExpandSeed(context());

    expect(hex(seed)).not.toBe(hex(bytes32('PLANTED')));
  });
});

describe('CustodialConfidentialNoteFungibleTokenWitnesses: both witnesses', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it.each(WITNESS_NAMES)(
    'should leave the private state untouched (%s)',
    (name) => {
      const witnesses = CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(
        createCustodialWallet(),
      );
      const ctx = context();

      const [state] = witnesses[name](ctx);

      expect(state).toBe(ctx.privateState);
      expect(state).toStrictEqual({});
    },
  );

  it.each(WITNESS_NAMES)(
    'should pass through a composing private state (%s)',
    (name) => {
      type Composed = { note: string };
      const witnesses = CustodialConfidentialNoteFungibleTokenWitnesses<
        Ledger,
        Composed
      >(createCustodialWallet());
      const ctx = { privateState: { note: 'core' } } as WitnessContext<
        Ledger,
        Composed
      >;

      const [state] = witnesses[name](ctx);

      expect(state).toBe(ctx.privateState);
    },
  );

  it.each(WITNESS_NAMES)(
    'should answer without reading the ledger or the contract address (%s)',
    (name) => {
      const witnesses = CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(
        createCustodialWallet(),
      );

      const [, value] = witnesses[name](sealedContext());

      expect(value.length).toBe(32);
    },
  );

  it.each(WITNESS_NAMES)(
    'should neither log nor fetch while answering (%s)',
    (name) => {
      const spies = [
        vi.spyOn(console, 'log'),
        vi.spyOn(console, 'info'),
        vi.spyOn(console, 'warn'),
        vi.spyOn(console, 'error'),
        vi.spyOn(console, 'debug'),
        vi.spyOn(globalThis, 'fetch'),
      ];
      const witnesses = CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(
        createCustodialWallet(),
      );

      witnesses[name](context());

      for (const spy of spies) {
        expect(spy).not.toHaveBeenCalled();
      }
    },
  );
});
