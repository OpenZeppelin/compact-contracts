import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockForwarder,
} from '../../../../artifacts/MockForwarder/contract/index.js';
import {
  MockForwarderPrivateState,
  MockForwarderWitnesses,
} from '../../witnesses/MockForwarderWitnesses.js';

type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };

type MockForwarderArgs = readonly [parent: Uint8Array, isInit: boolean];

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
    super([parent, isInit], options);
  }

  public depositShielded(coin: ShieldedCoinInfo) {
    return this.circuits.impure.depositShielded(coin);
  }

  public depositUnshielded(color: Uint8Array, amount: bigint) {
    return this.circuits.impure.depositUnshielded(color, amount);
  }

  public getReceived(color: Uint8Array): bigint {
    return this.circuits.impure.getReceived(color);
  }
}
