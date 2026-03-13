// SPDX-License-Identifier: MIT
// OpenZeppelin Compact Contracts v0.0.1-alpha.1 (crypto/test/mocks/PedersenSimulator.ts)

import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  Contract,
  ledger,
  type Commitment,
  type Opening,
} from '@src/artifacts/crypto/test/mocks/contracts/Pedersen.mock/contract/index.js';
import type { PedersenPrivateState } from '@src/crypto/test/mocks/witnesses/Pedersen.js';
import { PedersenWitnesses } from '@src/crypto/test/mocks/witnesses/Pedersen.js';

/**
 * Base simulator for Pedersen mock contract
 */
const PedersenSimulatorBase = createSimulator<
  PedersenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PedersenWitnesses>,
  Contract<PedersenPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) => new Contract<PedersenPrivateState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PedersenWitnesses(),
});

/**
 * @description A simulator implementation for testing Pedersen commitment operations.
 */
export class PedersenSimulator extends PedersenSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      PedersenPrivateState,
      ReturnType<typeof PedersenWitnesses>
    > = {},
  ) {
    super([], options);
  }

  public VALUE_GENERATOR(): unknown {
    return this.circuits.impure.VALUE_GENERATOR();
  }

  public commit(value: bigint, randomness: bigint): Commitment {
    return this.circuits.impure.commit(value, randomness);
  }

  public open(commitment: Commitment, value: bigint, randomness: bigint): boolean {
    return this.circuits.impure.open(commitment, value, randomness);
  }

  public verifyOpening(commitment: Commitment, opening: Opening): boolean {
    return this.circuits.impure.verifyOpening(commitment, opening);
  }

  public add(c1: Commitment, c2: Commitment): Commitment {
    return this.circuits.impure.add(c1, c2);
  }

  public sub(c1: Commitment, c2: Commitment): Commitment {
    return this.circuits.impure.sub(c1, c2);
  }

  public mockRandom(seed: bigint): bigint {
    return this.circuits.impure.mockRandom(seed);
  }

  public mockRandomFromData(data1: bigint, data2: bigint, nonce: bigint): bigint {
    return this.circuits.impure.mockRandomFromData(data1, data2, nonce);
  }

  public zero(): Commitment {
    return this.circuits.impure.zero();
  }

  public isZero(c: Commitment): boolean {
    return this.circuits.impure.isZero(c);
  }
}
