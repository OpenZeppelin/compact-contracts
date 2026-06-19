import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockForwarderPrivate,
  pureCircuits,
  type QualifiedShieldedCoinInfo,
  type ShieldedCoinInfo,
  type ShieldedSendResult,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockForwarderPrivate/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type MockForwarderPrivateArgs = readonly [
  parentCommitment: Uint8Array,
  isInit: boolean,
];

const MockForwarderPrivateSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockForwarderPrivate<EmptyPrivateState>,
  MockForwarderPrivateArgs
>({
  contractFactory: (witnesses) =>
    new MockForwarderPrivate<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (parentCommitment, isInit) => [parentCommitment, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

export class MockForwarderPrivateSimulator extends MockForwarderPrivateSimulatorBase {
  constructor(
    parentCommitment: Uint8Array,
    isInit: boolean,
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([parentCommitment, isInit], options);
  }

  public static calculateParentCommitment(
    parentAddr: Uint8Array,
    opSecret: Uint8Array,
  ): Uint8Array {
    return pureCircuits.calculateParentCommitment(parentAddr, opSecret);
  }

  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  public drain(
    coin: QualifiedShieldedCoinInfo,
    parent: ZswapCoinPublicKey,
    opSecret: Uint8Array,
    value: bigint,
  ): ShieldedSendResult {
    return this.circuits.impure.drain(coin, parent, opSecret, value);
  }

  public getParentCommitment(): Uint8Array {
    return this.circuits.impure.getParentCommitment();
  }
}
