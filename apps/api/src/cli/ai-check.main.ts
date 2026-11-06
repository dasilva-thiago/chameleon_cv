/**
 * `pnpm ai:check`: for each AI provider that has a key, checks the key, lists the models it can use and runs a tiny
 * JSON request with the configured model. It prints no key and no response text, only the verdict. Use it after
 * adding a key or when a provider stops answering: model names change often.
 */
import {
  KNOWN_PROVIDERS,
  createOpenAiCompatibleProvider,
  parseJsonLoose,
  resolveProviderSpecs,
} from '@chameleon/ai';

const specs = resolveProviderSpecs(process.env);
const withKey = new Set(specs.map((spec) => spec.id));

async function listModels(baseUrl: string, apiKey: string): Promise<string[] | null> {
  try {
    const response = await fetch(`${baseUrl}/models`, {
      headers: { Authorization: `Bearer ${apiKey}` },
      signal: AbortSignal.timeout(20_000),
    });
    if (!response.ok) return null;
    const body = (await response.json()) as { data?: { id?: unknown }[] };
    return (body.data ?? [])
      .map((model) => (typeof model.id === 'string' ? model.id.replace(/^models\//, '') : ''))
      .filter((id) => id !== '');
  } catch {
    return null;
  }
}

console.log('Provedores de IA (ordem de uso):\n');
for (const known of KNOWN_PROVIDERS) {
  if (!withKey.has(known.id)) {
    console.log(`- ${known.label} [${known.id}]: sem chave (${known.keyEnv} não definida)`);
    continue;
  }
  const spec = specs.find((candidate) => candidate.id === known.id)!;
  console.log(
    `- ${known.label} [${known.id}] modelo=${spec.model} limite=${String(spec.dailyRequests)}/dia`,
  );
  console.log(`  ${known.note}`);

  const models = await listModels(spec.baseUrl, spec.apiKey);
  if (models === null) {
    console.log(
      '  modelos: não foi possível listar (chave inválida, rede ou o provedor não oferece a lista)',
    );
  } else if (models.includes(spec.model)) {
    console.log(`  modelo configurado: encontrado (${String(models.length)} modelos disponíveis)`);
  } else {
    const hint = models
      .filter((id) => /flash|gpt-oss|llama|mistral|small|free|deepseek/i.test(id))
      .slice(0, 8);
    console.log(
      `  modelo configurado NÃO encontrado. Defina AI_${known.id.toUpperCase()}_MODEL. Exemplos: ${hint.join(', ')}`,
    );
  }

  try {
    const provider = createOpenAiCompatibleProvider(spec);
    const answer = await provider.complete({
      messages: [
        { role: 'system', content: 'Answer with the JSON object {"ok":true} and nothing else.' },
        { role: 'user', content: 'ping' },
      ],
      maxTokens: 30,
      temperature: 0,
    });
    const ok = (parseJsonLoose(answer.text) as { ok?: unknown }).ok === true;
    console.log(
      `  teste: ${ok ? 'OK' : 'respondeu, mas fora do formato JSON pedido'} (${String(answer.usage.totalTokens)} tokens)\n`,
    );
  } catch (error) {
    const kind = (error as { kind?: string }).kind ?? 'erro';
    const explain: Record<string, string> = {
      auth: 'chave recusada',
      quota: 'cota esgotada (tente mais tarde)',
      rate_limited: 'limite por minuto (tente de novo em instantes)',
      bad_request: 'requisição recusada: confira o nome do modelo',
      unavailable: 'provedor indisponível',
      timeout: 'tempo esgotado',
      invalid_output: 'resposta vazia ou inválida',
    };
    console.log(`  teste: FALHOU (${explain[kind] ?? kind})\n`);
  }
}
if (specs.length === 0) {
  console.log(
    '\nNenhuma chave configurada. Veja .env.example (GEMINI_API_KEY, GROQ_API_KEY, MISTRAL_API_KEY...).',
  );
}
