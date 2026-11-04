import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  Contract as ComposedEscrowBypass,
  ledger,
} from '../../../artifacts/ComposedEscrowBypass/contract/index.js';
import {
  ConfidentialFungibleTokenPrivateState,
  ConfidentialFungibleTokenWitnesses,
  DEFAULT_RANDOMNESS_SEED,
} from '../../../src/token/test/witnesses/ConfidentialFungibleTokenWitnesses.js';
import {
  makeUser,
  type TestUser,
  TOKEN_DECIMALS,
  TOKEN_NAME,
  TOKEN_SYMBOL,
} from './confidentialFungibleTokenPublicSupply.js';

/**
 * Integration fixture for `test/integration/_mocks/ComposedEscrowBypass`: the
 * production token module plus a composing-contract entry point that writes
 * the exported `_escrow` map directly. Reuses the base token's witnesses and
 * private state verbatim.
 */
type ComposedEscrowBypassArgs = readonly [
  name: string,
  symbol: string,
  decimals: bigint,
];

const Base = createSimulator<
  ConfidentialFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenWitnesses>,
  ComposedEscrowBypass<ConfidentialFungibleTokenPrivateState>,
  ComposedEscrowBypassArgs
>({
  contractFactory: (witnesses) =>
    new ComposedEscrowBypass<ConfidentialFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => ConfidentialFungibleTokenPrivateState.generate(),
  contractArgs: (name, symbol, decimals) => [name, symbol, decimals],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ConfidentialFungibleTokenWitnesses(),
  artifactName: 'ComposedEscrowBypass',
});

export class ComposedEscrowBypassSimulator extends Base {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    options: SimulatorOptions<
      ConfidentialFungibleTokenPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenWitnesses>
    > = {},
  ): Promise<ComposedEscrowBypassSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals],
      options,
    ) as Promise<ComposedEscrowBypassSimulator>;
  }

  public register(): Promise<Uint8Array> {
    return this.circuits.impure.register();
  }

  public transferFrom(
    fromAddress: Uint8Array,
    to: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure.transferFrom(fromAddress, to, value);
  }

  public _burnFrom(
    fromAddress: Uint8Array,
    value: bigint,
  ): Promise<Uint8Array> {
    return this.circuits.impure._burnFrom(fromAddress, value);
  }

  /** @description The bypass: a zero escrow entry written without `approve`. */
  public plantEscrow(owner: Uint8Array, spender: Uint8Array): Promise<[]> {
    return this.circuits.impure.plantEscrow(owner, spender);
  }

  public readonly privateState = {
    switchIdentity: (
      newSK: Uint8Array,
      newEK: Uint8Array,
    ): Promise<ConfidentialFungibleTokenPrivateState> =>
      this.updatePrivateState((current) => ({
        secretKey: newSK,
        encryptionKey: newEK,
        plaintextCache: new Map<string, bigint>(),
        randomnessSeed: current.randomnessSeed ?? DEFAULT_RANDOMNESS_SEED,
      })),
  };
}

export const CHARLIE = makeUser('CHARLIE');

/** Deploys a fresh bypass contract with the shared token metadata. */
export function deployBypass(): Promise<ComposedEscrowBypassSimulator> {
  return ComposedEscrowBypassSimulator.create(
    TOKEN_NAME,
    TOKEN_SYMBOL,
    TOKEN_DECIMALS,
  );
}

/** Switches the active identity to `user`. */
export async function actAs(
  cft: ComposedEscrowBypassSimulator,
  user: TestUser,
): Promise<void> {
  await cft.privateState.switchIdentity(user.secretKey, user.encryptionKey);
}

/** Switches the active identity to `user` and registers their account. */
export async function registerAs(
  cft: ComposedEscrowBypassSimulator,
  user: TestUser,
): Promise<void> {
  await actAs(cft, user);
  await cft.register();
}
