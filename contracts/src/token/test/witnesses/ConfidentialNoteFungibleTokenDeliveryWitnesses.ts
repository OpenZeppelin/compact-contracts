// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the ConfidentialNoteFungibleTokenDelivery extension in off-chain
// tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * The delivery witness's private input. The extension has one witness and no
 * private state, so this holds only the knob a spec may turn.
 */
export type DeliveryWallet = {
  /**
   * Fixed delivery-randomness seed. Leave undefined for the production-correct
   * behavior (a fresh secret seed per witness call); set one only to test what
   * a reused seed does.
   */
  deliverySeed?: Uint8Array;
};

export const createDeliveryWallet = (): DeliveryWallet => ({});

/** The extension declares no private state. */
export type ConfidentialNoteFungibleTokenDeliveryPrivateState = Record<
  string,
  never
>;
export const ConfidentialNoteFungibleTokenDeliveryPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenDeliveryPrivateState => ({}),
};

export interface IConfidentialNoteFungibleTokenDeliveryWitnesses<L, P> {
  wit_ConfidentialNoteDeliveryRandomness(
    context: WitnessContext<L, P>,
  ): [P, Uint8Array];
}

/**
 * `L` and `P` are the composing contract's ledger and private state, so the
 * same factory serves the standalone mock and a core + delivery composition
 * (spread it next to the core's witnesses).
 */
export const ConfidentialNoteFungibleTokenDeliveryWitnesses = <
  L,
  P = ConfidentialNoteFungibleTokenDeliveryPrivateState,
>(
  wallet: DeliveryWallet,
): IConfidentialNoteFungibleTokenDeliveryWitnesses<L, P> => ({
  // Fresh and secret per call, as the module requires; a fixed seed is only
  // honored when a spec explicitly plants one.
  wit_ConfidentialNoteDeliveryRandomness(context) {
    return [
      context.privateState,
      wallet.deliverySeed ?? new Uint8Array(getRandomValues(Buffer.alloc(32))),
    ];
  },
});
