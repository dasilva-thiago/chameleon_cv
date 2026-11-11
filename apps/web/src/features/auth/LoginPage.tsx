import { authEmailSchema, PASSWORD_MAX_LENGTH } from '@chameleon/contracts';
import { useForm } from 'react-hook-form';
import { Navigate, useLocation } from 'react-router';
import { PageHeading, usePageTitle } from '../../components/layout/PageHeading';
import { Alert } from '../../components/ui/Alert';
import { Button } from '../../components/ui/Button';
import { LoadingStatus } from '../../components/ui/LoadingStatus';
import { TextField } from '../../components/ui/TextField';
import { isApiError, messageForError } from '../../lib/api';
import { AuthNoticeBanner } from './AuthNoticeBanner';
import { safeInternalPath, type LoginLocationState } from './RequireAuth';
import { useAuthNotice, useLogin, useSession } from './session';

interface LoginFormValues {
  email: string;
  password: string;
}

export function LoginPage() {
  usePageTitle('Entrar');
  const session = useSession();
  const location = useLocation();
  const from = safeInternalPath((location.state as LoginLocationState | null)?.from);

  if (session.isPending) {
    return (
      <>
        <PageHeading>Entrar</PageHeading>
        <LoadingStatus label="Carregando…" />
      </>
    );
  }
  if (session.data) return <Navigate to={from ?? '/'} replace />;
  return <LoginForm />;
}

function LoginForm() {
  const login = useLogin();
  const notice = useAuthNotice();
  const {
    register,
    handleSubmit,
    resetField,
    setFocus,
    formState: { errors },
  } = useForm<LoginFormValues>({ defaultValues: { email: '', password: '' } });

  const onSubmit = handleSubmit((values) => {
    login.mutate(
      { email: values.email, password: values.password },
      {
        onError: (error) => {
          if (isApiError(error, 'INVALID_CREDENTIALS')) {
            resetField('password');
            setFocus('password');
          }
        },
      },
    );
  });

  return (
    <div className="mx-auto mt-[4vh] flex w-full max-w-md flex-col gap-6 rounded-panel border border-line bg-surface p-6 shadow-md sm:p-8">
      <div className="flex flex-col gap-2">
        <PageHeading>Entrar</PageHeading>
        <p className="text-body text-ink-2">Acesse sua conta para continuar.</p>
      </div>

      {notice ? <AuthNoticeBanner notice={notice} /> : null}

      <form
        onSubmit={(event) => {
          void onSubmit(event);
        }}
        noValidate
        className="flex flex-col gap-5"
        aria-label="Entrar"
      >
        {login.isError ? <Alert tone="error">{messageForError(login.error)}</Alert> : null}

        <TextField
          label="E-mail"
          type="email"
          autoComplete="username"
          inputMode="email"
          autoCapitalize="none"
          spellCheck={false}
          required
          error={errors.email?.message}
          {...register('email', {
            required: 'Informe seu e-mail.',
            validate: (value) =>
              authEmailSchema.safeParse(value).success || 'Informe um e-mail válido.',
          })}
        />
        <TextField
          label="Senha"
          type="password"
          autoComplete="current-password"
          required
          error={errors.password?.message}
          {...register('password', {
            required: 'Informe sua senha.',
            maxLength: {
              value: PASSWORD_MAX_LENGTH,
              message: `A senha tem no máximo ${String(PASSWORD_MAX_LENGTH)} caracteres.`,
            },
          })}
        />
        <Button type="submit" disabled={login.isPending}>
          {login.isPending ? 'Entrando…' : 'Entrar'}
        </Button>
      </form>

      <p className="text-body text-ink-2">
        O cadastro é feito por convite. Se você recebeu um, abra o link enviado a você para criar
        sua conta.
      </p>
    </div>
  );
}
