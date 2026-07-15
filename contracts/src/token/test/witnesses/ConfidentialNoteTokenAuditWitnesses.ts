// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives ConfidentialNoteTokenAudit (auditor viewing) circuits in off-chain
// tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteTokenAudit/contract/index.js';

export type ConfidentialNoteTokenAuditPrivateState = {
  /**
   * Optional fixed randomness seed. Leave undefined for the production-correct
   * behavior (a fresh secret seed per witness call); set it only in tests that
   * need deterministic ephemerals.
   */
  randomnessSeed?: Uint8Array;
};

export const ConfidentialNoteTokenAuditPrivateState = {
  generate: (): ConfidentialNoteTokenAuditPrivateState => ({}),
};

export interface IConfidentialNoteTokenAuditWitnesses<P> {
  wit_AuditRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

export const ConfidentialNoteTokenAuditWitnesses =
  (): IConfidentialNoteTokenAuditWitnesses<ConfidentialNoteTokenAuditPrivateState> => ({
    // Fresh + secret per call, as the extension requires; a fixed seed is only
    // honored when a test explicitly plants one.
    wit_AuditRandomness(context) {
      return [
        context.privateState,
        context.privateState.randomnessSeed ??
          new Uint8Array(getRandomValues(Buffer.alloc(32))),
      ];
    },
  });
