import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';

/**
 * A API respondeu CONSENT_REQUIRED_FOR_PROFILE: a conta nao tem a autorizacao vigente para tratar
 * dados do perfil. Ainda nao existe rota para registrar o consentimento depois do cadastro, entao
 * a tela explica a situacao e o proximo passo real (falar com quem administra o servico) sem
 * prometer um fluxo que nao existe.
 */
export function ConsentRequired() {
  usePageTitle('Autorização necessária');
  return (
    <div className="mx-auto flex max-w-2xl flex-col gap-4">
      <PageHeading>Perfil profissional</PageHeading>
      <Alert tone="info" title="Falta a autorização para tratar os dados do perfil">
        <p>
          Para guardar e usar seu perfil profissional, o serviço precisa da sua autorização de
          tratamento de dados do perfil. Esta conta ainda não tem essa autorização registrada: isso
          acontece em contas criadas antes de ela passar a ser exigida no cadastro, ou quando a
          autorização foi retirada.
        </p>
      </Alert>
      <p className="text-base text-slate-800">
        Por enquanto não é possível conceder a autorização por esta tela. Entre em contato com a
        pessoa que administra o serviço para regularizar a conta. Nenhum dado do perfil é lido ou
        gravado enquanto isso.
      </p>
    </div>
  );
}
