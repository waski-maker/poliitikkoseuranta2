/**
 * Versioned prompt files. Each prompt is a separate file named
 * <id>.v<version>.ts; changing a prompt means adding a new version so stored
 * analyses keep a reference to the exact prompt they were produced with.
 */
import neutralSystemV1 from './neutral-system.v1.ts';
import mapStepV1 from './map-step.v1.ts';
import reduceStepV1 from './reduce-step.v1.ts';

export interface PromptTemplate {
  id: string;
  version: number;
  description: string;
  template: string;
}

const prompts: PromptTemplate[] = [neutralSystemV1, mapStepV1, reduceStepV1];
const extra: PromptTemplate[] = [];

/** Modules register their own prompt files at startup. */
export function registerPrompt(p: PromptTemplate): void {
  if ([...prompts, ...extra].some((x) => x.id === p.id && x.version === p.version)) return;
  extra.push(p);
}

export function getPrompt(id: string, version?: number): PromptTemplate {
  const all = [...prompts, ...extra].filter((p) => p.id === id);
  if (!all.length) throw new Error(`Unknown prompt ${id}`);
  const p = version ? all.find((x) => x.version === version) : all.sort((a, b) => b.version - a.version)[0];
  if (!p) throw new Error(`Unknown prompt ${id} v${version}`);
  return p;
}

export function renderPrompt(p: PromptTemplate, vars: Record<string, string>): string {
  return p.template.replace(/\{\{(\w+)\}\}/g, (_, k: string) => vars[k] ?? '');
}

export function listPrompts(): PromptTemplate[] {
  return [...prompts, ...extra];
}
