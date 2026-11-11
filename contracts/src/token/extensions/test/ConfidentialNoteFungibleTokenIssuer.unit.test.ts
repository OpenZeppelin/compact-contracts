import { dummyContractAddress } from '@midnight-ntwrk/compact-runtime';
import {
  CircuitContextManager,
  isLiveBackend,
} from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import {
  pureCircuits as composed,
  Contract as MockIssued,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssued/contract/index.js';
import {
  pureCircuits as issuer,
  Contract as MockIssuer,
} from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuer/contract/index.js';
import { Contract as MockInit } from '../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenIssuerInit/contract/index.js';
import {
  ConfidentialNoteFungibleTokenWitnesses,
  createNoteWallet,
  INSTANCE_SALT,
} from '../../test/witnesses/ConfidentialNoteFungibleTokenWitnesses.js';
import { ConfidentialNoteFungibleTokenIssuedSimulator } from './simulators/ConfidentialNoteFungibleTokenIssuedSimulator.js';
import { ConfidentialNoteFungibleTokenIssuerSimulator } from './simulators/ConfidentialNoteFungibleTokenIssuerSimulator.js';
import {
  ConfidentialNoteFungibleTokenIssuerWitnesses,
  createIssuerWallet,
} from './witnesses/ConfidentialNoteFungibleTokenIssuerWitnesses.js';

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/** A deterministic 32-byte secret from a label. */
const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const hex = (bytes: Uint8Array): string => Buffer.from(bytes).toString('hex');

const ISSUER_SK = secretKey('ISSUER');
const SUCCESSOR_SK = secretKey('SUCCESSOR');
const MALLORY_SK = secretKey('MALLORY');
const ZERO_SK = new Uint8Array(32);

const OTHER_SALT = secretKey('OTHER-SALT');

// Every deployment below uses `INSTANCE_SALT` unless it says otherwise.
const ISSUER = issuer.derivePk(ISSUER_SK, INSTANCE_SALT);
const SUCCESSOR = issuer.derivePk(SUCCESSOR_SK, INSTANCE_SALT);

/** A note identity to mint to. */
const RECIPIENT = composed.derivePk(secretKey('RECIPIENT'), INSTANCE_SALT);

// Compact `Field` modulus (BLS12-381 scalar field).
const P =
  52435875175126190479447740508185965837690552500527637822603658699938581184513n;

const ERR = {
  alreadyInitialized:
    'ConfidentialNoteFungibleTokenIssuer: contract already initialized',
  notInitialized:
    'ConfidentialNoteFungibleTokenIssuer: contract not initialized',
  zeroSalt:
    'ConfidentialNoteFungibleTokenIssuer: instance salt must not be zero',
  zeroKey: 'ConfidentialNoteFungibleTokenIssuer: issuer key must not be zero',
  notIssuer: 'ConfidentialNoteFungibleTokenIssuer: caller is not the issuer',
} as const;

let token: ConfidentialNoteFungibleTokenIssuerSimulator;

/** The standalone mock's three cells, in a form `toStrictEqual` compares. */
const issuerCells = async (
  sim: ConfidentialNoteFungibleTokenIssuerSimulator = token,
) => {
  const state = await sim.getPublicState();
  return {
    isInitialized: state.Issuer__isInitialized,
    instanceSalt: hex(state.Issuer__instanceSalt),
    issuerPk: state.Issuer__issuerPk,
  };
};

const deployAs = (sk: Uint8Array) =>
  ConfidentialNoteFungibleTokenIssuerSimulator.create({
    wallet: { secretKey: sk },
  });

// ---------------------------------------------------------------------------
// initialize
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer: initialize', () => {
  it('should store the flag, the salt and the issuer key', async () => {
    token = await deployAs(ISSUER_SK);

    expect(await issuerCells()).toStrictEqual({
      isInitialized: true,
      instanceSalt: hex(INSTANCE_SALT),
      issuerPk: ISSUER,
    });
  });

  it('should not accept a zero salt', async () => {
    await expectRejection(
      ConfidentialNoteFungibleTokenIssuerSimulator.create({
        instanceSalt: new Uint8Array(32),
        issuerPk: ISSUER,
      }),
      ERR.zeroSalt,
    );
  });

  it('should not accept a zero issuer key', async () => {
    await expectRejection(
      ConfidentialNoteFungibleTokenIssuerSimulator.create({ issuerPk: 0n }),
      ERR.zeroKey,
    );
  });

  // The remaining guards are reachable only from a constructor, so a mock
  // built to fail construction drives them. Dry only: nothing to deploy.
  describe.skipIf(isLiveBackend())('constructor misuse', () => {
    const TWICE = 0n;
    const GATE_FIRST = 1n;
    const ROTATE_FIRST = 2n;
    const SET_FIRST = 3n;

    const construct = (misuse: bigint): Promise<void> =>
      new CircuitContextManager(
        new MockInit(
          ConfidentialNoteFungibleTokenIssuerWitnesses({
            secretKey: ISSUER_SK,
          }),
        ),
        {},
        '0'.repeat(64),
        dummyContractAddress(),
        0,
        ISSUER,
        INSTANCE_SALT,
        misuse,
      ).init();

    it('should not initialize twice', async () => {
      await expectRejection(construct(TWICE), ERR.alreadyInitialized);
    });

    it('should not run the gate before initialize', async () => {
      await expectRejection(construct(GATE_FIRST), ERR.notInitialized);
    });

    it('should not rotate before initialize', async () => {
      await expectRejection(construct(ROTATE_FIRST), ERR.notInitialized);
    });

    it('should not set the issuer before initialize', async () => {
      await expectRejection(construct(SET_FIRST), ERR.notInitialized);
    });
  });
});

