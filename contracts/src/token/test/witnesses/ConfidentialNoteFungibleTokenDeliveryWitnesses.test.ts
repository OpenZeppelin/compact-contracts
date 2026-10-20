import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import { describe, expect, it } from 'vitest';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteFungibleTokenDelivery/contract/index.js';
import {
  ConfidentialNoteFungibleTokenDeliveryWitnesses,
  createDeliveryWallet,
  type ConfidentialNoteFungibleTokenDeliveryPrivateState as PrivateState,
} from '../witnesses/ConfidentialNoteFungibleTokenDeliveryWitnesses.js';

/** The witness reads no ledger, so an empty context is enough. */
const context = (): WitnessContext<Ledger, PrivateState> =>
  ({ privateState: {} }) as WitnessContext<Ledger, PrivateState>;

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

describe('ConfidentialNoteFungibleTokenDeliveryWitnesses: wit_ConfidentialNoteDeliveryRandomness', () => {
  it('should return 32 bytes', () => {
    const witnesses = ConfidentialNoteFungibleTokenDeliveryWitnesses<Ledger>(
      createDeliveryWallet(),
    );

    const [, seed] = witnesses.wit_ConfidentialNoteDeliveryRandomness(
      context(),
    );

    expect(seed).toBeInstanceOf(Uint8Array);
    expect(seed.length).toBe(32);
  });

  it('should return a distinct seed on every call', () => {
    const witnesses = ConfidentialNoteFungibleTokenDeliveryWitnesses<Ledger>(
      createDeliveryWallet(),
    );
    const seen = new Set<string>();

    for (let i = 0; i < 10; i++) {
      const [, seed] = witnesses.wit_ConfidentialNoteDeliveryRandomness(
        context(),
      );
      seen.add(hex(seed));
    }

    expect(seen.size).toBe(10);
  });

  it('should return a planted seed verbatim on every call', () => {
    const planted = new Uint8Array(32).fill(0x5e);
    const witnesses = ConfidentialNoteFungibleTokenDeliveryWitnesses<Ledger>({
      deliverySeed: planted,
    });

    const [, first] = witnesses.wit_ConfidentialNoteDeliveryRandomness(
      context(),
    );
    const [, second] = witnesses.wit_ConfidentialNoteDeliveryRandomness(
      context(),
    );

    expect(first).toStrictEqual(planted);
    expect(second).toStrictEqual(planted);
  });

  it('should leave the private state untouched', () => {
    const witnesses = ConfidentialNoteFungibleTokenDeliveryWitnesses<Ledger>(
      createDeliveryWallet(),
    );
    const ctx = context();

    const [state] = witnesses.wit_ConfidentialNoteDeliveryRandomness(ctx);

    expect(state).toBe(ctx.privateState);
  });
});
