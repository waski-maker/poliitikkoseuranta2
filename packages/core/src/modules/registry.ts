import type { ModuleManifest, MenuItem } from './manifest.ts';
import { validateManifest } from './manifest.ts';
import type { ModuleContext, ServerModule } from './types.ts';

import type { ModuleApis } from '../index.ts';

type ApiOf<K extends string> = K extends keyof ModuleApis ? ModuleApis[K] : unknown;

interface Entry {
  module: ServerModule;
  api: unknown;
}

/**
 * Holds all server modules. Validates manifests and dependencies at startup
 * (unknown or cyclic dependencies abort the boot) and gives modules access to
 * each other's public API: registry.get('1.001').api.getPerson(id).
 */
export class ModuleRegistry {
  private entries = new Map<string, Entry>();
  private order: string[] = [];

  constructor(private readonly modules: ServerModule[]) {
    const ids = new Set<string>();
    for (const m of modules) {
      const errors = validateManifest(m.manifest);
      if (errors.length) throw new Error(`Module ${m.manifest.id}: ${errors.join('; ')}`);
      if (ids.has(m.manifest.id)) throw new Error(`Duplicate module id ${m.manifest.id}`);
      ids.add(m.manifest.id);
    }
    this.order = topoSort(modules.map((m) => m.manifest));
  }

  /** Creates module APIs in dependency order. */
  init(ctx: ModuleContext): void {
    for (const id of this.order) {
      const module = this.modules.find((m) => m.manifest.id === id)!;
      this.entries.set(id, { module, api: module.createApi(ctx) });
    }
  }

  get<K extends string>(id: K): { manifest: ModuleManifest; api: ApiOf<K> } {
    const e = this.entries.get(id);
    if (!e) throw new Error(`Module ${id} is not registered or not initialised`);
    return { manifest: e.module.manifest, api: e.api as ApiOf<K> };
  }

  has(id: string): boolean {
    return this.modules.some((m) => m.manifest.id === id);
  }

  /** Modules in dependency order. */
  list(): ServerModule[] {
    return this.order.map((id) => this.modules.find((m) => m.manifest.id === id)!);
  }

  manifests(): ModuleManifest[] {
    return this.list().map((m) => m.manifest);
  }

  menu(): (MenuItem & { moduleId: string })[] {
    return this.manifests()
      .flatMap((m) => m.menu.map((i) => ({ ...i, moduleId: m.id })))
      .sort((a, b) => a.order - b.order);
  }

  /** All module data tables (for trash, audit restore and backups). */
  tables(): string[] {
    return this.manifests().flatMap((m) =>
      [...m.backup.irreplaceable, ...m.backup.reproducible].map((t) => t.table),
    );
  }
}

export function topoSort(manifests: ModuleManifest[]): string[] {
  const byId = new Map(manifests.map((m) => [m.id, m]));
  const out: string[] = [];
  const state = new Map<string, 'visiting' | 'done'>();
  const visit = (id: string, path: string[]) => {
    const m = byId.get(id);
    if (!m) throw new Error(`Module ${path.at(-1)} depends on missing module ${id}`);
    if (state.get(id) === 'done') return;
    if (state.get(id) === 'visiting')
      throw new Error(`Cyclic module dependency: ${[...path, id].join(' -> ')}`);
    state.set(id, 'visiting');
    for (const dep of m.dependsOn) visit(dep, [...path, id]);
    state.set(id, 'done');
    out.push(id);
  };
  for (const m of [...manifests].sort((a, b) => a.id.localeCompare(b.id))) visit(m.id, []);
  return out;
}
