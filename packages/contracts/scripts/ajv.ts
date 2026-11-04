import Ajv2020 from 'ajv/dist/2020.js';

/**
 * Compila um JSON Schema draft 2020-12 no Ajv em modo STRICT.
 * `ajv-formats` nao e dependencia do projeto: os dois formatos emitidos pelo Zod
 * (`email`, `uri`) sao registrados aqui com expressoes regulares simples (a validacao
 * rigorosa continua sendo a do Zod; o JSON Schema e um subconjunto estrutural).
 */
export function createStrictAjv(): Ajv2020 {
  const ajv = new Ajv2020({ strict: true, allErrors: true });
  ajv.addFormat('email', /^[^@\s]+@[^@\s]+\.[^@\s]+$/);
  ajv.addFormat('uri', /^[a-z][a-z0-9+.-]*:\S+$/i);
  return ajv;
}

export function compileStrict(schema: object) {
  return createStrictAjv().compile(schema);
}
