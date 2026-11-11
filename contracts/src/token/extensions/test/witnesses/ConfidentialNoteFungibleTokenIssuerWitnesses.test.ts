import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Ledger } from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import {
  ConfidentialNoteFungibleTokenIssuerPrivateState,
  ConfidentialNoteFungibleTokenIssuerWitnesses,
  createIssuerWallet,
  type IssuerWallet,
  type ConfidentialNoteFungibleTokenIssuerPrivateState as PrivateState,
} from './ConfidentialNoteFungibleTokenIssuerWitnesses.js';

/** The witness reads no ledger, so an empty context is enough. */
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

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('ConfidentialNoteFungibleTokenIssuerWitnesses: createIssuerWallet', () => {
  it('should hold a 32-byte secret', () => {
    const { secretKey: sk } = createIssuerWallet();

    expect(sk).toBeInstanceOf(Uint8Array);
    expect(sk.length).toBe(32);
  });

  it('should draw a distinct secret for every wallet', () => {
    const seen = new Set<string>();

    for (let i = 0; i < 10; i++) {
      seen.add(hex(createIssuerWallet().secretKey));
    }

    expect(seen.size).toBe(10);
  });
});

describe('ConfidentialNoteFungibleTokenIssuerWitnesses: private state', () => {
  it('should generate an empty private state', () => {
    expect(
      ConfidentialNoteFungibleTokenIssuerPrivateState.generate(),
    ).toStrictEqual({});
  });
});

describe('ConfidentialNoteFungibleTokenIssuerWitnesses: wit_ConfidentialNoteIssuerSK', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });

  it("should return the wallet's secret", () => {
    const wallet = createIssuerWallet();
    const witnesses =
      ConfidentialNoteFungibleTokenIssuerWitnesses<Ledger>(wallet);

    const [, sk] = witnesses.wit_ConfidentialNoteIssuerSK(context());

    expect(sk).toBe(wallet.secretKey);
  });

  it('should read the wallet on every call', () => {
    const wallet: IssuerWallet = { secretKey: secretKey('FIRST') };
    const witnesses =
      ConfidentialNoteFungibleTokenIssuerWitnesses<Ledger>(wallet);

    const [, first] = witnesses.wit_ConfidentialNoteIssuerSK(context());
    wallet.secretKey = secretKey('SECOND');
    const [, second] = witnesses.wit_ConfidentialNoteIssuerSK(context());

    expect(first).toStrictEqual(secretKey('FIRST'));
    expect(second).toStrictEqual(secretKey('SECOND'));
  });

  it('should leave the private state untouched', () => {
    const witnesses = ConfidentialNoteFungibleTokenIssuerWitnesses<Ledger>(
      createIssuerWallet(),
    );
    const ctx = context();

    const [state] = witnesses.wit_ConfidentialNoteIssuerSK(ctx);

    expect(state).toBe(ctx.privateState);
    expect(state).toStrictEqual({});
  });

  it('should pass through a composing private state', () => {
    type Composed = { note: string };
    const witnesses = ConfidentialNoteFungibleTokenIssuerWitnesses<
      Ledger,
      Composed
    >(createIssuerWallet());
    const ctx = { privateState: { note: 'core' } } as WitnessContext<
      Ledger,
      Composed
    >;

    const [state] = witnesses.wit_ConfidentialNoteIssuerSK(ctx);

    expect(state).toBe(ctx.privateState);
  });

  it('should answer without reading the ledger or the contract address', () => {
    const wallet = createIssuerWallet();
    const witnesses =
      ConfidentialNoteFungibleTokenIssuerWitnesses<Ledger>(wallet);

    const [, sk] = witnesses.wit_ConfidentialNoteIssuerSK(sealedContext());

    expect(sk).toBe(wallet.secretKey);
  });

  it('should neither log nor fetch while answering', () => {
    const spies = [
      vi.spyOn(console, 'log'),
      vi.spyOn(console, 'info'),
      vi.spyOn(console, 'warn'),
      vi.spyOn(console, 'error'),
      vi.spyOn(console, 'debug'),
      vi.spyOn(globalThis, 'fetch'),
    ];
    const witnesses = ConfidentialNoteFungibleTokenIssuerWitnesses<Ledger>(
      createIssuerWallet(),
    );

    witnesses.wit_ConfidentialNoteIssuerSK(context());

    for (const spy of spies) {
      expect(spy).not.toHaveBeenCalled();
    }
  });
});
