// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/test/mocks/witnesses/Pedersen.ts)

import type { Witnesses } from '@src/artifacts/crypto/test/mocks/contracts/Pedersen.mock/contract/index.js';

export type PedersenPrivateState = Record<string, never>;

export const PedersenWitnesses = (): Witnesses<PedersenPrivateState> => ({});
