import type {
  DivResultU64,
  Witnesses,
} from '@artifacts/Uint64.mock/contract/index.js';
import { Contract, ledger } from '@artifacts/Uint64.mock/contract/index.js';
import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import { wit_divUint64 } from '@src/math/witnesses/wit_divUint64.js';
import { wit_sqrtUint64 } from '@src/math/witnesses/wit_sqrtUint64.js';
import { wit_uint64ToUnpackedBytes } from '@src/math/witnesses/wit_uint64ToUnpackedBytes.js';

export type Uint64PrivateState = Record<string, never>;

export const Uint64Witnesses = (): Witnesses<Uint64PrivateState> => ({
  wit_sqrtUint64(_context, radicand) {
    return [{}, wit_sqrtUint64(radicand)];
  },

  wit_divUint64(_context, dividend, divisor) {
    return [{}, wit_divUint64(dividend, divisor)];
  },

  wit_uint64ToUnpackedBytes(_context, value) {
    return [{}, wit_uint64ToUnpackedBytes(value)];
  },
});

/**
 * Base simulator for Uint64 mock contract
 */
const Uint64SimulatorBase = createSimulator<
  Uint64PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof Uint64Witnesses>,
  Contract<Uint64PrivateState>,
  readonly []
>({
  contractFactory: (witnesses) => new Contract<Uint64PrivateState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => Uint64Witnesses(),
});

/**
 * @description A simulator implementation for testing Uint64 math operations.
 */
export class Uint64Simulator extends Uint64SimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      Uint64PrivateState,
      ReturnType<typeof Uint64Witnesses>
    > = {},
  ) {
    super([], options);
  }

  ////////////////////////////////////////////////////////////////
  // Constants
  ////////////////////////////////////////////////////////////////

  public MAX_UINT8(): bigint {
    return this.circuits.impure.MAX_UINT8();
  }

  public MAX_UINT16(): bigint {
    return this.circuits.impure.MAX_UINT16();
  }

  public MAX_UINT32(): bigint {
    return this.circuits.impure.MAX_UINT32();
  }

  public MAX_UINT64(): bigint {
    return this.circuits.impure.MAX_UINT64();
  }

  ////////////////////////////////////////////////////////////////
  // Conversions
  ////////////////////////////////////////////////////////////////

  public toBytes(value: bigint): Uint8Array {
    return this.circuits.impure.toBytes(value);
  }

  public toUnpackedBytes(
    value: bigint,
  ): [bigint, bigint, bigint, bigint, bigint, bigint, bigint, bigint] {
    return this.circuits.impure.toUnpackedBytes(value) as [
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
      bigint,
    ];
  }

  ////////////////////////////////////////////////////////////////
  // Arithmetic
  ////////////////////////////////////////////////////////////////

  public add(a: bigint, b: bigint): bigint {
    return this.circuits.impure.add(a, b);
  }

  public addChecked(a: bigint, b: bigint): bigint {
    return this.circuits.impure.addChecked(a, b);
  }

  public sub(a: bigint, b: bigint): bigint {
    return this.circuits.impure.sub(a, b);
  }

  public mul(a: bigint, b: bigint): bigint {
    return this.circuits.impure.mul(a, b);
  }

  public mulChecked(a: bigint, b: bigint): bigint {
    return this.circuits.impure.mulChecked(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // Division
  ////////////////////////////////////////////////////////////////

  public div(a: bigint, b: bigint): bigint {
    return this.circuits.impure.div(a, b);
  }

  public rem(a: bigint, b: bigint): bigint {
    return this.circuits.impure.rem(a, b);
  }

  public divRem(a: bigint, b: bigint): DivResultU64 {
    return this.circuits.impure.divRem(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // Square Root
  ////////////////////////////////////////////////////////////////

  public sqrt(radical: bigint): bigint {
    return this.circuits.impure.sqrt(radical);
  }

  ////////////////////////////////////////////////////////////////
  // Utilities
  ////////////////////////////////////////////////////////////////

  public isMultiple(a: bigint, b: bigint): boolean {
    return this.circuits.impure.isMultiple(a, b);
  }

  public min(a: bigint, b: bigint): bigint {
    return this.circuits.impure.min(a, b);
  }

  public max(a: bigint, b: bigint): bigint {
    return this.circuits.impure.max(a, b);
  }
}
