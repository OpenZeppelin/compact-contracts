import {
  CoinPublicKey,
  convert_bigint_to_Uint8Array,
  convert_Uint8Array_to_bigint,
} from '@midnight-ntwrk/compact-runtime';
import { OwnableSimulator } from './simulators/OwnableSimulator';
import * as utils from './utils/address';

const OWNER = String(Buffer.from('OWNER', 'ascii').toString('hex')).padStart(
  64,
  '0',
);
const SPENDER = String(
  Buffer.from('SPENDER', 'ascii').toString('hex'),
).padStart(64, '0');
const UNAUTHORIZED = String(
  Buffer.from('UNAUTHORIZED', 'ascii').toString('hex'),
).padStart(64, '0');
const ZERO = String().padStart(64, '0');
const Z_OWNER = utils.createEitherTestUser('OWNER');
const Z_RECIPIENT = utils.createEitherTestUser('RECIPIENT');
const Z_SPENDER = utils.createEitherTestUser('SPENDER');
const Z_OTHER = utils.createEitherTestUser('OTHER');
const EMPTY_BYTES = utils.ZERO_KEY.left.bytes;
const BAD_SECRET_KEY = convert_bigint_to_Uint8Array(32, 123456789n);

let ownable: OwnableSimulator;
let caller: CoinPublicKey;
let ownerSK: Uint8Array;

describe('Ownable', () => {
  describe('initializer', () => {
    it('should initialize and set the caller as owner', () => {
      caller = OWNER;
      ownable = new OwnableSimulator(OWNER);
      expect(ownable.owner()).not.toEqual(utils.ZERO_ADDRESS);
      expect(ownable.getCurrentPublicState().ownable_Instance).toEqual(1n);
    });
  });

  beforeEach(() => {
    ownable = new OwnableSimulator(OWNER);
    ownerSK = ownable.getCurrentPrivateState().secretKey;
  });

  describe('assertOnlyOwner', () => {
    it('should allow owner to call', () => {
      ownable.assertOnlyOwner();
    });

    it('should fail with unauthorized caller', () => {
      // Change secret key in witness context
      ownable.setWitnessContext(BAD_SECRET_KEY);

      expect(() => {
        ownable.assertOnlyOwner();
      }).toThrow('Ownable: not owner');
    });

    it('should handle owner → not-owner → owner calls', () => {
      // Owner
      ownable.assertOnlyOwner();

      // Not owner
      ownable.setWitnessContext(BAD_SECRET_KEY);
      expect(() => {
        ownable.assertOnlyOwner();
      }).toThrow('Ownable: not owner');

      // Owner
      ownable.setWitnessContext(ownerSK);
      ownable.assertOnlyOwner();
    });
  });

  describe('renounceOwnership', () => {
    it('should renounce ownership', () => {
      ownable.renounceOwnership();
      expect(ownable.owner()).toEqual(EMPTY_BYTES);

      // Check that original owner can no longer call protected circuits
      expect(() => {
        ownable.assertOnlyOwner();
      }).toThrow('Ownable: not owner');
    });

    it('should not renounce ownership from non-owner', () => {
      ownable.setWitnessContext(BAD_SECRET_KEY);
      expect(() => {
        ownable.renounceOwnership();
      }).toThrow('Ownable: not owner');
    });

    it('should not renounce ownership from non-owner', () => {
      ownable.setWitnessContext(BAD_SECRET_KEY);
      expect(() => {
        ownable.renounceOwnership();
      }).toThrow('Ownable: not owner');
    });

    it('should not renounce ownership more than once', () => {
      ownable.renounceOwnership();

      expect(() => {
        ownable.renounceOwnership();
      }).toThrow('Ownable: not owner');
    });
  });
});

//const sk = ownable.getCurrentPrivateState().secretKey;
//console.log("skkkkkk", sk);
//
//ownable.setWitnessContext(BAD_SECRET_KEY);
////ownable.owner2();
//
//expect(ownable.owner()).not.toEqual(utils.ZERO_ADDRESS);
//console.log("ownerrrr after", ownable.owner());
//
//expect(() => {
//  ownable.assertOnlyOwner()
//}).toThrow('Ownable: not owner');
//
//ownable.setWitnessContext(sk);
//expect(() => {
//  ownable.assertOnlyOwner()
//}).toThrow('Ownable: not owner');
//
