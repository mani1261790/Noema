import { describe, expect, it } from "vitest";
import {
  CMS_EDIT_SESSION_IDLE_MS,
  completeCmsEditSessionSave,
  createCmsEditSession,
  ensureActiveCmsEditSession
} from "../src/cms-versioning";

describe("CMS editing session boundaries", () => {
  it("keeps autosaves in one visible version until 30 minutes of inactivity", () => {
    const session = createCmsEditSession(1_000, "11111111-1111-4111-8111-111111111111");
    const active = ensureActiveCmsEditSession(
      session,
      1_000 + CMS_EDIT_SESSION_IDLE_MS - 1,
      "22222222-2222-4222-8222-222222222222"
    );
    const rotated = ensureActiveCmsEditSession(
      session,
      1_000 + CMS_EDIT_SESSION_IDLE_MS,
      "22222222-2222-4222-8222-222222222222"
    );

    expect(active.id).toBe(session.id);
    expect(rotated.id).toBe("22222222-2222-4222-8222-222222222222");
  });

  it("closes a visible version after manual, conflict, or restore saves", () => {
    const session = createCmsEditSession(1_000, "11111111-1111-4111-8111-111111111111");
    expect(completeCmsEditSessionSave(session, "autosave", 2_000, "next")).toEqual({
      id: session.id,
      lastSavedAt: 2_000
    });
    for (const reason of ["manual", "conflict_resolution", "restored"] as const) {
      expect(completeCmsEditSessionSave(session, reason, 2_000, `next-${reason}`)).toEqual({
        id: `next-${reason}`,
        lastSavedAt: 2_000
      });
    }
  });
});
