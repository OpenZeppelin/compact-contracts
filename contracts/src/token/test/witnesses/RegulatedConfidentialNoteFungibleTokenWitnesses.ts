// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Drives the RegulatedConfidentialNoteFungibleToken preset module (via its
// mock contract) in off-chain tests: the union of the composed modules'
// witnesses.

import { getRandomValues } from 'node:crypto';
import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';
import type { Ledger } from '../../../../artifacts/MockRegulatedConfidentialNoteFungibleToken/contract/index.js';

/** A note as the circuits see it: value + field-typed nonce. */
export type Note = { value: bigint; nonce: bigint };

export type RegulatedConfidentialNoteFungibleTokenPrivateState = {
  /** Owner spend secret; pk = Hf(sk). */
  secretKey: Uint8Array;
  /** Issuer secret (issuerPk = Hf(issuerSecret)). */
  issuerSecret: Uint8Array;
  /** Seizure authority secret (authorityPk = Hf(authoritySecret)). */
  authoritySecret: Uint8Array;
  /** Supply-key secret (supplyKey = derivePk(secret)); consumed by attestSupply. */
  supplyKeySecret: Uint8Array;
  /**
   * Audit secret scalar (auditKey = g^auditSk); consumed only by
   * `rotateAuditKey`. Defaults to 0n, which fails the rotation gate — tests
   * exercising rotation must set it.
   */
  auditKeySecret?: bigint;
  /** The input note being spent in a transfer/burn (or seize target). */
  inputNote: Note;
};

export const RegulatedConfidentialNoteFungibleTokenPrivateState = {
  generate: (): RegulatedConfidentialNoteFungibleTokenPrivateState => ({
    secretKey: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    issuerSecret: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    authoritySecret: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    supplyKeySecret: new Uint8Array(getRandomValues(Buffer.alloc(32))),
    inputNote: { value: 0n, nonce: 0n },
  }),
};

const freshSeed = (): Uint8Array =>
  new Uint8Array(getRandomValues(Buffer.alloc(32)));

export interface IRegulatedConfidentialNoteFungibleTokenWitnesses<P> {
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
  wit_AuditKeySecret(context: WitnessContext<Ledger, P>): [P, bigint];
  wit_DeliveryRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
  wit_SupplyRandomness(context: WitnessContext<Ledger, P>): [P, Uint8Array];
}

export const RegulatedConfidentialNoteFungibleTokenWitnesses =
  (): IRegulatedConfidentialNoteFungibleTokenWitnesses<RegulatedConfidentialNoteFungibleTokenPrivateState> => ({
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
    wit_AuditKeySecret(context) {
      return [context.privateState, context.privateState.auditKeySecret ?? 0n];
    },
    wit_DeliveryRandomness(context) {
      return [context.privateState, freshSeed()];
    },
    wit_SupplyRandomness(context) {
      return [context.privateState, freshSeed()];
    },
  });
