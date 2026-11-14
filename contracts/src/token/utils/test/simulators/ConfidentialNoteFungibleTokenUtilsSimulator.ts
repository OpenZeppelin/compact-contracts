import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockConfidentialNoteFungibleTokenUtils,
  type Note,
} from '../../../../../artifacts/token/utils/test/mocks/MockConfidentialNoteFungibleTokenUtils/contract/index.js';

export type { Note };

/** `Either<Bytes<32>, ContractAddress>`, the owner key the preset commits to. */
export type Account = {
  is_left: boolean;
  left: Uint8Array;
  right: { bytes: Uint8Array };
};

// The module is stateless and declares no witnesses, so the private state and
// witness set are both empty.
export type ConfidentialNoteFungibleTokenUtilsPrivateState = Record<
  string,
  never
>;
export const ConfidentialNoteFungibleTokenUtilsPrivateState: ConfidentialNoteFungibleTokenUtilsPrivateState =
  {};
export const ConfidentialNoteFungibleTokenUtilsWitnesses = () => ({});

/**
 * Type constructor args
 */
type ConfidentialNoteFungibleTokenUtilsArgs = readonly [];

const ConfidentialNoteFungibleTokenUtilsSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenUtilsPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenUtilsWitnesses>,
  MockConfidentialNoteFungibleTokenUtils<ConfidentialNoteFungibleTokenUtilsPrivateState>,
  ConfidentialNoteFungibleTokenUtilsArgs
>({
  contractFactory: (witnesses) =>
    new MockConfidentialNoteFungibleTokenUtils<ConfidentialNoteFungibleTokenUtilsPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ConfidentialNoteFungibleTokenUtilsPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenUtilsWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenUtils',
});

/**
 * ConfidentialNoteFungibleTokenUtils Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit. The
 * `ref*` methods hash a flat preimage with the tag written out, without going
 * through the module.
 */
export class ConfidentialNoteFungibleTokenUtilsSimulator extends ConfidentialNoteFungibleTokenUtilsSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenUtilsPrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenUtilsWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenUtilsSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenUtilsSimulator>;
  }

  /** @description `commitOf` at a `Field` owner key. */
  public commitOfField(note: Note, pk: bigint): Promise<Uint8Array> {
    return this.circuits.impure.commitOfField(note, pk);
  }

  /** @description `commitOf` at an `Either<Bytes<32>, ContractAddress>` owner key. */
  public commitOfEither(note: Note, pk: Account): Promise<Uint8Array> {
    return this.circuits.impure.commitOfEither(note, pk);
  }

  /** @description `nullifierOf`. */
  public nullifierOf(note: Note): Promise<Uint8Array> {
    return this.circuits.impure.nullifierOf(note);
  }

  /** @description `issuedTagOf`. */
  public issuedTagOf(note: Note): Promise<Uint8Array> {
    return this.circuits.impure.issuedTagOf(note);
  }

  /** @description `persistentCommit` reference for {@link commitOfField}. */
  public refCommitOfField(note: Note, pk: bigint): Promise<Uint8Array> {
    return this.circuits.impure.refCommitOfField(note, pk);
  }

  /**
   * @description `persistentCommit` reference for {@link commitOfField} with
   * the key as its `Bytes<32>` cast.
   */
  public refCommitOfFieldBytes(note: Note, pk: bigint): Promise<Uint8Array> {
    return this.circuits.impure.refCommitOfFieldBytes(note, pk);
  }

  /** @description `persistentCommit` reference for {@link commitOfEither}. */
  public refCommitOfEither(note: Note, pk: Account): Promise<Uint8Array> {
    return this.circuits.impure.refCommitOfEither(note, pk);
  }

  /** @description `persistentHash` reference for {@link nullifierOf}. */
  public refNullifierOf(note: Note): Promise<Uint8Array> {
    return this.circuits.impure.refNullifierOf(note);
  }

  /** @description `persistentHash` reference for {@link issuedTagOf}. */
  public refIssuedTagOf(note: Note): Promise<Uint8Array> {
    return this.circuits.impure.refIssuedTagOf(note);
  }
}
