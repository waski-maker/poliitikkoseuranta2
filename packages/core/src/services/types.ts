/** Interfaces of switchable platform services. Modules depend only on these. */

export interface TestResult {
  ok: boolean;
  message: string;
}

export interface StorageAdapter {
  provider: string;
  put(key: string, bytes: Uint8Array, contentType: string): Promise<void>;
  get(key: string): Promise<Uint8Array | null>;
  delete(key: string): Promise<void>;
  list(prefix: string): Promise<{ key: string; size: number; updatedAt: string | null }[]>;
  /** Time-limited download URL, or null if the API must proxy downloads. */
  signedUrl(key: string, expiresInSec: number): Promise<string | null>;
  test(): Promise<TestResult>;
}

export interface MailMessage {
  to: string[];
  subject: string;
  text: string;
  html?: string;
}

export interface MailAdapter {
  provider: string;
  /** Returns false when the provider does not deliver application mail. */
  send(msg: MailMessage): Promise<boolean>;
  test(): Promise<TestResult>;
}

export interface JobsRunnerAdapter {
  provider: string;
  /** Hands a queued worker job to the runner. */
  dispatch(job: { id: string; type: string }): Promise<{ dispatched: boolean; message: string }>;
  test(): Promise<TestResult>;
}

/** Browser-side realtime configuration exposed via /api/v1/config. */
export interface RealtimeAdapter {
  provider: string;
  clientConfig(): Record<string, unknown>;
  test(): Promise<TestResult>;
}

export type SwitchableService = 'storage' | 'mail' | 'jobs' | 'realtime' | 'backup';

export interface ProviderOption {
  id: string;
  label: string;
  /** Config keys the admin can set (non-secret). */
  fields: { key: string; label: string; secret?: boolean; placeholder?: string }[];
}
