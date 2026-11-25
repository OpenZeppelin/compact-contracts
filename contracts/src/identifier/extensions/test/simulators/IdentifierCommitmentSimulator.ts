import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockIdentifierCommitment,
} from '../../../../../artifacts/identifier/extensions/test/mocks/MockIdentifierCommitment/contract/index.js';

// The IdentifierCommitment module is stateless and declares no witnesses, so the
// private state and witness set are both empty.
export type IdentifierCommitmentPrivateState = Record<string, never>;
export const IdentifierCommitmentPrivateState: IdentifierCommitmentPrivateState =
  {};
export const IdentifierCommitmentWitnesses = () => ({});

/**
 * Type constructor args
 */
type IdentifierCommitmentArgs = readonly [];

const IdentifierCommitmentSimulatorBase = createSimulator<
  IdentifierCommitmentPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof IdentifierCommitmentWitnesses>,
  MockIdentifierCommitment<IdentifierCommitmentPrivateState>,
  IdentifierCommitmentArgs
>({
  contractFactory: (witnesses) =>
    new MockIdentifierCommitment<IdentifierCommitmentPrivateState>(witnesses),
  defaultPrivateState: () => IdentifierCommitmentPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => IdentifierCommitmentWitnesses(),
  artifactName: 'MockIdentifierCommitment',
});

/**
 * IdentifierCommitment Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class IdentifierCommitmentSimulator extends IdentifierCommitmentSimulatorBase {
  static async create(
    options: SimulatorOptions<
      IdentifierCommitmentPrivateState,
      ReturnType<typeof IdentifierCommitmentWitnesses>
    > = {},
  ): Promise<IdentifierCommitmentSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<IdentifierCommitmentSimulator>;
  }

  /** @description `IdentifierCommitment.commit`. */
  public commit(
    domain: Uint8Array,
    publicKey: Uint8Array,
    blinding: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.commit(domain, publicKey, blinding);
  }
}
