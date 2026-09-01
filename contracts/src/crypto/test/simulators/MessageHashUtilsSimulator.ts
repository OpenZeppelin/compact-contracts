import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as MockMessageHashUtils,
} from '../../../../artifacts/MockMessageHashUtils/contract/index.js';

// The module is stateless and declares no witnesses, so both are empty.
export type MessageHashUtilsPrivateState = Record<string, never>;
export const MessageHashUtilsPrivateState: MessageHashUtilsPrivateState = {};
export const MessageHashUtilsWitnesses = () => ({});

/**
 * Type constructor args
 */
type MessageHashUtilsArgs = readonly [];

const MessageHashUtilsSimulatorBase = createSimulator<
  MessageHashUtilsPrivateState,
  ReturnType<typeof ledger>,
  ReturnType<typeof MessageHashUtilsWitnesses>,
  MockMessageHashUtils<MessageHashUtilsPrivateState>,
  MessageHashUtilsArgs
>({
  contractFactory: (witnesses) =>
    new MockMessageHashUtils<MessageHashUtilsPrivateState>(witnesses),
  defaultPrivateState: () => MessageHashUtilsPrivateState,
  contractArgs: () => [],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => MessageHashUtilsWitnesses(),
  artifactName: 'MockMessageHashUtils',
});

/**
 * MessageHashUtils Simulator
 *
 * Every MessageHashUtils circuit is pure (no ledger, no witnesses), so each
 * method is a thin pass-through to the compiled pure circuit.
 */
export class MessageHashUtilsSimulator extends MessageHashUtilsSimulatorBase {
  static async create(
    options: SimulatorOptions<
      MessageHashUtilsPrivateState,
      ReturnType<typeof MessageHashUtilsWitnesses>
    > = {},
  ): Promise<MessageHashUtilsSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create([], options) as Promise<MessageHashUtilsSimulator>;
  }

  /**
   * @description Encodes `value` as a 32-byte big-endian word.
   */
  public toBigEndianBytes32(value: bigint): Promise<bigint[]> {
    return this.circuits.pure.toBigEndianBytes32(value);
  }

  /**
   * @description Hashes an exact-length ASCII type string into a type hash.
   * The mock instantiates the size-generic circuit at 34, 53, 72, and 89 bytes;
   * other lengths throw.
   */
  public typeHashFromAscii(typeString: Uint8Array): Promise<Uint8Array> {
    switch (typeString.length) {
      case 34:
        return this.circuits.pure.typeHashFromAscii34(typeString);
      case 53:
        return this.circuits.pure.typeHashFromAscii53(typeString);
      case 72:
        return this.circuits.pure.typeHashFromAscii72(typeString);
      case 89:
        return this.circuits.pure.typeHashFromAscii89(typeString);
      default:
        throw new Error(
          `MockMessageHashUtils: no typeHashFromAscii instantiation for length ${typeString.length} (have 34, 53, 72, 89)`,
        );
    }
  }

  /**
   * @description Hashes a flat vector of 32-byte words. The mock instantiates
   * the size-generic circuit at 2..5 words; other lengths throw.
   */
  public hashWords(words: Uint8Array[]): Promise<Uint8Array> {
    switch (words.length) {
      case 2:
        return this.circuits.pure.hashWords2(words);
      case 3:
        return this.circuits.pure.hashWords3(words);
      case 4:
        return this.circuits.pure.hashWords4(words);
      case 5:
        return this.circuits.pure.hashWords5(words);
      default:
        throw new Error(
          `MockMessageHashUtils: no hashWords instantiation for ${words.length} words (have 2, 3, 4, 5)`,
        );
    }
  }

  /**
   * @description Builds the EIP-191 personal-sign digest of `messageHash`.
   */
  public toEthSignedMessageHash(messageHash: Uint8Array): Promise<Uint8Array> {
    return this.circuits.pure.toEthSignedMessageHash(messageHash);
  }

  /**
   * @description Builds the EIP-712 signing digest from a domain separator and
   * a struct hash.
   */
  public toTypedDataHash(ds: Uint8Array, hs: Uint8Array): Promise<Uint8Array> {
    return this.circuits.pure.toTypedDataHash(ds, hs);
  }

  /**
   * @description Computes the `EIP712Domain(string name,string version,bytes32 salt)`
   * domain separator.
   */
  public domainSeparator(
    nameHash: Uint8Array,
    versionHash: Uint8Array,
    salt: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.pure.domainSeparator(nameHash, versionHash, salt);
  }
}
