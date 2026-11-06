import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { messageForError } from '../../lib/api';
import { useAiStatus, useSetAiConsent } from './queries';

/**
 * Estado do uso de IA e o interruptor de consentimento. A IA só recebe a vaga e os itens CONFIRMADOS do perfil
 * escolhidos para ela (nunca contatos, itens privados ou ids); sem consentimento, tudo roda neste computador.
 */
export function AiPanel() {
  const status = useAiStatus();
  const consent = useSetAiConsent();

  if (!status.isSuccess || !status.data.configured) return null;
  const data = status.data;
  const names = data.providers.map((provider) => provider.label).join(', ');

  if (!data.active) {
    return (
      <Alert tone="info" title="IA disponível, mas desligada">
        <div className="flex flex-col gap-2">
          <p>
            Há chaves configuradas ({names}). Com a sua permissão, a análise da vaga e o currículo
            passam a usar IA para entender melhor os requisitos e adaptar o texto. Serão enviados
            apenas o texto da vaga e os itens confirmados do seu perfil escolhidos para ela, sem
            telefone, e-mail ou itens privados. Planos gratuitos podem usar o conteúdo enviado
            segundo os termos de cada provedor.
          </p>
          <ul className="list-disc pl-5 text-sm">
            {data.providers.map((provider) => (
              <li key={provider.id}>
                <strong>{provider.label}</strong>: {provider.note}
              </li>
            ))}
          </ul>
          <div>
            <Button
              disabled={consent.isPending}
              onClick={() => {
                consent.mutate(true);
              }}
            >
              {consent.isPending ? 'Salvando…' : 'Permitir uso de IA'}
            </Button>
          </div>
          {consent.isError ? <p role="alert">{messageForError(consent.error)}</p> : null}
        </div>
      </Alert>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-wrap items-center justify-between gap-2 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm"
    >
      <p>
        <strong>IA ativa</strong> (
        {data.providers
          .filter((p) => p.consented)
          .map((p) => p.label)
          .join(', ')}
        ). Hoje: {data.usageToday.requests} de {data.limits.totalDailyRequests} chamadas permitidas.
        Se um provedor atingir o limite, o próximo assume; se nenhum responder, o resultado local é
        usado.
      </p>
      <Button
        variant="secondary"
        disabled={consent.isPending}
        onClick={() => {
          consent.mutate(false);
        }}
      >
        {consent.isPending ? 'Salvando…' : 'Desligar IA'}
      </Button>
      {consent.isError ? <p role="alert">{messageForError(consent.error)}</p> : null}
    </div>
  );
}
