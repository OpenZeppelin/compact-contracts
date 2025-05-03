import { MyContractSimulator } from './simulators/MyContractSimulator';
import type { MaybeString } from './types/string';

const NAME: MaybeString = {
  is_some: true,
  value: 'NAME',
};

let contract: MyContractSimulator;

describe('MyContract', () => {
  describe('name', () => {
    it('should return name', () => {
      contract = new MyContractSimulator(NAME);

      expect(contract.getName()).toEqual(NAME);
    });
  });
});
