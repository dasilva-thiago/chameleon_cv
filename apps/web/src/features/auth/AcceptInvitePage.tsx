import {
  DISPLAY_NAME_MAX_LENGTH,
  PASSWORD_MAX_LENGTH,
  PASSWORD_MIN_LENGTH,
  SIGNUP_CONSENT_PURPOSE,
  displayNameSchema,
  inviteTokenSchema,
  type AcceptInviteRequest,
} from '@chameleon/contracts';
import { useQuery } from '@tanstack/react-query';
import { useEffect, useState } from 'react';
import { useForm, useWatch } from 'react-hook-form';
import { Link, useLocation, useNavigate } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { CheckboxField } from '../../components/ui/CheckboxField';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { TextField } from '../../components/ui/TextField';
import { authApi, fieldPathsOf, isApiError, messageForError } from '../../lib/api';
import { PROFILE_POLICY_VERSION } from '../../lib/config';
import { PROFILE_CONSENT_LABEL, PROFILE_CONSENT_PARAGRAPHS } from './consent-text';
import { useAcceptInvite } from './session';

/** O link de convite e `/accept-invite#token=<token>`: o token vai no fragmento, nunca na query. */
export function readTokenFromHash(hash: string): string | undefined {
  const value = new URLSearchParams(hash.startsWith('#') ? hash.slice(1) : hash).get('token');
  return value === null || value === '' ? undefined : value;
}

export function AcceptInvitePage() {
  usePageTitle('Criar conta');
  const location = useLocation();
  const navigate = useNavigate();
  const [token, setToken] = useState<string | undefined>(() => readTokenFromHash(location.hash));

  // Um novo link colado na mesma aba troca o convite (ajuste de estado durante a renderizacao).
  const hashToken = readTokenFromHash(location.hash);
  if (hashToken !== undefined && hashToken !== token) setToken(hashToken);

  // Depois de ler o token, remove o fragmento da URL e do historico (history.replaceState).
  const { hash, pathname, search } = location;
  useEffect(() => {
    if (hash === '') return;
    void navigate({ pathname, search, hash: '' }, { replace: true, preventScrollReset: true });
  }, [hash, pathname, search, navigate]);

  return (
    <div className="mx-auto flex w-full max-w-md flex-col gap-6">
      <div className="flex flex-col gap-2">
        <PageHeading>Criar conta</PageHeading>
        <p className="text-base text-slate-700">
          Você recebeu um convite. Defina sua senha para ativar a conta.
        </p>
      </div>
      {token === undefined ? (
        <InvalidInvite reason="missing" />
      ) : (
        <InviteFlow key={token} token={token} />
      )}
    </div>
  );
}

function InvalidInvite({ reason }: { reason: 'missing' | 'invalid' }) {
  return (
    <div className="flex flex-col items-start gap-4">
      <Alert tone="error" title="Convite inválido ou expirado">
        {reason === 'missing'
          ? 'O link de convite está incompleto. Abra o link exatamente como foi enviado a você ou peça um novo convite.'
          : 'Este convite não pode mais ser usado. Peça um novo convite a quem o enviou.'}
      </Alert>
      <p className="text-sm text-slate-700">
        Já tem uma conta?{' '}
        <Link to="/login" className="font-medium text-blue-800 underline">
          Entrar
        </Link>
      </p>
    </div>
  );
}

function InviteFlow({ token }: { token: string }) {
  const tokenIsWellFormed = inviteTokenSchema.safeParse(token).success;
  const preview = useQuery({
    queryKey: ['auth', 'invite-preview', token],
    queryFn: ({ signal }) => authApi.previewInvite(token, signal),
    enabled: tokenIsWellFormed,
    staleTime: Infinity,
    retry: false,
  });

  if (!tokenIsWellFormed) return <InvalidInvite reason="invalid" />;
  if (preview.isPending) return <LoadingStatus label="Verificando convite…" />;
  if (preview.isError) {
    if (isApiError(preview.error, 'INVITE_INVALID')) return <InvalidInvite reason="invalid" />;
    return (
      <div className="flex flex-col items-start gap-4">
        <Alert tone="error" title="Não foi possível verificar o convite">
          {messageForError(preview.error)}
        </Alert>
        <Button
          onClick={() => {
            void preview.refetch();
          }}
        >
          Tentar novamente
        </Button>
      </div>
    );
  }
  return <AcceptInviteForm token={token} email={preview.data.email} />;
}

interface AcceptFormValues {
  displayName: string;
  password: string;
  confirmPassword: string;
  consentProfile: boolean;
}

function RequirementItem({ met, children }: { met: boolean; children: string }) {
  return (
    <li className={met ? 'text-green-900' : 'text-slate-700'}>
      {children}
      <span className="font-medium"> — {met ? 'atendido' : 'pendente'}</span>
    </li>
  );
}

