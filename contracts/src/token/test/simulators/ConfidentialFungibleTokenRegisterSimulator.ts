import type { JubjubPoint } from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import { deriveEncryptionPk } from '#test-utils/fixtures/elgamal.js';
import {
  ledger,
  Contract as MockCFTRegister,
} from '../../../../artifacts/token/test/mocks/MockConfidentialFungibleTokenRegister/contract/index.js';
import {
  ConfidentialFungibleTokenPrivateState,
  ConfidentialFungibleTokenWitnesses,
} from '../witnesses/ConfidentialFungibleTokenWitnesses.js';

type Args = readonly [name: string, symbol: string, decimals: bigint];

const Base = createSimulator<
  ConfidentialFungibleTokenPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof ConfidentialFungibleTokenWitnesses>,
  MockCFTRegister<ConfidentialFungibleTokenPrivateState>,
  Args
>({
  contractFactory: (witnesses) =>
    new MockCFTRegister<ConfidentialFungibleTokenPrivateState>(witnesses),
  defaultPrivateState: () => ConfidentialFungibleTokenPrivateState.generate(),
  contractArgs: (name, symbol, decimals) => [name, symbol, decimals],
  ledgerExtractor: ledger,
  witnessesFactory: () => ConfidentialFungibleTokenWitnesses(),
  artifactName: 'MockConfidentialFungibleTokenRegister',
});

/**
 * Drives the registration-only CFT slice. Exists so `registerWithKey` can be
 * proven on the local node, where the full base mock is too large to deploy.
 */
export class ConfidentialFungibleTokenRegisterSimulator extends Base {
  static async create(
    name: string,
    symbol: string,
    decimals: bigint,
    options: SimulatorOptions<
      ConfidentialFungibleTokenPrivateState,
      ReturnType<typeof ConfidentialFungibleTokenWitnesses>
    > = {},
  ): Promise<ConfidentialFungibleTokenRegisterSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [name, symbol, decimals],
      options,
    ) as Promise<ConfidentialFungibleTokenRegisterSimulator>;
  }

  /** Registers the active identity with the key derived from its EK. */
  public async register(): Promise<Uint8Array> {
    const ek = (await this.getPrivateState()).encryptionKey;
    return this.registerWithKey(deriveEncryptionPk(ek));
  }

  public registerWithKey(pk: JubjubPoint): Promise<Uint8Array> {
    return this.circuits.impure.registerWithKey(pk);
  }

  public isRegistered(account: Uint8Array): Promise<boolean> {
    return this.circuits.impure.isRegistered(account);
  }
}
