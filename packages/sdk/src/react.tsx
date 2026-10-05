/**
 * React bindings for the SDK: one shared client per app (ApiProvider) and
 * TanStack Query hooks. Module UIs use these, never fetch() directly.
 */
import * as React from 'react';
import {
  QueryClient,
  QueryClientProvider,
  useMutation,
  useQuery,
  useQueryClient,
} from '@tanstack/react-query';
import type { ApiClient } from './index.ts';

const ApiContext = React.createContext<ApiClient | null>(null);

export function ApiProvider({
  client,
  queryClient,
  children,
}: {
  client: ApiClient;
  queryClient: QueryClient;
  children: React.ReactNode;
}) {
  return (
    <ApiContext.Provider value={client}>
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    </ApiContext.Provider>
  );
}

export function useApi(): ApiClient {
  const c = React.useContext(ApiContext);
  if (!c) throw new Error('useApi must be used inside <ApiProvider>');
  return c;
}

export function createQueryClient(): QueryClient {
  return new QueryClient({
    defaultOptions: {
      queries: {
        staleTime: 30_000,
        retry: (count, err) => {
          const status = (err as unknown as { status?: number }).status;
          return count < 2 && !(status && status < 500);
        },
        refetchOnWindowFocus: false,
      },
    },
  });
}

export { useQuery, useMutation, useQueryClient, QueryClient };

/** Client-side part of a module: routes, dashboard cards and command palette entries. */
export interface UiModule {
  /** Module id, e.g. "0.001"; menu items come from the module manifest. */
  id: string;
  routes: { path: string; element: React.ReactNode }[];
  dashboardCards?: { id: string; permission: string; Component: React.ComponentType }[];
  /** Static commands for the command palette (search results come from /search). */
  commands?: { id: string; label: string; path: string; permission: string; keywords?: string[] }[];
}

/** Current user's permissions, provided by the app shell. */
const PermissionsContext = React.createContext<{ can(permission: string): boolean }>({ can: () => false });
export const PermissionsProvider = PermissionsContext.Provider;
export function usePermissions() {
  return React.useContext(PermissionsContext);
}
