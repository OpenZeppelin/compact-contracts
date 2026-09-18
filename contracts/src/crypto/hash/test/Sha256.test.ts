import { createHash } from 'node:crypto';
import { beforeAll, describe, expect, it } from 'vitest';
import { Sha256Simulator } from './simulators/Sha256Simulator.js';

// Expected values come from the Python reference in crypto/test/vectors.

const Q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;

const hex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');
const label = (text: string): Uint8Array => {
  const b = new Uint8Array(32);
  b.set(new TextEncoder().encode(text));
  return b;
};
const sha256 = (...parts: Uint8Array[]): Uint8Array => {
  const h = createHash('sha256');
  for (const p of parts) h.update(p);
  return new Uint8Array(h.digest());
};

const ZERO = new Uint8Array(32);
const MAX = new Uint8Array(32).fill(0xff);
const ABC = label('abc');
const FULL = Uint8Array.from({ length: 32 }, (_, i) => i);
const DST_OZ = label('OZ:test:dst');
const DST_OTHER = label('other');

describe('Sha256', () => {
  let sha: Sha256Simulator;

  beforeAll(async () => {
    sha = await Sha256Simulator.create();
  });

  describe('digest', () => {
    it('should hash 32 zero bytes', async () => {
      expect(toHex(await sha.digest(ZERO))).toStrictEqual(
        '66687aadf862bd776c8fc18b8e9f8e20089714856ee233b3902a591d0d5f2925',
      );
    });

    it('should hash "abc" padded to 32 bytes', async () => {
      expect(toHex(await sha.digest(ABC))).toStrictEqual(
        '26426d7cb06a12643ccfe84107603083d835c37f000a12f734137a0c8df77f26',
      );
    });

    it('should hash the bytes 0x00 to 0x1f', async () => {
      expect(toHex(await sha.digest(FULL))).toStrictEqual(
        '630dcd2966c4336691125448bbb25b4ff412a49c732db2c8abc1b8581bd710dd',
      );
    });

    it('should hash 32 0xff bytes', async () => {
      expect(toHex(await sha.digest(MAX))).toStrictEqual(
        'af9613760f72635fbdb44a5a0a63c39f12af30f950a6ee5c971be188e89c4051',
      );
    });

    it('should equal plain SHA-256 of the 32 bytes', async () => {
      const msg = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
      expect(toHex(await sha.digest(msg))).toStrictEqual(toHex(sha256(msg)));
    });
  });

  describe('hashToField', () => {
    it('should map 32 zero bytes under "OZ:test:dst"', async () => {
      expect(await sha.hashToField(ZERO, DST_OZ)).toStrictEqual(
        34210192094318977985183534168987902724601372674013286402051453020672578529427n,
      );
    });

    it('should map 32 zero bytes under "other"', async () => {
      expect(await sha.hashToField(ZERO, DST_OTHER)).toStrictEqual(
        8252444046083393956013555787964600531038925995538232948302863214155512041927n,
      );
    });

    it('should map 32 zero bytes under a 0xff tag', async () => {
      expect(await sha.hashToField(ZERO, MAX)).toStrictEqual(
        5783169439825234658278062974923324003958453459859062855722018262150474251593n,
      );
    });

    it('should map "abc" under "OZ:test:dst"', async () => {
      expect(await sha.hashToField(ABC, DST_OZ)).toStrictEqual(
        4324394735155083904531704740297192940187867625546932967580253364999850513246n,
      );
    });

    it('should map "abc" under "other"', async () => {
      expect(await sha.hashToField(ABC, DST_OTHER)).toStrictEqual(
        21857836360300176587501939499123296964562523761200186881588315994230546836595n,
      );
    });

    it('should map "abc" under a 0xff tag', async () => {
      expect(await sha.hashToField(ABC, MAX)).toStrictEqual(
        1226102576975082613384683709326516658236353740412667946641545403440333170714n,
      );
    });

    it('should map the bytes 0x00 to 0x1f under "OZ:test:dst"', async () => {
      expect(await sha.hashToField(FULL, DST_OZ)).toStrictEqual(
        15556550438748104882361422133592315476793818450331618665969441588440568877440n,
      );
    });

    it('should map the bytes 0x00 to 0x1f under "other"', async () => {
      expect(await sha.hashToField(FULL, DST_OTHER)).toStrictEqual(
        9992742822580069016050322119799082654165910733055334771929215765417118172064n,
      );
    });

    it('should map the bytes 0x00 to 0x1f under a 0xff tag', async () => {
      expect(await sha.hashToField(FULL, MAX)).toStrictEqual(
        47774871813993836535546443118418351091640792380679911218978961729634430076400n,
      );
    });

    it('should map 32 0xff bytes under "OZ:test:dst"', async () => {
      expect(await sha.hashToField(MAX, DST_OZ)).toStrictEqual(
        11885617370090720359587156065762348771197463332995176966052374470152502703310n,
      );
    });

    it('should map 32 0xff bytes under "other"', async () => {
      expect(await sha.hashToField(MAX, DST_OTHER)).toStrictEqual(
        38666714245396177227157505064478008025562388204734340763101648940949970599424n,
      );
    });

    it('should map 32 0xff bytes under a 0xff tag', async () => {
      expect(await sha.hashToField(MAX, MAX)).toStrictEqual(
        5376335326590360629005099603710189236197405386625499623432894039735085815136n,
      );
    });

    it('should equal LEOS2IP_512(b_0 || b_1) mod q with b_i = SHA-256(msg || DST || i)', async () => {
      const msg = Uint8Array.from({ length: 32 }, (_, i) => i * 7);
      const DST = Uint8Array.from({ length: 32 }, (_, i) => 100 + i);
      const counter = (i: number): Uint8Array => {
        const c = new Uint8Array(32);
        c[0] = i;
        return c;
      };
      const tv = new Uint8Array([
        ...sha256(msg, DST, counter(0)),
        ...sha256(msg, DST, counter(1)),
      ]);
      const expected =
        tv.reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n) % Q;
      expect(await sha.hashToField(msg, DST)).toStrictEqual(expected);
    });

    it('should stay below q', async () => {
      expect(await sha.hashToField(MAX, MAX)).toBeLessThan(Q);
      expect(await sha.hashToField(hex('80'.repeat(32)), ZERO)).toBeLessThan(Q);
    });

    it('should not give the same element under two tags', async () => {
      expect(await sha.hashToField(ABC, DST_OZ)).not.toStrictEqual(
        await sha.hashToField(ABC, DST_OTHER),
      );
    });

    it('should not give the same element for two messages', async () => {
      expect(await sha.hashToField(ABC, DST_OZ)).not.toStrictEqual(
        await sha.hashToField(FULL, DST_OZ),
      );
    });
  });
});
