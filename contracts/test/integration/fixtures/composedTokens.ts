import { createSimulator } from '@openzeppelin/compact-simulator';
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
  contractArgs: (ftName, ftSymbol, ftDecimals, nftName, nftSymbol, initFT, initNFT) => [
    ftName,
    ftSymbol,
    ftDecimals,
    nftName,
    nftSymbol,
    initFT,
    initNFT,
  ],
  ledgerExtractor: (state) => ledger(state),
  witnessesFactory: () => ({}),
});

/**
 * Drives the ComposedTokens contract: production FungibleToken + NonFungibleToken
 * (same directory) composed in one contract. `initFT` / `initNFT` choose which
 * module is initialized at construction, so a test can prove the two init flags
 * are independent (the #556 fix).
 */
export class ComposedTokensSimulator extends ComposedTokensSimulatorBase {
  constructor(initFT: boolean, initNFT: boolean) {
    super(['FT', 'FTK', 18n, 'NFT', 'NFTK', initFT, initNFT], {});
  }

  public ftName(): string {
    return this.circuits.impure.ftName();
  }

  public nftName(): string {
    return this.circuits.impure.nftName();
  }
}
