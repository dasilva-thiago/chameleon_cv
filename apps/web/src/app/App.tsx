import { QueryClientProvider, type QueryClient } from '@tanstack/react-query';
import { useState } from 'react';
import { Route, Routes } from 'react-router';
import { PublicLayout } from '../components/layout/PublicLayout';
import { AcceptInvitePage } from '../features/auth/AcceptInvitePage';
import { LoginPage } from '../features/auth/LoginPage';
import { RequireAuth } from '../features/auth/RequireAuth';
import { createAppQueryClient } from '../features/auth/session';
import { AccountPage } from '../features/home/AccountPage';
import { HomePage } from '../features/home/HomePage';
import { NotFoundPage } from '../features/home/NotFoundPage';
import { ErrorBoundary } from './ErrorBoundary';

export function AppRoutes() {
  return (
    <Routes>
      <Route element={<PublicLayout />}>
        <Route path="/login" element={<LoginPage />} />
        <Route path="/accept-invite" element={<AcceptInvitePage />} />
      </Route>
      <Route element={<RequireAuth />}>
        <Route index element={<HomePage />} />
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
