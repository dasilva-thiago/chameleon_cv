import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { MemoryRouter, useLocation } from 'react-router';
import { App } from '../../src/app/App';
import { createAppQueryClient } from '../../src/features/auth/session';

function LocationProbe() {
  const { pathname, search, hash } = useLocation();
  return <div data-testid="location">{`${pathname}${search}${hash}`}</div>;
}

export function renderApp(entry: string | { pathname: string; state?: unknown } = '/') {
  const queryClient = createAppQueryClient();
  const user = userEvent.setup();
  const result = render(
    <MemoryRouter initialEntries={[entry]}>
      <App queryClient={queryClient} />
      <LocationProbe />
    </MemoryRouter>,
  );
  return { ...result, queryClient, user };
}
