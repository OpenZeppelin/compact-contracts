// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts (multisig/presets/witnesses.ts)
//
// Reference witness implementation for `MultisigConfidentialShieldedToken` — the
// FIRST witness surface in this preset family. The Monument proof server adapts
// this; the relayer (which proves `mintReserve`) and BitGo (which only co-signs
// `amountCommitment`) never run it.
//
// ─── INV-40 (CRITICAL): witnesses are leak-free ────────────────────────────
// Every function here returns PRIVATE material — the operator ElGamal secret
// (ek), per-customer plaintext balances, the private op amount, the
// amount-commitment blind, the encryption-randomness seed, and the reserve coin
// to burn. NONE of it may EVER be logged, persisted off the prover device, sent
// over a network, or emitted to telemetry. The proof server is LOCAL to the
// prover; witnesses never leave the device. A single `console.log(ek)` or
// `console.log(opAmount)` re-introduces the exact off-chain leak the on-chain
// encryption was designed to prevent. Keep these functions pure reads of
// `context.privateState`; do not add side effects.
//
// ─── INV-11 (single-read) ──────────────────────────────────────────────────
// A Compact `witness` is an oracle; the circuit reads each one ONCE per op and
// reuses the bound value. These implementations return from immutable
// `privateState`, so repeated calls would return the same value anyway — but do
// NOT introduce per-call mutation or counters that would make a second call
// diverge.

import type { WitnessContext } from '@midnight-ntwrk/compact-runtime';
// `Ledger` and `QualifiedShieldedCoinInfo` are emitted into the generated
// contract types by `compact compile`; the path resolves once the preset builds.
import type {
  Ledger,
  QualifiedShieldedCoinInfo,
} from './managed/MultisigConfidentialShieldedToken/contract/index.cjs';

/**
 * @description Private state held by the Monument proof server for one in-flight
 * op. Hydrated per call from Monument's secure key store and customer books.
 * NEVER serialized to logs or the network (INV-40).
 */
export type ConfidentialShieldedTokenPrivateState = {
  /** ElGamal operator secret seed (ek). Redeem + selective disclosure only. */
  readonly elGamalSecret: Uint8Array;
  /**
   * Operator's off-chain customer books: account commitment (lowercase hex,
   * no `0x`) -> plaintext balance. Unknown accounts read as `0n`, matching the
   * on-chain first-touch `Enc(0)`.
   */
  readonly balances: ReadonlyMap<string, bigint>;
  /** The private amount for the in-flight credit/redeem. */
  readonly opAmount: bigint;
  /** Fresh, high-entropy 32-byte blind opening the op's `amountCommitment` (INV-35). */
  readonly opAmountBlind: Uint8Array;
  /** Fresh 32-byte randomness seed; the circuit expands it per-encryption (INV-34). */
  readonly encryptRandomness: Uint8Array;
  /** Contract-held reserve coin to burn on redeem (INV-15/50). */
  readonly redeemCoin: QualifiedShieldedCoinInfo;
};

/**
 * @description Witness interface for `MultisigConfidentialShieldedToken`. Keys
 * match the Compact `witness` declarations exactly.
 * @template L - The ledger type.
 * @template P - The private state type.
 */
export interface IConfidentialShieldedTokenWitnesses<L, P> {
  elGamalSecret(context: WitnessContext<L, P>): [P, Uint8Array];
  accountBalancePlain(context: WitnessContext<L, P>, customer: Uint8Array): [P, bigint];
  opAmount(context: WitnessContext<L, P>): [P, bigint];
  opAmountBlind(context: WitnessContext<L, P>): [P, Uint8Array];
  encryptRandomness(context: WitnessContext<L, P>): [P, Uint8Array];
  redeemCoin(context: WitnessContext<L, P>): [P, QualifiedShieldedCoinInfo];
}

const toHex = (b: Uint8Array): string =>
  Array.from(b, (x) => x.toString(16).padStart(2, '0')).join('');

/**
 * @description Factory creating the witness implementations. Bind it to the
 * Monument proof server's per-op private state.
 *
 * @example
 * ```typescript
 * const witnesses = ConfidentialShieldedTokenWitnesses<Ledger>();
 * // privateState is hydrated per op from the operator key store + customer books.
 * ```
 */
export const ConfidentialShieldedTokenWitnesses = <
  L = Ledger,
>(): IConfidentialShieldedTokenWitnesses<
  L,
  ConfidentialShieldedTokenPrivateState
> => ({
  elGamalSecret({ privateState }: WitnessContext<L, ConfidentialShieldedTokenPrivateState>) {
    return [privateState, Uint8Array.from(privateState.elGamalSecret)];
  },

  accountBalancePlain(
    { privateState }: WitnessContext<L, ConfidentialShieldedTokenPrivateState>,
    customer: Uint8Array,
  ) {
    // 0n for an unknown account — matches the on-chain first-touch Enc(0).
    const balance = privateState.balances.get(toHex(customer)) ?? 0n;
    return [privateState, balance];
  },

  opAmount({ privateState }: WitnessContext<L, ConfidentialShieldedTokenPrivateState>) {
    return [privateState, privateState.opAmount];
  },

  opAmountBlind({ privateState }: WitnessContext<L, ConfidentialShieldedTokenPrivateState>) {
    return [privateState, Uint8Array.from(privateState.opAmountBlind)];
  },

  encryptRandomness({ privateState }: WitnessContext<L, ConfidentialShieldedTokenPrivateState>) {
    return [privateState, Uint8Array.from(privateState.encryptRandomness)];
  },

  redeemCoin({ privateState }: WitnessContext<L, ConfidentialShieldedTokenPrivateState>) {
    return [privateState, privateState.redeemCoin];
  },
});
