import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ShieldedMultiSigSimulator } from './simulators/ShieldedMultiSigSimulator.js';

const ProposalStatus = { Inactive: 0, Active: 1, Executed: 2, Cancelled: 3 };
const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const THRESHOLD = 2n;
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;
const PROPOSAL_AMOUNT = 400n;

const [SIGNER1, Z_SIGNER1] = utils.generateEitherPubKeyPair('SIGNER1');
const [SIGNER2, Z_SIGNER2] = utils.generateEitherPubKeyPair('SIGNER2');
const [SIGNER3, Z_SIGNER3] = utils.generateEitherPubKeyPair('SIGNER3');
const SIGNERS = [Z_SIGNER1, Z_SIGNER2, Z_SIGNER3];

const [_NON_SIGNER, Z_NON_SIGNER] = utils.generateEitherPubKeyPair('OTHER');
const [RECIPIENT_PK, Z_RECIPIENT_PK] = utils.generatePubKeyPair('RECIPIENT');

function makeRecipient(pk: { bytes: Uint8Array }): {
  kind: number;
  address: Uint8Array;
} {
  return { kind: RecipientKind.ShieldedUser, address: pk.bytes };
}

function makeCoin(
  color: Uint8Array,
  value: bigint,
  nonce?: Uint8Array,
): { nonce: Uint8Array; color: Uint8Array; value: bigint } {
  return {
    nonce: nonce ?? new Uint8Array(32).fill(0),
    color,
    value,
  };
}

let multisig: ShieldedMultiSigSimulator;

