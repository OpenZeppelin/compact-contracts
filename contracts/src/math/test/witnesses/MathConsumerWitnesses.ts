// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Audit consumer witnesses before production use.

import type { Witnesses } from '../../../../artifacts/MockMathConsumer/contract/index.js';
import { Uint128Witnesses } from './Uint128Witnesses.js';

export type MathConsumerPrivateState = Record<string, never>;

export function MathConsumerWitnesses() {
  const { wit_divUint128, wit_sqrtU128 } = Uint128Witnesses();
  return {
    wit_divUint128,
    wit_sqrtU128,
  } satisfies Witnesses<MathConsumerPrivateState>;
}
