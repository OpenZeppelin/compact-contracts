import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockShieldedTreasuryStateless,
} from '../../../../artifacts/MockShieldedTreasuryStateless/contract/index.js';
import {
  ShieldedTreasuryPrivateState,
  ShieldedTreasuryWitnesses,
} from '../witnesses/ShieldedTreasuryWitnesses.js';

type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
type QualifiedShieldedCoinInfo = ShieldedCoinInfo & { mt_index: bigint };
type ShieldedSendResult = {
  change: { is_some: boolean; value: ShieldedCoinInfo };
  sent: ShieldedCoinInfo;
};

type ShieldedTreasuryStatelessArgs = readonly [];

const MockShieldedTreasuryStatelessSimulatorBase = createSimulator<
  ShieldedTreasuryPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedTreasuryWitnesses>,
  MockShieldedTreasuryStateless<ShieldedTreasuryPrivateState>,
  ShieldedTreasuryStatelessArgs
>({
  contractFactory: (witnesses) =>
    new MockShieldedTreasuryStateless<ShieldedTreasuryPrivateState>(witnesses),
  defaultPrivateState: () => ShieldedTreasuryPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedTreasuryWitnesses(),
  artifactName: 'MockShieldedTreasuryStateless',
});

export class MockShieldedTreasuryStatelessSimulator extends MockShieldedTreasuryStatelessSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ShieldedTreasuryPrivateState,
      ReturnType<typeof ShieldedTreasuryWitnesses>
    > = {},
  ): Promise<MockShieldedTreasuryStatelessSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<MockShieldedTreasuryStatelessSimulator>;
  }

  public _deposit(coin: ShieldedCoinInfo): Promise<[]> {
    return this.circuits.impure._deposit(coin);
  }

  public _send(
    coin: QualifiedShieldedCoinInfo,
    recipient: {
      is_left: boolean;
      left: { bytes: Uint8Array };
      right: { bytes: Uint8Array };
    },
    amount: bigint,
  ): Promise<ShieldedSendResult> {
    return this.circuits.impure._send(coin, recipient, amount);
  }

  public _sendAndRouteChange(
    coin: QualifiedShieldedCoinInfo,
    recipient: {
      is_left: boolean;
      left: { bytes: Uint8Array };
      right: { bytes: Uint8Array };
    },
    amount: bigint,
    changeRecipient: {
      is_left: boolean;
      left: { bytes: Uint8Array };
      right: { bytes: Uint8Array };
    },
  ): Promise<ShieldedSendResult> {
    return this.circuits.impure._sendAndRouteChange(
      coin,
      recipient,
      amount,
      changeRecipient,
    );
  }
}
