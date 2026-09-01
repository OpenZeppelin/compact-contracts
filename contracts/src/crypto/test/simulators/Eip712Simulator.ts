import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockEip712,
} from '../../../../artifacts/MockEip712/contract/index.js';

// The module declares no witnesses, so the private state is empty. Its ledger
// stays out of `ledger()` because the mock imports the module prefix-only, the
// same way the presets do.
export type Eip712PrivateState = Record<string, never>;
export const Eip712PrivateState: Eip712PrivateState = {};
export const Eip712Witnesses = () => ({});

/**
 * Type constructor args
 */
type Eip712Args = readonly [nameHash: Uint8Array, versionHash: Uint8Array];

const Eip712SimulatorBase = createSimulator<
  Eip712PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof Eip712Witnesses>,
  MockEip712<Eip712PrivateState>,
  Eip712Args
>({
  contractFactory: (witnesses) => new MockEip712<Eip712PrivateState>(witnesses),
  defaultPrivateState: () => Eip712PrivateState,
  contractArgs: (nameHash, versionHash) => [nameHash, versionHash],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => Eip712Witnesses(),
  artifactName: 'MockEip712',
});

/**
 * Eip712 Simulator
 *
 * Both circuits read the contract address via `kernel.self()`, so they are
 * impure and go through the contract-call path rather than `pureCircuits`.
 */
export class Eip712Simulator extends Eip712SimulatorBase {
  static async create(
    nameHash: Uint8Array,
    versionHash: Uint8Array,
    options: SimulatorOptions<
      Eip712PrivateState,
      ReturnType<typeof Eip712Witnesses>
    > = {},
  ): Promise<Eip712Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [nameHash, versionHash],
      options,
    ) as Promise<Eip712Simulator>;
  }

  /**
   * @description Returns this contract's EIP-712 domain separator.
   */
  public _domainSeparatorV4(): Promise<Uint8Array> {
    return this.circuits.impure._domainSeparatorV4();
  }

  /**
   * @description Wraps `structHash` into the digest an EIP-712 signer signs.
   */
  public _hashTypedDataV4(structHash: Uint8Array): Promise<Uint8Array> {
    return this.circuits.impure._hashTypedDataV4(structHash);
  }
}