function AcceptInviteForm({ token, email }: { token: string; email: string }) {
  const navigate = useNavigate();
  const accept = useAcceptInvite();
  const [showPasswords, setShowPasswords] = useState(false);
  const {
    register,
    handleSubmit,
    control,
    setError,
    setFocus,
    formState: { errors },
  } = useForm<AcceptFormValues>({
    defaultValues: { displayName: '', password: '', confirmPassword: '', consentProfile: false },
  });

  const password = useWatch({ control, name: 'password' });
  const confirmPassword = useWatch({ control, name: 'confirmPassword' });
  const lengthMet = password.length >= PASSWORD_MIN_LENGTH;
  const matchMet = confirmPassword !== '' && confirmPassword === password;

  const inviteGone = isApiError(accept.error, 'INVITE_INVALID');

  const onSubmit = handleSubmit((values) => {
    const displayName = values.displayName.trim();
    const request: AcceptInviteRequest = {
      token,
      password: values.password,
      ...(displayName !== '' ? { displayName } : {}),
      // The consent is mandatory and validated above; there is no AI consent at signup.
      consents: [
        { purpose: SIGNUP_CONSENT_PURPOSE, granted: true, policyVersion: PROFILE_POLICY_VERSION },
      ],
    };
    accept.mutate(request, {
      onSuccess: () => {
        void navigate('/', { replace: true });
      },
      onError: (error) => {
        if (isApiError(error, 'WEAK_PASSWORD')) {
          setError('password', { message: messageForError(error) });
          setFocus('password');
        } else if (isApiError(error, 'CONSENT_REQUIRED')) {
          setError('consentProfile', { message: messageForError(error) });
          setFocus('consentProfile');
        } else if (isApiError(error, 'VALIDATION_ERROR')) {
          const paths = fieldPathsOf(error);
          if (paths.includes('displayName')) {
            setError('displayName', { message: 'Informe um nome válido.' });
            setFocus('displayName');
          } else if (paths.includes('password')) {
            setError('password', { message: 'Informe uma senha válida.' });
            setFocus('password');
          }
        }
      },
    });
  });

  if (inviteGone) return <InvalidInvite reason="invalid" />;

  const passwordType = showPasswords ? 'text' : 'password';
  // CONSENT_REQUIRED is shown on the checkbox; CONSENT_INVALID falls through to the banner.
  const genericError =
    accept.isError &&
    !isApiError(accept.error, 'WEAK_PASSWORD') &&
    !isApiError(accept.error, 'CONSENT_REQUIRED') &&
    !hasFieldError(accept.error);

  return (
    <form
      onSubmit={(event) => {
        void onSubmit(event);
      }}
      noValidate
      className="flex flex-col gap-5"
      aria-label="Criar conta"
    >
      {genericError ? <Alert tone="error">{messageForError(accept.error)}</Alert> : null}

      <TextField
        label="E-mail do convite"
        type="email"
        value={email}
        readOnly
        autoComplete="username"
        hint="Este é o e-mail da sua conta e não pode ser alterado."
      />
      <TextField
        label="Nome (opcional)"
        type="text"
        autoComplete="name"
        maxLength={DISPLAY_NAME_MAX_LENGTH}
        hint="Como você quer ser identificado no sistema."
        error={errors.displayName?.message}
        {...register('displayName', {
          validate: (value) =>
            value.trim() === '' ||
            displayNameSchema.safeParse(value).success ||
            'Informe um nome válido, sem caracteres de controle.',
        })}
      />
      <TextField
        label="Senha"
        type={passwordType}
        autoComplete="new-password"
        required
        hint={
          <ul aria-label="Requisitos da senha" className="mt-1 list-disc pl-5">
            <RequirementItem met={lengthMet}>
              {`Pelo menos ${String(PASSWORD_MIN_LENGTH)} caracteres`}
            </RequirementItem>
            <li className="text-slate-700">
              Evite senhas comuns ou que contenham o seu e-mail; elas são recusadas.
            </li>
          </ul>
        }
        error={errors.password?.message}
        {...register('password', {
          required: 'Crie uma senha.',
          minLength: {
            value: PASSWORD_MIN_LENGTH,
            message: `A senha deve ter ao menos ${String(PASSWORD_MIN_LENGTH)} caracteres.`,
          },
          maxLength: {
            value: PASSWORD_MAX_LENGTH,
            message: `A senha deve ter no máximo ${String(PASSWORD_MAX_LENGTH)} caracteres.`,
          },
        })}
      />
      <TextField
        label="Confirme a senha"
        type={passwordType}
        autoComplete="new-password"
        required
        hint={
          <ul aria-label="Confirmação da senha" className="list-disc pl-5">
            <RequirementItem met={matchMet}>As duas senhas são iguais</RequirementItem>
          </ul>
        }
        error={errors.confirmPassword?.message}
        {...register('confirmPassword', {
          required: 'Repita a senha.',
          validate: (value, formValues) =>
            value === formValues.password || 'As senhas não coincidem.',
        })}
      />
      <CheckboxField
        label="Mostrar senhas"
        checked={showPasswords}
        onChange={(event) => {
          setShowPasswords(event.target.checked);
        }}
      />

      <fieldset className="flex flex-col gap-3 rounded-md border border-slate-300 bg-white p-4">
        <legend className="px-1 text-sm font-semibold text-slate-900">
          Tratamento de dados do perfil
        </legend>
        {PROFILE_CONSENT_PARAGRAPHS.map((paragraph) => (
          <p key={paragraph} className="text-sm text-slate-700">
            {paragraph}
          </p>
        ))}
        <CheckboxField
          label={PROFILE_CONSENT_LABEL}
          description={`Versão da política: ${PROFILE_POLICY_VERSION}`}
          aria-required="true"
          error={errors.consentProfile?.message}
          {...register('consentProfile', {
            required: 'Você precisa autorizar o tratamento dos dados do perfil para criar a conta.',
          })}
        />
      </fieldset>

      <Button type="submit" disabled={accept.isPending}>
        {accept.isPending ? 'Criando conta…' : 'Criar conta'}
      </Button>
    </form>
  );
}

function hasFieldError(error: unknown): boolean {
  if (!isApiError(error, 'VALIDATION_ERROR')) return false;
  const paths = fieldPathsOf(error);
  return paths.includes('displayName') || paths.includes('password');
}
