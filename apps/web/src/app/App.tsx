import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { Suspense, lazy, useState } from 'react';
import { Route, Routes } from 'react-router';
import { PublicLayout } from '../components/layout/PublicLayout';
import { AcceptInvitePage } from '../features/auth/AcceptInvitePage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { createAppQueryClient } from '../features/auth/session';
import { AccountPage } from '../features/home/AccountPage';
import { HomePage } from '../features/home/HomePage';
import { NotFoundPage } from '../features/home/NotFoundPage';
import { JobDetailPage } from '../features/jobs/JobDetailPage';
import { EditJobPage, NewJobPage } from '../features/jobs/JobFormPages';
import { JobsPage } from '../features/jobs/JobsPage';
import { SkeletonBlock } from '../components/ui/Skeleton';
import { ErrorBoundary } from './ErrorBoundary';

// The two heaviest screens load on demand (plan §3.9): the first paint ships only what Início and Vagas need.
const ProfilePage = lazy(async () => ({
  default: (await import('../features/profile/ProfilePage')).ProfilePage,
}));
const ResumeEditorPage = lazy(async () => ({
  default: (await import('../features/resumes/ResumeEditorPage')).ResumeEditorPage,
}));

const screenFallback = <SkeletonBlock label="Carregando a tela…" lines={6} />;

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route index element={<HomePage />} />
        <Route
          path="/perfil"
          element={
            <Suspense fallback={screenFallback}>
              <ProfilePage />
            </Suspense>
          }
        />
        <Route path="/vagas" element={<JobsPage />} />
        <Route path="/vagas/nova" element={<NewJobPage />} />
        <Route path="/vagas/:jobId" element={<JobDetailPage />} />
        <Route path="/vagas/:jobId/editar" element={<EditJobPage />} />
        <Route
          path="/curriculos/:resumeId/versoes/:versionId"
          element={
            <Suspense fallback={screenFallback}>
              <ResumeEditorPage />
            </Suspense>
          }
        />
        <Route path="/conta" element={<AccountPage />} />
      </Route>
      <Route element={<PublicLayout />}>
        <Route path="*" element={<NotFoundPage />} />
      </Route>
    </Routes>
  );
}

/**
 * Raiz da aplicacao. O roteador (BrowserRouter em producao, MemoryRouter em testes) e fornecido
 * por quem monta o componente.
 */
export function App({ queryClient }: { queryClient?: QueryClient }) {
  const [defaultClient] = useState(createAppQueryClient);
  return (
    <ErrorBoundary>
      <QueryClientProvider client={queryClient ?? defaultClient}>
        <AppRoutes />
      </QueryClientProvider>
    </ErrorBoundary>
  );
}
