// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/test/mocks/SchnorrJubJubSimulator.ts)

import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  Contract,
  ledger,
  type SchnorrKeyPair,
  type SchnorrSignature,
} from '@src/artifacts/crypto/test/mocks/contracts/SchnorrJubJub.mock/contract/index.js';
import type { SchnorrJubJubPrivateState } from '@src/crypto/test/mocks/witnesses/SchnorrJubJub.js';
import { SchnorrJubJubWitnesses } from '@src/crypto/test/mocks/witnesses/SchnorrJubJub.js';

/**
 * Base simulator for SchnorrJubJub mock contract
 */
const SchnorrJubJubSimulatorBase = createSimulator<
  SchnorrJubJubPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof SchnorrJubJubWitnesses>,
  Contract<SchnorrJubJubPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new Contract<SchnorrJubJubPrivateState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => SchnorrJubJubWitnesses(),
});

/**
 * @description A simulator implementation for testing Schnorr signature operations over BLS12-381.
 */
export class SchnorrJubJubSimulator extends SchnorrJubJubSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      SchnorrJubJubPrivateState,
      ReturnType<typeof SchnorrJubJubWitnesses>
    > = {},
  ) {
    super([], options);
  }

  public derivePublicKey(sk: Uint8Array): { x: bigint; y: bigint } {
    return this.circuits.impure.derivePublicKey(sk);
  }

  public generateKeyPair(sk: Uint8Array): SchnorrKeyPair {
    return this.circuits.impure.generateKeyPair(sk);
  }

  public sign(sk: Uint8Array, message: Uint8Array, nonce: Uint8Array): SchnorrSignature {
    return this.circuits.impure.sign(sk, message, nonce);
  }

  public verifySignature(
    publicKey: { x: bigint; y: bigint },
    message: Uint8Array,
    signature: SchnorrSignature,
  ): boolean {
    return this.circuits.impure.verifySignature(publicKey, message, signature);
  }

  public isValidPublicKey(publicKey: { x: bigint; y: bigint }): boolean {
    return this.circuits.impure.isValidPublicKey(publicKey);
  }
}
