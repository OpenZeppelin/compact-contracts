import { describe, expect, it } from 'vitest';
import { createParties, labelledSecret } from '../parties.js';

describe('concurrency parties: labelledSecret', () => {
  it('should derive the same bytes for the same label', () => {
    expect(labelledSecret('alice')).toStrictEqual(labelledSecret('alice'));
  });

  it('should derive different bytes for different labels', () => {
    expect(labelledSecret('alice')).not.toStrictEqual(labelledSecret('bob'));
  });

  it('should zero-pad to the requested width', () => {
    const secret = labelledSecret('ab', 4);

    expect(secret).toStrictEqual(new Uint8Array([0x61, 0x62, 0x00, 0x00]));
  });

  it('should not silently truncate a label that does not fit', () => {
    expect(() => labelledSecret('alice', 4)).toThrow(
      "labelledSecret: 'alice' needs 5 bytes, limit is 4",
    );
  });
});

describe('concurrency parties: createParties', () => {
  // Stands in for a contract instance; only identity matters here.
  const factory = {
    wallet: (label: string) => ({ secret: labelledSecret(label) }),
    contract: (wallet: { secret: Uint8Array }) => ({ boundTo: wallet }),
  };

  it('should give every party its own wallet and contract', () => {
    const { parties } = createParties(['alice', 'bob'], factory);

    expect(Object.keys(parties)).toStrictEqual(['alice', 'bob']);
    expect(parties.alice.name).toBe('alice');
    expect(parties.alice.wallet).not.toBe(parties.bob.wallet);
    expect(parties.alice.contract).not.toBe(parties.bob.contract);
  });

  it('should bind each contract to that party wallet', () => {
    const { parties } = createParties(['alice'], factory);

    // The witnesses have to read the party's own inputs, or two "parties" would
    // race with one identity.
    expect(parties.alice.contract.boundTo).toBe(parties.alice.wallet);
  });

  it('should seed each wallet from the party name', () => {
    const { parties } = createParties(['alice'], factory);

    expect(parties.alice.wallet.secret).toStrictEqual(labelledSecret('alice'));
  });

  it('should expose contracts keyed the way Call.actor names them', () => {
    const { parties, contracts } = createParties(['alice', 'bob'], factory);

    expect(contracts.alice).toBe(parties.alice.contract);
    expect(contracts.bob).toBe(parties.bob.contract);
  });

  it('should return nothing for no names', () => {
    const { parties, contracts } = createParties([], factory);

    expect(parties).toStrictEqual({});
    expect(contracts).toStrictEqual({});
  });
});