describe('ShieldedMultiSig', () => {
  describe('constructor', () => {
    it('should initialize with signers and threshold', () => {
      multisig = new ShieldedMultiSigSimulator(SIGNERS, THRESHOLD);
      expect(multisig.getSignerCount()).toEqual(BigInt(SIGNERS.length));
      expect(multisig.getThreshold()).toEqual(THRESHOLD);
    });

    it('should register all signers', () => {
      multisig = new ShieldedMultiSigSimulator(SIGNERS, THRESHOLD);
      for (const signer of SIGNERS) {
        expect(multisig.isSigner(signer)).toEqual(true);
      }
    });

    it('should reject non-signers', () => {
      multisig = new ShieldedMultiSigSimulator(SIGNERS, THRESHOLD);
      expect(multisig.isSigner(Z_NON_SIGNER)).toEqual(false);
    });

    it('should fail with zero threshold', () => {
      expect(() => {
        new ShieldedMultiSigSimulator(SIGNERS, 0n);
      }).toThrow('SignerManager: threshold must be > 0');
    });

    it('should fail with threshold exceeding signer count', () => {
      expect(() => {
        new ShieldedMultiSigSimulator(SIGNERS, 4n);
      }).toThrow('SignerManager: threshold exceeds signer count');
    });
  });

  describe('when initialized', () => {
    beforeEach(() => {
      multisig = new ShieldedMultiSigSimulator(SIGNERS, THRESHOLD);
    });

    describe('deposit', () => {
      it('should accept deposits', () => {
        multisig.deposit(makeCoin(COLOR, AMOUNT));
        expect(multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);
      });

      it('should accumulate deposits', () => {
        multisig.deposit(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)));
        multisig.deposit(makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(2)));
        expect(multisig.getTokenBalance(COLOR)).toEqual(AMOUNT * 2n);
      });

      it('should track received total', () => {
        multisig.deposit(makeCoin(COLOR, AMOUNT));
        expect(multisig.getReceivedTotal(COLOR)).toEqual(AMOUNT);
      });
    });

    describe('createShieldedProposal', () => {
      it('should allow signer to create proposal', () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        expect(id).toEqual(1n);
      });

      it('should store proposal data correctly', () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);

        const proposal = multisig.getProposal(id);
        expect(proposal.status).toEqual(ProposalStatus.Active);
        expect(proposal.amount).toEqual(PROPOSAL_AMOUNT);
        expect(proposal.color).toEqual(COLOR);
      });

      it('should fail for non-signer', () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        expect(() => {
          multisig
            .as(_NON_SIGNER)
            .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        }).toThrow('SignerManager: not a signer');
      });

      it('should fail with zero amount', () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        expect(() => {
          multisig.as(SIGNER1).createShieldedProposal(to, COLOR, 0n);
        }).toThrow('ProposalManager: zero amount');
      });
    });

    describe('approveProposal', () => {
      let proposalId: bigint;

      beforeEach(() => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        proposalId = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
      });

      it('should allow signer to approve', () => {
        multisig.as(SIGNER1).approveProposal(proposalId);
        expect(
          multisig.isProposalApprovedBySigner(proposalId, Z_SIGNER1),
        ).toEqual(true);
        expect(multisig.getApprovalCount(proposalId)).toEqual(1n);
      });

      it('should allow multiple signers to approve', () => {
        multisig.as(SIGNER1).approveProposal(proposalId);
        multisig.as(SIGNER2).approveProposal(proposalId);
        expect(multisig.getApprovalCount(proposalId)).toEqual(2n);
      });

      it('should fail for non-signer', () => {
        expect(() => {
          multisig.as(_NON_SIGNER).approveProposal(proposalId);
        }).toThrow('SignerManager: not a signer');
      });

      it('should fail for double approval', () => {
        multisig.as(SIGNER1).approveProposal(proposalId);
        expect(() => {
          multisig.as(SIGNER1).approveProposal(proposalId);
        }).toThrow('Multisig: already approved');
      });

      it('should fail for non-existing proposal', () => {
        expect(() => {
          multisig.as(SIGNER1).approveProposal(999n);
        }).toThrow('ProposalManager: proposal not found');
      });

      it('should fail for executed proposal', () => {
        multisig.deposit(makeCoin(COLOR, AMOUNT));
        multisig.as(SIGNER1).approveProposal(proposalId);
        multisig.as(SIGNER2).approveProposal(proposalId);
        multisig.executeShieldedProposal(proposalId);

        expect(() => {
          multisig.as(SIGNER3).approveProposal(proposalId);
        }).toThrow('ProposalManager: proposal not active');
      });
    });

    describe('revokeApproval', () => {
      let proposalId: bigint;

      beforeEach(() => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        proposalId = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        multisig.as(SIGNER1).approveProposal(proposalId);
      });

      it('should allow signer to revoke their approval', () => {
        multisig.as(SIGNER1).revokeApproval(proposalId);
        expect(
          multisig.isProposalApprovedBySigner(proposalId, Z_SIGNER1),
        ).toEqual(false);
        expect(multisig.getApprovalCount(proposalId)).toEqual(0n);
      });

      it('should fail for non-signer', () => {
        expect(() => {
          multisig.as(_NON_SIGNER).revokeApproval(proposalId);
        }).toThrow('SignerManager: not a signer');
      });

      it('should fail if not yet approved', () => {
        expect(() => {
          multisig.as(SIGNER2).revokeApproval(proposalId);
        }).toThrow('Multisig: not approved');
      });

      it('should allow re-approval after revoke', () => {
        multisig.as(SIGNER1).revokeApproval(proposalId);
        multisig.as(SIGNER1).approveProposal(proposalId);
        expect(
          multisig.isProposalApprovedBySigner(proposalId, Z_SIGNER1),
        ).toEqual(true);
        expect(multisig.getApprovalCount(proposalId)).toEqual(1n);
      });

      it('should fail for executed proposal', () => {
        multisig.deposit(makeCoin(COLOR, AMOUNT));
        multisig.as(SIGNER2).approveProposal(proposalId);
        multisig.executeShieldedProposal(proposalId);

        expect(() => {
          multisig.as(SIGNER1).revokeApproval(proposalId);
        }).toThrow('ProposalManager: proposal not active');
      });
    });

    describe('executeShieldedProposal', () => {
      let proposalId: bigint;

      beforeEach(() => {
        // Fund the treasury
        multisig.deposit(makeCoin(COLOR, AMOUNT));

        // Create and approve proposal to threshold
        const to = makeRecipient(Z_RECIPIENT_PK);
        proposalId = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        multisig.as(SIGNER1).approveProposal(proposalId);
        multisig.as(SIGNER2).approveProposal(proposalId);
      });

      it('should execute when threshold is met', () => {
        multisig.executeShieldedProposal(proposalId);
        expect(multisig.getProposalStatus(proposalId)).toEqual(
          ProposalStatus.Executed,
        );
      });

      it('should return sent coin and change in result', () => {
        const result = multisig.executeShieldedProposal(proposalId);
        expect(result.sent.value).toEqual(PROPOSAL_AMOUNT);
        expect(result.sent.color).toEqual(COLOR);
        expect(result.change.is_some).toEqual(true);
        expect(result.change.value.value).toEqual(AMOUNT - PROPOSAL_AMOUNT);
        expect(result.change.value.color).toEqual(COLOR);
      });

      it('should return no change when sending full balance', () => {
        // Create proposal for the full amount
        const to = makeRecipient(Z_RECIPIENT_PK);
        const fullId = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, AMOUNT);
        multisig.as(SIGNER1).approveProposal(fullId);
        multisig.as(SIGNER2).approveProposal(fullId);

        const result = multisig.executeShieldedProposal(fullId);
        expect(result.sent.value).toEqual(AMOUNT);
        expect(result.change.is_some).toEqual(false);
      });

      it('should deduct from treasury balance', () => {
        multisig.executeShieldedProposal(proposalId);
        expect(multisig.getTokenBalance(COLOR)).toEqual(
          AMOUNT - PROPOSAL_AMOUNT,
        );
      });

      it('should track sent total', () => {
        multisig.executeShieldedProposal(proposalId);
        expect(multisig.getSentTotal(COLOR)).toEqual(PROPOSAL_AMOUNT);
      });

      it('should fail when threshold is not met', () => {
        // Create a new proposal with only 1 approval
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id2 = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, 100n);
        multisig.as(SIGNER1).approveProposal(id2);

        expect(() => {
          multisig.executeShieldedProposal(id2);
        }).toThrow('SignerManager: threshold not met');
      });

      it('should fail for non-existing proposal', () => {
        expect(() => {
          multisig.executeShieldedProposal(999n);
        }).toThrow('ProposalManager: proposal not found');
      });

      it('should fail when executed twice', () => {
        multisig.executeShieldedProposal(proposalId);
        expect(() => {
          multisig.executeShieldedProposal(proposalId);
        }).toThrow('ProposalManager: proposal not active');
      });

      it('should fail with insufficient treasury balance', () => {
        // Create proposal for more than treasury holds
        const to = makeRecipient(Z_RECIPIENT_PK);
        const bigId = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, AMOUNT + 1n);
        multisig.as(SIGNER1).approveProposal(bigId);
        multisig.as(SIGNER2).approveProposal(bigId);

        expect(() => {
          multisig.executeShieldedProposal(bigId);
        }).toThrow('ShieldedTreasury: coin value insufficient');
      });
    });

    describe('view - approvals', () => {
      it('should return false for unapproved signer', () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        expect(multisig.isProposalApprovedBySigner(id, Z_SIGNER1)).toEqual(
          false,
        );
      });

      it('should return 0 approval count for new proposal', () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        expect(multisig.getApprovalCount(id)).toEqual(0n);
      });
    });

    describe('view - proposal delegation', () => {
      let proposalId: bigint;

      beforeEach(() => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        proposalId = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
      });

      it('getProposalRecipient should return recipient', () => {
        const recipient = multisig.getProposalRecipient(proposalId);
        expect(recipient.kind).toEqual(RecipientKind.ShieldedUser);
        expect(recipient.address).toEqual(Z_RECIPIENT_PK.bytes);
      });

      it('getProposalAmount should return amount', () => {
        expect(multisig.getProposalAmount(proposalId)).toEqual(PROPOSAL_AMOUNT);
      });

      it('getProposalColor should return color', () => {
        expect(multisig.getProposalColor(proposalId)).toEqual(COLOR);
      });
    });

    describe('view - signer manager delegation', () => {
      it('getSignerCount should match initial count', () => {
        expect(multisig.getSignerCount()).toEqual(BigInt(SIGNERS.length));
      });

      it('getThreshold should match initial threshold', () => {
        expect(multisig.getThreshold()).toEqual(THRESHOLD);
      });

      it('isSigner should return true for signer', () => {
        expect(multisig.isSigner(Z_SIGNER1)).toEqual(true);
      });

      it('isSigner should return false for non-signer', () => {
        expect(multisig.isSigner(Z_NON_SIGNER)).toEqual(false);
      });
    });

    describe('view - treasury delegation', () => {
      beforeEach(() => {
        multisig.deposit(makeCoin(COLOR, AMOUNT));
      });

      it('getTokenBalance should reflect deposits', () => {
        expect(multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);
      });

      it('getReceivedTotal should reflect deposits', () => {
        expect(multisig.getReceivedTotal(COLOR)).toEqual(AMOUNT);
      });

      it('getSentTotal should be 0 before any sends', () => {
        expect(multisig.getSentTotal(COLOR)).toEqual(0n);
      });

      it('getReceivedMinusSent should equal balance', () => {
        expect(multisig.getReceivedMinusSent(COLOR)).toEqual(AMOUNT);
      });
    });

    describe('full lifecycle', () => {
      it('should handle deposit -> propose -> approve -> execute', () => {
        // Deposit
        multisig.deposit(makeCoin(COLOR, AMOUNT));
        expect(multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);

        // Propose
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);

        // Approve to threshold
        multisig.as(SIGNER1).approveProposal(id);
        multisig.as(SIGNER2).approveProposal(id);
        expect(multisig.getApprovalCount(id)).toEqual(THRESHOLD);

        // Execute
        multisig.executeShieldedProposal(id);
        expect(multisig.getProposalStatus(id)).toEqual(ProposalStatus.Executed);
        expect(multisig.getTokenBalance(COLOR)).toEqual(
          AMOUNT - PROPOSAL_AMOUNT,
        );
        expect(multisig.getReceivedMinusSent(COLOR)).toEqual(
          AMOUNT - PROPOSAL_AMOUNT,
        );
      });

      it('should handle multiple proposals concurrently', () => {
        multisig.deposit(makeCoin(COLOR, AMOUNT));

        const to = makeRecipient(Z_RECIPIENT_PK);
        const id1 = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, 200n);
        const id2 = multisig
          .as(SIGNER2)
          .createShieldedProposal(to, COLOR, 300n);

        // Approve and execute first
        multisig.as(SIGNER1).approveProposal(id1);
        multisig.as(SIGNER2).approveProposal(id1);
        multisig.executeShieldedProposal(id1);

        // Approve and execute second
        multisig.as(SIGNER1).approveProposal(id2);
        multisig.as(SIGNER3).approveProposal(id2);
        multisig.executeShieldedProposal(id2);

        expect(multisig.getTokenBalance(COLOR)).toEqual(AMOUNT - 200n - 300n);
      });

      it('should handle approve -> revoke -> re-approve -> execute', () => {
        multisig.deposit(makeCoin(COLOR, AMOUNT));
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = multisig
          .as(SIGNER1)
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);

        // Approve then revoke
        multisig.as(SIGNER1).approveProposal(id);
        multisig.as(SIGNER1).revokeApproval(id);
        expect(multisig.getApprovalCount(id)).toEqual(0n);

        // Re-approve with enough signers
        multisig.as(SIGNER2).approveProposal(id);
        multisig.as(SIGNER3).approveProposal(id);
        expect(multisig.getApprovalCount(id)).toEqual(2n);

        multisig.executeShieldedProposal(id);
        expect(multisig.getProposalStatus(id)).toEqual(ProposalStatus.Executed);
      });
    });
  });
});
