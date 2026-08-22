// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

import { getRandomValues } from 'node:crypto';
import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';

/**
 * The one identity witness for the account-based modules.
 *
 * Replaces `wit_OwnableSK`, `wit_AccessControlSK`, `wit_FungibleTokenSK`,
 * `wit_NonFungibleTokenSK`, `wit_MultiTokenSK`, `wit_ConfidentialTokenSK` and
 * `ShieldedAccessControl`'s `wit_secretKey`. A composed contract could answer those
 * seven inconsistently. `access/Caller` now holds the only caller secret in that
 * set, so you implement one witness and a transaction carries one identity.
 *
 * Two witnesses stay elsewhere. `ZOwnablePK` keeps `wit_secretNonce`, a blinding
 * factor over a runtime-supplied public key, so a spec driving it wires that witness
 * too. `ConfidentialFungibleToken` keeps its three encryption witnesses, which carry
 * no identity. The `Caller` module header explains both.
 */

/**
 * @description Interface defining the witness methods for caller authentication.
 * @template P - The private state type.
 */
export interface ICallerWitnesses<L, P> {
  /**
   * Retrieves the secret key from the private state.
   * @param context - The witness context containing the private state.
   * @returns A tuple of the private state and the secret key as a Uint8Array.
   */
  wit_CallerSK(context: WitnessContext<L, P>): [P, Uint8Array];
}

/**
 * @description The private state backing caller authentication: one secret key.
 */
export type CallerPrivateState = {
  /** @description A 32-byte secret key the caller's principal is derived from. */
  secretKey: Uint8Array;
};

/**
 * @description Utility object for managing caller private state.
 */
export const CallerPrivateState = {
  /**
   * @description Generates a new private state with a random secret key.
   * @returns A fresh CallerPrivateState instance.
   */
  generate: (): CallerPrivateState => {
    return { secretKey: getRandomValues(new Uint8Array(32)) };
  },

  /**
   * @description Generates a new private state with a user-defined secret key.
   * Useful for deterministic key generation or advanced use cases.
   *
   * @param sk - The 32-byte secret key to use.
   * @returns A fresh CallerPrivateState instance with the provided key.
   *
   * @example
   * ```typescript
   * // For deterministic keys (user-defined scheme)
   * const deterministicKey = myDeterministicScheme(...);
   * const privateState = CallerPrivateState.withSecretKey(deterministicKey);
   * ```
   */
  withSecretKey: (sk: Uint8Array): CallerPrivateState => {
    if (sk.length !== 32) {
      throw new Error(
        `withSecretKey: expected 32-byte secret key, received ${sk.length} bytes`,
      );
    }
    return { secretKey: Uint8Array.from(sk) };
  },
};

/**
 * @description Factory function creating the caller witness implementation.
 * @returns An object implementing the Witnesses interface for CallerPrivateState.
 */
export const CallerWitnesses = <L>(): ICallerWitnesses<
  L,
  CallerPrivateState
> => ({
  wit_CallerSK(
    context: WitnessContext<L, CallerPrivateState>,
  ): [CallerPrivateState, Uint8Array] {
    return [
      context.privateState,
      Uint8Array.from(context.privateState.secretKey),
    ];
  },
});
