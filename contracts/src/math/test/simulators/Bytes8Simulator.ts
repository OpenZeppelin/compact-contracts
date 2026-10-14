import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockBytes8,
} from '../../../../artifacts/MockBytes8/contract/index.js';
import { PackPrivateState, PackWitnesses } from '../witnesses/PackWitnesses.js';

/**
 * Type constructor args
 */
type Bytes8Args = readonly [];

// Bytes8 declares no witness of its own. Its unpack path calls the Pack
// witness, so the simulator uses the Pack witnesses.
const Bytes8SimulatorBase = createSimulator<
  PackPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PackWitnesses>,
  MockBytes8<PackPrivateState>,
  Bytes8Args
>({
  contractFactory: (witnesses) => new MockBytes8<PackPrivateState>(witnesses),
  defaultPrivateState: () => PackPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PackWitnesses(),
  artifactName: 'MockBytes8',
});

/**
 * @description A simulator implementation for testing Bytes8 conversion operations.
 */
export class Bytes8Simulator extends Bytes8SimulatorBase {
  static async create(
    options: SimulatorOptions<
      PackPrivateState,
      ReturnType<typeof PackWitnesses>
    > = {},
  ): Promise<Bytes8Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<Bytes8Simulator>;
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

  public vectorToUint64(vec: bigint[]): Promise<bigint> {
    return this.circuits.impure.vectorToUint64(vec);
  }

  public bytesToUint64(bytes: Uint8Array): Promise<bigint> {
    return this.circuits.impure.bytesToUint64(bytes);
  }
}
