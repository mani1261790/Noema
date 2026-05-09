(function (global) {
  const STORAGE_KEY = "noema_auth_session";
  const ID_TOKEN_KEY = "noema_id_token";
  const ACCESS_TOKEN_KEY = "noema_access_token";
  const REFRESH_TOKEN_KEY = "noema_refresh_token";
  const CLOCK_SKEW_MS = 30 * 1000;

  function decodeBase64Url(value) {
    const normalized = String(value || "").replace(/-/g, "+").replace(/_/g, "/");
    const padding = normalized.length % 4 === 0 ? "" : "=".repeat(4 - (normalized.length % 4));
    const binary = atob(normalized + padding);
    const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
    if (typeof TextDecoder === "function") {
      return new TextDecoder().decode(bytes);
    }
    return Array.from(bytes, (byte) => String.fromCharCode(byte)).join("");
  }

  function parseJwt(token) {
    try {
      const payload = String(token || "").split(".")[1];
      if (!payload) return null;
      return JSON.parse(decodeBase64Url(payload));
    } catch {
      return null;
    }
  }

  function tokenExpiryMs(claims) {
    const exp = Number(claims && claims.exp);
    return Number.isFinite(exp) && exp > 0 ? exp * 1000 : 0;
  }

  function isTokenExpired(claims) {
    const expiry = tokenExpiryMs(claims);
    if (!expiry) return false;
    return Date.now() >= expiry - CLOCK_SKEW_MS;
  }

  function normalizeToken(token, expectedUse) {
    const raw = String(token || "").trim();
    if (!raw) return { token: "", claims: null, expired: true };
    const claims = parseJwt(raw);
    if (!claims || (expectedUse && claims.token_use && claims.token_use !== expectedUse)) {
      return { token: "", claims: null, expired: true };
    }
    return { token: raw, claims, expired: isTokenExpired(claims) };
  }

  function readSessionObject() {
    const raw = localStorage.getItem(STORAGE_KEY) || "";
    if (!raw) return null;
    try {
      const parsed = JSON.parse(raw);
      return parsed && typeof parsed === "object" ? parsed : null;
    } catch {
      return null;
    }
  }

  function writeSessionObject(session) {
    if (!session) {
      localStorage.removeItem(STORAGE_KEY);
      localStorage.removeItem(ID_TOKEN_KEY);
      localStorage.removeItem(ACCESS_TOKEN_KEY);
      localStorage.removeItem(REFRESH_TOKEN_KEY);
      return;
    }
    localStorage.setItem(STORAGE_KEY, JSON.stringify(session));
    if (session.idToken) {
      localStorage.setItem(ID_TOKEN_KEY, session.idToken);
    } else {
      localStorage.removeItem(ID_TOKEN_KEY);
    }
    if (session.accessToken) {
      localStorage.setItem(ACCESS_TOKEN_KEY, session.accessToken);
    } else {
      localStorage.removeItem(ACCESS_TOKEN_KEY);
    }
    localStorage.removeItem(REFRESH_TOKEN_KEY);
  }

  function buildSession(input) {
    const id = normalizeToken(input && input.idToken, "id");
    const access = normalizeToken(input && input.accessToken, "access");
    if (!id.token && !access.token) return null;
    return {
      idToken: id.token,
      accessToken: access.token,
      idClaims: id.claims,
      accessClaims: access.claims,
      savedAt: new Date().toISOString()
    };
  }

  function migrateLegacySession() {
    const idToken = localStorage.getItem(ID_TOKEN_KEY) || "";
    const accessToken = localStorage.getItem(ACCESS_TOKEN_KEY) || "";
    const refreshToken = localStorage.getItem(REFRESH_TOKEN_KEY) || "";
    const session = buildSession({ idToken, accessToken, refreshToken });
    if (session) {
      writeSessionObject(session);
      return session;
    }
    writeSessionObject(null);
    return null;
  }

  function getSession() {
    const session = readSessionObject() || migrateLegacySession();
    if (!session) return null;
    const normalized = buildSession(session);
    if (!normalized) {
      writeSessionObject(null);
      return null;
    }
    const changed =
      normalized.idToken !== session.idToken ||
      normalized.accessToken !== session.accessToken ||
      normalized.refreshToken !== session.refreshToken;
    if (changed) {
      writeSessionObject(normalized);
    }
    return normalized;
  }

  function saveSession(input) {
    const session = buildSession(input);
    writeSessionObject(session);
    return session;
  }

  function saveCognitoAuthResult(result) {
    const auth = result && typeof result === "object" ? result : {};
    const session = saveSession({
      idToken: auth.IdToken,
      accessToken: auth.AccessToken
    });
    if (!session) {
      throw new Error("Cognito authentication did not return a valid session.");
    }
    return session;
  }

  function saveOAuthTokenPayload(payload) {
    const data = payload && typeof payload === "object" ? payload : {};
    const session = saveSession({
      idToken: data.id_token,
      accessToken: data.access_token
    });
    if (!session) {
      throw new Error("OAuth token payload did not contain a valid session.");
    }
    return session;
  }

  function clearSession() {
    writeSessionObject(null);
  }

  function getIdentityToken() {
    const session = getSession();
    return session && session.idToken ? session.idToken : "";
  }

  function getAccessToken() {
    const session = getSession();
    return session && session.accessToken ? session.accessToken : "";
  }

  function getAuthorizationToken() {
    return getIdentityToken() || getAccessToken();
  }

  function getIdentityClaims() {
    const session = getSession();
    return session && session.idClaims ? session.idClaims : null;
  }

  function isAuthenticated() {
    return Boolean(getIdentityToken() || getAccessToken());
  }

  global.NoemaAuth = {
    parseJwt,
    getSession,
    saveSession,
    saveCognitoAuthResult,
    saveOAuthTokenPayload,
    clearSession,
    getIdentityToken,
    getAccessToken,
    getAuthorizationToken,
    getIdentityClaims,
    isAuthenticated
  };
})(window);
