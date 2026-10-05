import type { JobsRunnerAdapter } from '../types.ts';

/**
 * GitHub Actions: triggers a workflow_dispatch run that executes
 * `pnpm job work --id <jobId>`; progress is written to the database.
 */
export function githubActionsRunner(opts: {
  repository: string;
  token: string;
  workflowFile: string;
  ref: string;
  fetch?: typeof fetch;
}): JobsRunnerAdapter {
  const f = opts.fetch ?? fetch;
  const api = `https://api.github.com/repos/${opts.repository}`;
  const headers = {
    Authorization: `Bearer ${opts.token}`,
    Accept: 'application/vnd.github+json',
    'X-GitHub-Api-Version': '2022-11-28',
    'User-Agent': 'poliitikkoseuranta',
  };
  return {
    provider: 'github-actions',
    async dispatch(job) {
      const res = await f(`${api}/actions/workflows/${opts.workflowFile}/dispatches`, {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ ref: opts.ref, inputs: { job_id: job.id } }),
      });
      if (!res.ok)
        return { dispatched: false, message: `GitHub Actions: HTTP ${res.status} ${await res.text()}` };
      return { dispatched: true, message: 'Työ käynnistetty GitHub Actionsissa' };
    },
    async test() {
      const res = await f(`${api}/actions/workflows/${opts.workflowFile}`, { headers });
      return res.ok
        ? { ok: true, message: `Työnkulku ${opts.workflowFile} löytyi` }
        : { ok: false, message: `GitHub Actions: HTTP ${res.status}` };
    },
  };
}

/** Runs worker jobs inside the API process (Node/Docker self-hosting, development). */
export function inlineRunner(run: (jobId: string) => void): JobsRunnerAdapter {
  return {
    provider: 'inline',
    async dispatch(job) {
      run(job.id);
      return { dispatched: true, message: 'Työ käynnistetty palvelimella' };
    },
    async test() {
      return { ok: true, message: 'Työt ajetaan API-prosessissa' };
    },
  };
}

/** Leaves jobs in the queue for an external worker (`pnpm job work` via cron, systemd or Docker). */
export function queueRunner(): JobsRunnerAdapter {
  return {
    provider: 'queue',
    async dispatch() {
      return { dispatched: true, message: 'Työ jonossa; taustatyöntekijä ottaa sen käsittelyyn' };
    },
    async test() {
      return { ok: true, message: 'Jonotila: varmista, että `pnpm job work` ajetaan ajastetusti' };
    },
  };
}
