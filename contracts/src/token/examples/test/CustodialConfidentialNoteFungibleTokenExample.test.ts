import { createSimulator } from '@openzeppelin/compact-simulator';
import { beforeEach, describe, expect, it } from 'vitest';
import { expectRejection } from '#test-utils/assertions/rejection.js';
import {
  type ContractAddress,
  type Either,
  Contract as Ex,
  ledger,
  pureCircuits,
} from '../../../../artifacts/token/examples/CustodialConfidentialNoteFungibleTokenExample/contract/index.js';
import {
  type CustodialConfidentialNoteFungibleTokenPrivateState,
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  type ICustodialConfidentialNoteFungibleTokenWitnesses,
  ISSUER_SALT,
  NOTE_SALT,
  CustodialConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';

type Ledger = ReturnType<typeof ledger>;
type PS = CustodialConfidentialNoteFungibleTokenPrivateState;
type Account = Either<Uint8Array, ContractAddress>;

type ExampleArgs = readonly [Account, Uint8Array, Uint8Array];

const secretKey = (label: string): Uint8Array => {
  const sk = new Uint8Array(32);
  sk.set(new TextEncoder().encode(label));
  return sk;
};

const ISSUER_SK = secretKey('ISSUER');
const ALICE_SK = secretKey('ALICE');
const ISSUER = pureCircuits.deriveAccount(ISSUER_SK, ISSUER_SALT);
const ALICE = pureCircuits.deriveAccount(ALICE_SK, NOTE_SALT);
const BOB = pureCircuits.deriveAccount(secretKey('BOB'), NOTE_SALT);

/** The witnesses answer from this wallet; a case sets the acting secret. */
const wallet: CustodialWallet = { secretKey: ISSUER_SK };

const ExampleSimulator = createSimulator<
  PS,
  Ledger,
  ICustodialConfidentialNoteFungibleTokenWitnesses<Ledger, PS>,
  Ex<PS>,
  ExampleArgs
>({
  contractFactory: (witnesses) => new Ex<PS>(witnesses),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (issuer, issuerSalt, noteSalt) => [
    issuer,
    issuerSalt,
    noteSalt,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () =>
    CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet),
  artifactName: 'CustodialConfidentialNoteFungibleTokenExample',
});

describe('CustodialConfidentialNoteFungibleTokenExample', () => {
  let ex: InstanceType<typeof ExampleSimulator>;

  beforeEach(async () => {
    wallet.secretKey = ISSUER_SK;
    ex = await ExampleSimulator.create([ISSUER, ISSUER_SALT, NOTE_SALT]);
  });

  it('should surface the preset state in ledger()', async () => {
    const state = await ex.getPublicState();

    expect(state.Token__issuerSalt).toStrictEqual(ISSUER_SALT);
    expect(state.Token__noteSalt).toStrictEqual(NOTE_SALT);
    expect(state.Token_Core__commitments.firstFree()).toStrictEqual(0n);
    expect(state.Token_Core__nullifiers.isEmpty()).toStrictEqual(true);
    expect(state.Token_Core__issuedNonces.isEmpty()).toStrictEqual(true);
    expect(state.Token_Ownable__isInitialized).toStrictEqual(true);
    expect(state.Token_Ownable__owner).toStrictEqual(ISSUER);
  });

  it('should report the owner the constructor registered', async () => {
    expect(await ex.circuits.impure.owner()).toStrictEqual(ISSUER);
  });

  it('should mint for the issuer and let the holder transfer the note', async () => {
    const note = await ex.circuits.impure.mint(ALICE, 100n);
    const path = (
      await ex.getPublicState()
    ).Token_Core__commitments.findPathForLeaf(
      pureCircuits.commitOf(note, ALICE),
    );
    if (path === undefined) throw new Error('test setup: note not committed');
    wallet.secretKey = ALICE_SK;

    const [out, change] = await ex.circuits.impure.transfer(
      BOB,
      30n,
      note,
      path.path,
    );

    expect([out.value, change.value]).toStrictEqual([30n, 70n]);
    expect(
      (await ex.getPublicState()).Token_Core__nullifiers.member(
        pureCircuits.nullifierOf(note),
      ),
    ).toStrictEqual(true);
  });

  it('should reject a deploy with equal salts', async () => {
    await expectRejection(
      ExampleSimulator.create([ISSUER, ISSUER_SALT, ISSUER_SALT]),
      'CustodialConfidentialNoteFungibleToken: salts must differ',
    );
  });
});
