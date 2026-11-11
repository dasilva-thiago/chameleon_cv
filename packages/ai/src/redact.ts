/**
 * What never leaves the server: contact details. The AI does not need them (the resume header is built by the
 * program from the base), so header lines with a phone or an e-mail are dropped and any e-mail address or phone
 * number left in the text is masked before a prompt is built.
 */

const CONTACT_LINE =
  /^\s*\*\*\s*(phone|telefone|celular|whats\s?app|e-?mail|endere[cç]o|address)[^*]*\*\*.*$/gim;
const EMAIL = /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g;
const PHONE = /(?:\+?\d{1,3}[\s.-]?)?\(?\d{2}\)?[\s.-]?9?\d{4}[\s.-]?\d{4}\b/g;

export function redactContacts(markdown: string): string {
  return markdown.replace(CONTACT_LINE, '').replace(EMAIL, '[e-mail]').replace(PHONE, '[telefone]');
}
