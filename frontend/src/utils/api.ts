const apiBase = import.meta.env.DEV ? "" : "";

export const getApiBase = () => apiBase;

export const apiUrl = (path: string) => `${apiBase}${path}`;

export const tryFetchApi = async (path: string, init?: RequestInit) => {
  const { supabase } = await import("./supabaseClient");
  const {
    data: { session },
  } = await supabase.auth.getSession();
  let appKey: string | null = null;
  if (typeof window !== "undefined") {
    appKey = (window.localStorage.getItem("appKey") || "").trim() || null;
  }

  const headers = new Headers(init?.headers || undefined);
  if (appKey && !headers.has("x-app-key")) {
    headers.set("x-app-key", appKey);
  }
  const accessToken = session?.access_token;
  if (accessToken && !headers.has("authorization") && !headers.has("Authorization")) {
    headers.set("Authorization", `Bearer ${accessToken}`);
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