// ---------------------------------------------------------------------------
// assertOnlyIssuer
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer: assertOnlyIssuer', () => {
  beforeEach(async () => {
    token = await deployAs(ISSUER_SK);
  });

  it('should pass for the issuer secret', async () => {
    await token.assertOnlyIssuer();
  });

  it('should not pass for another secret', async () => {
    token.wallet.secretKey = MALLORY_SK;

    await expectRejection(token.assertOnlyIssuer(), ERR.notIssuer);
  });

  it('should not pass for the zero secret', async () => {
    token.wallet.secretKey = ZERO_SK;

    await expectRejection(token.assertOnlyIssuer(), ERR.notIssuer);
  });

  it('should pass again on every call with the same secret', async () => {
    await token.assertOnlyIssuer();
    await token.assertOnlyIssuer();

    await token.assertOnlyIssuer();
  });

  it('should leave the ledger unchanged when it passes', async () => {
    const before = await issuerCells();

    await token.assertOnlyIssuer();

    expect(await issuerCells()).toStrictEqual(before);
  });

  it('should leave the ledger unchanged when it fails', async () => {
    const before = await issuerCells();
    token.wallet.secretKey = MALLORY_SK;

    await expectRejection(token.assertOnlyIssuer(), ERR.notIssuer);
    expect(await issuerCells()).toStrictEqual(before);
  });

  // The core's identity of the same secret and salt, installed as the issuer
  // key: the tags differ, so the issuer's own secret cannot match it.
  it("should not accept the core's note identity of the issuer secret as the key", async () => {
    token = await ConfidentialNoteFungibleTokenIssuerSimulator.create({
      wallet: { secretKey: ISSUER_SK },
      issuerPk: composed.derivePk(ISSUER_SK, INSTANCE_SALT),
    });

    await expectRejection(token.assertOnlyIssuer(), ERR.notIssuer);
  });
});

