export const PUBLICATION_CAPABILITIES_PATH =
  "/api/publication-capabilities" as const;
export const ARTICLE_SUBMISSIONS_PATH = "/api/article-submissions" as const;
export const PUBLICATION_DISABLED_CODE = "github_app_not_configured" as const;

export type StudioApiErrorCode =
  | "access_authentication_failed"
  | "access_authentication_required"
  | "access_verification_unavailable"
  | "api_not_found"
  | "method_not_allowed"
  | typeof PUBLICATION_DISABLED_CODE
  | "publication_unavailable"
  | "same_origin_required";

export interface StudioApiErrorResponse {
  error: {
    code: StudioApiErrorCode;
    message: string;
    retryable: boolean;
  };
}

export interface PublicationCapabilitiesResponse {
  /** Server-derived Access identity. Never accept this identity from a submission body. */
  identity: {
    email: string;
    /** Opaque Access subject; not a GitHub user or article author identifier. */
    subject: string;
  };
  publication: {
    baseBranch: "develop";
    code: typeof PUBLICATION_DISABLED_CODE;
    enabled: false;
    reviewKind: "draft_pull_request";
    state: "disabled";
    submissionMode: "create_only";
  };
}
