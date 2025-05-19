import type * as Contract from "../artifacts/MockERC721/contract/index.cjs";
import type { WitnessContext } from "@midnight-ntwrk/compact-runtime";

export type ERC721PrivateState = {
   tokenURI: string
};

export const ERC721Witnesses = {
   /**
    * @description A mock implementation of the computeTokenURI witness function
    *
    * @dev This function should be modified to meet the needs of your application
    * 
    * @param {ERC721PrivateState} privateState The private state of the contract
    * @param {string} baseURI The baseURI which is the empty string by default
    * @returns {[ERC721PrivateState, string]} A tuple of the new private state and the declared return value
    */
   computeTokenURI({ privateState }: WitnessContext<Contract.Ledger, ERC721PrivateState>, baseURI: string, tokenId: bigint): [ERC721PrivateState, string] {
      return [privateState, baseURI + privateState.tokenURI + tokenId.toString()];
   }
}
