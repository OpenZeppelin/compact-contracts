import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockBytes32,
  type U256,
} from '../../../../artifacts/MockBytes32/contract/index.js';
import { PackPrivateState, PackWitnesses } from '../witnesses/PackWitnesses.js';

/**
 * Type constructor args
 */
type Bytes32Args = readonly [];

// Bytes32 declares no witness of its own. Its unpack path calls the Pack
// witness, so the simulator uses the Pack witnesses.
const Bytes32SimulatorBase = createSimulator<
  PackPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PackWitnesses>,
  MockBytes32<PackPrivateState>,
  Bytes32Args
>({
  contractFactory: (witnesses) => new MockBytes32<PackPrivateState>(witnesses),
  defaultPrivateState: () => PackPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PackWitnesses(),
  artifactName: 'MockBytes32',
});

/**
 * @description A simulator implementation for testing Bytes32 conversion operations.
 */
export class Bytes32Simulator extends Bytes32SimulatorBase {
  static async create(
    options: SimulatorOptions<
      PackPrivateState,
      ReturnType<typeof PackWitnesses>
    > = {},
  ): Promise<Bytes32Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<Bytes32Simulator>;
  }

  ////////////////////////////////////////////////////////////////
  // Conversions
  ////////////////////////////////////////////////////////////////

  public pack(vec: bigint[]): Promise<Uint8Array> {
    return this.circuits.impure.pack(vec);
  }

  public unpack(bytes: Uint8Array): Promise<bigint[]> {
    return this.circuits.impure.unpack(bytes);
  }

  public vectorToU256(vec: bigint[]): Promise<U256> {
    return this.circuits.impure.vectorToU256(vec);
  }

  public bytesToU256(bytes: Uint8Array): Promise<U256> {
    return this.circuits.impure.bytesToU256(bytes);
  }

  ////////////////////////////////////////////////////////////////
  // Comparisons
  ////////////////////////////////////////////////////////////////

  public eq(a: Uint8Array, b: Uint8Array): Promise<boolean> {
    return this.circuits.impure.eq(a, b);
  }

  public lt(a: Uint8Array, b: Uint8Array): Promise<boolean> {
    return this.circuits.impure.lt(a, b);
  }

  public lte(a: Uint8Array, b: Uint8Array): Promise<boolean> {
    return this.circuits.impure.lte(a, b);
  }

  public gt(a: Uint8Array, b: Uint8Array): Promise<boolean> {
    return this.circuits.impure.gt(a, b);
  }

  public gte(a: Uint8Array, b: Uint8Array): Promise<boolean> {
    return this.circuits.impure.gte(a, b);
  }

  ////////////////////////////////////////////////////////////////
  // Utilities
  ////////////////////////////////////////////////////////////////

  public isZero(a: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isZero(a);
  }
}
