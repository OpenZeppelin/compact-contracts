import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ProposalManagerSimulator } from './simulators/ProposalManagerSimulator.js';

// Enum values matching ProposalStatus and RecipientKind
const ProposalStatus = { Inactive: 0, Active: 1, Executed: 2, Cancelled: 3 };
const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const COLOR = new Uint8Array(32).fill(1);
const COLOR2 = new Uint8Array(32).fill(2);
const AMOUNT = 1000n;
const AMOUNT2 = 2000n;

const [_RECIPIENT, Z_RECIPIENT] = utils.generatePubKeyPair('RECIPIENT');
const Z_CONTRACT_RECIPIENT = utils.encodeToAddress('CONTRACT_RECIPIENT');

let contract: ProposalManagerSimulator;

describe('ProposalManager', () => {
  beforeEach(() => {
    contract = new ProposalManagerSimulator();
  });

  describe('recipient helpers (pure)', () => {
    it('should create shielded user recipient', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      expect(recipient.kind).toEqual(RecipientKind.ShieldedUser);
      expect(recipient.address).toEqual(Z_RECIPIENT.bytes);
    });

    it('should create unshielded user recipient', () => {
      const addr = utils.encodeToPK('UNSHIELDED_USER');
      const recipient = contract.unshieldedUserRecipient(addr);
      expect(recipient.kind).toEqual(RecipientKind.UnshieldedUser);
      expect(recipient.address).toEqual(addr.bytes);
    });

    it('should create contract recipient', () => {
      const recipient = contract.contractRecipient(Z_CONTRACT_RECIPIENT);
      expect(recipient.kind).toEqual(RecipientKind.Contract);
      expect(recipient.address).toEqual(Z_CONTRACT_RECIPIENT.bytes);
    });

    it('should convert shielded user recipient to shielded send format', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const shielded = contract.toShieldedRecipient(recipient);
      expect(shielded.is_left).toEqual(true);
      expect(shielded.left.bytes).toEqual(Z_RECIPIENT.bytes);
    });

    it('should convert contract recipient to shielded send format', () => {
      const recipient = contract.contractRecipient(Z_CONTRACT_RECIPIENT);
      const shielded = contract.toShieldedRecipient(recipient);
      expect(shielded.is_left).toEqual(false);
      expect(shielded.right.bytes).toEqual(Z_CONTRACT_RECIPIENT.bytes);
    });

    it('should reject unshielded user in toShieldedRecipient', () => {
      const recipient = {
        kind: RecipientKind.UnshieldedUser,
        address: new Uint8Array(32),
      };
      expect(() => {
        contract.toShieldedRecipient(recipient);
      }).toThrow('ProposalManager: invalid shielded recipient');
    });

    it('should convert contract recipient to unshielded send format', () => {
      const recipient = contract.contractRecipient(Z_CONTRACT_RECIPIENT);
      const unshielded = contract.toUnshieldedRecipient(recipient);
      expect(unshielded.is_left).toEqual(true);
      expect(unshielded.left.bytes).toEqual(Z_CONTRACT_RECIPIENT.bytes);
    });

    it('should convert unshielded user recipient to unshielded send format', () => {
      const addr = utils.encodeToPK('UNSHIELDED_USER');
      const recipient = contract.unshieldedUserRecipient(addr);
      const unshielded = contract.toUnshieldedRecipient(recipient);
      expect(unshielded.is_left).toEqual(false);
      expect(unshielded.right.bytes).toEqual(addr.bytes);
    });

    it('should reject shielded user in toUnshieldedRecipient', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      expect(() => {
        contract.toUnshieldedRecipient(recipient);
      }).toThrow('ProposalManager: invalid unshielded recipient');
    });
  });

  describe('_createProposal', () => {
    it('should create a proposal and return id', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      expect(id).toEqual(1n);
    });

    it('should create sequential proposal ids', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id1 = contract._createProposal(recipient, COLOR, AMOUNT);
      const id2 = contract._createProposal(recipient, COLOR2, AMOUNT2);
      expect(id1).toEqual(1n);
      expect(id2).toEqual(2n);
    });

    it('should store proposal data correctly', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);

      const proposal = contract.getProposal(id);
      expect(proposal.to.kind).toEqual(RecipientKind.ShieldedUser);
      expect(proposal.to.address).toEqual(Z_RECIPIENT.bytes);
      expect(proposal.color).toEqual(COLOR);
      expect(proposal.amount).toEqual(AMOUNT);
      expect(proposal.status).toEqual(ProposalStatus.Active);
    });

    it('should store contract recipient correctly', () => {
      const recipient = contract.contractRecipient(Z_CONTRACT_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR2, AMOUNT2);

      const proposal = contract.getProposal(id);
      expect(proposal.to.kind).toEqual(RecipientKind.Contract);
      expect(proposal.to.address).toEqual(Z_CONTRACT_RECIPIENT.bytes);
      expect(proposal.color).toEqual(COLOR2);
      expect(proposal.amount).toEqual(AMOUNT2);
    });

    it('should fail with zero amount', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      expect(() => {
        contract._createProposal(recipient, COLOR, 0n);
      }).toThrow('ProposalManager: zero amount');
    });
  });

  describe('assertProposalExists', () => {
    it('should pass for existing proposal', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      expect(() => contract.assertProposalExists(id)).not.toThrow();
    });

    it('should fail for non-existing proposal', () => {
      expect(() => {
        contract.assertProposalExists(999n);
      }).toThrow('ProposalManager: proposal not found');
    });
  });

  describe('assertProposalActive', () => {
    it('should pass for active proposal', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      expect(() => contract.assertProposalActive(id)).not.toThrow();
    });

    it('should fail for non-existing proposal', () => {
      expect(() => {
        contract.assertProposalActive(999n);
      }).toThrow('ProposalManager: proposal not found');
    });

    it('should fail for cancelled proposal', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      contract._cancelProposal(id);
      expect(() => {
        contract.assertProposalActive(id);
      }).toThrow('ProposalManager: proposal not active');
    });

    it('should fail for executed proposal', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      contract._markExecuted(id);
      expect(() => {
        contract.assertProposalActive(id);
      }).toThrow('ProposalManager: proposal not active');
    });
  });

  describe('_cancelProposal', () => {
    it('should cancel an active proposal', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);

      contract._cancelProposal(id);
      expect(contract.getProposalStatus(id)).toEqual(ProposalStatus.Cancelled);
    });

    it('should preserve proposal data after cancellation', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);

      contract._cancelProposal(id);
      const proposal = contract.getProposal(id);
      expect(proposal.to.address).toEqual(Z_RECIPIENT.bytes);
      expect(proposal.color).toEqual(COLOR);
      expect(proposal.amount).toEqual(AMOUNT);
    });

    it('should fail for non-existing proposal', () => {
      expect(() => {
        contract._cancelProposal(999n);
      }).toThrow('ProposalManager: proposal not found');
    });

    it('should fail for already cancelled proposal', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      contract._cancelProposal(id);

      expect(() => {
        contract._cancelProposal(id);
      }).toThrow('ProposalManager: proposal not active');
    });

    it('should fail for executed proposal', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      contract._markExecuted(id);

      expect(() => {
        contract._cancelProposal(id);
      }).toThrow('ProposalManager: proposal not active');
    });
  });

  describe('_markExecuted', () => {
    it('should mark an active proposal as executed', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);

      contract._markExecuted(id);
      expect(contract.getProposalStatus(id)).toEqual(ProposalStatus.Executed);
    });

    it('should fail for non-existing proposal', () => {
      expect(() => {
        contract._markExecuted(999n);
      }).toThrow('ProposalManager: proposal not found');
    });

    it('should fail for already executed proposal', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      contract._markExecuted(id);

      expect(() => {
        contract._markExecuted(id);
      }).toThrow('ProposalManager: proposal not active');
    });

    it('should fail for cancelled proposal', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      contract._cancelProposal(id);

      expect(() => {
        contract._markExecuted(id);
      }).toThrow('ProposalManager: proposal not active');
    });
  });

  describe('view circuits', () => {
    let proposalId: bigint;

    beforeEach(() => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      proposalId = contract._createProposal(recipient, COLOR, AMOUNT);
    });

    it('getProposal should return full proposal', () => {
      const proposal = contract.getProposal(proposalId);
      expect(proposal.to.kind).toEqual(RecipientKind.ShieldedUser);
      expect(proposal.color).toEqual(COLOR);
      expect(proposal.amount).toEqual(AMOUNT);
      expect(proposal.status).toEqual(ProposalStatus.Active);
    });

    it('getProposalRecipient should return recipient', () => {
      const recipient = contract.getProposalRecipient(proposalId);
      expect(recipient.kind).toEqual(RecipientKind.ShieldedUser);
      expect(recipient.address).toEqual(Z_RECIPIENT.bytes);
    });

    it('getProposalAmount should return amount', () => {
      expect(contract.getProposalAmount(proposalId)).toEqual(AMOUNT);
    });

    it('getProposalColor should return color', () => {
      expect(contract.getProposalColor(proposalId)).toEqual(COLOR);
    });

    it('getProposalStatus should return status', () => {
      expect(contract.getProposalStatus(proposalId)).toEqual(
        ProposalStatus.Active,
      );
    });

    it('all view circuits should fail for non-existing proposal', () => {
      const badId = 999n;
      expect(() => contract.getProposal(badId)).toThrow(
        'ProposalManager: proposal not found',
      );
      expect(() => contract.getProposalRecipient(badId)).toThrow(
        'ProposalManager: proposal not found',
      );
      expect(() => contract.getProposalAmount(badId)).toThrow(
        'ProposalManager: proposal not found',
      );
      expect(() => contract.getProposalColor(badId)).toThrow(
        'ProposalManager: proposal not found',
      );
      expect(() => contract.getProposalStatus(badId)).toThrow(
        'ProposalManager: proposal not found',
      );
    });
  });

  describe('lifecycle transitions', () => {
    it('should handle create -> cancel flow', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      expect(contract.getProposalStatus(id)).toEqual(ProposalStatus.Active);

      contract._cancelProposal(id);
      expect(contract.getProposalStatus(id)).toEqual(ProposalStatus.Cancelled);
    });

    it('should handle create -> execute flow', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id = contract._createProposal(recipient, COLOR, AMOUNT);
      expect(contract.getProposalStatus(id)).toEqual(ProposalStatus.Active);

      contract._markExecuted(id);
      expect(contract.getProposalStatus(id)).toEqual(ProposalStatus.Executed);
    });

    it('should handle multiple proposals independently', () => {
      const recipient = contract.shieldedUserRecipient(Z_RECIPIENT);
      const id1 = contract._createProposal(recipient, COLOR, AMOUNT);
      const id2 = contract._createProposal(recipient, COLOR2, AMOUNT2);

      contract._cancelProposal(id1);

      expect(contract.getProposalStatus(id1)).toEqual(ProposalStatus.Cancelled);
      expect(contract.getProposalStatus(id2)).toEqual(ProposalStatus.Active);

      contract._markExecuted(id2);
      expect(contract.getProposalStatus(id2)).toEqual(ProposalStatus.Executed);
    });
  });
});
