import { beforeEach, describe, expect, it } from 'vitest';
import * as utils from '#test-utils/fixtures/address.js';
import {
  type Caller,
  OwnableCallerSimulator,
} from './simulators/OwnableCallerSimulator.js';

// The base mock authenticates through `AuthPrfAddr`, which cannot produce the
// zero account. This mock takes the caller as an argument, so a spec can act
// as it.

const zeroBytes = utils.zeroUint8Array();

const callerOf = (publicKey: Uint8Array): Caller => ({
  account: { is_left: true, left: publicKey, right: { bytes: zeroBytes } },
});

const OWNER = callerOf(new Uint8Array(32).fill(1));
const NEW_OWNER = callerOf(new Uint8Array(32).fill(2));
const ZERO = callerOf(zeroBytes);

const NOT_OWNER = 'Ownable: caller is not the owner';

const DIRT = new Uint8Array(32).fill(0xff);

const callerWith = (
  isLeft: boolean,
  left: Uint8Array,
  right: Uint8Array,
): Caller => ({
  account: { is_left: isLeft, left, right: { bytes: right } },
});

const otherZeroCallers = [
  ['contract-arm zero account', callerWith(false, zeroBytes, zeroBytes)],
  ['non-canonical zero account', callerWith(true, zeroBytes, DIRT)],
] as const;

const otherShapeCallers = [
  ['non-canonical owner account', callerWith(true, OWNER.account.left, DIRT)],
  ['contract', callerWith(false, zeroBytes, new Uint8Array(32).fill(4))],
] as const;

describe('Ownable: the zero account as caller', () => {
  let ownable: OwnableCallerSimulator;

  beforeEach(async () => {
    ownable = await OwnableCallerSimulator.create(OWNER.account);
  });

  describe('before ownership is renounced', () => {
    it('should let the owner through', async () => {
      await ownable.assertOnlyOwner(OWNER);
    });

    it('should reject the zero account', async () => {
      await expect(ownable.assertOnlyOwner(ZERO)).rejects.toThrow(NOT_OWNER);
    });

    it.each(otherZeroCallers)('should reject the %s', async (_, caller) => {
      await expect(ownable.assertOnlyOwner(caller)).rejects.toThrow(NOT_OWNER);
    });
  });

  describe('after ownership is renounced', () => {
    beforeEach(async () => {
      await ownable.renounceOwnership(OWNER);
    });

    it('should store the zero account as owner', async () => {
      expect(await ownable.owner()).toEqual(ZERO.account);
    });

    it('should reject the zero account in assertOnlyOwner', async () => {
      await expect(ownable.assertOnlyOwner(ZERO)).rejects.toThrow(NOT_OWNER);
    });

    it('should reject the zero account in transferOwnership', async () => {
      await expect(
        ownable.transferOwnership(ZERO, NEW_OWNER.account),
      ).rejects.toThrow(NOT_OWNER);
      expect(await ownable.owner()).toEqual(ZERO.account);
    });

    it('should reject the zero account in _unsafeTransferOwnership', async () => {
      await expect(
        ownable._unsafeTransferOwnership(ZERO, NEW_OWNER.account),
      ).rejects.toThrow(NOT_OWNER);
      expect(await ownable.owner()).toEqual(ZERO.account);
    });

    it('should reject the zero account in renounceOwnership', async () => {
      await expect(ownable.renounceOwnership(ZERO)).rejects.toThrow(NOT_OWNER);
    });

    it.each(otherZeroCallers)(
      'should reject the %s in assertOnlyOwner',
      async (_, caller) => {
        await expect(ownable.assertOnlyOwner(caller)).rejects.toThrow(
          NOT_OWNER,
        );
      },
    );
  });
});

describe('Ownable: a caller in another account shape', () => {
  let ownable: OwnableCallerSimulator;

  beforeEach(async () => {
    ownable = await OwnableCallerSimulator.create(OWNER.account);
  });

  describe('before ownership is renounced', () => {
    it.each(otherShapeCallers)(
      'should reject the %s in assertOnlyOwner',
      async (_, caller) => {
        await expect(ownable.assertOnlyOwner(caller)).rejects.toThrow(
          NOT_OWNER,
        );
      },
    );

    it.each(otherShapeCallers)(
      'should reject the %s in transferOwnership',
      async (_, caller) => {
        await expect(
          ownable.transferOwnership(caller, NEW_OWNER.account),
        ).rejects.toThrow(NOT_OWNER);
        expect(await ownable.owner()).toEqual(OWNER.account);
      },
    );

    it.each(otherShapeCallers)(
      'should reject the %s in renounceOwnership',
      async (_, caller) => {
        await expect(ownable.renounceOwnership(caller)).rejects.toThrow(
          NOT_OWNER,
        );
        expect(await ownable.owner()).toEqual(OWNER.account);
      },
    );
  });

  describe('after ownership is renounced', () => {
    beforeEach(async () => {
      await ownable.renounceOwnership(OWNER);
    });

    it.each(otherShapeCallers)(
      'should reject the %s in assertOnlyOwner',
      async (_, caller) => {
        await expect(ownable.assertOnlyOwner(caller)).rejects.toThrow(
          NOT_OWNER,
        );
      },
    );
  });
});
