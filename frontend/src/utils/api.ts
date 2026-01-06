const apiBase = import.meta.env.DEV ? "" : "";

export const getApiBase = () => apiBase;

export const apiUrl = (path: string) => `${apiBase}${path}`;

export const tryFetchApi = async (path: string, init?: RequestInit) => {
  let appKey: string | null = null;
  if (typeof window !== "undefined") {
    appKey = (window.localStorage.getItem("appKey") || "").trim() || null;
  }

  const headers = new Headers(init?.headers || undefined);
  if (appKey && !headers.has("x-app-key")) {
    headers.set("x-app-key", appKey);
  }

  const mergedInit: RequestInit = {
    ...init,
    headers,
  };

  const res = await fetch(apiUrl(path), mergedInit);
  if (!res.ok) {
    throw new Error(`Bad response ${res.status} at ${apiUrl(path)}`);
  }
  return res;
};
