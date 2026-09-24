/**
 * The node's rejection of a transaction that takes longer to dismiss than its
 * size allows, 2 µs per byte (the ledger's `OutsideTimeToDismiss`).
 */
export const OUTSIDE_TIME_TO_DISMISS =
  '1010: Invalid Transaction: Custom error: 231';
