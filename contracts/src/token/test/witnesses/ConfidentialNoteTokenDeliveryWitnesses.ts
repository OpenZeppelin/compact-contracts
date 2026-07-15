// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives ConfidentialNoteTokenDelivery (note delivery) circuits in off-chain
// tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteTokenDelivery/contract/index.js';

export type ConfidentialNoteTokenDeliveryPrivateState = {
  /**
   * Optional fixed randomness seed. Leave undefined for the production-correct
   * behavior (a fresh secret seed per witness call).
   */
  randomnessSeed?: Uint8Array;
};

export const ConfidentialNoteTokenDeliveryPrivateState = {
  generate: (): ConfidentialNoteTokenDeliveryPrivateState => ({}),
};

export interface IConfidentialNoteTokenDeliveryWitnesses<P> {
  wit_DeliveryRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

export const ConfidentialNoteTokenDeliveryWitnesses =
  (): IConfidentialNoteTokenDeliveryWitnesses<ConfidentialNoteTokenDeliveryPrivateState> => ({
    // Fresh + secret per call, as the extension requires; a fixed seed is only
    // honored when a test explicitly plants one.
    wit_DeliveryRandomness(context) {
      return [
        context.privateState,
        context.privateState.randomnessSeed ??
          new Uint8Array(getRandomValues(Buffer.alloc(32))),
      ];
    },
  });
