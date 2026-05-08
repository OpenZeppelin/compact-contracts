import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  type ApprovedSig,
  type Ledger,
  ledger,
  Contract as ShieldedMultiSigSchnorrV1,
} from '../../../../artifacts/ShieldedMultiSigSchnorrV1/contract/index.js';
import {
  ShieldedMultiSigSchnorrV1PrivateState,
  ShieldedMultiSigSchnorrV1Witnesses,
} from '../../witnesses/ShieldedMultiSigSchnorrV1Witnesses.js';

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

type ShieldedMultiSigSchnorrV1Args = readonly [
  signerPubkeys: JubjubPoint[],
  thresh: bigint,
];

const SimulatorBase: any = createSimulator<
  ShieldedMultiSigSchnorrV1PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedMultiSigSchnorrV1Witnesses>,
  ShieldedMultiSigSchnorrV1<ShieldedMultiSigSchnorrV1PrivateState>,
  ShieldedMultiSigSchnorrV1Args
>({
  contractFactory: (witnesses) =>
    new ShieldedMultiSigSchnorrV1<ShieldedMultiSigSchnorrV1PrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ShieldedMultiSigSchnorrV1PrivateState,
  contractArgs: (signerPubkeys, thresh) => [signerPubkeys, thresh],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedMultiSigSchnorrV1Witnesses(),
});

/**
 * Drives the ShieldedMultiSigSchnorrV1 preset through the in-process simulator
 * for unit-level tests. The treasury step is reached only on the auth-success
 * happy path; failure tests assert before the treasury runs.
 */
export class ShieldedMultiSigSchnorrV1Simulator extends SimulatorBase {
  constructor(
    signerPubkeys: JubjubPoint[],
    thresh: bigint,
    options: BaseSimulatorOptions<
      ShieldedMultiSigSchnorrV1PrivateState,
      ReturnType<typeof ShieldedMultiSigSchnorrV1Witnesses>
    > = {},
  ) {
    super([signerPubkeys, thresh], options);
  }

  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  public execute(
    to: Recipient,
    amount: bigint,
    coin: QualifiedShieldedCoinInfo,
    approvedSigs: ApprovedSig[],
  ): ShieldedSendResult {
    return this.circuits.impure.execute(to, amount, coin, approvedSigs);
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

  public isSigner(pk: JubjubPoint): boolean {
    return this.circuits.impure.isSigner(pk);
  }

  public getLedger(): Ledger {
    return this.getPublicState();
  }
}
