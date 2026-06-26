import {
  createSimulator,
  type SimulatorOptions,
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
  artifactName: 'MockForwarderUnshielded',
});

export class MockForwarderUnshieldedSimulator extends MockForwarderUnshieldedSimulatorBase {
  static async create(
    parent: UserAddress,
    isInit: boolean,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<MockForwarderUnshieldedSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [parent, isInit],
      options,
    ) as Promise<MockForwarderUnshieldedSimulator>;
  }

  public deposit(color: Uint8Array, amount: bigint): Promise<[]> {
    return this.circuits.impure.deposit(color, amount);
  }

  public getParent(): Promise<Either<ContractAddress, UserAddress>> {
    return this.circuits.impure.getParent();
  }
}
