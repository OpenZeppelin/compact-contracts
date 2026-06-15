import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  type Ledger,
  ledger,
  Contract as ShieldedMultiSig,
} from '../../../../artifacts/ShieldedMultiSig/contract/index.js';
import {
  ShieldedMultiSigPrivateState,
  ShieldedMultiSigWitnesses,
} from '../../witnesses/ShieldedMultiSigWitnesses.js';

type EitherPKAddress = {
  is_left: boolean;
  left: { bytes: Uint8Array };
  right: { bytes: Uint8Array };
};
type Recipient = { kind: number; address: Uint8Array };
type ShieldedCoinInfo = { nonce: Uint8Array; color: Uint8Array; value: bigint };
type ShieldedSendResult = {
  change: { is_some: boolean; value: ShieldedCoinInfo };
  sent: ShieldedCoinInfo;
};
type Proposal = {
  to: Recipient;
  color: Uint8Array;
  amount: bigint;
  status: number;
};

type ShieldedMultiSigArgs = readonly [
  signers: EitherPKAddress[],
  thresh: bigint,
];

const ShieldedMultiSigSimulatorBase = createSimulator<
  ShieldedMultiSigPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ShieldedMultiSigWitnesses>,
  ShieldedMultiSig<ShieldedMultiSigPrivateState>,
  ShieldedMultiSigArgs
>({
  contractFactory: (witnesses) =>
    new ShieldedMultiSig<ShieldedMultiSigPrivateState>(witnesses),
  defaultPrivateState: () => ShieldedMultiSigPrivateState,
  contractArgs: (signers, thresh) => [signers, thresh],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ShieldedMultiSigWitnesses(),
});

export class ShieldedMultiSigSimulator extends ShieldedMultiSigSimulatorBase {
  constructor(
    signers: EitherPKAddress[],
    thresh: bigint,
    options: BaseSimulatorOptions<
      ShieldedMultiSigPrivateState,
      ReturnType<typeof ShieldedMultiSigWitnesses>
    > = {},
  ) {
    super([signers, thresh], options);
  }

  // Deposit
  public deposit(coin: ShieldedCoinInfo) {
    return this.circuits.impure.deposit(coin);
  }

  // Proposals
  public createShieldedProposal(
    to: Recipient,
    color: Uint8Array,
    amount: bigint,
  ): bigint {
    return this.circuits.impure.createShieldedProposal(to, color, amount);
  }

  public approveProposal(id: bigint) {
    return this.circuits.impure.approveProposal(id);
  }

  public revokeApproval(id: bigint) {
    return this.circuits.impure.revokeApproval(id);
  }

  public executeShieldedProposal(id: bigint): ShieldedSendResult {
    return this.circuits.impure.executeShieldedProposal(id);
  }

  // View - Approvals
  public isProposalApprovedBySigner(
    id: bigint,
    signer: EitherPKAddress,
  ): boolean {
    return this.circuits.impure.isProposalApprovedBySigner(id, signer);
  }

  public getApprovalCount(id: bigint): bigint {
    return this.circuits.impure.getApprovalCount(id);
  }

  // View - Proposals
  public getProposal(id: bigint): Proposal {
    return this.circuits.impure.getProposal(id);
  }

  public getProposalRecipient(id: bigint): Recipient {
    return this.circuits.impure.getProposalRecipient(id);
  }

  public getProposalAmount(id: bigint): bigint {
    return this.circuits.impure.getProposalAmount(id);
  }

  public getProposalColor(id: bigint): Uint8Array {
    return this.circuits.impure.getProposalColor(id);
  }

  public getProposalStatus(id: bigint): number {
    return this.circuits.impure.getProposalStatus(id);
  }

  // View - Treasury
  public getTokenBalance(color: Uint8Array): bigint {
    return this.circuits.impure.getTokenBalance(color);
  }

  public getReceivedTotal(color: Uint8Array): bigint {
    return this.circuits.impure.getReceivedTotal(color);
  }

  public getSentTotal(color: Uint8Array): bigint {
    return this.circuits.impure.getSentTotal(color);
  }

  public getReceivedMinusSent(color: Uint8Array): bigint {
    return this.circuits.impure.getReceivedMinusSent(color);
  }

  // View - Signers
  public getSignerCount(): bigint {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): bigint {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(account: EitherPKAddress): boolean {
    return this.circuits.impure.isSigner(account);
  }

  // Ledger access
  public getLedger(): Ledger {
    return this.getPublicState();
  }
}
