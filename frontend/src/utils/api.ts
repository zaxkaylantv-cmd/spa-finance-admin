const apiBase = import.meta.env.DEV ? "" : "/spa-finance-api";

export const getApiBase = () => apiBase;

export const apiUrl = (path: string) => `${apiBase}${path}`;

export const tryFetchApi = async (path: string, init?: RequestInit) => {
  const res = await fetch(apiUrl(path), init);
  if (!res.ok) {
    throw new Error(`Bad response ${res.status} at ${apiUrl(path)}`);
  }
  return res;
};
