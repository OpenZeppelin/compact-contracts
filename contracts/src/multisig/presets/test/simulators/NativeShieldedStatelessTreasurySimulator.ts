import type { Secp256k1Point } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import type { EcdsaSignature } from '#test-utils/fixtures/ecdsa.js';
import {
  type Ledger,
  ledger,
  Contract as MockNativeShieldedStatelessTreasury,
  pureCircuits,
} from '../../../../../artifacts/MockNativeShieldedStatelessTreasury/contract/index.js';
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

type NativeShieldedStatelessTreasuryArgs = readonly [
  instanceSalt: Uint8Array,
  signerCommitments: Uint8Array[],
  thresh: bigint,
  isInit: boolean,
];

const NativeShieldedStatelessTreasurySimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  MockNativeShieldedStatelessTreasury<EmptyPrivateState>,
  NativeShieldedStatelessTreasuryArgs
>({
  contractFactory: (witnesses) =>
    new MockNativeShieldedStatelessTreasury<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (instanceSalt, signerCommitments, thresh, isInit) => [
    instanceSalt,
    signerCommitments,
    thresh,
    isInit,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'MockNativeShieldedStatelessTreasury',
});

export class NativeShieldedStatelessTreasurySimulator extends NativeShieldedStatelessTreasurySimulatorBase {
  static async create(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    thresh: bigint,
    isInit: boolean,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<NativeShieldedStatelessTreasurySimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [instanceSalt, signerCommitments, thresh, isInit],
      options,
    ) as Promise<NativeShieldedStatelessTreasurySimulator>;
  }

  public initialize(
    instanceSalt: Uint8Array,
    signerCommitments: Uint8Array[],
    thresh: bigint,
  ): Promise<[]> {
    return this.circuits.impure.initialize(
      instanceSalt,
      signerCommitments,
      thresh,
    );
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

  public isSigner(commitment: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isSigner(commitment);
  }

  public getLedger(): Promise<Ledger> {
    return this.getPublicState();
  }
}