// ---------------------------------------------------------------------------
// Instance salt
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer: instance salt', () => {
  it('should not pass for a secret whose key was derived under another salt', async () => {
    token = await ConfidentialNoteFungibleTokenIssuerSimulator.create({
      wallet: { secretKey: ISSUER_SK },
      instanceSalt: OTHER_SALT,
      issuerPk: ISSUER,
    });

    await expectRejection(token.assertOnlyIssuer(), ERR.notIssuer);
  });

  it('should pass for the same secret with its key derived under the deployment salt', async () => {
    token = await ConfidentialNoteFungibleTokenIssuerSimulator.create({
      wallet: { secretKey: ISSUER_SK },
      instanceSalt: OTHER_SALT,
    });

    expect((await issuerCells()).issuerPk).toBe(
      issuer.derivePk(ISSUER_SK, OTHER_SALT),
    );
    expect((await issuerCells()).issuerPk).not.toBe(ISSUER);
    await token.assertOnlyIssuer();
  });
});

// ---------------------------------------------------------------------------
// rotateIssuer
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer: rotateIssuer', () => {
  beforeEach(async () => {
    token = await deployAs(ISSUER_SK);
  });

  it('should set the issuer key and nothing else', async () => {
    const before = await issuerCells();

    await token.rotateIssuer(SUCCESSOR);

    expect(await issuerCells()).toStrictEqual({
      ...before,
      issuerPk: SUCCESSOR,
    });
  });

  it('should reject the old secret and accept the new one', async () => {
    await token.rotateIssuer(SUCCESSOR);

    await expectRejection(token.assertOnlyIssuer(), ERR.notIssuer);
    token.wallet.secretKey = SUCCESSOR_SK;
    await token.assertOnlyIssuer();
  });

  it('should let the new issuer rotate back to the first key', async () => {
    await token.rotateIssuer(SUCCESSOR);
    token.wallet.secretKey = SUCCESSOR_SK;
    await token.rotateIssuer(ISSUER);

    expect((await issuerCells()).issuerPk).toBe(ISSUER);
    await expectRejection(token.assertOnlyIssuer(), ERR.notIssuer);
    token.wallet.secretKey = ISSUER_SK;
    await token.assertOnlyIssuer();
  });

  it('should keep the issuer when rotated to the current key', async () => {
    const before = await issuerCells();

    await token.rotateIssuer(ISSUER);

    expect(await issuerCells()).toStrictEqual(before);
    await token.assertOnlyIssuer();
  });

  it('should not accept a zero key', async () => {
    const before = await issuerCells();

    await expectRejection(token.rotateIssuer(0n), ERR.zeroKey);
    expect(await issuerCells()).toStrictEqual(before);
  });

  it('should not let another secret rotate', async () => {
    const before = await issuerCells();
    token.wallet.secretKey = MALLORY_SK;

    await expectRejection(
      token.rotateIssuer(issuer.derivePk(MALLORY_SK, INSTANCE_SALT)),
      ERR.notIssuer,
    );
    expect(await issuerCells()).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------
// _setIssuer
// ---------------------------------------------------------------------------

/** The standalone mock re-exports `_setIssuer` with no gate in front of it. */
describe('ConfidentialNoteFungibleTokenIssuer: _setIssuer', () => {
  beforeEach(async () => {
    token = await deployAs(ISSUER_SK);
    token.wallet.secretKey = MALLORY_SK;
  });

  it('should set the issuer key for a caller with no issuer secret', async () => {
    const before = await issuerCells();

    await token._setIssuer(SUCCESSOR);

    expect(await issuerCells()).toStrictEqual({
      ...before,
      issuerPk: SUCCESSOR,
    });
  });

  it('should reject the old secret and accept the new one', async () => {
    await token._setIssuer(SUCCESSOR);

    token.wallet.secretKey = ISSUER_SK;
    await expectRejection(token.assertOnlyIssuer(), ERR.notIssuer);
    token.wallet.secretKey = SUCCESSOR_SK;
    await token.assertOnlyIssuer();
  });

  it('should accept the smallest and the largest non-zero key', async () => {
    await token._setIssuer(1n);
    expect((await issuerCells()).issuerPk).toBe(1n);

    await token._setIssuer(P - 1n);
    expect((await issuerCells()).issuerPk).toBe(P - 1n);
  });

  it('should not accept a zero key', async () => {
    const before = await issuerCells();

    await expectRejection(token._setIssuer(0n), ERR.zeroKey);
    expect(await issuerCells()).toStrictEqual(before);
  });
});

// ---------------------------------------------------------------------------
// Composed with the core
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer: composed with the core', () => {
  let issued: ConfidentialNoteFungibleTokenIssuedSimulator;

  /** Every cell both modules publish, in a form `toStrictEqual` compares. */
  const composedCells = async () => {
    const state = await issued.getPublicState();
    return {
      coreInitialized: state.Core__isInitialized,
      coreSalt: hex(state.Core__instanceSalt),
      commitments: state.Core__commitments.firstFree(),
      nullifiers: state.Core__nullifiers.size(),
      issuedNonces: state.Core__issuedNonces.size(),
      issuerInitialized: state.Issuer__isInitialized,
      issuerSalt: hex(state.Issuer__instanceSalt),
      issuerPk: state.Issuer__issuerPk,
    };
  };

  beforeEach(async () => {
    issued = await ConfidentialNoteFungibleTokenIssuedSimulator.create({
      issuerWallet: { secretKey: ISSUER_SK },
    });
  });

  it('should mint for the issuer', async () => {
    const note = await issued.mint(RECIPIENT, 100n);

    expect(note.value).toBe(100n);
    expect((await composedCells()).commitments).toBe(1n);
  });

  it('should not mint for another secret and leave the ledger unchanged', async () => {
    const before = await composedCells();
    issued.issuerWallet.secretKey = MALLORY_SK;

    await expectRejection(issued.mint(RECIPIENT, 100n), ERR.notIssuer);
    expect(await composedCells()).toStrictEqual(before);
  });

  // The gate consumes nothing; the core's issued-nonce set is what makes each
  // mint single-use.
  it('should mint twice in a row with one secret', async () => {
    const first = await issued.mint(RECIPIENT, 100n);
    const second = await issued.mint(RECIPIENT, 100n);

    expect(second.nonce).not.toBe(first.nonce);
    const cells = await composedCells();
    expect(cells.commitments).toBe(2n);
    expect(cells.issuedNonces).toBe(2n);
  });

  it('should move minting to the new issuer after rotation', async () => {
    await issued.rotateIssuer(SUCCESSOR);

    await expectRejection(issued.mint(RECIPIENT, 100n), ERR.notIssuer);
    issued.issuerWallet.secretKey = SUCCESSOR_SK;
    await issued.mint(RECIPIENT, 100n);
    expect((await composedCells()).commitments).toBe(1n);
  });

  it('should not let another secret rotate and leave the ledger unchanged', async () => {
    const before = await composedCells();
    issued.issuerWallet.secretKey = MALLORY_SK;

    await expectRejection(
      issued.rotateIssuer(issuer.derivePk(MALLORY_SK, INSTANCE_SALT)),
      ERR.notIssuer,
    );
    expect(await composedCells()).toStrictEqual(before);
  });

  it('should not expose _setIssuer', () => {
    const witnesses = {
      ...ConfidentialNoteFungibleTokenWitnesses(createNoteWallet()),
      ...ConfidentialNoteFungibleTokenIssuerWitnesses(createIssuerWallet()),
    };

    expect(
      Object.keys(new MockIssued(witnesses).impureCircuits).sort(),
    ).toStrictEqual(['mint', 'rotateIssuer']);
    expect(
      Object.keys(
        new MockIssuer(
          ConfidentialNoteFungibleTokenIssuerWitnesses(createIssuerWallet()),
        ).impureCircuits,
      ).sort(),
    ).toStrictEqual(['_setIssuer', 'assertOnlyIssuer', 'rotateIssuer']);
  });
});

