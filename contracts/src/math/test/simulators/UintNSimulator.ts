import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockUintN,
} from '../../../../artifacts/MockUintN/contract/index.js';

// The UintN module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type UintNPrivateState = Record<string, never>;
export const UintNPrivateState: UintNPrivateState = {};
export const UintNWitnesses = () => ({});

/**
 * Type constructor args
 */
type UintNArgs = readonly [];

const UintNSimulatorBase = createSimulator<
  UintNPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof UintNWitnesses>,
  MockUintN<UintNPrivateState>,
  UintNArgs
>({
  contractFactory: (witnesses) => new MockUintN<UintNPrivateState>(witnesses),
  defaultPrivateState: () => UintNPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => UintNWitnesses(),
  artifactName: 'MockUintN',
});

/**
 * @description A simulator implementation for testing UintN wrapping
 * arithmetic (N = 8, 64, 248).
 *
 * Each method calls the mock's impure wrapper, the circuit a live run proves.
 * The pure re-exports (`U8_wrappingAdd`, ...) are called through the
 * artifact's `pureCircuits`.
 */
export class UintNSimulator extends UintNSimulatorBase {
  static async create(
    options: SimulatorOptions<
      UintNPrivateState,
      ReturnType<typeof UintNWitnesses>
    > = {},
  ): Promise<UintNSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<UintNSimulator>;
  }

  ////////////////////////////////////////////////////////////////
  // N = 8
  ////////////////////////////////////////////////////////////////

  public MODULUS8(): Promise<bigint> {
    return this.circuits.impure.MODULUS8();
  }

  public wrappingAdd8(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.wrappingAdd8(a, b);
  }

  public wrappingSub8(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.wrappingSub8(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // N = 64
  ////////////////////////////////////////////////////////////////

  public MODULUS64(): Promise<bigint> {
    return this.circuits.impure.MODULUS64();
  }

  public wrappingAdd64(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.wrappingAdd64(a, b);
  }

  public wrappingSub64(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.wrappingSub64(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // N = 248
  ////////////////////////////////////////////////////////////////

  public MODULUS248(): Promise<bigint> {
    return this.circuits.impure.MODULUS248();
  }

  public wrappingAdd248(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.wrappingAdd248(a, b);
  }

  public wrappingSub248(a: bigint, b: bigint): Promise<bigint> {
    return this.circuits.impure.wrappingSub248(a, b);
  }
}
