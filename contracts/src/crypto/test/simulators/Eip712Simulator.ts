import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockEip712,
} from '../../../../artifacts/MockEip712/contract/index.js';

// The Eip712 module is stateless and declares no witnesses, so the private
// state and witness set are both empty.
export type Eip712PrivateState = Record<string, never>;
export const Eip712PrivateState: Eip712PrivateState = {};
export const Eip712Witnesses = () => ({});

/**
 * Type constructor args
 */
type Eip712Args = readonly [];

const Eip712SimulatorBase = createSimulator<
  Eip712PrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof Eip712Witnesses>,
  MockEip712<Eip712PrivateState>,
  Eip712Args
>({
  contractFactory: (witnesses) => new MockEip712<Eip712PrivateState>(witnesses),
  defaultPrivateState: () => Eip712PrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => Eip712Witnesses(),
  artifactName: 'MockEip712',
});

/**
 * Eip712 Simulator
 */
export class Eip712Simulator extends Eip712SimulatorBase {
  static async create(
    options: SimulatorOptions<
      Eip712PrivateState,
      ReturnType<typeof Eip712Witnesses>
    > = {},
  ): Promise<Eip712Simulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<Eip712Simulator>;
  }

  /**
   * @description The domain separator for `(name, version, salt)`.
   */
  public domainSeparator(
    hashedName: Uint8Array,
    hashedVersion: Uint8Array,
    salt: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.domainSeparator(
      hashedName,
      hashedVersion,
      salt,
    );
  }

  /**
   * @description Wraps a struct hash in the typed-data envelope.
   * @param separator The domain separator, fixed at deployment.
   * @param structHash `keccak256(typeHash || the operation's EVM ABI words)`.
   * @returns The digest to verify signatures against.
   */
  public hashTypedData(
    separator: Uint8Array,
    structHash: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.impure.hashTypedData(separator, structHash);
  }
}
