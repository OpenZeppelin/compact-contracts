// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (multisig/witnesses/ShieldedMultiSigSchnorrTreeV1Witnesses.ts)

import {
  type ISignerTreeWitnesses,
  SignerTreePrivateState,
  SignerTreeWitnesses,
} from './SignerTreeWitnesses.js';

/**
 * Private state for the Scheme D preset. The preset itself owns no
 * witnesses — it delegates to `SignerTree`'s `wit_getSignerCommitmentPath`
 * for Merkle-path lookups, and to `crypto/Schnorr` (which has no
 * witnesses) for signature verification. So this is just a re-export of
 * the SignerTree private-state shell.
 */
export type ShieldedMultiSigSchnorrTreeV1PrivateState = typeof SignerTreePrivateState;
export const ShieldedMultiSigSchnorrTreeV1PrivateState: ShieldedMultiSigSchnorrTreeV1PrivateState =
  SignerTreePrivateState;

export const ShieldedMultiSigSchnorrTreeV1Witnesses = <
  L,
>(): ISignerTreeWitnesses<L, ShieldedMultiSigSchnorrTreeV1PrivateState> =>
  SignerTreeWitnesses<L>();
