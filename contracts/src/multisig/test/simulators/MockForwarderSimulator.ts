import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockForwarder,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../artifacts/MockForwarder/contract/index.js';
import {
  MockForwarderPrivateState,
  MockForwarderWitnesses,
} from '../../witnesses/MockForwarderWitnesses.js';

type MockForwarderArgs = readonly [parent: ZswapCoinPublicKey, isInit: boolean];

const MockForwarderSimulatorBase = createSimulator<
  MockForwarderPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof MockForwarderWitnesses>,
  MockForwarder<MockForwarderPrivateState>,
  MockForwarderArgs
>({
  contractFactory: (witnesses) =>
    new MockForwarder<MockForwarderPrivateState>(witnesses),
  defaultPrivateState: () => MockForwarderPrivateState,
  contractArgs: (parent, isInit) => [parent, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => MockForwarderWitnesses(),
});

export class MockForwarderSimulator extends MockForwarderSimulatorBase {
  constructor(
    parent: Uint8Array,
    isInit: boolean,
    options: BaseSimulatorOptions<
      MockForwarderPrivateState,
      ReturnType<typeof MockForwarderWitnesses>
    > = {},
  ) {
    super([{ bytes: parent }, isInit], options);
  }

  public depositShielded(coin: ShieldedCoinInfo) {
    return this.circuits.impure.depositShielded(coin);
  }

  public depositUnshielded(color: Uint8Array, amount: bigint) {
    return this.circuits.impure.depositUnshielded(color, amount);
  }
}
