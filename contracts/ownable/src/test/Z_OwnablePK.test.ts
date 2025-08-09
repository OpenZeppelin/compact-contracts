import {
  type CoinPublicKey,
  convert_bigint_to_Uint8Array,
  persistentHash,
  CompactTypeVector,
  CompactTypeBytes
} from '@midnight-ntwrk/compact-runtime';
import { beforeEach, describe, expect, it } from 'vitest';
import { Z_OwnablePKSimulator } from './simulators/Z_OwnablePKSimulator.js';
import * as utils from './utils/address.js';
import { ZswapCoinPublicKey } from '../artifacts/MockOwnable/contract/index.cjs';

const OWNER = String(Buffer.from('OWNER', 'ascii').toString('hex')).padStart(
  64,
  '0',
);
const NEW_OWNER = String(
  Buffer.from('NEW_OWNER', 'ascii').toString('hex'),
).padStart(64, '0');
const UNAUTHORIZED = String(
  Buffer.from('UNAUTHORIZED', 'ascii').toString('hex'),
).padStart(64, '0');
const Z_ZERO = utils.encodeToPK('');
const Z_OWNER = utils.encodeToPK('OWNER');
const Z_NEW_OWNER = utils.encodeToPK('NEW_OWNER');
const Z_NEW_NEW_OWNER = utils.encodeToPK('Z_NEW_NEW_OWNER');
const EMPTY_BYTES = utils.ZERO_KEY.left.bytes;

// Commitments
const DOMAIN = "Z_OwnablePK:shield:";
const INIT_COUNTER = 1n;
const STATIC_NONCE = new Uint8Array(32).fill(0xab);

let ownable: Z_OwnablePKSimulator;

const createZPKCommitment = (
    domain: string,
    pk: ZswapCoinPublicKey,
    counter: bigint,
    nonce: Uint8Array
): Uint8Array => {
  const rt_type = new CompactTypeVector(4, new CompactTypeBytes(32));
  const encoder = new TextEncoder();

  const bDomain = encoder.encode(domain);
  const bPK = pk.bytes;
  const bCounter = convert_bigint_to_Uint8Array(32, counter);
  return persistentHash(rt_type, [bDomain, bPK, bCounter, nonce]);
}

describe('Z_OwnablePK', () => {
  describe('before initialize', () => {
    it('should fail when setting owner commitment as 0', () => {
      expect(() => {
        const badCommitment = new Uint8Array(32).fill(0);
        new Z_OwnablePKSimulator(badCommitment);
      }).toThrow('Invalid parameters');
    });

    it('should initialize with non-zero commitment', () => {
      const nonZeroCommitment = new Uint8Array(32).fill(1);
      ownable = new Z_OwnablePKSimulator(nonZeroCommitment);

      expect(ownable.owner()).toEqual(nonZeroCommitment);
    });
  });

  describe('after initialization', () => {
    beforeEach(() => {
      const ownerCommitment = createZPKCommitment(DOMAIN, Z_OWNER, INIT_COUNTER, STATIC_NONCE);
      ownable = new Z_OwnablePKSimulator(ownerCommitment);
    });

    describe('owner', () => {
      it('should return the correct owner commitment', () => {
        const expCommitment = createZPKCommitment(DOMAIN, Z_OWNER, INIT_COUNTER, STATIC_NONCE);
        expect(ownable.owner()).toEqual(expCommitment);
      });
    });

    describe('assertOnlyOwner', () => {
      it('should allow the authorized caller with correct nonce to call', () => {
        ownable.setCaller(OWNER);
        expect(ownable.assertOnlyOwner()).to.not.throw;
      });

      it('should fail when called by unauthorized with correct nonce', () => {
        ownable.setCaller(UNAUTHORIZED);

        expect(() => {
          ownable.assertOnlyOwner();
        }).toThrow('Forbidden');
      });
    });
  });
});
