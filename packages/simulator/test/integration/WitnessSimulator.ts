import { type BaseSimulatorOptions, createSimulator } from '../../src/index';
import {
  WitnessPrivateState,
  WitnessWitnesses,
} from '../fixtures/sample-contracts/witnesses/WitnessWitnesses';
import {
  ledger,
  Contract as SampleZOwnable,
} from '../fixtures/test-artifacts/Witness/contract/index.cjs';

/**
 * Type constructor args
 */
type WitnessArgs = readonly [];

/**
 * Base simulator
 */
const WitnessSimulatorBase = createSimulator<
  WitnessPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof WitnessWitnesses>,
  WitnessArgs
>({
  contractFactory: (witnesses) =>
    new SampleZOwnable<WitnessPrivateState>(witnesses),
  defaultPrivateState: () => WitnessPrivateState.generate(),
  contractArgs: () => {
    return [];
  },
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => WitnessWitnesses(),
});

/**
 * SampleZOwnable Simulator
 */
export class WitnessSimulator extends WitnessSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      WitnessPrivateState,
      ReturnType<typeof WitnessWitnesses>
    > = {},
  ) {
    super([], options);
  }

  public setBytes() {
    this.circuits.impure.setBytes();
  }

  public setField(arg: bigint) {
    this.circuits.impure.setField(arg);
  }

  public setUint(arg1: bigint, arg2: bigint) {
    this.circuits.impure.setUint(arg1, arg2);
  }

  public readonly privateState = {
    injectSecretBytes: (
      newBytes: Buffer<ArrayBufferLike>,
    ): WitnessPrivateState => {
      const currentState =
        this.circuitContextManager.getContext().currentPrivateState;
      const updatedState = { ...currentState, secretBytes: newBytes };
      this.circuitContextManager.updatePrivateState(updatedState);
      return updatedState;
    },
    injectSecretField: (newField: bigint): WitnessPrivateState => {
      const currentState =
        this.circuitContextManager.getContext().currentPrivateState;
      const updatedState = { ...currentState, secretField: newField };
      this.circuitContextManager.updatePrivateState(updatedState);
      return updatedState;
    },
    injectSecretUint: (newUint: bigint): WitnessPrivateState => {
      const currentState =
        this.circuitContextManager.getContext().currentPrivateState;
      const updatedState = { ...currentState, secretUint: newUint };
      this.circuitContextManager.updatePrivateState(updatedState);
      return updatedState;
    },
  };
}
