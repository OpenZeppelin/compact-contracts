import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Ledger,
  ledger,
  pureCircuits,
  Contract as ShieldedStatelessMultisig,
} from '../../../../artifacts/ShieldedStatelessMultisig/contract/index.js';
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

type ShieldedStatelessMultisigArgs = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  thresh: bigint,
];

const ShieldedStatelessMultisigSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  ShieldedStatelessMultisig<EmptyPrivateState>,
  ShieldedStatelessMultisigArgs
>({
  contractFactory: (witnesses) =>
    new ShieldedStatelessMultisig<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments, thresh) => [
    instanceSalt,
    signerCommitments,
    thresh,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'ShieldedStatelessMultisig',
});

export class ShieldedStatelessMultisigSimulator extends ShieldedStatelessMultisigSimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    thresh: bigint,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<ShieldedStatelessMultisigSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments, thresh],
      options,
    ) as Promise<ShieldedStatelessMultisigSimulator>;
  }

  public static calculateSignerId(
    pk: Uint8Array,
    salt: Uint8Array,
  ): Uint8Array {
    return pureCircuits._calculateSignerId(pk, salt);
  }

  public deposit(coin: ShieldedCoinInfo): Promise<[]> {
    return this.circuits.impure.deposit(coin);
  }

  public execute(
    to: Recipient,
    amount: bigint,
    coin: QualifiedShieldedCoinInfo,
    pubkeys: Uint8Array[],
    signatures: Uint8Array[],
  ): Promise<ShieldedSendResult> {
    return this.circuits.impure.execute(to, amount, coin, pubkeys, signatures);
  }

  public getNonce(): Promise<bigint> {
    return this.circuits.impure.getNonce();
  }

  public getSignerCount(): Promise<bigint> {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(commitment: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isSigner(commitment);
  }

  public getLedger(): Promise<Ledger> {
    return this.getPublicState();
  }
}
