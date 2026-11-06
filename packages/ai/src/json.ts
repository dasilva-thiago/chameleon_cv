/**
 * Reads the JSON object out of a model answer. Models sometimes wrap it in a code fence or add a sentence around
 * it, even in JSON mode. The result is UNTRUSTED data: the caller must validate it with a schema.
 */
export function parseJsonLoose(text: string): unknown {
  let body = (text.charCodeAt(0) === 0xfeff ? text.slice(1) : text).trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(body);
  if (fenced?.[1] !== undefined) body = fenced[1].trim();
  const start = body.indexOf('{');
  const end = body.lastIndexOf('}');
  if (start < 0 || end <= start) throw new Error('no JSON object in the answer');
  return JSON.parse(body.slice(start, end + 1)) as unknown;
}
