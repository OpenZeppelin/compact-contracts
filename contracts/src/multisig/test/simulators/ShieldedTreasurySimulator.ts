import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockShieldedTreasury,
} from '../../../../artifacts/MockShieldedTreasury/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
type ShieldedSendResult = {
  change: { is_some: boolean; value: ShieldedCoinInfo };
  sent: ShieldedCoinInfo;
};

type ShieldedTreasuryArgs = readonly [];

const ShieldedTreasurySimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockShieldedTreasury<EmptyPrivateState>,
  ShieldedTreasuryArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedTreasury<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockShieldedTreasury',
});

export class ShieldedTreasurySimulator extends ShieldedTreasurySimulatorBase {
  static async create(
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<ShieldedTreasurySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<ShieldedTreasurySimulator>;
  }

  public _deposit(coin: ShieldedCoinInfo): Promise<[]> {
    return this.circuits.impure._deposit(coin);
  }

  public _send(
    recipient: {
      is_left: boolean;
      left: { bytes: Uint8Array };
      right: { bytes: Uint8Array };
    },
    color: Uint8Array,
    amount: bigint,
  ): Promise<ShieldedSendResult> {
    return this.circuits.impure._send(recipient, color, amount);
  }

  public getTokenBalance(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getTokenBalance(color);
  }

  public getReceivedTotal(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getReceivedTotal(color);
  }

  public getSentTotal(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getSentTotal(color);
  }

  public getReceivedMinusSent(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getReceivedMinusSent(color);
  }
}
