import type { ModuleManifest } from '@ps/core/manifest';
import type { UiModule } from '@ps/sdk/react';
import { manifest as registriesManifest } from '@ps/m0001-registries/manifest';
import { registriesUi } from '@ps/m0001-registries/ui';

/**
 * Enabled UI modules. The sidebar, routes, dashboard cards and command
 * palette entries are built from these automatically.
 */
export const uiModules: { manifest: ModuleManifest; ui: UiModule }[] = [
  { manifest: registriesManifest, ui: registriesUi },
];
