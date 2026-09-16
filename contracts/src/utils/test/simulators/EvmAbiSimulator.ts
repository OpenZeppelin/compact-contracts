import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockEvmAbi,
} from '../../../../artifacts/MockEvmAbi/contract/index.js';

// The EvmAbi module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type EvmAbiPrivateState = Record<string, never>;
export const EvmAbiPrivateState: EvmAbiPrivateState = {};
export const EvmAbiWitnesses = () => ({});

/**
 * Type constructor args
 */
type EvmAbiArgs = readonly [];

const EvmAbiSimulatorBase = createSimulator<
  EvmAbiPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof EvmAbiWitnesses>,
  MockEvmAbi<EvmAbiPrivateState>,
  EvmAbiArgs
>({
  contractFactory: (witnesses) => new MockEvmAbi<EvmAbiPrivateState>(witnesses),
  defaultPrivateState: () => EvmAbiPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => EvmAbiWitnesses(),
  artifactName: 'MockEvmAbi',
});

/**
 * EvmAbi Simulator
 */
export class EvmAbiSimulator extends EvmAbiSimulatorBase {
  static async create(
    options: SimulatorOptions<
      EvmAbiPrivateState,
      ReturnType<typeof EvmAbiWitnesses>
    > = {},
  ): Promise<EvmAbiSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<EvmAbiSimulator>;
  }

  /**
   * @description Encodes a `Uint<8>` as an `abi.encode(uint8)` word.
   */
  public uint8Word(value: bigint): Promise<Uint8Array> {
    return this.circuits.pure.uint8Word(value);
  }

  /**
   * @description Encodes a `Uint<64>` as an `abi.encode(uint256)` word.
   * @param value The value to encode.
   * @returns The value as a big-endian ABI word.
   */
  public uint64Word(value: bigint): Promise<Uint8Array> {
    return this.circuits.pure.uint64Word(value);
  }

  /**
   * @description Encodes a `Uint<128>` as an `abi.encode(uint256)` word.
   */
  public uint128Word(value: bigint): Promise<Uint8Array> {
    return this.circuits.pure.uint128Word(value);
  }

  /**
   * @description Encodes a `Boolean` as an `abi.encode(bool)` word.
   * @param value The value to encode.
   * @returns The value as an ABI word.
   */
  public boolWord(value: boolean): Promise<Uint8Array> {
    return this.circuits.pure.boolWord(value);
  }
}
