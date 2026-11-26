import type { MerkleTreePathEntry } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  Contract as MockAllowlist,
  pureCircuits,
} from '../../../../../artifacts/token/extensions/test/mocks/MockConfidentialNoteFungibleTokenAllowlist/contract/index.js';

/** `Identifier`: a `left` public key or a `right` contract address. */
export type Identifier = Either<Uint8Array, ContractAddress>;

// The mock declares no witnesses, so the private state and witness set are
// both empty.
export type ConfidentialNoteFungibleTokenAllowlistPrivateState = Record<
  string,
  never
>;
export const ConfidentialNoteFungibleTokenAllowlistPrivateState: ConfidentialNoteFungibleTokenAllowlistPrivateState =
  {};
export const ConfidentialNoteFungibleTokenAllowlistWitnesses = () => ({});

/** The slot a path leads from: bit `i` is set when entry `i` is a right child. */
export const slotOf = (path: MerkleTreePathEntry[]): bigint =>
  path.reduce(
    (slot, entry, i) => (entry.goes_left ? slot : slot + (1n << BigInt(i))),
    0n,
  );

type Ledger = ReturnType<typeof ledger>;
type Witnesses = ReturnType<
  typeof ConfidentialNoteFungibleTokenAllowlistWitnesses
>;

const ConfidentialNoteFungibleTokenAllowlistSimulatorBase = createSimulator<
  ConfidentialNoteFungibleTokenAllowlistPrivateState,
  Ledger,
  Witnesses,
  MockAllowlist<ConfidentialNoteFungibleTokenAllowlistPrivateState>,
  readonly []
>({
  contractFactory: (witnesses) =>
    new MockAllowlist<ConfidentialNoteFungibleTokenAllowlistPrivateState>(
      witnesses,
    ),
  defaultPrivateState: () => ConfidentialNoteFungibleTokenAllowlistPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialNoteFungibleTokenAllowlistWitnesses(),
  artifactName: 'MockConfidentialNoteFungibleTokenAllowlist',
});

/**
 * ConfidentialNoteFungibleTokenAllowlist (standalone) simulator, at depth 32.
 *
 * A membership check takes the account's path as an argument, see
 * {@link allowPathOf}.
 */
export class ConfidentialNoteFungibleTokenAllowlistSimulator extends ConfidentialNoteFungibleTokenAllowlistSimulatorBase {
  static async create(
    options: SimulatorOptions<
      ConfidentialNoteFungibleTokenAllowlistPrivateState,
      Witnesses
    > = {},
  ): Promise<ConfidentialNoteFungibleTokenAllowlistSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create keeps subclass `this`
    return super.create(
      [],
      options,
    ) as Promise<ConfidentialNoteFungibleTokenAllowlistSimulator>;
  }

  /** Asserts that `account` is a member, by `path`. */
  public assertAllowed(
    account: Identifier,
    path: MerkleTreePathEntry[],
  ): Promise<[]> {
    return this.circuits.impure.assertAllowed(account, path);
  }

  /** Adds `account` to the list. Ungated. */
  public _allow(account: Identifier): Promise<[]> {
    return this.circuits.impure._allow(account);
  }

  /** Removes `account`, whose leaf `path` proves. Ungated. */
  public _disallow(
    account: Identifier,
    path: MerkleTreePathEntry[],
  ): Promise<[]> {
    return this.circuits.impure._disallow(account, path);
  }

  /**
   * The path entries of `account`'s leaf, read from the current tree.
   *
   * @throws If the account has no live leaf.
   */
  public async allowPathOf(
    account: Identifier,
  ): Promise<MerkleTreePathEntry[]> {
    const path = (
      await this.getPublicState()
    ).Allowlist__allowed.findPathForLeaf(pureCircuits.leafOf(account));
    if (path === undefined) {
      throw new Error('allowPathOf: leaf not found in tree');
    }
    return path.path;
  }
}
