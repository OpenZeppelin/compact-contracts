import { COMPACT_COMPILER_VERSION, COMPACT_LANGUAGE_VERSION } from "./constants";

export const REPLACEMENTS = {
  include: ['**/content/contracts-compact/**/*.mdx'],
  replacements: {
    compact_compiler_version: COMPACT_COMPILER_VERSION,
    compact_language_version: COMPACT_LANGUAGE_VERSION
  }
}
