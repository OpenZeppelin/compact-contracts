import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudit/contract/index.js';
import {
  ConfidentialNoteFungibleTokenAuditWitnesses,
  createAuditWallet,
  type ConfidentialNoteFungibleTokenAuditPrivateState as PrivateState,
} from './ConfidentialNoteFungibleTokenAuditWitnesses.js';

/** The witness reads no ledger, so an empty context is enough. */
const context = (): WitnessContext<Ledger, PrivateState> =>
  ({ privateState: {} }) as WitnessContext<Ledger, PrivateState>;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('ConfidentialNoteFungibleTokenAuditWitnesses: wit_RandPrfExpandSeed', () => {
  it('should return 32 bytes', () => {
    const witnesses = ConfidentialNoteFungibleTokenAuditWitnesses<Ledger>(
      createAuditWallet(),
    );

    const [, seed] = witnesses.wit_RandPrfExpandSeed(context());

    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(32);
  });

  it('should return a distinct seed on every call', () => {
    const witnesses = ConfidentialNoteFungibleTokenAuditWitnesses<Ledger>(
      createAuditWallet(),
    );
    const seen = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const [, seed] = witnesses.wit_RandPrfExpandSeed(context());
      seen.add(hex(seed));
    }

    expect(seen.size).toBe(10);
  });

  it('should return a planted seed verbatim on every call', () => {
    const planted = new Uint8Array(32).fill(0xa7);
    const witnesses = ConfidentialNoteFungibleTokenAuditWitnesses<Ledger>({
      auditSeed: planted,
    });

    const [, first] = witnesses.wit_RandPrfExpandSeed(context());
    const [, second] = witnesses.wit_RandPrfExpandSeed(context());

    expect(first).toStrictEqual(planted);
    expect(second).toStrictEqual(planted);
  });

  it('should leave the private state untouched', () => {
    const witnesses = ConfidentialNoteFungibleTokenAuditWitnesses<Ledger>(
      createAuditWallet(),
    );
    const ctx = context();

    const [state] = witnesses.wit_RandPrfExpandSeed(ctx);

    expect(state).toBe(ctx.privateState);
  });
});
