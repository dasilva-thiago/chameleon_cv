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
        <div className="flex flex-col gap-3">
          <p>
            Permita para a análise e o currículo usarem IA ({names}). Só o texto da vaga e os itens
            confirmados escolhidos são enviados.
          </p>
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
          <details>
            <summary className="w-fit cursor-pointer font-medium underline decoration-dotted">
              O que é enviado e quais os limites
            </summary>
            <div className="mt-2 flex flex-col gap-2">
              <p>
                Serão enviados apenas o texto da vaga e os itens confirmados do seu perfil
                escolhidos para ela, sem telefone, e-mail ou itens privados. Planos gratuitos podem
                usar o conteúdo enviado segundo os termos de cada provedor.
              </p>
              <ul className="list-disc pl-5">
                {data.providers.map((provider) => (
                  <li key={provider.id}>
                    <strong>{provider.label}</strong>: {provider.note}
                  </li>
                ))}
              </ul>
            </div>
          </details>
          {consent.isError ? <p role="alert">{messageForError(consent.error)}</p> : null}
        </div>
      </Alert>
    );
  }

  return (
    <div
      role="status"
      className="flex flex-col gap-2 rounded-md border border-slate-300 bg-slate-50 p-3 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-2">
        <p>
          <strong>IA ativa</strong> (
          {data.providers
            .filter((p) => p.consented)
            .map((p) => p.label)
            .join(', ')}
          ). Hoje: {data.usageToday.requests} de {data.limits.totalDailyRequests} chamadas.
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
      </div>
      <details>
        <summary className="w-fit cursor-pointer text-slate-800 underline decoration-dotted">
          Como funciona
        </summary>
        <p className="mt-1">
          Se um provedor atingir o limite, o próximo assume; se nenhum responder, o resultado local
          é usado.
        </p>
      </details>
      {consent.isError ? <p role="alert">{messageForError(consent.error)}</p> : null}
    </div>
  );
}
