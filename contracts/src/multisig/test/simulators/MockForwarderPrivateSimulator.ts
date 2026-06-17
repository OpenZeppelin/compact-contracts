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
} from '../../../../artifacts/MockForwarderPrivate/contract/index.js';
import {
  MockForwarderPrivatePrivateState,
  MockForwarderPrivateWitnesses,
} from '../witnesses/MockForwarderPrivateWitnesses.js';

type MockForwarderPrivateArgs = readonly [
  parentCommitment: Uint8Array,
  isInit: boolean,
];

const MockForwarderPrivateSimulatorBase = createSimulator<
  MockForwarderPrivatePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof MockForwarderPrivateWitnesses>,
  MockForwarderPrivate<MockForwarderPrivatePrivateState>,
  MockForwarderPrivateArgs
>({
  contractFactory: (witnesses) =>
    new MockForwarderPrivate<MockForwarderPrivatePrivateState>(witnesses),
  defaultPrivateState: () => MockForwarderPrivatePrivateState,
  contractArgs: (parentCommitment, isInit) => [parentCommitment, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => MockForwarderPrivateWitnesses(),
});

export class MockForwarderPrivateSimulator extends MockForwarderPrivateSimulatorBase {
  constructor(
    parentCommitment: Uint8Array,
    isInit: boolean,
    options: BaseSimulatorOptions<
      MockForwarderPrivatePrivateState,
      ReturnType<typeof MockForwarderPrivateWitnesses>
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
    parentAddr: Uint8Array,
    opSecret: Uint8Array,
    value: bigint,
  ): ShieldedSendResult {
    return this.circuits.impure.drain(coin, parentAddr, opSecret, value);
  }
}
