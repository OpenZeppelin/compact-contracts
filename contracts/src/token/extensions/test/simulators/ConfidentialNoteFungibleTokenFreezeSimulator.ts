import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockFreeze,
  type Utils_Note as Note,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenFreeze/contract/index.js';

export type { Note };

// The mock declares no witnesses, so the private state and witness set are
// both empty.
export type ConfidentialNoteFungibleTokenFreezePrivateState = Record<
  string,
  never
>;
export const ConfidentialNoteFungibleTokenFreezePrivateState: ConfidentialNoteFungibleTokenFreezePrivateState =
  {};
export const ConfidentialNoteFungibleTokenFreezeWitnesses = () => ({});

const ConfidentialNoteFungibleTokenFreezeSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenFreezePrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialNoteFungibleTokenFreezeWitnesses>,
  MockFreeze<ConfidentialNoteFungibleTokenFreezePrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockFreeze<ConfidentialNoteFungibleTokenFreezePrivateState>(witnesses),
  defaultPrivateState: () => ConfidentialNoteFungibleTokenFreezePrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenFreezeWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenFreeze',
});

/**
 * ConfidentialNoteFungibleTokenFreeze (standalone) simulator.
 *
 * Nothing is committed: a spec builds notes by hand and derives their
 * nullifiers with {@link nullifierOf}.
 */
export class ConfidentialNoteFungibleTokenFreezeSimulator extends ConfidentialNoteFungibleTokenFreezeSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenFreezePrivateState,
      ReturnType<typeof ConfidentialNoteFungibleTokenFreezeWitnesses>
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenFreezeSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenFreezeSimulator>;
  }

  public isFrozen(nf: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isFrozen(nf);
  }

  /** Throws if `note`'s nullifier is frozen. */
  public assertNotFrozen(note: Note): Promise<[]> {
    return this.circuits.impure.assertNotFrozen(note);
  }

  /** Freezes `nf`. Ungated. */
  public _freeze(nf: Uint8Array): Promise<[]> {
    return this.circuits.impure._freeze(nf);
  }

  /** Unfreezes `nf`. Ungated. */
  public _unfreeze(nf: Uint8Array): Promise<[]> {
    return this.circuits.impure._unfreeze(nf);
  }

  public nullifierOf(note: Note): Promise<Uint8Array> {
    return this.circuits.pure.nullifierOf(note);
  }
}
