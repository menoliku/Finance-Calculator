export const TOKEN_STORAGE_KEY = "financeAppToken";

const AUTH_CHANGE_EVENT = "financeAppAuthChange";

export function getToken(): string | null {
  return localStorage.getItem(TOKEN_STORAGE_KEY);
}

export function setToken(token: string | null) {
  if (token) {
    localStorage.setItem(TOKEN_STORAGE_KEY, token);
  } else {
    localStorage.removeItem(TOKEN_STORAGE_KEY);
  }

  notifyAuthChange();
}

export function authHeaders(): Record<string, string> {
  const token = getToken();
  return token ? { Authorization: `Bearer ${token}` } : {};
}

// Fired on login/logout/upgrade/downgrade so other components (which read the
// token/tier at fetch time, not reactively) know to refetch premium-gated data.
export function notifyAuthChange() {
  window.dispatchEvent(new Event(AUTH_CHANGE_EVENT));
}

export function onAuthChange(callback: () => void) {
  window.addEventListener(AUTH_CHANGE_EVENT, callback);
  return () => window.removeEventListener(AUTH_CHANGE_EVENT, callback);
}

// fetch that attaches the auth header and, on a 401 (expired or invalidated
// token), clears the stored token and notifies -- so the whole app flips to
// its signed-out state instead of each component failing its own request
// while the sidebar still says you're logged in.
export async function authFetch(
  input: RequestInfo | URL,
  init: RequestInit = {}
): Promise<Response> {
  const response = await fetch(input, {
    ...init,
    headers: { ...(init.headers ?? {}), ...authHeaders() },
  });

  if (response.status === 401 && getToken()) {
    setToken(null);
  }

  return response;
}
