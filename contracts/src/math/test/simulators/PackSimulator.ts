import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockPack,
} from '../../../../artifacts/MockPack/contract/index.js';
import { PackPrivateState, PackWitnesses } from '../witnesses/PackWitnesses.js';

/**
 * Type constructor args
 */
type PackArgs = readonly [];

const PackSimulatorBase = createSimulator<
  PackPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof PackWitnesses>,
  MockPack<PackPrivateState>,
  PackArgs
>({
  contractFactory: (witnesses) => new MockPack<PackPrivateState>(witnesses),
  defaultPrivateState: () => PackPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => PackWitnesses(),
  artifactName: 'MockPack',
});

/**
 * @description A simulator implementation for testing Pack conversion operations (N=8, 16, 32).
 */
export class PackSimulator extends PackSimulatorBase {
  static async create(
    options: SimulatorOptions<
      PackPrivateState,
      ReturnType<typeof PackWitnesses>
    > = {},
  ): Promise<PackSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<PackSimulator>;
  }

  /** Packs Vector<8, Uint<8>> into Bytes<8>. */
  public pack8(vec: bigint[]): Promise<Uint8Array> {
    return this.circuits.impure.pack8(vec);
  }

  /** Unpacks Bytes<8> into Vector<8, Uint<8>>. */
  public unpack8(bytes: Uint8Array): Promise<bigint[]> {
    return this.circuits.impure.unpack8(bytes);
  }

  /** Packs Vector<16, Uint<8>> into Bytes<16>. */
  public pack16(vec: bigint[]): Promise<Uint8Array> {
    return this.circuits.impure.pack16(vec);
  }

  /** Unpacks Bytes<16> into Vector<16, Uint<8>>. */
  public unpack16(bytes: Uint8Array): Promise<bigint[]> {
    return this.circuits.impure.unpack16(bytes);
  }

  /** Packs Vector<32, Uint<8>> into Bytes<32>. */
  public pack32(vec: bigint[]): Promise<Uint8Array> {
    return this.circuits.impure.pack32(vec);
  }

  /** Unpacks Bytes<32> into Vector<32, Uint<8>>. */
  public unpack32(bytes: Uint8Array): Promise<bigint[]> {
    return this.circuits.impure.unpack32(bytes);
  }
}
