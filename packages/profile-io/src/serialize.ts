import { canonicalizeProfileDocument, type ProfileDocument } from '@chameleon/contracts';
import { Document, visit } from 'yaml';
import type { ProfileTextFormat } from './parse';

const QUOTE_LIKE = /^\d{4}(-\d{2}(-\d{2})?)?$|^\d+\.\d+\.\d+$/;

/**
 * Serializa um documento v2 na forma canonica (chaves na ordem do schema, sem chaves nulas)
 * para que `parse -> normalizar -> serializar -> parse` seja estavel e os diffs sejam legiveis.
 * A exportacao sempre emite a versao corrente do contrato (ADR-0004).
 */
export function serializeProfile(
  document: ProfileDocument,
  format: ProfileTextFormat = 'yaml',
): string {
  const canonical = canonicalizeProfileDocument(document);
  if (format === 'json') return `${JSON.stringify(canonical, null, 2)}\n`;
  const yaml = new Document(canonical, {
    aliasDuplicateObjects: false,
    schema: 'core',
    version: '1.2',
  });
  // Datas e versoes sempre entre aspas: interpretadores YAML 1.1 leem AAAA-MM-DD como timestamp.
  visit(yaml, {
    Scalar(_key, node) {
      if (typeof node.value === 'string' && QUOTE_LIKE.test(node.value)) node.type = 'QUOTE_DOUBLE';
    },
  });
  return yaml.toString({ indent: 2, lineWidth: 0, minContentWidth: 0, nullStr: 'null' });
}
