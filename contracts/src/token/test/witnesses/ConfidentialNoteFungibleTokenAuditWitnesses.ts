// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives ConfidentialNoteFungibleTokenAudit (auditor viewing) circuits in off-chain
// tests.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockConfidentialNoteFungibleTokenAudit/contract/index.js';

export type ConfidentialNoteFungibleTokenAuditPrivateState = {
  /**
   * Optional fixed randomness seed. Leave undefined for the production-correct
   * behavior (a fresh secret seed per witness call); set it only in tests that
   * need deterministic ephemerals.
   */
  randomnessSeed?: Uint8Array;
  /**
   * Audit secret scalar (auditKey = g^auditSk); consumed only by
   * `_rotateAuditKey`. Defaults to 0n, which fails the rotation gate — tests
   * exercising rotation must set it.
   */
  auditKeySecret?: bigint;
};

export const ConfidentialNoteFungibleTokenAuditPrivateState = {
  generate: (): ConfidentialNoteFungibleTokenAuditPrivateState => ({}),
};

export interface IConfidentialNoteFungibleTokenAuditWitnesses<P> {
  wit_AuditRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_AuditKeySecret(context: WitnessContext<Ledger, P>): [P, bigint];
}

export const ConfidentialNoteFungibleTokenAuditWitnesses =
  (): IConfidentialNoteFungibleTokenAuditWitnesses<ConfidentialNoteFungibleTokenAuditPrivateState> => ({
    // Fresh + secret per call, as the extension requires; a fixed seed is only
    // honored when a test explicitly plants one.
    wit_AuditRandomness(context) {
      return [
        context.privateState,
        context.privateState.randomnessSeed ??
          new Uint8Array(getRandomValues(Buffer.alloc(32))),
      ];
    },
    wit_AuditKeySecret(context) {
      return [context.privateState, context.privateState.auditKeySecret ?? 0n];
    },
  });
