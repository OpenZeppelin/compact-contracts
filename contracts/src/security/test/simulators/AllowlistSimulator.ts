import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockAllowlist,
} from '../../../../artifacts/MockAllowlist/contract/index.js';
import {
  AllowlistPrivateState,
  AllowlistWitnesses,
} from '../witnesses/AllowlistWitnesses.js';

/**
 * Type constructor args
 */
type AllowlistArgs = readonly [];

const AllowlistSimulatorBase = createSimulator<
  AllowlistPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof AllowlistWitnesses>,
  MockAllowlist<AllowlistPrivateState>,
  AllowlistArgs
>({
  contractFactory: (witnesses) =>
    new MockAllowlist<AllowlistPrivateState>(witnesses),
  defaultPrivateState: () => AllowlistPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => AllowlistWitnesses(),
  artifactName: 'MockAllowlist',
});

/**
 * Allowlist Simulator
 */
export class AllowlistSimulator extends AllowlistSimulatorBase {
  static async create(
    options: SimulatorOptions<
      AllowlistPrivateState,
      ReturnType<typeof AllowlistWitnesses>
    > = {},
  ): Promise<AllowlistSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<AllowlistSimulator>;
  }

  /**
   * @description Returns whether `account` is currently allowed.
   * @returns True if `account` is a member of the allowlist.
   */
  public isAllowed(account: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isAllowed(account);
  }

  /**
   * @description Asserts that `account` is allowed.
   */
  public assertAllowed(account: Uint8Array): Promise<[]> {
    return this.circuits.impure.assertAllowed(account);
  }

  /**
   * @description Adds `account` to the allowlist.
   */
  public allow(account: Uint8Array): Promise<[]> {
    return this.circuits.impure.allow(account);
  }

  /**
   * @description Removes `account` from the allowlist.
   */
  public disallow(account: Uint8Array): Promise<[]> {
    return this.circuits.impure.disallow(account);
  }
}
