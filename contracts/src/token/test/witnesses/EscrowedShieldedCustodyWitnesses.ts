// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in off-chain
// tests. Not shipped as a consumable artifact.
//
// PRODUCTION SHAPE (MGBP): the issuer's backend (Monument Core, co-located
// with the prover — INV-27) implements this SAME interface against its escrow
// keystore. For a holder operation it loads the holder's key; for a SEIZE it
// loads the VICTIM's escrowed key and the victim note's path. The witness
// signatures take no account selector, so selection happens by which key the
// backend places into the private state before proving.
//
// INV-27: implementations MUST be side-effect-free on the secret path — no
// logging, telemetry, or network I/O that would re-export keys or openings.

import { getRandomValues } from 'node:crypto';
import type {
  MerkleTreePath,
  WitnessContext,
} from '@midnight-ntwrk/compact-runtime';

/**
 * @description Witness methods for EscrowedShieldedCustody. The ledger field
 * names assume the consuming contract imports the module with the prefix
 * `EscrowedShieldedCustody_` (so the trees are `EscrowedShieldedCustody__notes`
 * and `EscrowedShieldedCustody__authorizedAccounts`) — true for both
 * `MockEscrowedShieldedCustody` and `ShieldedCustodyMultiSig`.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IEscrowedShieldedCustodyWitnesses<L, P> {
  /**
   * Returns the ACTING account's secret key. For a seize the backend loads the
   * victim's escrowed key into the private state first.
   * @returns A tuple of the private state and the 32-byte secret key.
   */
  wit_secretKey(context: WitnessContext<L, P>): [P, Uint8Array];

  /**
   * Returns the Merkle path to `commitment` in the `_notes` tree (never
   * disclosed; only the root it hashes to crosses).
   * @returns A tuple of the private state and the note path.
   */
  wit_notePath(
    context: WitnessContext<L, P>,
    commitment: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];

  /**
   * Returns the Merkle path to `ownerId` in the `_authorizedAccounts` tree.
   * @returns A tuple of the private state and the auth path.
   */
  wit_authPath(
    context: WitnessContext<L, P>,
    ownerId: Uint8Array,
  ): [P, MerkleTreePath<Uint8Array>];
}

/**
 * @description Private state for an EscrowedShieldedCustody-driven contract.
 * Holds the secret key of the account the current proof acts for. The bank
 * backend swaps this per operation (holder key for holder ops, victim key for
 * seize); `keystore` is an optional convenience for tests that drive many
 * accounts from one process.
 */
export type EscrowedShieldedCustodyPrivateState = {
  /** @description The 32-byte secret key of the currently-acting account. */
  secretKey: Uint8Array;
  /**
   * @description Optional test escrow: ownerId-hex -> secret key. Lets a test
   * select the acting (or victim) account via `forAccount`.
   */
  keystore?: Record<string, Uint8Array>;
};

const DEPTH = 20;

const defaultPath = (): MerkleTreePath<Uint8Array> => ({
  leaf: new Uint8Array(32),
  path: Array.from({ length: DEPTH }, () => ({
    sibling: { field: 0n },
    goes_left: false,
  })),
});

/**
 * @description Utilities for building and reshaping the private state.
 */
export const EscrowedShieldedCustodyPrivateState = {
  /**
   * @description Fresh private state with a cryptographically random key.
   */
  generate: (): EscrowedShieldedCustodyPrivateState => ({
    secretKey: new Uint8Array(getRandomValues(new Uint8Array(32))),
  }),

  /**
   * @description Private state with a caller-supplied 32-byte key.
   */
  withSecretKey: (sk: Uint8Array): EscrowedShieldedCustodyPrivateState => {
    if (sk.length !== 32) {
      throw new Error(
        `withSecretKey: expected 32-byte secret key, received ${sk.length} bytes`,
      );
    }
    return { secretKey: Uint8Array.from(sk) };
  },

  /**
   * @description Returns a copy of `state` whose active `secretKey` is the
   * key registered for `ownerIdHex` in the keystore — the seize selection step.
   * Throws if no such key is escrowed (mirrors the backend's guarantee that it
   * only seizes accounts it custodies).
   */
  forAccount: (
    state: EscrowedShieldedCustodyPrivateState,
    ownerIdHex: string,
  ): EscrowedShieldedCustodyPrivateState => {
    const sk = state.keystore?.[ownerIdHex];
    if (!sk) {
      throw new Error(`forAccount: no escrowed key for ownerId ${ownerIdHex}`);
    }
    return { ...state, secretKey: Uint8Array.from(sk) };
  },

  /**
   * @description Looks up a leaf's Merkle path in a named ledger tree, or
   * returns a default (invalid) depth-20 path so the circuit's `path.leaf ==
   * commitment` / `checkRoot` asserts drive the failure case deterministically.
   */
  pathForLeaf: <L>(
    ledger: L,
    tree:
      | 'EscrowedShieldedCustody__notes'
      | 'EscrowedShieldedCustody__authorizedAccounts',
    leaf: Uint8Array,
  ): MerkleTreePath<Uint8Array> => {
    // cast to any to avoid type gymnastics over the generated ledger shape
    const path = (ledger as any)[tree]?.findPathForLeaf(leaf);
    return path ? path : defaultPath();
  },
};

/**
 * @description Factory creating the witness implementations.
 */
export const EscrowedShieldedCustodyWitnesses = <
  L,
>(): IEscrowedShieldedCustodyWitnesses<
  L,
  EscrowedShieldedCustodyPrivateState
> => ({
  wit_secretKey(
    context: WitnessContext<L, EscrowedShieldedCustodyPrivateState>,
  ): [EscrowedShieldedCustodyPrivateState, Uint8Array] {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.secretKey),
    ];
  },

  wit_notePath(
    context: WitnessContext<L, EscrowedShieldedCustodyPrivateState>,
    commitment: Uint8Array,
  ): [EscrowedShieldedCustodyPrivateState, MerkleTreePath<Uint8Array>] {
    return [
      context.privateState,
      EscrowedShieldedCustodyPrivateState.pathForLeaf<L>(
        context.ledger,
        'EscrowedShieldedCustody__notes',
        commitment,
      ),
    ];
  },

  wit_authPath(
    context: WitnessContext<L, EscrowedShieldedCustodyPrivateState>,
    ownerId: Uint8Array,
  ): [EscrowedShieldedCustodyPrivateState, MerkleTreePath<Uint8Array>] {
    return [
      context.privateState,
      EscrowedShieldedCustodyPrivateState.pathForLeaf<L>(
        context.ledger,
        'EscrowedShieldedCustody__authorizedAccounts',
        ownerId,
      ),
    ];
  },
});
