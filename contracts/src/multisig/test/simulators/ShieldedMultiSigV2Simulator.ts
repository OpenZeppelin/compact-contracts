import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Ledger,
  ledger,
  pureCircuits,
  Contract as ShieldedMultiSigV2,
} from '../../../../artifacts/ShieldedMultiSigV2/contract/index.js';
import {
  ShieldedMultiSigV2PrivateState,
  ShieldedMultiSigV2Witnesses,
} from '../witnesses/ShieldedMultiSigV2Witnesses.js';

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

type ShieldedMultiSigV2Args = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  thresh: bigint,
];

const ShieldedMultiSigV2SimulatorBase = createSimulator<
  ShieldedMultiSigV2PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedMultiSigV2Witnesses>,
  ShieldedMultiSigV2<ShieldedMultiSigV2PrivateState>,
  ShieldedMultiSigV2Args
>({
  contractFactory: (witnesses) =>
    new ShieldedMultiSigV2<ShieldedMultiSigV2PrivateState>(witnesses),
  defaultPrivateState: () => ShieldedMultiSigV2PrivateState,
  contractArgs: (instanceSalt, signerCommitments, thresh) => [
    instanceSalt,
    signerCommitments,
    thresh,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedMultiSigV2Witnesses(),
  artifactName: 'ShieldedMultiSigV2',
});

export class ShieldedMultiSigV2Simulator extends ShieldedMultiSigV2SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    thresh: bigint,
    options: SimulatorOptions<
      ShieldedMultiSigV2PrivateState,
      ReturnType<typeof ShieldedMultiSigV2Witnesses>
    > = {},
  ): Promise<ShieldedMultiSigV2Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments, thresh],
      options,
    ) as Promise<ShieldedMultiSigV2Simulator>;
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
