import type {
  ArticleSubmissionErrorCode,
  ArticleSubmissionValidationIssue
} from "@noema/studio-publication";
import type { StudioPublicationStepResult } from "./publication-runtime";

export const PUBLICATION_CAPABILITIES_PATH =
  "/api/publication-capabilities" as const;
export const ARTICLE_SUBMISSIONS_PATH = "/api/article-submissions" as const;
export const ARTICLE_SUBMISSION_CANCELLATIONS_PATH =
  "/api/article-submission-cancellations" as const;
export const PUBLICATION_DISABLED_CODE = "github_app_not_configured" as const;

export type StudioApiErrorCode =
  | "access_authentication_failed"
  | "access_authentication_required"
  | "access_verification_unavailable"
  | "api_not_found"
  | "invalid_json"
  | "method_not_allowed"
  | "request_body_too_large"
  | typeof PUBLICATION_DISABLED_CODE
  | "publication_unavailable"
  | "same_origin_required"
  | "unsupported_media_type"
  | ArticleSubmissionErrorCode;

export interface StudioApiErrorResponse {
  error: {
    code: StudioApiErrorCode;
    issues?: ArticleSubmissionValidationIssue[];
    message: string;
    retryable: boolean;
  };
}

export interface ArticleSubmissionApiResponse {
  result: Extract<StudioPublicationStepResult, { kind: "done"; ok: true }>;
}

export interface PublicationCapabilitiesResponse {
  /** Server-derived Access identity. Never accept this identity from a submission body. */
  identity: {
    email: string;
    /** Opaque Access subject; not a GitHub user or article author identifier. */
    subject: string;
  };
  publication:
    | {
        baseBranch: "develop";
        code: typeof PUBLICATION_DISABLED_CODE;
        enabled: false;
        reviewKind: "draft_pull_request";
        state: "disabled";
        submissionMode: "create_only";
      }
    | {
        baseBranch: "develop";
        enabled: true;
        reviewKind: "draft_pull_request";
        state: "enabled";
        submissionMode: "create_only";
      };
}
