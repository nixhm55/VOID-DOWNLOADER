/**
 * Application-wide environment configuration and constants.
 */
export const APP_CONFIG = {
  name: 'VOID DOWNLOADER',
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL ?? '',
  isDev: import.meta.env.DEV,
  isProd: import.meta.env.PROD,
} as const;
