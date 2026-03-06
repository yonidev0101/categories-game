export interface ClientConfig {
  apiUrl: string;
  socketUrl: string;
}

declare global {
  interface Window {
    __APP_CONFIG__?: ClientConfig;
  }
}

const PROD_SERVER_URL = "https://server-production-cb9a.up.railway.app";

const fallbackConfig: ClientConfig = {
  apiUrl: PROD_SERVER_URL,
  socketUrl: PROD_SERVER_URL
};

export function getClientConfig(): ClientConfig {
  if (typeof window !== "undefined" && window.__APP_CONFIG__) {
    return window.__APP_CONFIG__;
  }

  return fallbackConfig;
}


