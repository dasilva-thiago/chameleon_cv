import {
  cloneJson,
  listRecords,
  type ImportReport,
  type ProfileDocument,
} from '@chameleon/contracts';
import { buildImportPreview } from '@chameleon/profile-io';
import { isJson } from './doc';

/**
 * Applying a file must not undo decisions the owner already made. `importProfile` marks EVERY record
 * `needs_review` (ADR-0005), which is right for new and changed content but would silently demote the
 * `confirmed`/`archived` status of records the file leaves untouched (typical when the owner re-imports their
 * own export). So, against the CURRENT stored document, records the preview classifies as `unchanged` keep the
 * stored `meta` (status, visibility, use, evidence links). New and updated records keep the import defaults:
 * a file can never confirm anything, and a changed record goes back to review.
 */
export function preserveGovernanceOfUnchanged(
  incoming: ProfileDocument,
  existing: ProfileDocument,
  report: ImportReport,
): ProfileDocument {
  const preview = buildImportPreview(incoming, report, existing);
  const unchanged = new Set(
    preview.records.filter((record) => record.action === 'unchanged').map((record) => record.id),
  );
  if (unchanged.size === 0) return incoming;
  const storedMeta = new Map<string, unknown>();
  for (const entry of listRecords(existing)) {
    if (entry.id !== null && isJson(entry.value.meta)) storedMeta.set(entry.id, entry.value.meta);
  }
  const copy = cloneJson(incoming);
  for (const entry of listRecords(copy)) {
    if (entry.id === null || !unchanged.has(entry.id)) continue;
    const meta = storedMeta.get(entry.id);
    if (meta !== undefined) entry.value.meta = cloneJson(meta);
  }
  return copy;
}
