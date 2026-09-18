import { beforeAll, describe, expect, it } from 'vitest';
import { FqSimulator } from './simulators/FqSimulator.js';

// Expected values come from the Python reference in crypto/test/vectors.

const Q = 0x73eda753299d7d483339d80809a1d80553bda402fffe5bfeffffffff00000001n;
const TWO_248 = 1n << 248n;

const hex = (h: string): Uint8Array => Uint8Array.from(Buffer.from(h, 'hex'));
const toHex = (b: Uint8Array): string => Buffer.from(b).toString('hex');

const ZERO = new Uint8Array(32);
const MAX = new Uint8Array(32).fill(0xff);
const FULL = Uint8Array.from({ length: 32 }, (_, i) => i);

describe('Fq', () => {
  let fq: FqSimulator;

  beforeAll(async () => {
    fq = await FqSimulator.create();
  });

  describe('fromUniformBytes', () => {
    it('should map 64 zero bytes to 0', async () => {
      expect(
        await fq.fromUniformBytes({ low: ZERO, high: ZERO }),
      ).toStrictEqual(0n);
    });

    it('should map 64 0xff bytes to 2^512 - 1 mod q', async () => {
      expect(await fq.fromUniformBytes({ low: MAX, high: MAX })).toStrictEqual(
        3294906474794265442129797520630710739278575682199800681788903916070560242796n,
      );
      expect(await fq.fromUniformBytes({ low: MAX, high: MAX })).toStrictEqual(
        ((1n << 512n) - 1n) % Q,
      );
    });

    it('should map a 0xff low half and a zero high half to 2^256 - 1 mod q', async () => {
      expect(await fq.fromUniformBytes({ low: MAX, high: ZERO })).toStrictEqual(
        10920338887063814464675503992315976177888879664585288394250266608035967270909n,
      );
    });

    it('should map a zero low half and a 0xff high half to (2^256 - 1) * 2^256 mod q', async () => {
      expect(await fq.fromUniformBytes({ low: ZERO, high: MAX })).toStrictEqual(
        44810442762856641456902034036500700399080248518142150110142296007973174156400n,
      );
    });

    it('should map the sha256("seed", 0, 0) || sha256("seed", 0, 1) sample', async () => {
      const low = hex(
        '605200169e1f2f47217873e2653be15a9f908339122cfc0e73a7f3e376e852e1',
      );
      const high = hex(
        '1f961d4472ac98cf60b31eefbc9c883bba2795e9344660ea645bd0f93e5c0dc2',
      );
      expect(await fq.fromUniformBytes({ low, high })).toStrictEqual(
        31452218399753120422222562747939223430251044203153823220554251502299720908698n,
      );
    });

    it('should map the sha256("seed", 1, 0) || sha256("seed", 1, 1) sample', async () => {
      const low = hex(
        '09f2699773536422e82af8f72a22688608a843205bfb32ae9f4140e09896288f',
      );
      const high = hex(
        '369e1a91fca98365d5adab174a43992cd85b96ed831a4c312bf3d2c080ca7fa9',
      );
      expect(await fq.fromUniformBytes({ low, high })).toStrictEqual(
        17968124744794858211683481897468933973143662277017257676723493893263354887101n,
      );
    });

    it('should map the sha256("seed", 2, 0) || sha256("seed", 2, 1) sample', async () => {
      const low = hex(
        '152a9ca1762c545e9791f6cc0341d41fc096f174726f7cc4806aab6b8e0210d1',
      );
      const high = hex(
        'a6afd15b6068cdcc521b2e07ec6071a91f5b3de3510707723eaabdfa5dd249ad',
      );
      expect(await fq.fromUniformBytes({ low, high })).toStrictEqual(
        20887356668751830947791920180130609210996405222516537233922531532839350200685n,
      );
    });

    it('should map the sha256("seed", 3, 0) || sha256("seed", 3, 1) sample', async () => {
      const low = hex(
        '48fff96d4986158b5a2581a55db6e6656a7ee36219e3734591733882805a1a3d',
      );
      const high = hex(
        'e6b03328584243fbcdd704e62065b00e62dba75668757959d52f8da5b622e0ce',
      );
      expect(await fq.fromUniformBytes({ low, high })).toStrictEqual(
        14228422586471851165696052436850627815199929218761824924046832318003104052378n,
      );
    });

    it('should weight the high half by 2^256 mod q', async () => {
      const one = Uint8Array.from(ZERO);
      one[0] = 1;
      expect(await fq.fromUniformBytes({ low: ZERO, high: one })).toStrictEqual(
        0x1824b159acc5056f998c4fefecbc4ff55884b7fa0003480200000001fffffffen,
      );
    });

    it('should equal LEOS2IP_512(low || high) mod q', async () => {
      const low = FULL;
      const high = Uint8Array.from({ length: 32 }, (_, i) => 255 - i);
      const tv = new Uint8Array([...low, ...high]);
      const expected =
        tv.reduceRight((acc, b) => (acc << 8n) | BigInt(b), 0n) % Q;
      expect(await fq.fromUniformBytes({ low, high })).toStrictEqual(expected);
    });

    it('should not ignore byte 31 of either half', async () => {
      const lowOnly = Uint8Array.from(ZERO);
      lowOnly[31] = 1;
      const highOnly = Uint8Array.from(ZERO);
      highOnly[31] = 1;
      expect(
        await fq.fromUniformBytes({ low: lowOnly, high: ZERO }),
      ).toStrictEqual(1n << 248n);
      expect(
        await fq.fromUniformBytes({ low: ZERO, high: highOnly }),
      ).toStrictEqual((1n << 504n) % Q);
    });
  });

  describe('truncatedLEOS2IP', () => {
    it('should map 32 zero bytes to 0', async () => {
      expect(await fq.truncatedLEOS2IP(ZERO)).toStrictEqual(0n);
    });

    it('should map 32 0xff bytes to 2^248 - 1', async () => {
      expect(await fq.truncatedLEOS2IP(MAX)).toStrictEqual(
        452312848583266388373324160190187140051835877600158453279131187530910662655n,
      );
    });

    it('should map the bytes 0x00 to 0x1f little-endian', async () => {
      expect(await fq.truncatedLEOS2IP(FULL)).toStrictEqual(
        53206320320083115796502214552783413060461247639578808291150702859268522240n,
      );
    });

    it('should map a string with only byte 31 set to 0', async () => {
      expect(
        await fq.truncatedLEOS2IP(hex(`${'00'.repeat(31)}01`)),
      ).toStrictEqual(0n);
    });

    it('should not distinguish two strings that differ only in byte 31', async () => {
      const a = new Uint8Array(32).fill(0xab);
      const b = Uint8Array.from(a);
      b[31] = 0x00;
      expect(await fq.truncatedLEOS2IP(a)).toStrictEqual(
        await fq.truncatedLEOS2IP(b),
      );
    });
  });

  describe('truncatedI2LEOSP', () => {
    it('should map 0 to 32 zero bytes', async () => {
      expect(toHex(await fq.truncatedI2LEOSP(0n))).toStrictEqual(
        '00'.repeat(32),
      );
    });

    it('should map 0x0102030405 to its little-endian bytes', async () => {
      expect(toHex(await fq.truncatedI2LEOSP(0x0102030405n))).toStrictEqual(
        '0504030201000000000000000000000000000000000000000000000000000000',
      );
    });

    it('should map 2^248 - 1 to 31 0xff bytes and a zero byte', async () => {
      expect(toHex(await fq.truncatedI2LEOSP(TWO_248 - 1n))).toStrictEqual(
        `${'ff'.repeat(31)}00`,
      );
    });

    it('should map 2^248 to 32 zero bytes', async () => {
      expect(toHex(await fq.truncatedI2LEOSP(TWO_248))).toStrictEqual(
        '00'.repeat(32),
      );
    });

    it('should map q - 1 to its low 248 bits', async () => {
      expect(toHex(await fq.truncatedI2LEOSP(Q - 1n))).toStrictEqual(
        '00000000fffffffffe5bfeff02a4bd5305d8a10908d83933487d9d2953a7ed00',
      );
    });

    it('should not distinguish two elements equal mod 2^248', async () => {
      expect(await fq.truncatedI2LEOSP(0x0102030405n + TWO_248)).toStrictEqual(
        await fq.truncatedI2LEOSP(0x0102030405n),
      );
    });
  });

  describe('round trips', () => {
    it('should return x mod 2^248 from LEOS2IP(I2LEOSP(x))', async () => {
      for (const x of [0n, 0x0102030405n, TWO_248 - 1n, TWO_248, Q - 1n]) {
        const back = await fq.truncatedLEOS2IP(await fq.truncatedI2LEOSP(x));
        expect(back).toStrictEqual(x % TWO_248);
      }
    });

    it('should return S with byte 31 zeroed from I2LEOSP(LEOS2IP(S))', async () => {
      for (const S of [ZERO, MAX, FULL]) {
        const back = await fq.truncatedI2LEOSP(await fq.truncatedLEOS2IP(S));
        const expected = Uint8Array.from(S);
        expected[31] = 0;
        expect(toHex(back)).toStrictEqual(toHex(expected));
      }
    });

    it('should be the identity on 248-bit values', async () => {
      const x = TWO_248 - 12345n;
      expect(
        await fq.truncatedLEOS2IP(await fq.truncatedI2LEOSP(x)),
      ).toStrictEqual(x);
    });
  });
});
