import {
  CompactTypeBytes,
  CompactTypeVector,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { ExampleCompliantDepositSimulator } from './simulators/ExampleCompliantDepositSimulator.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

const buildAccountId = (sk: Uint8Array): Uint8Array => {
  const t = new CompactTypeVector(1, new CompactTypeBytes(32));
  return persistentHash(t, [sk]);
};

const key = (label: string): Uint8Array => {
  const k = new Uint8Array(32);
  k.set(new TextEncoder().encode(label).slice(0, 32));
  return k;
};

const makeUser = (label: string) => {
  const secretKey = key(`${label}_SK`);
  const encryptionKey = key(`${label}_EK`);
  return { secretKey, encryptionKey, accountId: buildAccountId(secretKey) };
};

// OWNER authenticates as issuer via wit_OwnableSK; its commitment is set as the
// initial owner at construction.
const OWNER = makeUser('OWNER');
const ALICE = makeUser('ALICE');
const BOB = makeUser('BOB');
const CHARLIE = makeUser('CHARLIE');

const NAME = 'Deposit';
const SYMBOL = 'DEP';
const DECIMALS = 2n;

let sim: ExampleCompliantDepositSimulator;

const registerUser = (u: {
  secretKey: Uint8Array;
  encryptionKey: Uint8Array;
}) => {
  sim.privateState.switchIdentity(u.secretKey, u.encryptionKey);
  sim.register();
};

// Registers Alice & Bob, mints `amount` to Alice, leaves Alice active with her
// balance cached so caller-side gates (which run after CFT debits) are reached.
const fundAlice = (amount: bigint) => {
  registerUser(ALICE);
  registerUser(BOB);
  sim.mint(ALICE.accountId, amount);
  sim.privateState.switchIdentity(ALICE.secretKey, ALICE.encryptionKey);
  sim.privateState.cachePlaintext(sim.balanceOf(ALICE.accountId), amount);
};

describe('ExampleCompliantDeposit', () => {
  beforeEach(() => {
    sim = new ExampleCompliantDepositSimulator(
      NAME,
      SYMBOL,
      DECIMALS,
      OWNER.accountId,
    );
    // Act as the issuer by default.
    sim.privateState.setOwnerSecretKey(OWNER.secretKey);
  });

  describe('issuer authority (Ownable)', () => {
    it('reports the configured owner', () => {
      const o = sim.owner();
      expect(o.is_left).toBe(true);
      expect(o.left).toEqual(OWNER.accountId);
    });

    it('lets the owner mint to a registered account', () => {
      registerUser(ALICE);
      sim.mint(ALICE.accountId, 100n);
      expect(sim.totalSupply()).toBe(100n);
    });

    it('rejects mint from a non-owner', () => {
      sim.privateState.setOwnerSecretKey(ALICE.secretKey); // wrong issuer key
      expect(() => sim.mint(BOB.accountId, 100n)).toThrow(
        'Ownable: caller is not the owner',
      );
    });

    it('rejects freeze from a non-owner', () => {
      sim.privateState.setOwnerSecretKey(ALICE.secretKey);
      expect(() => sim.freeze(BOB.accountId)).toThrow(
        'Ownable: caller is not the owner',
      );
    });

    it('rejects setKycRequired from a non-owner', () => {
      sim.privateState.setOwnerSecretKey(ALICE.secretKey);
      expect(() => sim.setKycRequired(true)).toThrow(
        'Ownable: caller is not the owner',
      );
    });
  });

  describe('freeze', () => {
    it('isFrozen tracks freeze/unfreeze', () => {
      registerUser(ALICE);
      expect(sim.isFrozen(ALICE.accountId)).toBe(false);
      sim.freeze(ALICE.accountId);
      expect(sim.isFrozen(ALICE.accountId)).toBe(true);
      sim.unfreeze(ALICE.accountId);
      expect(sim.isFrozen(ALICE.accountId)).toBe(false);
    });

    it('blocks a frozen sender (gate on the returned caller id)', () => {
      fundAlice(100n);
      sim.freeze(ALICE.accountId);
      // Sender check runs after CFT debits; reaching it (vs. an earlier error)
      // is exactly why the cached balance is set up.
      expect(() => sim.transfer(BOB.accountId, 30n)).toThrow(
        'ComplianceRegistry: account frozen',
      );
    });

    it('blocks transfers to a frozen recipient (gate on the explicit arg)', () => {
      fundAlice(100n);
      sim.freeze(BOB.accountId);
      expect(() => sim.transfer(BOB.accountId, 30n)).toThrow(
        'ComplianceRegistry: account frozen',
      );
    });

    it('restores transfers after unfreeze', () => {
      fundAlice(100n);
      sim.freeze(ALICE.accountId);
      sim.unfreeze(ALICE.accountId);
      expect(() => sim.transfer(BOB.accountId, 30n)).not.toThrow();
      // Transfer does not change supply.
      expect(sim.totalSupply()).toBe(100n);
    });
  });

  describe('KYC allowlist', () => {
    it('is permissionless by default (KYC not required)', () => {
      sim.privateState.switchIdentity(CHARLIE.secretKey, CHARLIE.encryptionKey);
      expect(() => sim.register()).not.toThrow();
      expect(sim.isRegistered(CHARLIE.accountId)).toBe(true);
    });

    it('blocks an unapproved account from registering when required', () => {
      sim.setKycRequired(true);
      sim.privateState.switchIdentity(CHARLIE.secretKey, CHARLIE.encryptionKey);
      expect(() => sim.register()).toThrow(
        'ComplianceRegistry: account not KYC-approved',
      );
      expect(sim.isRegistered(CHARLIE.accountId)).toBe(false);
    });

    it('lets an approved account register when required', () => {
      sim.setKycRequired(true);
      sim.setKycApproved(CHARLIE.accountId, true);
      sim.privateState.switchIdentity(CHARLIE.secretKey, CHARLIE.encryptionKey);
      expect(() => sim.register()).not.toThrow();
      expect(sim.isRegistered(CHARLIE.accountId)).toBe(true);
    });
  });
});
