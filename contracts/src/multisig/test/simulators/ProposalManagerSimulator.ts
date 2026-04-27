import {
  type BaseSimulatorOptions,
  createSimulator,
} from '@openzeppelin-compact/contracts-simulator';
import {
  ledger,
  Contract as MockProposalManager,
  pureCircuits,
} from '../../../../artifacts/MockProposalManager/contract/index.js';
import {
  ProposalManagerPrivateState,
  ProposalManagerWitnesses,
} from '../../witnesses/ProposalManagerWitnesses.js';

type Recipient = { kind: number; address: Uint8Array };
type Proposal = {
  to: Recipient;
  color: Uint8Array;
  amount: bigint;
  status: number;
};

type ProposalManagerArgs = readonly [];

const ProposalManagerSimulatorBase = createSimulator<
  ProposalManagerPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ProposalManagerWitnesses>,
  MockProposalManager<ProposalManagerPrivateState>,
  ProposalManagerArgs
>({
  contractFactory: (witnesses) =>
    new MockProposalManager<ProposalManagerPrivateState>(witnesses),
  defaultPrivateState: () => ProposalManagerPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ProposalManagerWitnesses(),
});

export class ProposalManagerSimulator extends ProposalManagerSimulatorBase {
  constructor(
    options: BaseSimulatorOptions<
      ProposalManagerPrivateState,
      ReturnType<typeof ProposalManagerWitnesses>
    > = {},
  ) {
    super([], options);
  }

  // Pure circuits (recipient helpers)
  public shieldedUserRecipient(key: { bytes: Uint8Array }): Recipient {
    return pureCircuits.shieldedUserRecipient(key);
  }

  public unshieldedUserRecipient(addr: { bytes: Uint8Array }): Recipient {
    return pureCircuits.unshieldedUserRecipient(addr);
  }

  public contractRecipient(addr: { bytes: Uint8Array }): Recipient {
    return pureCircuits.contractRecipient(addr);
  }

  public toShieldedRecipient(r: Recipient): {
    is_left: boolean;
    left: { bytes: Uint8Array };
    right: { bytes: Uint8Array };
  } {
    return pureCircuits.toShieldedRecipient(r);
  }

  public toUnshieldedRecipient(r: Recipient): {
    is_left: boolean;
    left: { bytes: Uint8Array };
    right: { bytes: Uint8Array };
  } {
    return pureCircuits.toUnshieldedRecipient(r);
  }

  // Guards
  public assertProposalExists(id: bigint) {
    return this.circuits.impure.assertProposalExists(id);
  }

  public assertProposalActive(id: bigint) {
    return this.circuits.impure.assertProposalActive(id);
  }

  // Lifecycle
  public _createProposal(
    to: Recipient,
    color: Uint8Array,
    amount: bigint,
  ): bigint {
    return this.circuits.impure._createProposal(to, color, amount);
  }

  public _cancelProposal(id: bigint) {
    return this.circuits.impure._cancelProposal(id);
  }

  public _markExecuted(id: bigint) {
    return this.circuits.impure._markExecuted(id);
  }

  // View
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
}
