export const CMS_EDIT_SESSION_IDLE_MS = 30 * 60 * 1_000;

export interface CmsEditSession {
  id: string;
  lastSavedAt: number;
}

export type CmsBrowserSaveReason =
  | "autosave"
  | "manual"
  | "conflict_resolution"
  | "restored";

export function createCmsEditSession(
  now = Date.now(),
  id: string = crypto.randomUUID()
): CmsEditSession {
  return { id, lastSavedAt: now };
}

export function ensureActiveCmsEditSession(
  session: CmsEditSession,
  now = Date.now(),
  nextId: string = crypto.randomUUID()
): CmsEditSession {
  return now - session.lastSavedAt >= CMS_EDIT_SESSION_IDLE_MS
    ? createCmsEditSession(now, nextId)
    : session;
}

export function completeCmsEditSessionSave(
  session: CmsEditSession,
  reason: CmsBrowserSaveReason,
  now = Date.now(),
  nextId: string = crypto.randomUUID()
): CmsEditSession {
  return reason === "autosave"
    ? { ...session, lastSavedAt: now }
    : createCmsEditSession(now, nextId);
}
