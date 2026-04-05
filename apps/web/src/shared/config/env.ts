type RuntimeEnv = {
  apiBaseUrl: string;
  apiDocsUrl: string;
  appTitle: string;
};

export const env: RuntimeEnv = {
  apiBaseUrl: import.meta.env.VITE_API_BASE_URL || "/api/v1",
  apiDocsUrl: import.meta.env.VITE_API_DOCS_URL || "/api/docs",
  appTitle: import.meta.env.VITE_APP_TITLE || "Regatta Control Center",
};
