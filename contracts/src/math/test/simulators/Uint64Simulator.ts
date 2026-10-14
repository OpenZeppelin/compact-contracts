import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type DivResultU64,
  ledger,
  Contract as MockUint64,
} from '../../../../artifacts/MockUint64/contract/index.js';
import {
  Uint64PrivateState,
  Uint64Witnesses,
} from '../witnesses/Uint64Witnesses.js';

/**
 * Type constructor args
 */
type Uint64Args = readonly [];

const Uint64SimulatorBase = createSimulator<
  Uint64PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof Uint64Witnesses>,
  MockUint64<Uint64PrivateState>,
  Uint64Args
>({
  contractFactory: (witnesses) => new MockUint64<Uint64PrivateState>(witnesses),
  defaultPrivateState: () => Uint64PrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => Uint64Witnesses(),
  artifactName: 'MockUint64',
});

/**
 * @description A simulator implementation for testing Uint64 math operations.
 */
export class Uint64Simulator extends Uint64SimulatorBase {
  static async create(
    options: SimulatorOptions<
      Uint64PrivateState,
      ReturnType<typeof Uint64Witnesses>
    > = {},
  ): Promise<Uint64Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<Uint64Simulator>;
  }

  ////////////////////////////////////////////////////////////////
  // Constants
  ////////////////////////////////////////////////////////////////

  public MAX_UINT8(): Promise<bigint> {
    return this.circuits.impure.MAX_UINT8();
  }

  public MAX_UINT16(): Promise<bigint> {
    return this.circuits.impure.MAX_UINT16();
  }

  public MAX_UINT32(): Promise<bigint> {
    return this.circuits.impure.MAX_UINT32();
  }

  public MAX_UINT64(): Promise<bigint> {
    return this.circuits.impure.MAX_UINT64();
  }

  ////////////////////////////////////////////////////////////////
  // Conversions
  ////////////////////////////////////////////////////////////////

  public toBytes(value: bigint): Promise<Uint8Array> {
    return this.circuits.impure.toBytes(value);
  }

  public toUnpackedBytes(value: bigint): Promise<bigint[]> {
    return this.circuits.impure.toUnpackedBytes(value);
  }

  ////////////////////////////////////////////////////////////////
  // Arithmetic
  ////////////////////////////////////////////////////////////////

  public add(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.add(a, b);
  }

  public addChecked(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.addChecked(a, b);
  }

  public sub(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.sub(a, b);
  }

  public mul(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.mul(a, b);
  }

  public mulChecked(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.mulChecked(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // Division
  ////////////////////////////////////////////////////////////////

  public div(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.div(a, b);
  }

  public rem(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.rem(a, b);
  }

  public divRem(a: bigint, b: bigint): Promise<DivResultU64> {
    return this.circuits.impure.divRem(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // Square Root
  ////////////////////////////////////////////////////////////////

  public sqrt(radical: bigint): Promise<bigint> {
    return this.circuits.impure.sqrt(radical);
  }

  ////////////////////////////////////////////////////////////////
  // Utilities
  ////////////////////////////////////////////////////////////////

  public isMultiple(a: bigint, b: bigint): Promise<boolean> {
    return this.circuits.impure.isMultiple(a, b);
  }

  public min(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.min(a, b);
  }

  public max(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.max(a, b);
  }
}
