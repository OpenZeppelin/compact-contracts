import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Ledger,
  ledger,
  Contract as ShieldedMultiSig,
} from '../../../../artifacts/ShieldedMultiSig/contract/index.js';
import { EmptyPrivateState, emptyWitnesses } from '../EmptyWitnesses.js';

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
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof emptyWitnesses>,
  ShieldedMultiSig<EmptyPrivateState>,
  ShieldedMultiSigArgs
>({
  contractFactory: (witnesses) =>
    new ShieldedMultiSig<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => EmptyPrivateState,
  contractArgs: (signers, thresh) => [signers, thresh],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => emptyWitnesses(),
  artifactName: 'ShieldedMultiSig',
});

export class ShieldedMultiSigSimulator extends ShieldedMultiSigSimulatorBase {
  static async create(
    signers: EitherPKAddress[],
    thresh: bigint,
    options: SimulatorOptions<
      EmptyPrivateState,
      ReturnType<typeof emptyWitnesses>
    > = {},
  ): Promise<ShieldedMultiSigSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [signers, thresh],
      options,
    ) as Promise<ShieldedMultiSigSimulator>;
  }

  // Deposit
  public deposit(coin: ShieldedCoinInfo): Promise<[]> {
    return this.circuits.impure.deposit(coin);
  }

  // Proposals
  public createShieldedProposal(
    to: Recipient,
    color: Uint8Array,
    amount: bigint,
  ): Promise<bigint> {
    return this.circuits.impure.createShieldedProposal(to, color, amount);
  }

  public approveProposal(id: bigint): Promise<[]> {
    return this.circuits.impure.approveProposal(id);
  }

  public revokeApproval(id: bigint): Promise<[]> {
    return this.circuits.impure.revokeApproval(id);
  }

  public executeShieldedProposal(id: bigint): Promise<ShieldedSendResult> {
    return this.circuits.impure.executeShieldedProposal(id);
  }

  // View - Approvals
  public isProposalApprovedBySigner(
    id: bigint,
    signer: EitherPKAddress,
  ): Promise<boolean> {
    return this.circuits.impure.isProposalApprovedBySigner(id, signer);
  }

  public getApprovalCount(id: bigint): Promise<bigint> {
    return this.circuits.impure.getApprovalCount(id);
  }

  // View - Proposals
  public getProposal(id: bigint): Promise<Proposal> {
    return this.circuits.impure.getProposal(id);
  }

  // getProposalRecipient / getProposalAmount / getProposalColor were dropped from
  // the contract (redundant with getProposal; removed to fit the deploy block
  // limit). Derive them here so specs are unchanged.
  public async getProposalRecipient(id: bigint): Promise<Recipient> {
    return (await this.getProposal(id)).to;
  }

  public async getProposalAmount(id: bigint): Promise<bigint> {
    return (await this.getProposal(id)).amount;
  }

  public async getProposalColor(id: bigint): Promise<Uint8Array> {
    return (await this.getProposal(id)).color;
  }

  public getProposalStatus(id: bigint): Promise<number> {
    return this.circuits.impure.getProposalStatus(id);
  }

  // View - Treasury
  public getTokenBalance(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getTokenBalance(color);
  }

  public getReceivedTotal(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getReceivedTotal(color);
  }

  public getSentTotal(color: Uint8Array): Promise<bigint> {
    return this.circuits.impure.getSentTotal(color);
  }

  // getReceivedMinusSent was dropped from the contract (redundant; removed to fit
  // the deploy block limit). Derive it from the two tracked totals.
  public async getReceivedMinusSent(color: Uint8Array): Promise<bigint> {
    // Await sequentially: on live each impure getter submits a tx, and two
    // concurrent submissions balance against the same wallet snapshot and
    // trigger a stale-UTXO rejection.
    const received = await this.getReceivedTotal(color);
    const sent = await this.getSentTotal(color);
    return received - sent;
  }

  // View - Signers
  public getSignerCount(): Promise<bigint> {
    return this.circuits.impure.getSignerCount();
  }

  public getThreshold(): Promise<bigint> {
    return this.circuits.impure.getThreshold();
  }

  public isSigner(account: EitherPKAddress): Promise<boolean> {
    return this.circuits.impure.isSigner(account);
  }

  // Ledger access
  public getLedger(): Promise<Ledger> {
    return this.getPublicState();
  }
}
