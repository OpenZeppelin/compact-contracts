import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockAccount,
} from '../../../../artifacts/account/test/mocks/MockAccount/contract/index.js';

/** `ContractAddress` as the runtime passes it. */
export type ContractAddress = { bytes: Uint8Array };

/** `Either<Bytes<32>, ContractAddress>` as the runtime passes it. */
export type Account = {
  is_left: boolean;
  left: Uint8Array;
  right: ContractAddress;
};

// The Account module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type AccountPrivateState = Record<string, never>;
export const AccountPrivateState: AccountPrivateState = {};
export const AccountWitnesses = () => ({});

/**
 * Type constructor args
 */
type AccountArgs = readonly [];

const AccountSimulatorBase = createSimulator<
  AccountPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof AccountWitnesses>,
  MockAccount<AccountPrivateState>,
  AccountArgs
>({
  contractFactory: (witnesses) =>
    new MockAccount<AccountPrivateState>(witnesses),
  defaultPrivateState: () => AccountPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => AccountWitnesses(),
  artifactName: 'MockAccount',
});

/**
 * Account Simulator
 *
 * Each method is a thin pass-through to the mock's matching circuit.
 */
export class AccountSimulator extends AccountSimulatorBase {
  static async create(
    options: SimulatorOptions<
      AccountPrivateState,
      ReturnType<typeof AccountWitnesses>
    > = {},
  ): Promise<AccountSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<AccountSimulator>;
  }

  /** @description `Account.publicKeyOf`. */
  public publicKeyOf(account: Account): Promise<Uint8Array> {
    return this.circuits.impure.publicKeyOf(account);
  }

  /** @description `Account.contractAddressOf`. */
  public contractAddressOf(account: Account): Promise<ContractAddress> {
    return this.circuits.impure.contractAddressOf(account);
  }
}
