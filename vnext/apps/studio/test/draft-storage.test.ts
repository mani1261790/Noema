import { describe, expect, it } from "vitest";
import {
  DRAFT_STORAGE_KEY,
  DRAFT_STORAGE_VERSION,
  clearDraft,
  createBlankArticle,
  loadDraft,
  resolveBrowserStorage,
  saveDraft,
  type DraftStorage,
  type StudioDraft
} from "../src/draft-storage";

class MemoryStorage implements DraftStorage {
  readonly values = new Map<string, string>();
  getError: unknown;
  setError: unknown;
  removeError: unknown;

  getItem(key: string): string | null {
    if (this.getError) throw this.getError;
    return this.values.get(key) ?? null;
  }

  setItem(key: string, value: string): void {
    if (this.setError) throw this.setError;
    this.values.set(key, value);
  }

  removeItem(key: string): void {
    if (this.removeError) throw this.removeError;
    this.values.delete(key);
  }
}

function incompleteDraft(): StudioDraft {
  return {
    frontmatter: {
      ...createBlankArticle("2026-07-18"),
      title: "書きかけのタイトル",
      description: "",
      slug: "still editing!",
      outcome: "この続きを考える",
      authors: [],
      topics: [],
      tags: ["AI", "下書き"],
      prerequisites: ["基礎知識"],
      estimatedMinutes: 0,
      sources: [{ title: "", url: "", checkedAt: "" }]
    },
    body: "## 書きかけ\n\n本文も保存する"
  };
}

describe("resolveBrowserStorage", () => {
  it("returns the browser storage when the host exposes it", () => {
    const storage = new MemoryStorage();
    expect(resolveBrowserStorage({ localStorage: storage })).toEqual({
      available: true,
      storage
    });
  });

  it("contains a throwing localStorage getter and returns an unavailable adapter", () => {
    const host = Object.defineProperty({}, "localStorage", {
      get() {
        throw new Error("SecurityError");
      }
    });

    const resolved = resolveBrowserStorage(host);
    expect(resolved.available).toBe(false);
    expect(loadDraft(resolved.storage)).toEqual({
      status: "invalid",
      reason: "storage_unavailable"
    });
    expect(saveDraft(resolved.storage, incompleteDraft())).toEqual({
      ok: false,
      reason: "storage_unavailable"
    });
  });
});

describe("createBlankArticle", () => {
  it("creates an editor-safe blank article instead of copying preview content", () => {
    expect(createBlankArticle("2026-07-18")).toEqual({
      title: "",
      description: "",
      slug: "",
      status: "draft",
      updatedAt: "2026-07-18",
      authors: ["Noema編集部"],
      topics: ["conversational-ai"],
      tags: [],
      approach: "experience",
      outcome: "",
      prerequisites: [],
      estimatedMinutes: 10,
      heroImage: null,
      sources: []
    });
  });

  it("rejects an impossible supplied calendar date", () => {
    expect(() => createBlankArticle("2026-02-31")).toThrow(RangeError);
  });
});

describe("loadDraft", () => {
  it("distinguishes an empty store", () => {
    expect(loadDraft(new MemoryStorage())).toEqual({ status: "empty" });
  });

  it("restores an incomplete legacy draft and retains its editable lists", () => {
    const storage = new MemoryStorage();
    const draft = incompleteDraft();
    storage.values.set(DRAFT_STORAGE_KEY, JSON.stringify({
      frontmatter: {
        ...draft.frontmatter,
        excerpt: "legacy preview data",
        href: "/preview/article",
        previewOnly: true
      },
      body: draft.body
    }));

    const result = loadDraft(storage);

    expect(result).toEqual({
      status: "restored",
      source: "legacy",
      updatedAt: null,
      draft
    });
    if (result.status === "restored") {
      expect(result.draft.frontmatter).not.toHaveProperty("excerpt");
      expect(result.draft.frontmatter.tags).toEqual(["AI", "下書き"]);
      expect(result.draft.frontmatter.sources).toEqual([{ title: "", url: "", checkedAt: "" }]);
    }
  });

  it("restores a bounded versioned record with its save timestamp", () => {
    const storage = new MemoryStorage();
    const draft = incompleteDraft();
    storage.values.set(DRAFT_STORAGE_KEY, JSON.stringify({
      version: DRAFT_STORAGE_VERSION,
      updatedAt: "2026-07-18T01:02:03.000Z",
      frontmatter: draft.frontmatter,
      body: draft.body
    }));

    expect(loadDraft(storage)).toEqual({
      status: "restored",
      source: "versioned",
      updatedAt: "2026-07-18T01:02:03.000Z",
      draft
    });
  });

  it.each([
    ["malformed JSON", "{"],
    ["unsupported version", JSON.stringify({ version: 99, updatedAt: "2026-07-18T00:00:00Z", frontmatter: {}, body: "" })],
    ["wrong nested type", JSON.stringify({ frontmatter: { ...incompleteDraft().frontmatter, tags: "AI" }, body: "" })],
    ["oversized body", JSON.stringify({ frontmatter: incompleteDraft().frontmatter, body: "x".repeat(1_048_577) })]
  ])("marks %s as invalid", (_name, stored) => {
    const storage = new MemoryStorage();
    storage.values.set(DRAFT_STORAGE_KEY, stored);
    expect(loadDraft(storage).status).toBe("invalid");
  });

  it("reports storage read failures as invalid without throwing", () => {
    const storage = new MemoryStorage();
    storage.getError = new Error("denied");
    expect(loadDraft(storage)).toEqual({
      status: "invalid",
      reason: "storage_unavailable"
    });
  });
});

describe("saveDraft", () => {
  it("writes a versioned record using an injected clock and preserves incomplete fields", () => {
    const storage = new MemoryStorage();
    const draft = incompleteDraft();
    const result = saveDraft(storage, draft, {
      now: () => new Date("2026-07-18T04:05:06.000Z")
    });

    expect(result).toEqual({ ok: true, updatedAt: "2026-07-18T04:05:06.000Z" });
    expect(JSON.parse(storage.values.get(DRAFT_STORAGE_KEY) ?? "null")).toEqual({
      version: DRAFT_STORAGE_VERSION,
      updatedAt: "2026-07-18T04:05:06.000Z",
      frontmatter: draft.frontmatter,
      body: draft.body
    });
    expect(loadDraft(storage)).toMatchObject({ status: "restored", draft });
  });

  it("returns a failure instead of throwing when the storage write fails", () => {
    const storage = new MemoryStorage();
    storage.setError = new Error("quota exceeded");

    expect(saveDraft(storage, incompleteDraft())).toEqual({
      ok: false,
      reason: "storage_unavailable"
    });
  });

  it("does not write an unbounded draft", () => {
    const storage = new MemoryStorage();
    const draft = incompleteDraft();
    draft.frontmatter.title = "x".repeat(1_001);

    expect(saveDraft(storage, draft)).toEqual({
      ok: false,
      reason: "invalid_draft"
    });
    expect(storage.values.size).toBe(0);
  });
});

describe("clearDraft", () => {
  it("clears the stored record and reports success", () => {
    const storage = new MemoryStorage();
    storage.values.set(DRAFT_STORAGE_KEY, "draft");

    expect(clearDraft(storage)).toEqual({ ok: true });
    expect(storage.values.has(DRAFT_STORAGE_KEY)).toBe(false);
  });

  it("returns a failure instead of throwing when removal is unavailable", () => {
    const storage = new MemoryStorage();
    storage.removeError = new Error("denied");

    expect(clearDraft(storage)).toEqual({
      ok: false,
      reason: "storage_unavailable"
    });
  });
});
