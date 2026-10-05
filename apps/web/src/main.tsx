import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import { BrowserRouter } from 'react-router';
import { createApiClient } from '@ps/sdk';
import { ApiProvider, createQueryClient } from '@ps/sdk/react';
import { ThemeProvider, Toaster, TooltipProvider } from '@ps/ui';
import { AuthProvider } from './auth/AuthProvider.tsx';
import { tokenStore } from './auth/token-store.ts';
import { env } from './env.ts';
import { App } from './App.tsx';
import './styles.css';

const api = createApiClient({ baseUrl: env.apiUrl, getToken: tokenStore.get });
const queryClient = createQueryClient();

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <ThemeProvider>
      <TooltipProvider>
        <ApiProvider client={api} queryClient={queryClient}>
          <AuthProvider api={api}>
            <BrowserRouter basename={env.basePath.replace(/\/$/, '')}>
              <App />
            </BrowserRouter>
          </AuthProvider>
        </ApiProvider>
        <Toaster position="bottom-right" richColors closeButton />
      </TooltipProvider>
    </ThemeProvider>
  </StrictMode>,
);
