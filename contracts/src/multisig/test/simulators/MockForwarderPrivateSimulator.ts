import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  pureCircuits,
  Contract as MockForwarderPrivate,
} from '../../../../artifacts/MockForwarderPrivate/contract/index.js';
import {
  MockForwarderPrivatePrivateState,
  MockForwarderPrivateWitnesses,
} from '../../witnesses/MockForwarderPrivateWitnesses.js';

type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
type QualifiedShieldedCoinInfo = {
  nonce: Uint8Array;
  color: Uint8Array;
  value: bigint;
  mt_index: bigint;
};
type ShieldedSendResult = {
  change: { is_some: boolean; value: ShieldedCoinInfo };
  sent: ShieldedCoinInfo;
};

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
    salt: Uint8Array,
  ): Uint8Array {
    return pureCircuits.calculateParentCommitment(parentAddr, salt);
  }

  public initialize(parentCommitment: Uint8Array) {
    return this.circuits.impure.initialize(parentCommitment);
  }

  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  public drain(
    coin: QualifiedShieldedCoinInfo,
    parentAddr: Uint8Array,
    salt: Uint8Array,
    value: bigint,
  ): ShieldedSendResult {
    return this.circuits.impure.drain(coin, parentAddr, salt, value);
  }
}
