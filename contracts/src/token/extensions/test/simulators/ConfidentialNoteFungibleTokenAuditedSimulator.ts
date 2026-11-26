import type {
  JubjubPoint,
  MerkleTreePathEntry,
} from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type Audit_AuditRecord as AuditRecord,
  type ContractAddress,
  type Core_Note,
  type Either,
  ledger,
  Contract as MockAudited,
  pureCircuits,
  type Audit_RecoveredRecord as RecoveredRecord,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAudited/contract/index.js';
import {
  type CustodialConfidentialNoteFungibleTokenPrivateState,
  CustodialConfidentialNoteFungibleTokenWitnesses,
  type CustodialWallet,
  createCustodialWallet,
  type ICustodialConfidentialNoteFungibleTokenWitnesses,
  NOTE_SALT,
  CustodialConfidentialNoteFungibleTokenPrivateState as PrivateState,
} from '../../../presets/test/witnesses/CustodialConfidentialNoteFungibleTokenWitnesses.js';

export type { AuditRecord, RecoveredRecord };

/** `Identifier`: a `left` public key or a `right` contract address. */
export type Identifier = Either<Uint8Array, ContractAddress>;

export type Note = Core_Note;

type Ledger = ReturnType<typeof ledger>;
type Witnesses = ICustodialConfidentialNoteFungibleTokenWitnesses<
  Ledger,
  CustodialConfidentialNoteFungibleTokenPrivateState
>;
type Options = SimulatorOptions<
  CustodialConfidentialNoteFungibleTokenPrivateState,
  Witnesses
>;

type AuditedArgs = readonly [noteSalt: Uint8Array, auditKey: JubjubPoint];

const ConfidentialNoteFungibleTokenAuditedSimulatorBase = createSimulator<
  CustodialConfidentialNoteFungibleTokenPrivateState,
  Ledger,
  Witnesses,
  MockAudited<CustodialConfidentialNoteFungibleTokenPrivateState>,
  AuditedArgs
>({
  contractFactory: (witnesses) =>
    new MockAudited<CustodialConfidentialNoteFungibleTokenPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => PrivateState.generate(),
  contractArgs: (noteSalt, auditKey) => [noteSalt, auditKey],
  ledgerExtractor: (state) => ledger(state),
  // Fallback only: `create` always passes its own witnesses.
  witnessesFactory: () =>
    CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(
      createCustodialWallet(),
    ),
  artifactName: 'MockConfidentialNoteFungibleTokenAudited',
});

/**
 * Simulator for the core + audit composition.
 *
 * The caller's secret and the seed are witness inputs: set them on
 * {@link wallet}. A spend takes the note and its path entries as arguments,
 * see {@link pathOf}. Every created note gets one `Audit__auditTrail` record.
 */
export class ConfidentialNoteFungibleTokenAuditedSimulator extends ConfidentialNoteFungibleTokenAuditedSimulatorBase {
  /** The private inputs the witnesses answer with. Mutate between calls. */
  public wallet!: CustodialWallet;

  /**
   * @param options Standard simulator options, plus the `auditKey`, the
   * `noteSalt` (default {@link NOTE_SALT}) and a `wallet` to reuse across
   * deployments. Passing `options.witnesses` takes over witness wiring
   * entirely and leaves {@link wallet} disconnected.
   */
  static async create(
    options: Options & {
      auditKey: JubjubPoint;
      noteSalt?: Uint8Array;
      wallet?: CustodialWallet;
    },
  ): Promise<ConfidentialNoteFungibleTokenAuditedSimulator> {
    const { auditKey, noteSalt, wallet: givenWallet, ...rest } = options;
    const wallet = givenWallet ?? createCustodialWallet();
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    const simulator = (await super.create([noteSalt ?? NOTE_SALT, auditKey], {
      ...rest,
      witnesses:
        rest.witnesses ??
        CustodialConfidentialNoteFungibleTokenWitnesses<Ledger>(wallet),
    })) as ConfidentialNoteFungibleTokenAuditedSimulator;
    simulator.wallet = wallet;
    return simulator;
  }

  /** Replaces the audit key. Ungated. */
  public _setAuditKey(newAuditKey: JubjubPoint): Promise<[]> {
    return this.circuits.impure._setAuditKey(newAuditKey);
  }

  /** Mints `value` to `recipientPk` and audits it. Ungated. */
  public mint(recipientPk: Identifier, value: bigint): Promise<Note> {
    return this.circuits.impure.mint(recipientPk, value);
  }

  /** Spends the caller's `note` into a recipient note plus change, both audited. */
  public transfer(
    recipientPk: Identifier,
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
  ): Promise<[Note, Note]> {
    return this.circuits.impure.transfer(recipientPk, value, note, path);
  }

  /** Burns `value` from the caller's `note` and audits the change. */
  public burn(
    value: bigint,
    note: Note,
    path: MerkleTreePathEntry[],
  ): Promise<Note> {
    return this.circuits.impure.burn(value, note, path);
  }

  /** Consumes `targetPk`'s `note` and re-mints its value to `recoveryPk`, audited. Ungated. */
  public seize(
    targetPk: Identifier,
    recoveryPk: Identifier,
    note: Note,
    path: MerkleTreePathEntry[],
  ): Promise<Note> {
    return this.circuits.impure.seize(targetPk, recoveryPk, note, path);
  }

  /**
   * The path entries of `note`'s commitment under `ownerPk`, read from the
   * current tree.
   *
   * @throws If no such leaf is committed.
   */
  public async pathOf(
    note: Note,
    ownerPk: Identifier,
  ): Promise<MerkleTreePathEntry[]> {
    const path = (
      await this.getPublicState()
    ).Core__commitments.findPathForLeaf(pureCircuits.commitOf(note, ownerPk));
    if (path === undefined) {
      throw new Error('pathOf: commitment not found in tree');
    }
    return path.path;
  }
}
