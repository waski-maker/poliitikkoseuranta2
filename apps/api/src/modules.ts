import type { ServerModule } from '@ps/core';
import { registriesModule } from '@ps/m0001-registries';

/**
 * Enabled server modules. Adding a module = add its package here (pnpm
 * new-module does it automatically). The registry orders them by dependency.
 */
export const serverModules: ServerModule[] = [registriesModule as ServerModule];
