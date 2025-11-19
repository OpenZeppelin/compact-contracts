import { CLASS_HASHES, CLASS_HASH_SCARB_VERSION, OPENZEPPELIN_INTERFACES_VERSION, OPENZEPPELIN_UTILS_VERSION, UMBRELLA_VERSION } from "./constants";

export const REPLACEMENTS = {
  include: ['**/content/contracts-cairo/alpha/**/*.mdx'],
  replacements: {
    umbrella_version: UMBRELLA_VERSION,
    openzeppelin_interfaces_version: OPENZEPPELIN_INTERFACES_VERSION,
    openzeppelin_utils_version: OPENZEPPELIN_UTILS_VERSION,
    class_hash_scarb_version: CLASS_HASH_SCARB_VERSION,
    ...CLASS_HASHES,
  }
}
