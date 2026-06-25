import {
  createSimulator,
  type SimulatorOptions,
} from '@openzeppelin/compact-simulator';
import {
  ledger,
  Contract as ComposedTokens,
} from '../../../artifacts/ComposedTokens/contract/index.js';

type EmptyPrivateState = Record<string, never>;

type ComposedTokensArgs = readonly [
  ftName: string,
  ftSymbol: string,
  ftDecimals: bigint,
  nftName: string,
  nftSymbol: string,
  initFT: boolean,
  initNFT: boolean,
];

const ComposedTokensSimulatorBase = createSimulator<
  EmptyPrivateState,
  ReturnType<typeof ledger>,
  // biome-ignore lint/complexity/noBannedTypes: the contract declares no witnesses
  {},
  ComposedTokens<EmptyPrivateState>,
  ComposedTokensArgs
>({
  contractFactory: (witnesses) =>
    new ComposedTokens<EmptyPrivateState>(witnesses),
  defaultPrivateState: () => ({}),
  contractArgs: (
    ftName,
    ftSymbol,
    ftDecimals,
    nftName,
    nftSymbol,
    initFT,
    initNFT,
  ) => [ftName, ftSymbol, ftDecimals, nftName, nftSymbol, initFT, initNFT],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ({}),
  artifactName: 'ComposedTokens',
});

/**
 * Drives the ComposedTokens contract: production FungibleToken + NonFungibleToken
 * (same directory) composed in one contract. `initFT` / `initNFT` choose which
 * module is initialized at construction, so a test can prove the two init flags
 * are independent (the #556 fix).
 */
export class ComposedTokensSimulator extends ComposedTokensSimulatorBase {
  static async create(
    initFT: boolean,
    initNFT: boolean,
    // biome-ignore lint/complexity/noBannedTypes: the contract declares no witnesses
    options: SimulatorOptions<EmptyPrivateState, {}> = {},
  ): Promise<ComposedTokensSimulator> {
    // biome-ignore lint/complexity/noThisInStatic: super.create must keep the subclass `this`
    return super.create(
      ['FT', 'FTK', 18n, 'NFT', 'NFTK', initFT, initNFT],
      options,
    ) as Promise<ComposedTokensSimulator>;
  }

  public ftName(): Promise<string> {
    return this.circuits.impure.ftName();
  }

  public nftName(): Promise<string> {
    return this.circuits.impure.nftName();
  }
}
