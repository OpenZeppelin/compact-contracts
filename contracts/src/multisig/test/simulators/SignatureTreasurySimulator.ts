import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  pureCircuits,
  Contract as MockSignatureTreasury,
} from '../../../../artifacts/MockSignatureTreasury/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

type Recipient = { kind: number; address: Uint8Array };
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

type SignatureTreasuryArgs = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  thresh: bigint,
];

const SignatureTreasurySimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockSignatureTreasury<EmptyPrivateState>,
  SignatureTreasuryArgs
>({
  contractFactory: (witnesses) =>
    new MockSignatureTreasury<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments, thresh) => [
    instanceSalt,
    signerCommitments,
    thresh,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
});

export class SignatureTreasurySimulator extends SignatureTreasurySimulatorBase {
  constructor(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    thresh: bigint,
    options: BaseSimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ) {
    super([instanceSalt, signerCommitments, thresh], options);
  }

  public static calculateSignerId(
    pk: Uint8Array,
    salt: Uint8Array,
  ): Uint8Array {
    return pureCircuits._calculateSignerId(pk, salt);
  }

  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  public execute(
    to: Recipient,
    amount: bigint,
    coin: QualifiedShieldedCoinInfo,
    pubkeys: Uint8Array[],
    signatures: Uint8Array[],
  ): ShieldedSendResult {
    return this.circuits.impure.execute(to, amount, coin, pubkeys, signatures);
  }

  public getNonce(): bigint {
    return this.circuits.impure.getNonce();
  }

  public getSignerCount(): bigint {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): bigint {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(commitment: Uint8Array): boolean {
    return this.circuits.impure.isSigner(commitment);
  }
}
