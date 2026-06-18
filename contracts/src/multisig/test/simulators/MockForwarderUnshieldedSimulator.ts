import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockForwarderUnshielded,
  type UserAddress,
} from '../../../../artifacts/MockForwarderUnshielded/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type MockForwarderUnshieldedArgs = readonly [
  parent: UserAddress,
  isInit: boolean,
];

const MockForwarderUnshieldedSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockForwarderUnshielded<EmptyPrivateState>,
  MockForwarderUnshieldedArgs
>({
  contractFactory: (witnesses) =>
    new MockForwarderUnshielded<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (parent, isInit) => [parent, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

export class MockForwarderUnshieldedSimulator extends MockForwarderUnshieldedSimulatorBase {
  constructor(
    parent: UserAddress,
    isInit: boolean,
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([parent, isInit], options);
  }

  public deposit(color: Uint8Array, amount: bigint) {
    return this.circuits.impure.deposit(color, amount);
  }

  public getParent(): Either<ContractAddress, UserAddress> {
    return this.circuits.impure.getParent();
  }
}
