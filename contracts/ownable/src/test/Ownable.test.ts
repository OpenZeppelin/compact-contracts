import { CoinPublicKey, encodeCoinPublicKey } from '@midnight-ntwrk/compact-runtime';
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

let ownable: OwnableSimulator;
let caller: CoinPublicKey;

describe('Ownable', () => {
  describe('initializer', () => {
    it('should initialize and set the caller as owner', () => {
      caller = OWNER;
      ownable = new OwnableSimulator(OWNER);
      //expect(ownable.owner()).not.toEqual(utils.ZERO_ADDRESS);
    });
  });
});
