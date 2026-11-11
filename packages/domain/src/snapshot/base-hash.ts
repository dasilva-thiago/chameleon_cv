import { canonicalJson } from './canonical-json';
import { sha256Hex } from './sha256';

/** SHA-256 of the professional base (CV + profile). Cache key of the evaluations; same text, same hash. */
export function hashProfileBase(cvMarkdown: string, profileMarkdown: string): string {
  return sha256Hex(canonicalJson({ cv: cvMarkdown, profile: profileMarkdown }));
}
