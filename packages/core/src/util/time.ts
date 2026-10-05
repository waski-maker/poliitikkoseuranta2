export const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Runs a background promise; keeps Supabase Edge / Deno Deploy runtimes alive until it settles. */
export function runInBackground(p: Promise<unknown>): void {
  const g = globalThis as unknown as { EdgeRuntime?: { waitUntil(p: Promise<unknown>): void } };
  if (g.EdgeRuntime?.waitUntil) g.EdgeRuntime.waitUntil(p);
  else p.catch(() => {});
}
