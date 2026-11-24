import { beforeEach, describe, expect, it } from 'vitest';
import { deriveEncryptionPk } from '#test-utils/fixtures/elgamal.js';
import { ConfidentialFungibleTokenRegisterSimulator } from './simulators/ConfidentialFungibleTokenRegisterSimulator.js';
import { ConfidentialFungibleTokenPrivateState } from './witnesses/ConfidentialFungibleTokenWitnesses.js';

// Runs on both backends. On the dry backend it duplicates the base suite's
// registration tests on the reduced mock; on the live backend it is the
// on-chain proof of `registerWithKey`, which the full base mock cannot give
// because it exceeds the deploy block budget.

const NAME = 'Confidential';
const SYMBOL = 'CNF';
const DECIMALS = 18n;

const ALICE = ConfidentialFungibleTokenPrivateState.generate();
const BOB = ConfidentialFungibleTokenPrivateState.generate();

describe('ConfidentialFungibleToken: registerWithKey on the reduced mock', () => {
  let cft: ConfidentialFungibleTokenRegisterSimulator;

  beforeEach(async () => {
    cft = await ConfidentialFungibleTokenRegisterSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
      { privateState: ALICE },
    );
  });

  it('registerWithKey proves and records the derived key', async () => {
    const accountId = await cft.register();

    expect(await cft.isRegistered(accountId)).toBe(true);
    const ledger = await cft.getPublicState();
    expect(ledger.CFT__encryptionKeys.lookup(accountId)).toEqual(
      deriveEncryptionPk(ALICE.encryptionKey),
    );
  });

  it('registers a generated identity when no private state is supplied', async () => {
    const fresh = await ConfidentialFungibleTokenRegisterSimulator.create(
      NAME,
      SYMBOL,
      DECIMALS,
    );
    const accountId = await fresh.register();

    expect(await fresh.isRegistered(accountId)).toBe(true);
  });

  it('registerWithKey rejects a key not derived from the caller EK', async () => {
    await expect(
      cft.registerWithKey(deriveEncryptionPk(BOB.encryptionKey)),
    ).rejects.toThrow('ElGamal: ek/pk mismatch');
  });
});
