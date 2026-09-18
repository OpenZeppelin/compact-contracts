// TEST-ONLY WITNESS. NOT FOR PRODUCTION USE.
// Unaudited reference material that drives Compact circuits in
// off-chain tests. Not shipped as a consumable artifact. Production
// consumers must author and audit their own witnesses.
//
// The ElGamal module is stateless and declares no witnesses, so the private
// state and witness set are both empty.

export type ElGamalPrivateState = Record<string, never>;
export const ElGamalPrivateState: ElGamalPrivateState = {};
export const ElGamalWitnesses = () => ({});
