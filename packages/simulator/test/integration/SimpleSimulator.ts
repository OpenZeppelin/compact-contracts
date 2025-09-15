import { type BaseSimulatorOptions, createSimulator } from '../../src/index';
import {
  ledger,
  Contract as SimpleContract,
} from '../fixtures/artifacts/Simple/contract/index.cjs';
import {
  SimplePrivateState,
  SimpleWitnesses,
} from '../fixtures/sampleContracts/witnesses/SimpleWitnesses';

/**
 * Base simulator
 */
const SimpleSimulatorBase = createSimulator({
  contractFactory: (witnesses) =>
    new SimpleContract<SimplePrivateState>(witnesses),
  defaultPrivateState: () => SimplePrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => SimpleWitnesses(),
});

/**
 * Simple Simulator
 */
export class SimpleSimulator extends SimpleSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      SimplePrivateState,
      ReturnType<typeof SimpleWitnesses>
    > = {},
  ) {
    super([], options);
  }

  public setVal(n: bigint) {
    this.circuits.impure.setVal(n);
  }

  public getVal(): bigint {
    return this.circuits.impure.getVal();
  }
}
