import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockIdentifier,
} from '../../../../artifacts/identifier/test/mocks/MockIdentifier/contract/index.js';

/** `ContractAddress` as the runtime passes it. */
export type ContractAddress = { bytes: Uint8Array };

/** `Either<Bytes<32>, ContractAddress>` as the runtime passes it. */
export type Identifier = {
  is_left: boolean;
  left: Uint8Array;
  right: ContractAddress;
};

// The Identifier module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type IdentifierPrivateState = Record<string, never>;
export const IdentifierPrivateState: IdentifierPrivateState = {};
export const IdentifierWitnesses = () => ({});

/**
 * Type constructor args
 */
type IdentifierArgs = readonly [];

const IdentifierSimulatorBase = createSimulator<
  IdentifierPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof IdentifierWitnesses>,
  MockIdentifier<IdentifierPrivateState>,
  IdentifierArgs
>({
  contractFactory: (witnesses) =>
    new MockIdentifier<IdentifierPrivateState>(witnesses),
  defaultPrivateState: () => IdentifierPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => IdentifierWitnesses(),
  artifactName: 'MockIdentifier',
});

/**
 * Identifier Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class IdentifierSimulator extends IdentifierSimulatorBase {
  static async create(
    options: SimulatorOptions<
      IdentifierPrivateState,
      ReturnType<typeof IdentifierWitnesses>
    > = {},
  ): Promise<IdentifierSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<IdentifierSimulator>;
  }

  /** @description `Identifier.publicKeyOf`. */
  public publicKeyOf(account: Identifier): Promise<Uint8Array> {
    return this.circuits.impure.publicKeyOf(account);
  }
}
