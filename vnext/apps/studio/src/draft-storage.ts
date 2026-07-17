import type { ArticleFrontmatter } from "@noema/content";

export const DRAFT_STORAGE_KEY = "noema-studio-draft-v1";
export const DRAFT_STORAGE_VERSION = 2;

const MAX_STORED_DRAFT_CHARACTERS = 1_500_000;
const MAX_BODY_CHARACTERS = 1_048_576;
const MAX_TITLE_CHARACTERS = 1_000;
const MAX_DESCRIPTION_CHARACTERS = 4_000;
const MAX_SLUG_CHARACTERS = 512;
const MAX_OUTCOME_CHARACTERS = 4_000;
const MAX_LIST_ITEMS = 100;
const MAX_LIST_ITEM_CHARACTERS = 1_000;
const MAX_SOURCES = 50;
const MAX_URL_CHARACTERS = 4_096;
const MAX_DATE_CHARACTERS = 64;

const articleStatuses = new Set(["draft", "published", "archived"]);
const articleApproaches = new Set(["experience", "practice", "development", "theory"]);
const articleTopics = new Set([
  "conversational-ai",
  "research-organization",
  "generation-creation",
  "development-environment",
  "data-models",
  "mathematics"
]);

export interface DraftStorage {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

export interface BrowserStorageHost {
  readonly localStorage?: DraftStorage;
}

export interface BrowserStorageResolution {
  available: boolean;
  storage: DraftStorage;
}

const unavailableBrowserStorage: DraftStorage = {
  getItem(): never {
    throw new Error("Browser storage is unavailable.");
  },
  removeItem(): never {
    throw new Error("Browser storage is unavailable.");
  },
  setItem(): never {
    throw new Error("Browser storage is unavailable.");
  }
};

export function resolveBrowserStorage(host: BrowserStorageHost): BrowserStorageResolution {
  try {
    const storage = host.localStorage;
    if (
      !storage ||
      typeof storage.getItem !== "function" ||
      typeof storage.setItem !== "function" ||
      typeof storage.removeItem !== "function"
    ) {
      return { available: false, storage: unavailableBrowserStorage };
    }
    return { available: true, storage };
  } catch {
    return { available: false, storage: unavailableBrowserStorage };
  }
}

export interface StudioDraft {
  frontmatter: ArticleFrontmatter;
  body: string;
}

export interface DraftStorageOptions {
  key?: string;
  now?: () => Date;
}

export type DraftLoadResult =
  | { status: "empty" }
  | {
      status: "restored";
      draft: StudioDraft;
      source: "legacy" | "versioned";
      updatedAt: string | null;
    }
  | {
      status: "invalid";
      reason: "invalid_data" | "storage_unavailable" | "unsupported_version";
    };

export type DraftSaveResult =
  | { ok: true; updatedAt: string }
  | { ok: false; reason: "invalid_draft" | "storage_unavailable" };

export type DraftClearResult =
  | { ok: true }
  | { ok: false; reason: "storage_unavailable" };

export function createBlankArticle(date: Date | string = new Date()): ArticleFrontmatter {
  return {
    title: "",
    description: "",
    slug: "",
    status: "draft",
    updatedAt: formatArticleDate(date),
    authors: ["Noema編集部"],
    topics: ["conversational-ai"],
    tags: [],
    approach: "experience",
    outcome: "",
    prerequisites: [],
    estimatedMinutes: 10,
    heroImage: null,
    sources: []
  };
}

export function loadDraft(
  storage: DraftStorage,
  options: Pick<DraftStorageOptions, "key"> = {}
): DraftLoadResult {
  let stored: string | null;
  try {
    stored = storage.getItem(options.key ?? DRAFT_STORAGE_KEY);
  } catch {
    return { status: "invalid", reason: "storage_unavailable" };
  }

  if (stored === null) return { status: "empty" };
  if (stored.length > MAX_STORED_DRAFT_CHARACTERS) {
    return { status: "invalid", reason: "invalid_data" };
  }

  let value: unknown;
  try {
    value = JSON.parse(stored);
  } catch {
    return { status: "invalid", reason: "invalid_data" };
  }

  if (!isRecord(value)) return { status: "invalid", reason: "invalid_data" };

  if (Object.hasOwn(value, "version")) {
    if (value.version !== DRAFT_STORAGE_VERSION) {
      return { status: "invalid", reason: "unsupported_version" };
    }
    if (!hasOnlyKeys(value, ["version", "updatedAt", "frontmatter", "body"])) {
      return { status: "invalid", reason: "invalid_data" };
    }
    if (!isStoredTimestamp(value.updatedAt)) {
      return { status: "invalid", reason: "invalid_data" };
    }
    const draft = parseDraft(value);
    if (!draft) return { status: "invalid", reason: "invalid_data" };
    return {
      status: "restored",
      draft,
      source: "versioned",
      updatedAt: value.updatedAt
    };
  }

  if (!hasOnlyKeys(value, ["frontmatter", "body"])) {
    return { status: "invalid", reason: "invalid_data" };
  }
  const draft = parseDraft(value);
  if (!draft) return { status: "invalid", reason: "invalid_data" };
  return {
    status: "restored",
    draft,
    source: "legacy",
    updatedAt: null
  };
}

export function saveDraft(
  storage: DraftStorage,
  draft: StudioDraft,
  options: DraftStorageOptions = {}
): DraftSaveResult {
  const checkedDraft = parseDraft(draft);
  if (!checkedDraft) return { ok: false, reason: "invalid_draft" };

  let updatedAt: string;
  let stored: string;
  try {
    const now = (options.now ?? (() => new Date()))();
    updatedAt = now.toISOString();
    stored = JSON.stringify({
      version: DRAFT_STORAGE_VERSION,
      updatedAt,
      frontmatter: checkedDraft.frontmatter,
      body: checkedDraft.body
    });
  } catch {
    return { ok: false, reason: "invalid_draft" };
  }

  if (stored.length > MAX_STORED_DRAFT_CHARACTERS) {
    return { ok: false, reason: "invalid_draft" };
  }

  try {
    storage.setItem(options.key ?? DRAFT_STORAGE_KEY, stored);
    return { ok: true, updatedAt };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

export function clearDraft(
  storage: DraftStorage,
  options: Pick<DraftStorageOptions, "key"> = {}
): DraftClearResult {
  try {
    storage.removeItem(options.key ?? DRAFT_STORAGE_KEY);
    return { ok: true };
  } catch {
    return { ok: false, reason: "storage_unavailable" };
  }
}

function parseDraft(value: unknown): StudioDraft | null {
  if (!isRecord(value) || !isBoundedString(value.body, MAX_BODY_CHARACTERS)) return null;
  const frontmatter = parseFrontmatter(value.frontmatter);
  return frontmatter ? { frontmatter, body: value.body } : null;
}

function parseFrontmatter(value: unknown): ArticleFrontmatter | null {
  if (!isRecord(value)) return null;
  if (!isBoundedString(value.title, MAX_TITLE_CHARACTERS)) return null;
  if (!isBoundedString(value.description, MAX_DESCRIPTION_CHARACTERS)) return null;
  if (!isBoundedString(value.slug, MAX_SLUG_CHARACTERS)) return null;
  if (!isEnumValue(value.status, articleStatuses)) return null;
  if (value.publishedAt !== undefined && !isBoundedString(value.publishedAt, MAX_DATE_CHARACTERS)) return null;
  if (!isBoundedString(value.updatedAt, MAX_DATE_CHARACTERS)) return null;

  const authors = parseStringList(value.authors, MAX_LIST_ITEMS, MAX_LIST_ITEM_CHARACTERS);
  const topics = parseEnumList(value.topics, articleTopics, 10);
  const tags = parseStringList(value.tags, MAX_LIST_ITEMS, MAX_LIST_ITEM_CHARACTERS);
  const prerequisites = parseStringList(value.prerequisites, MAX_LIST_ITEMS, MAX_LIST_ITEM_CHARACTERS);
  if (!authors || !topics || !tags || !prerequisites) return null;
  if (!isEnumValue(value.approach, articleApproaches)) return null;
  if (!isBoundedString(value.outcome, MAX_OUTCOME_CHARACTERS)) return null;
  if (
    typeof value.estimatedMinutes !== "number" ||
    !Number.isInteger(value.estimatedMinutes) ||
    value.estimatedMinutes < 0 ||
    value.estimatedMinutes > 10_000
  ) return null;

  const heroImage = parseHeroImage(value.heroImage);
  if (heroImage === undefined) return null;
  const sources = parseSources(value.sources);
  if (!sources) return null;

  return {
    title: value.title,
    description: value.description,
    slug: value.slug,
    status: value.status as ArticleFrontmatter["status"],
    ...(value.publishedAt !== undefined ? { publishedAt: value.publishedAt } : {}),
    updatedAt: value.updatedAt,
    authors,
    topics: topics as ArticleFrontmatter["topics"],
    tags,
    approach: value.approach as ArticleFrontmatter["approach"],
    outcome: value.outcome,
    prerequisites,
    estimatedMinutes: value.estimatedMinutes,
    heroImage,
    sources
  };
}

function parseHeroImage(value: unknown): ArticleFrontmatter["heroImage"] | undefined {
  if (value === null) return null;
  if (!isRecord(value)) return undefined;
  if (!isBoundedString(value.src, MAX_URL_CHARACTERS)) return undefined;
  if (!isBoundedString(value.alt, MAX_LIST_ITEM_CHARACTERS * 2)) return undefined;
  return { src: value.src, alt: value.alt };
}

function parseSources(value: unknown): ArticleFrontmatter["sources"] | null {
  if (!Array.isArray(value) || value.length > MAX_SOURCES) return null;
  const sources: ArticleFrontmatter["sources"] = [];
  for (const source of value) {
    if (!isRecord(source)) return null;
    if (!isBoundedString(source.title, MAX_LIST_ITEM_CHARACTERS)) return null;
    if (!isBoundedString(source.url, MAX_URL_CHARACTERS)) return null;
    if (!isBoundedString(source.checkedAt, MAX_DATE_CHARACTERS)) return null;
    sources.push({
      title: source.title,
      url: source.url,
      checkedAt: source.checkedAt
    });
  }
  return sources;
}

function parseStringList(value: unknown, maxItems: number, maxCharacters: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: string[] = [];
  for (const item of value) {
    if (!isBoundedString(item, maxCharacters)) return null;
    result.push(item);
  }
  return result;
}

function parseEnumList(value: unknown, allowed: Set<string>, maxItems: number): string[] | null {
  if (!Array.isArray(value) || value.length > maxItems) return null;
  const result: string[] = [];
  for (const item of value) {
    if (!isEnumValue(item, allowed)) return null;
    result.push(item);
  }
  return result;
}

function formatArticleDate(value: Date | string): string {
  if (typeof value === "string") {
    if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) throw new RangeError("Invalid article date");
    const parsed = new Date(`${value}T00:00:00.000Z`);
    if (!Number.isFinite(parsed.valueOf()) || parsed.toISOString().slice(0, 10) !== value) {
      throw new RangeError("Invalid article date");
    }
    return value;
  }
  if (!Number.isFinite(value.valueOf())) throw new RangeError("Invalid article date");
  return value.toISOString().slice(0, 10);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function hasOnlyKeys(value: Record<string, unknown>, allowedKeys: string[]): boolean {
  const allowed = new Set(allowedKeys);
  return Object.keys(value).every((key) => allowed.has(key));
}

function isBoundedString(value: unknown, maxCharacters: number): value is string {
  return typeof value === "string" && value.length <= maxCharacters;
}

function isEnumValue(value: unknown, allowed: Set<string>): value is string {
  return typeof value === "string" && allowed.has(value);
}

function isStoredTimestamp(value: unknown): value is string {
  return isBoundedString(value, MAX_DATE_CHARACTERS) &&
    value.includes("T") &&
    Number.isFinite(Date.parse(value));
}
