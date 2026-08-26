CREATE TABLE studio_auth_user (
  id TEXT NOT NULL PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL UNIQUE COLLATE NOCASE,
  emailVerified INTEGER NOT NULL,
  image TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE TABLE studio_auth_session (
  id TEXT NOT NULL PRIMARY KEY,
  expiresAt DATE NOT NULL,
  token TEXT NOT NULL UNIQUE,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL,
  ipAddress TEXT,
  userAgent TEXT,
  userId TEXT NOT NULL REFERENCES studio_auth_user(id) ON DELETE CASCADE
);

CREATE TABLE studio_auth_account (
  id TEXT NOT NULL PRIMARY KEY,
  issuer TEXT NOT NULL,
  accountId TEXT NOT NULL,
  providerId TEXT NOT NULL,
  userId TEXT NOT NULL REFERENCES studio_auth_user(id) ON DELETE CASCADE,
  accessToken TEXT,
  refreshToken TEXT,
  idToken TEXT,
  accessTokenExpiresAt DATE,
  refreshTokenExpiresAt DATE,
  scope TEXT,
  password TEXT,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE TABLE studio_auth_verification (
  id TEXT NOT NULL PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expiresAt DATE NOT NULL,
  createdAt DATE NOT NULL,
  updatedAt DATE NOT NULL
);

CREATE TABLE studio_auth_rate_limit (
  id TEXT NOT NULL PRIMARY KEY,
  key TEXT NOT NULL UNIQUE,
  count INTEGER NOT NULL,
  lastRequest BIGINT NOT NULL
);

CREATE TABLE cms_auth_identities (
  user_id TEXT NOT NULL PRIMARY KEY REFERENCES studio_auth_user(id) ON DELETE CASCADE,
  cms_subject TEXT NOT NULL UNIQUE REFERENCES cms_members(subject) ON DELETE CASCADE,
  linked_at TEXT NOT NULL
);

CREATE INDEX studio_auth_session_userId_idx ON studio_auth_session(userId);
CREATE INDEX studio_auth_account_userId_idx ON studio_auth_account(userId);
CREATE INDEX studio_auth_verification_identifier_idx ON studio_auth_verification(identifier);
CREATE UNIQUE INDEX studio_auth_account_issuer_accountId_uidx
  ON studio_auth_account(issuer, accountId);
