import type { CoinPublicKey } from '@midnight-ntwrk/compact-runtime';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { OwnableSimulator } from './simulators/OwnableSimulator';
import * as utils from './utils/address';

// Callers
const OWNER = utils.toHexPadded('OWNER');
const SPENDER = utils.toHexPadded('SPENDER');
const UNAUTHORIZED = utils.toHexPadded('UNAUTHORIZED');
const ZERO = utils.toHexPadded('');

// Encoded PK/Addresses
const Z_OWNER = utils.createEitherTestUser('OWNER');
const Z_RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const Z_OTHER = utils.createEitherTestUser('OTHER');
const Z_OWNER_CONTRACT =
  utils.createEitherTestContractAddress('OWNER_CONTRACT');
const Z_RECIPIENT_CONTRACT =
  utils.createEitherTestContractAddress('RECIPIENT_CONTRACT');

let ownable: OwnableSimulator;
let caller: CoinPublicKey;

describe('Ownable', () => {
  beforeEach(() => {
    ownable = new OwnableSimulator(Z_OWNER);
  });

  describe('before initialization', () => {
    it('should initialize owner', () => {
      //ownable = new OwnableSimulator(Z_OWNER);
      //const owner = ownable.owner();
      //const l = Z_OWNER
      //expect(owner).to.equal(l);
      console.log("ahhhhhhh", ownable.owner());
      console.log("ahhhhhhh2222", Z_OWNER);
    });
  });
});
