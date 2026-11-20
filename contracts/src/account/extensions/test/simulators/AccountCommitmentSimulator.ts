import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockAccountCommitment,
} from '../../../../../artifacts/account/extensions/test/mocks/MockAccountCommitment/contract/index.js';

// The AccountCommitment module is stateless and declares no witnesses, so the
// private state and witness set are both empty.
export type AccountCommitmentPrivateState = Record<string, never>;
export const AccountCommitmentPrivateState: AccountCommitmentPrivateState = {};
export const AccountCommitmentWitnesses = () => ({});

/**
 * Type constructor args
 */
type AccountCommitmentArgs = readonly [];

const AccountCommitmentSimulatorBase = createSimulator<
  AccountCommitmentPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof AccountCommitmentWitnesses>,
  MockAccountCommitment<AccountCommitmentPrivateState>,
  AccountCommitmentArgs
>({
  contractFactory: (witnesses) =>
    new MockAccountCommitment<AccountCommitmentPrivateState>(witnesses),
  defaultPrivateState: () => AccountCommitmentPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => AccountCommitmentWitnesses(),
  artifactName: 'MockAccountCommitment',
});

/**
 * AccountCommitment Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class AccountCommitmentSimulator extends AccountCommitmentSimulatorBase {
  static async create(
    options: SimulatorOptions<
      AccountCommitmentPrivateState,
      ReturnType<typeof AccountCommitmentWitnesses>
    > = {},
  ): Promise<AccountCommitmentSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<AccountCommitmentSimulator>;
  }

  /** @description `AccountCommitment.commit`. */
  public commit(
    domain: Uint8Array,
    publicKey: Uint8Array,
    blinding: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.commit(domain, publicKey, blinding);
  }
}
