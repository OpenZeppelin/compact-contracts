import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockForwarderShielded,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockForwarderShielded/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type MockForwarderShieldedArgs = readonly [
  parent: ZswapCoinPublicKey,
  isInit: boolean,
];

const MockForwarderShieldedSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockForwarderShielded<EmptyPrivateState>,
  MockForwarderShieldedArgs
>({
  contractFactory: (witnesses) =>
    new MockForwarderShielded<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (parent, isInit) => [parent, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockForwarderShielded',
});

export class MockForwarderShieldedSimulator extends MockForwarderShieldedSimulatorBase {
  static async create(
    parent: ZswapCoinPublicKey,
    isInit: boolean,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<MockForwarderShieldedSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [parent, isInit],
      options,
    ) as Promise<MockForwarderShieldedSimulator>;
  }

  public deposit(coin: ShieldedCoinInfo): Promise<[]> {
    return this.circuits.impure.deposit(coin);
  }

  public getParent(): Promise<Either<ZswapCoinPublicKey, ContractAddress>> {
    return this.circuits.impure.getParent();
  }
}
