import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockBlocklist,
} from '../../../../artifacts/security/test/mocks/MockBlocklist/contract/index.js';
import {
  BlocklistPrivateState,
  BlocklistWitnesses,
} from '../witnesses/BlocklistWitnesses.js';

/**
 * Type constructor args
 */
type BlocklistArgs = readonly [];

const BlocklistSimulatorBase = createSimulator<
  BlocklistPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof BlocklistWitnesses>,
  MockBlocklist<BlocklistPrivateState>,
  BlocklistArgs
>({
  contractFactory: (witnesses) =>
    new MockBlocklist<BlocklistPrivateState>(witnesses),
  defaultPrivateState: () => BlocklistPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => BlocklistWitnesses(),
  artifactName: 'MockBlocklist',
});

/**
 * Blocklist Simulator
 */
export class BlocklistSimulator extends BlocklistSimulatorBase {
  static async create(
    options: SimulatorOptions<
      BlocklistPrivateState,
      ReturnType<typeof BlocklistWitnesses>
    > = {},
  ): Promise<BlocklistSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<BlocklistSimulator>;
  }

  /**
   * @description Returns whether `account` is currently blocked.
   * @returns True if `account` is a member of the blocklist.
   */
  public isBlocked(
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<boolean> {
    return this.circuits.impure.isBlocked(account);
  }

  /**
   * @description Asserts that `account` is not blocked.
   */
  public assertNotBlocked(
    account: Either<Uint8Array, ContractAddress>,
  ): Promise<[]> {
    return this.circuits.impure.assertNotBlocked(account);
  }

  /**
   * @description Adds `account` to the blocklist.
   */
  public block(account: Either<Uint8Array, ContractAddress>): Promise<[]> {
    return this.circuits.impure.block(account);
  }

  /**
   * @description Removes `account` from the blocklist.
   */
  public unblock(account: Either<Uint8Array, ContractAddress>): Promise<[]> {
    return this.circuits.impure.unblock(account);
  }
}
