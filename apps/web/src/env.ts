/** Build-time configuration (Vite env). Only public values: never put secrets here. */
export const env = {
  /** API origin. Supabase: https://<ref>.supabase.co/functions/v1 ; Node/Docker: http://localhost:8787 */
  apiUrl: (import.meta.env.VITE_API_URL as string | undefined) ?? 'http://localhost:8787',
  basePath: import.meta.env.BASE_URL,
  appName: 'Poliitikkoseuranta',
};
