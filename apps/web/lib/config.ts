export interface ClientConfig {
  apiUrl: string;
  socketUrl: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: ClientConfig;
  }
}

const PROD_SERVER_URL = "https://server-production-9aa9.up.railway.app";

// `next dev` talks to the local server, `next build` (Railway) keeps using
// production — no env var needed. Set NEXT_PUBLIC_SERVER_URL to override either.
const SERVER_URL =
  process.env.NEXT_PUBLIC_SERVER_URL ||
  (process.env.NODE_ENV === "development" ? "http://localhost:4000" : PROD_SERVER_URL);

const fallbackConfig: ClientConfig = {
  apiUrl: SERVER_URL,
  socketUrl: SERVER_URL
};

export function getClientConfig(): ClientConfig {
  if (typeof window !== "undefined" && window.__APP_CONFIG__) {
    return window.__APP_CONFIG__;
  }

  return fallbackConfig;
}


