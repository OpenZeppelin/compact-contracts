import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  ledger,
  Contract as MockShieldedMultiSigV2_1To3,
  pureCircuits,
} from '../../../../../artifacts/MockShieldedMultiSigV2_1To3/contract/index.js';
import {
  EmptyPrivateState,
  emptyWitnesses,
} from '../../../test/EmptyWitnesses.js';

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
];

const ShieldedMultiSigV2_1To3SimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockShieldedMultiSigV2_1To3<EmptyPrivateState>,
  ShieldedMultiSigV2Args
>({
  contractFactory: (witnesses) =>
    new MockShieldedMultiSigV2_1To3<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments) => [
    instanceSalt,
    signerCommitments,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockShieldedMultiSigV2_1To3',
});

export class ShieldedMultiSigV2_1To3Simulator extends ShieldedMultiSigV2_1To3SimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<ShieldedMultiSigV2_1To3Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments],
      options,
    ) as Promise<ShieldedMultiSigV2_1To3Simulator>;
  }

  public static calculateSignerId(
    pk: Secp256k1Point,
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
    pubkeys: Secp256k1Point[],
    signatures: EcdsaSignature[],
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
}
