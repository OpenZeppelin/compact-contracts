import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/address.js';
import { ShieldedMultiSigSimulator } from './simulators/ShieldedMultiSigSimulator.js';

const ProposalStatus = { Inactive: 0, Active: 1, Executed: 2, Cancelled: 3 };
const RecipientKind = { ShieldedUser: 0, UnshieldedUser: 1, Contract: 2 };

const THRESHOLD = 2n;
const COLOR = new Uint8Array(32).fill(1);
const AMOUNT = 1000n;
const PROPOSAL_AMOUNT = 400n;

const [, Z_SIGNER1] = utils.generateEitherPubKeyPair('SIGNER1');
const [, Z_SIGNER2] = utils.generateEitherPubKeyPair('SIGNER2');
const [, Z_SIGNER3] = utils.generateEitherPubKeyPair('SIGNER3');
const SIGNERS = [Z_SIGNER1, Z_SIGNER2, Z_SIGNER3];

const [, Z_NON_SIGNER] = utils.generateEitherPubKeyPair('OTHER');
const [, Z_RECIPIENT_PK] = utils.generatePubKeyPair('RECIPIENT');

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
    it('should initialize with signers and threshold', async () => {
      multisig = await ShieldedMultiSigSimulator.create(SIGNERS, THRESHOLD);
      expect(await multisig.getSignerCount()).toEqual(BigInt(SIGNERS.length));
      expect(await multisig.getThreshold()).toEqual(THRESHOLD);
    });

    it('should register all signers', async () => {
      multisig = await ShieldedMultiSigSimulator.create(SIGNERS, THRESHOLD);
      for (const signer of SIGNERS) {
        expect(await multisig.isSigner(signer)).toEqual(true);
      }
    });

    it('should reject non-signers', async () => {
      multisig = await ShieldedMultiSigSimulator.create(SIGNERS, THRESHOLD);
      expect(await multisig.isSigner(Z_NON_SIGNER)).toEqual(false);
    });

    it('should fail with zero threshold', async () => {
      await expect(
        ShieldedMultiSigSimulator.create(SIGNERS, 0n),
      ).rejects.toThrow('SignerManager: threshold must be > 0');
    });

    it('should fail with threshold exceeding signer count', async () => {
      await expect(
        ShieldedMultiSigSimulator.create(SIGNERS, 4n),
      ).rejects.toThrow('SignerManager: threshold exceeds signer count');
    });
  });

  describe('when initialized', () => {
    beforeEach(async () => {
      multisig = await ShieldedMultiSigSimulator.create(SIGNERS, THRESHOLD);
    });

    describe('deposit', () => {
      it('should accept deposits', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);
      });

      it('should accumulate deposits', async () => {
        await multisig.deposit(
          makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(1)),
        );
        await multisig.deposit(
          makeCoin(COLOR, AMOUNT, new Uint8Array(32).fill(2)),
        );
        expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT * 2n);
      });

      it('should track received total', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        expect(await multisig.getReceivedTotal(COLOR)).toEqual(AMOUNT);
      });
    });

    describe('createShieldedProposal', () => {
      it('should allow signer to create proposal', async () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        expect(id).toEqual(1n);
      });

      it('should store proposal data correctly', async () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);

        const proposal = await multisig.getProposal(id);
        expect(proposal.status).toEqual(ProposalStatus.Active);
        expect(proposal.amount).toEqual(PROPOSAL_AMOUNT);
        expect(proposal.color).toEqual(COLOR);
      });

      it('should fail for non-signer', async () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        await expect(
          multisig
            .as('OTHER')
            .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT),
        ).rejects.toThrow('SignerManager: not a signer');
      });

      it('should fail with zero amount', async () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        await expect(
          multisig.as('SIGNER1').createShieldedProposal(to, COLOR, 0n),
        ).rejects.toThrow('ProposalManager: zero amount');
      });

      it('should reject UnshieldedUser recipient kind', async () => {
        const to = {
          kind: RecipientKind.UnshieldedUser,
          address: Z_RECIPIENT_PK.bytes,
        };
        await expect(
          multisig
            .as('SIGNER1')
            .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT),
        ).rejects.toThrow(
          'ShieldedMultiSig: recipient must be a shielded user or contract',
        );
      });

      it('should accept Contract recipient kind', async () => {
        const to = {
          kind: RecipientKind.Contract,
          address: new Uint8Array(32).fill(7),
        };
        const id = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        expect(id).toEqual(1n);
        expect((await multisig.getProposalRecipient(id)).kind).toEqual(
          RecipientKind.Contract,
        );
      });
    });

    describe('approveProposal', () => {
      let proposalId: bigint;

      beforeEach(async () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        proposalId = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
      });

      it('should allow signer to approve', async () => {
        await multisig.as('SIGNER1').approveProposal(proposalId);
        expect(
          await multisig.isProposalApprovedBySigner(proposalId, Z_SIGNER1),
        ).toEqual(true);
        expect(await multisig.getApprovalCount(proposalId)).toEqual(1n);
      });

      it('should allow multiple signers to approve', async () => {
        await multisig.as('SIGNER1').approveProposal(proposalId);
        await multisig.as('SIGNER2').approveProposal(proposalId);
        expect(await multisig.getApprovalCount(proposalId)).toEqual(2n);
      });

      it('should fail for non-signer', async () => {
        await expect(
          multisig.as('OTHER').approveProposal(proposalId),
        ).rejects.toThrow('SignerManager: not a signer');
      });

      it('should fail for double approval', async () => {
        await multisig.as('SIGNER1').approveProposal(proposalId);
        await expect(
          multisig.as('SIGNER1').approveProposal(proposalId),
        ).rejects.toThrow('Multisig: already approved');
      });

      it('should fail for non-existing proposal', async () => {
        await expect(
          multisig.as('SIGNER1').approveProposal(999n),
        ).rejects.toThrow('ProposalManager: proposal not found');
      });

      it('should fail for executed proposal', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        await multisig.as('SIGNER1').approveProposal(proposalId);
        await multisig.as('SIGNER2').approveProposal(proposalId);
        await multisig.executeShieldedProposal(proposalId);

        await expect(
          multisig.as('SIGNER3').approveProposal(proposalId),
        ).rejects.toThrow('ProposalManager: proposal not active');
      });
    });

    describe('revokeApproval', () => {
      let proposalId: bigint;

      beforeEach(async () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        proposalId = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        await multisig.as('SIGNER1').approveProposal(proposalId);
      });

      it('should allow signer to revoke their approval', async () => {
        await multisig.as('SIGNER1').revokeApproval(proposalId);
        expect(
          await multisig.isProposalApprovedBySigner(proposalId, Z_SIGNER1),
        ).toEqual(false);
        expect(await multisig.getApprovalCount(proposalId)).toEqual(0n);
      });

      it('should fail for non-signer', async () => {
        await expect(
          multisig.as('OTHER').revokeApproval(proposalId),
        ).rejects.toThrow('SignerManager: not a signer');
      });

      it('should fail if not yet approved', async () => {
        await expect(
          multisig.as('SIGNER2').revokeApproval(proposalId),
        ).rejects.toThrow('Multisig: not approved');
      });

      it('should allow re-approval after revoke', async () => {
        await multisig.as('SIGNER1').revokeApproval(proposalId);
        await multisig.as('SIGNER1').approveProposal(proposalId);
        expect(
          await multisig.isProposalApprovedBySigner(proposalId, Z_SIGNER1),
        ).toEqual(true);
        expect(await multisig.getApprovalCount(proposalId)).toEqual(1n);
      });

      it('should fail for executed proposal', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        await multisig.as('SIGNER2').approveProposal(proposalId);
        await multisig.executeShieldedProposal(proposalId);

        await expect(
          multisig.as('SIGNER1').revokeApproval(proposalId),
        ).rejects.toThrow('ProposalManager: proposal not active');
      });
    });

    describe('executeShieldedProposal', () => {
      let proposalId: bigint;

      beforeEach(async () => {
        // Fund the treasury
        await multisig.deposit(makeCoin(COLOR, AMOUNT));

        // Create and approve proposal to threshold
        const to = makeRecipient(Z_RECIPIENT_PK);
        proposalId = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        await multisig.as('SIGNER1').approveProposal(proposalId);
        await multisig.as('SIGNER2').approveProposal(proposalId);
      });

      it('should execute when threshold is met', async () => {
        await multisig.executeShieldedProposal(proposalId);
        expect(await multisig.getProposalStatus(proposalId)).toEqual(
          ProposalStatus.Executed,
        );
      });

      it('should return sent coin and change in result', async () => {
        const result = await multisig.executeShieldedProposal(proposalId);
        expect(result.sent.value).toEqual(PROPOSAL_AMOUNT);
        expect(result.sent.color).toEqual(COLOR);
        expect(result.change.is_some).toEqual(true);
        expect(result.change.value.value).toEqual(AMOUNT - PROPOSAL_AMOUNT);
        expect(result.change.value.color).toEqual(COLOR);
      });

      it('should return no change when sending full balance', async () => {
        // Create proposal for the full amount
        const to = makeRecipient(Z_RECIPIENT_PK);
        const fullId = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, AMOUNT);
        await multisig.as('SIGNER1').approveProposal(fullId);
        await multisig.as('SIGNER2').approveProposal(fullId);

        const result = await multisig.executeShieldedProposal(fullId);
        expect(result.sent.value).toEqual(AMOUNT);
        expect(result.change.is_some).toEqual(false);
      });

      it('should deduct from treasury balance', async () => {
        await multisig.executeShieldedProposal(proposalId);
        expect(await multisig.getTokenBalance(COLOR)).toEqual(
          AMOUNT - PROPOSAL_AMOUNT,
        );
      });

      it('should track sent total', async () => {
        await multisig.executeShieldedProposal(proposalId);
        expect(await multisig.getSentTotal(COLOR)).toEqual(PROPOSAL_AMOUNT);
      });

      it('should fail when threshold is not met', async () => {
        // Create a new proposal with only 1 approval
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id2 = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, 100n);
        await multisig.as('SIGNER1').approveProposal(id2);

        await expect(multisig.executeShieldedProposal(id2)).rejects.toThrow(
          'SignerManager: threshold not met',
        );
      });

      it('should fail for non-existing proposal', async () => {
        await expect(multisig.executeShieldedProposal(999n)).rejects.toThrow(
          'ProposalManager: proposal not found',
        );
      });

      it('should fail when executed twice', async () => {
        await multisig.executeShieldedProposal(proposalId);
        await expect(
          multisig.executeShieldedProposal(proposalId),
        ).rejects.toThrow('ProposalManager: proposal not active');
      });

      it('should fail with insufficient treasury balance', async () => {
        // Create proposal for more than treasury holds
        const to = makeRecipient(Z_RECIPIENT_PK);
        const bigId = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, AMOUNT + 1n);
        await multisig.as('SIGNER1').approveProposal(bigId);
        await multisig.as('SIGNER2').approveProposal(bigId);

        await expect(multisig.executeShieldedProposal(bigId)).rejects.toThrow(
          'ShieldedTreasury: coin value insufficient',
        );
      });
    });

    describe('view - approvals', () => {
      it('should return false for unapproved signer', async () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        expect(
          await multisig.isProposalApprovedBySigner(id, Z_SIGNER1),
        ).toEqual(false);
      });

      it('should return 0 approval count for new proposal', async () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
        expect(await multisig.getApprovalCount(id)).toEqual(0n);
      });
    });

    describe('view - proposal delegation', () => {
      let proposalId: bigint;

      beforeEach(async () => {
        const to = makeRecipient(Z_RECIPIENT_PK);
        proposalId = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);
      });

      it('getProposalRecipient should return recipient', async () => {
        const recipient = await multisig.getProposalRecipient(proposalId);
        expect(recipient.kind).toEqual(RecipientKind.ShieldedUser);
        expect(recipient.address).toEqual(Z_RECIPIENT_PK.bytes);
      });

      it('getProposalAmount should return amount', async () => {
        expect(await multisig.getProposalAmount(proposalId)).toEqual(
          PROPOSAL_AMOUNT,
        );
      });

      it('getProposalColor should return color', async () => {
        expect(await multisig.getProposalColor(proposalId)).toEqual(COLOR);
      });
    });

    describe('view - signer manager delegation', () => {
      it('getSignerCount should match initial count', async () => {
        expect(await multisig.getSignerCount()).toEqual(BigInt(SIGNERS.length));
      });

      it('getThreshold should match initial threshold', async () => {
        expect(await multisig.getThreshold()).toEqual(THRESHOLD);
      });

      it('isSigner should return true for signer', async () => {
        expect(await multisig.isSigner(Z_SIGNER1)).toEqual(true);
      });

      it('isSigner should return false for non-signer', async () => {
        expect(await multisig.isSigner(Z_NON_SIGNER)).toEqual(false);
      });
    });

    describe('view - treasury delegation', () => {
      beforeEach(async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
      });

      it('getTokenBalance should reflect deposits', async () => {
        expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);
      });

      it('getReceivedTotal should reflect deposits', async () => {
        expect(await multisig.getReceivedTotal(COLOR)).toEqual(AMOUNT);
      });

      it('getSentTotal should be 0 before any sends', async () => {
        expect(await multisig.getSentTotal(COLOR)).toEqual(0n);
      });

      it('getReceivedMinusSent should equal balance', async () => {
        expect(await multisig.getReceivedMinusSent(COLOR)).toEqual(AMOUNT);
      });
    });

    describe('full lifecycle', () => {
      it('should handle deposit -> propose -> approve -> execute', async () => {
        // Deposit
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        expect(await multisig.getTokenBalance(COLOR)).toEqual(AMOUNT);

        // Propose
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);

        // Approve to threshold
        await multisig.as('SIGNER1').approveProposal(id);
        await multisig.as('SIGNER2').approveProposal(id);
        expect(await multisig.getApprovalCount(id)).toEqual(THRESHOLD);

        // Execute
        await multisig.executeShieldedProposal(id);
        expect(await multisig.getProposalStatus(id)).toEqual(
          ProposalStatus.Executed,
        );
        expect(await multisig.getTokenBalance(COLOR)).toEqual(
          AMOUNT - PROPOSAL_AMOUNT,
        );
        expect(await multisig.getReceivedMinusSent(COLOR)).toEqual(
          AMOUNT - PROPOSAL_AMOUNT,
        );
      });

      it('should handle multiple proposals concurrently', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));

        const to = makeRecipient(Z_RECIPIENT_PK);
        const id1 = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, 200n);
        const id2 = await multisig
          .as('SIGNER2')
          .createShieldedProposal(to, COLOR, 300n);

        // Approve and execute first
        await multisig.as('SIGNER1').approveProposal(id1);
        await multisig.as('SIGNER2').approveProposal(id1);
        await multisig.executeShieldedProposal(id1);

        // Approve and execute second
        await multisig.as('SIGNER1').approveProposal(id2);
        await multisig.as('SIGNER3').approveProposal(id2);
        await multisig.executeShieldedProposal(id2);

        expect(await multisig.getTokenBalance(COLOR)).toEqual(
          AMOUNT - 200n - 300n,
        );
      });

      it('should handle approve -> revoke -> re-approve -> execute', async () => {
        await multisig.deposit(makeCoin(COLOR, AMOUNT));
        const to = makeRecipient(Z_RECIPIENT_PK);
        const id = await multisig
          .as('SIGNER1')
          .createShieldedProposal(to, COLOR, PROPOSAL_AMOUNT);

        // Approve then revoke
        await multisig.as('SIGNER1').approveProposal(id);
        await multisig.as('SIGNER1').revokeApproval(id);
        expect(await multisig.getApprovalCount(id)).toEqual(0n);

        // Re-approve with enough signers
        await multisig.as('SIGNER2').approveProposal(id);
        await multisig.as('SIGNER3').approveProposal(id);
        expect(await multisig.getApprovalCount(id)).toEqual(2n);

        await multisig.executeShieldedProposal(id);
        expect(await multisig.getProposalStatus(id)).toEqual(
          ProposalStatus.Executed,
        );
      });
    });
  });
});
