// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

// This is how we type an empty object.
export type ShieldedTokenPrivateState = Record<string, never>;
export const ShieldedTokenWitnesses = {};
