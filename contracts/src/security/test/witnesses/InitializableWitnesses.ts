// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.

export type InitializablePrivateState = Record<string, never>;
export const InitializablePrivateState: InitializablePrivateState = {};
export const InitializableWitnesses = () => ({});
