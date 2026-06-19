import {
  type BaseSimulatorOptions,
  createSimulator,
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
});

export class MockForwarderShieldedSimulator extends MockForwarderShieldedSimulatorBase {
  constructor(
    parent: ZswapCoinPublicKey,
    isInit: boolean,
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([parent, isInit], options);
  }

  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  public getParent(): Either<ZswapCoinPublicKey, ContractAddress> {
    return this.circuits.impure.getParent();
  }
}
