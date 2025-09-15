import { beforeEach, describe, expect, it } from 'vitest';
import { SimpleSimulator } from './SimpleSimulator';

let simple: SimpleSimulator;

describe('Simple test', () => {
  beforeEach(() => {
    simple = new SimpleSimulator();
  });

  it('sanity check', () => {
    expect(1).toEqual(1);
  });

  it('should set val', () => {
    const VAL = 123n;
    simple.setVal(VAL);
    expect(simple.getVal()).toEqual(VAL);
  });
});
