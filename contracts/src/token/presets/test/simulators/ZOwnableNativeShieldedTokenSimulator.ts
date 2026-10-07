import {
  CompactTypeBytes,
  CompactTypeVector,
  convertBigintToBytes,
  persistentHash,
} from '@midnight-ntwrk/compact-runtime';
import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  type ContractAddress,
  type Either,
  ledger,
  type Maybe,
  Contract as MockZOwnableNativeShieldedToken,
  type ShieldedCoinInfo,
  type ZswapCoinPublicKey,
} from '../../../../../artifacts/MockZOwnableNativeShieldedToken/contract/index.js';
import {
  ZOwnablePKPrivateState,
  ZOwnablePKWitnesses,
} from '../../../../access/test/witnesses/ZOwnablePKWitnesses.js';

type ZOwnableNativeShieldedTokenArgs = readonly [
  ownerId: Uint8Array,
  instanceSalt: Uint8Array,
  tokenDomain: Uint8Array,
  name: string,
  symbol: string,
  decimals: bigint,
  isInit: boolean,
];

type ZOwnableNativeShieldedTokenLedger = ReturnType<typeof ledger>;

/**
 * Base simulator
 * @dev We deliberately use `any` as the base simulator type.
 * This workaround is necessary due to type inference and declaration filegen
 * in a monorepo environment. Attempting to fully preserve type information
 * turns into type gymnastics.
 *
 * `any` can be safely removed once the contract simulator is consumed
 * as a properly packaged dependency (outside the monorepo).
 */
const ZOwnableNativeShieldedTokenSimulatorBase: any = createSimulator<
  ZOwnablePKPrivateState,
  ZOwnableNativeShieldedTokenLedger,
  ReturnType<typeof ZOwnablePKWitnesses>,
  MockZOwnableNativeShieldedToken<ZOwnablePKPrivateState>,
  ZOwnableNativeShieldedTokenArgs
>({
  contractFactory: (witnesses) =>
    new MockZOwnableNativeShieldedToken<ZOwnablePKPrivateState>(witnesses),
  defaultPrivateState: () => ZOwnablePKPrivateState.generate(),
  contractArgs: (
    ownerId,
    instanceSalt,
    tokenDomain,
    name,
    symbol,
    decimals,
    isInit,
  ) => [ownerId, instanceSalt, tokenDomain, name, symbol, decimals, isInit],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () =>
    ZOwnablePKWitnesses<ZOwnableNativeShieldedTokenLedger>(),
  artifactName: 'MockZOwnableNativeShieldedToken',
});

export class ZOwnableNativeShieldedTokenSimulator extends ZOwnableNativeShieldedTokenSimulatorBase {
  static async create(
    ownerId: Uint8Array,
    instanceSalt: Uint8Array,
    tokenDomain: Uint8Array,
    name: string,
    symbol: string,
    decimals: bigint,
    isInit: boolean,
    options: SimulatorOptions<
      ZOwnablePKPrivateState,
      ReturnType<typeof ZOwnablePKWitnesses>
    > = {},
  ): Promise<ZOwnableNativeShieldedTokenSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      [ownerId, instanceSalt, tokenDomain, name, symbol, decimals, isInit],
      options,
    ) as Promise<ZOwnableNativeShieldedTokenSimulator>;
  }

  public mint(
    recipient: ZswapCoinPublicKey,
    amount: bigint,
    nonce: Uint8Array,
  ): Promise<ShieldedCoinInfo> {
    return this.circuits.impure.mint(recipient, amount, nonce);
  }

  /** Burns `amount` of a coin the caller pays in; the remainder goes to `refundTo`. */
  public burn(
    coin: ShieldedCoinInfo,
    amount: bigint,
    refundTo: ZswapCoinPublicKey,
  ): Promise<Maybe<ShieldedCoinInfo>> {
    return this.circuits.impure.burn(coin, amount, refundTo);
  }

  public transferOwnership(newOwnerId: Uint8Array): Promise<[]> {
    return this.circuits.impure.transferOwnership(newOwnerId);
  }

  public renounceOwnership(): Promise<[]> {
    return this.circuits.impure.renounceOwnership();
  }

  /** Returns the current owner commitment. */
  public owner(): Promise<Uint8Array> {
    return this.circuits.impure.owner();
  }

  public _computeOwnerId(
    pk: Either<ZswapCoinPublicKey, ContractAddress>,
    nonce: Uint8Array,
  ): Promise<Uint8Array> {
    return this.circuits.pure._computeOwnerId(pk, nonce);
  }

  public totalMinted(): Promise<bigint> {
    return this.circuits.impure.totalMinted();
  }

  public name(): Promise<string> {
    return this.circuits.impure.name();
  }

  public symbol(): Promise<string> {
    return this.circuits.impure.symbol();
  }

  public decimals(): Promise<bigint> {
    return this.circuits.impure.decimals();
  }

  public tokenColor(): Promise<Uint8Array> {
    return this.circuits.impure.tokenColor();
  }

  public readonly privateState = {
    injectSecretNonce: (
      newNonce: Buffer<ArrayBufferLike>,
    ): Promise<ZOwnablePKPrivateState> =>
      this.updatePrivateState({ secretNonce: newNonce }),

    getCurrentSecretNonce: async (): Promise<Uint8Array> => {
      return (await this.getPrivateState()).secretNonce;
    },
  };
}

const OWNER_DOMAIN = 'ZOwnablePK:shield:';

/** Off-chain `SHA256(pk, nonce)`, the id ZOwnablePK commits to. */
export const createIdHash = (
  pk: ZswapCoinPublicKey,
  nonce: Uint8Array,
): Uint8Array =>
  persistentHash(new CompactTypeVector(2, new CompactTypeBytes(32)), [
    pk.bytes,
    nonce,
  ]);

/** Off-chain owner commitment for `id` at `counter`. */
export const buildCommitmentFromId = (
  id: Uint8Array,
  instanceSalt: Uint8Array,
  counter: bigint,
): Uint8Array =>
  persistentHash(new CompactTypeVector(4, new CompactTypeBytes(32)), [
    id,
    instanceSalt,
    convertBigintToBytes(32, counter, ''),
    new TextEncoder().encode(OWNER_DOMAIN),
  ]);
