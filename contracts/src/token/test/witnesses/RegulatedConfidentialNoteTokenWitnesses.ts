// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the RegulatedConfidentialNoteToken preset contract in off-chain
// tests: the union of the composed modules' witnesses.

import { getRandomValues } from 'node:crypto';
import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/RegulatedConfidentialNoteToken/contract/index.js';

/** A note as the circuits see it: value + field-typed nonce. */
export type Note = { value: bigint; nonce: bigint };

export type RegulatedConfidentialNoteTokenPrivateState = {
  /** Owner spend secret; pk = Hf(sk). */
  secretKey: Uint8Array;
  /** Issuer secret (issuerPk = Hf(issuerSecret)). */
  issuerSecret: Uint8Array;
  /** Seizure authority secret (authorityPk = Hf(authoritySecret)). */
  authoritySecret: Uint8Array;
  /** Supply-key secret (supplyKey = derivePk(secret)); consumed by attestSupply. */
  supplyKeySecret: Uint8Array;
  /** The input note being spent in a transfer/burn (or seize target). */
  inputNote: Note;
};

export const RegulatedConfidentialNoteTokenPrivateState = {
  generate: (): RegulatedConfidentialNoteTokenPrivateState => ({
    secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    issuerSecret: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    authoritySecret: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    supplyKeySecret: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    inputNote: { value: 0n, nonce: 0n },
  }),
};

const freshSeed = (): Uint8Array =>
  new Uint8Array(getRandomValues(Buffer.alloc(32)));

export interface IRegulatedConfidentialNoteTokenWitnesses<P> {
  wit_SecretKey(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_IssuerSecret(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_AuthoritySecret(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_SupplyKeySecret(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_InputNote(context: WitnessContext<Ledger, P>): [P, Note];
  wit_Path(
    context: WitnessContext<Ledger, P>,
    cm: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
  wit_AuditRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_DeliveryRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_SupplyRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

export const RegulatedConfidentialNoteTokenWitnesses =
  (): IRegulatedConfidentialNoteTokenWitnesses<RegulatedConfidentialNoteTokenPrivateState> => ({
    wit_SecretKey(context) {
      return [context.privateState, context.privateState.secretKey];
    },
    wit_IssuerSecret(context) {
      return [context.privateState, context.privateState.issuerSecret];
    },
    wit_AuthoritySecret(context) {
      return [context.privateState, context.privateState.authoritySecret];
    },
    wit_SupplyKeySecret(context) {
      return [context.privateState, context.privateState.supplyKeySecret];
    },
    wit_InputNote(context) {
      return [context.privateState, context.privateState.inputNote];
    },
    // The circuit passes the input commitment; we return its Merkle path by
    // reading the live commitment tree from the ledger.
    wit_Path(context, cm) {
      const path = context.ledger._commitments.findPathForLeaf(cm);
      if (path === undefined) {
        throw new Error('wit_Path: commitment not found in tree');
      }
      return [context.privateState, path];
    },
    // All randomness seeds are fresh + secret per call, as the modules
    // require.
    wit_AuditRandomness(context) {
      return [context.privateState, freshSeed()];
    },
    wit_DeliveryRandomness(context) {
      return [context.privateState, freshSeed()];
    },
    wit_SupplyRandomness(context) {
      return [context.privateState, freshSeed()];
    },
  });