// ---------------------------------------------------------------------------
// Simulator wiring
// ---------------------------------------------------------------------------

describe('ConfidentialNoteFungibleTokenIssuer: simulator wiring', () => {
  it('should key a default deployment to a fresh wallet', async () => {
    token = await ConfidentialNoteFungibleTokenIssuerSimulator.create();

    expect((await issuerCells()).issuerPk).toBe(
      issuer.derivePk(token.wallet.secretKey, INSTANCE_SALT),
    );
    await token.assertOnlyIssuer();
  });

  it('should answer from explicit witnesses and leave the wallet disconnected', async () => {
    token = await ConfidentialNoteFungibleTokenIssuerSimulator.create({
      witnesses: ConfidentialNoteFungibleTokenIssuerWitnesses({
        secretKey: ISSUER_SK,
      }),
      issuerPk: ISSUER,
    });
    token.wallet.secretKey = MALLORY_SK;

    await token.assertOnlyIssuer();
  });

  it('should key a default composed deployment to fresh wallets', async () => {
    const issued = await ConfidentialNoteFungibleTokenIssuedSimulator.create();

    expect((await issued.getPublicState()).Issuer__issuerPk).toBe(
      composed.deriveIssuerPk(issued.issuerWallet.secretKey, INSTANCE_SALT),
    );
    await expect(issued.mint(RECIPIENT, 1n)).resolves.toMatchObject({
      value: 1n,
    });
  });

  it('should deploy the composition under a given salt and key', async () => {
    const issued = await ConfidentialNoteFungibleTokenIssuedSimulator.create({
      wallet: createNoteWallet(),
      issuerWallet: { secretKey: ISSUER_SK },
      instanceSalt: OTHER_SALT,
      issuerPk: issuer.derivePk(ISSUER_SK, OTHER_SALT),
    });
    const state = await issued.getPublicState();

    expect(state.Core__instanceSalt).toStrictEqual(OTHER_SALT);
    expect(state.Issuer__instanceSalt).toStrictEqual(OTHER_SALT);
    await expect(issued.mint(RECIPIENT, 1n)).resolves.toMatchObject({
      value: 1n,
    });
  });

  // `_create` skips `create`'s wiring, so the factory's fallback wallet
  // answers: a fresh random secret that matches no key a spec chose.
  describe.skipIf(isLiveBackend())('fallback witnesses', () => {
    it('should fall back to a fresh random issuer secret without explicit witnesses', async () => {
      const bare = await ConfidentialNoteFungibleTokenIssuerSimulator._create([
        ISSUER,
        INSTANCE_SALT,
      ]);

      await expectRejection(
        bare.circuits.impure.assertOnlyIssuer(),
        ERR.notIssuer,
      );
    });

    it('should fall back to fresh random secrets for the composition', async () => {
      const bare = await ConfidentialNoteFungibleTokenIssuedSimulator._create([
        INSTANCE_SALT,
        ISSUER,
      ]);

      await expectRejection(
        bare.circuits.impure.mint(RECIPIENT, 1n),
        ERR.notIssuer,
      );
    });
  });

  it('should answer the composed gate from explicit witnesses', async () => {
    const issued = await ConfidentialNoteFungibleTokenIssuedSimulator.create({
      witnesses: {
        ...ConfidentialNoteFungibleTokenWitnesses(createNoteWallet()),
        ...ConfidentialNoteFungibleTokenIssuerWitnesses({
          secretKey: ISSUER_SK,
        }),
      },
      issuerPk: ISSUER,
    });
    issued.issuerWallet.secretKey = MALLORY_SK;

    await expect(issued.mint(RECIPIENT, 1n)).resolves.toMatchObject({
      value: 1n,
    });
  });
});
