import type {
  CmsReviewComment,
  CmsReviewCommentAnchor,
  CmsReviewCommentTarget
} from "@noema/cms";
import type { FormEvent, RefObject } from "react";

interface CmsReviewCommentsProps {
  activeAnchor: CmsReviewCommentAnchor | null;
  body: string;
  busy: boolean;
  canComment: boolean;
  canReopen: boolean;
  canResolve: boolean;
  comments: CmsReviewComment[];
  inputRef: RefObject<HTMLTextAreaElement | null>;
  loading: boolean;
  onActiveAnchorClear: () => void;
  onBodyChange: (value: string) => void;
  onCommentFocus: (comment: CmsReviewComment) => void;
  onStatusChange: (comment: CmsReviewComment, action: "resolve" | "reopen") => void;
  onSubmit: (event: FormEvent<HTMLFormElement>) => void;
  onTargetChange: (target: CmsReviewCommentTarget) => void;
  target: CmsReviewCommentTarget;
}

export function CmsReviewComments({
  activeAnchor,
  body,
  busy,
  canComment,
  canReopen,
  canResolve,
  comments,
  inputRef,
  loading,
  onActiveAnchorClear,
  onBodyChange,
  onCommentFocus,
  onStatusChange,
  onSubmit,
  onTargetChange,
  target
}: CmsReviewCommentsProps) {
  const openComments = comments.filter((comment) => comment.status === "open");
  const resolvedComments = comments.filter((comment) => comment.status === "resolved");
  return (
    <section aria-labelledby="cms-review-comments-heading" className="studio-review-comments">
      <div className="studio-review-comments__heading">
        <div>
          <p>指摘と修正</p>
          <h3 id="cms-review-comments-heading">未対応 {openComments.length}件</h3>
        </div>
        <span>全{comments.length}件</span>
      </div>
      <p className="studio-review-comments__guide">
        本文を選択してコメントすると、編集に戻ったあとも同じ箇所を開けます。
      </p>
      {loading ? <p role="status">コメントを読み込んでいます…</p> : null}
      {!loading && comments.length === 0 ? (
        <p className="studio-review-comments__empty">コメントはまだありません。本文の該当箇所を選択して指摘を追加できます。</p>
      ) : null}
      {openComments.length > 0 ? (
        <ol aria-label="未対応のレビューコメント" className="studio-review-comments__list">
          {openComments.map((comment) => (
            <ReviewCommentCard
              action={canResolve ? "resolve" : null}
              busy={busy}
              comment={comment}
              key={comment.id}
              onFocus={onCommentFocus}
              onStatusChange={onStatusChange}
            />
          ))}
        </ol>
      ) : comments.length > 0 ? (
        <p className="studio-review-comments__complete" role="status">未対応の指摘はありません。</p>
      ) : null}
      {resolvedComments.length > 0 ? (
        <details className="studio-review-comments__resolved">
          <summary>対応済み {resolvedComments.length}件</summary>
          <ol className="studio-review-comments__list">
            {resolvedComments.map((comment) => (
              <ReviewCommentCard
                action={canReopen ? "reopen" : null}
                busy={busy}
                comment={comment}
                key={comment.id}
                onFocus={onCommentFocus}
                onStatusChange={onStatusChange}
              />
            ))}
          </ol>
        </details>
      ) : null}
      {canComment ? (
        <form className="studio-review-comments__form" onSubmit={onSubmit}>
          <label htmlFor="cms-review-comment-target">コメント対象</label>
          <select
            id="cms-review-comment-target"
            onChange={(event) => onTargetChange(event.target.value as CmsReviewCommentTarget)}
            value={target}
          >
            <option value="body">選択した本文</option>
            <option value="article">記事全体</option>
            <option value="metadata">記事情報</option>
          </select>
          {target === "body" ? activeAnchor ? (
            <div className="studio-review-comments__selection" role="status">
              <div>
                <strong>選択中の本文</strong>
                <blockquote>{activeAnchor.quote}</blockquote>
              </div>
              <button onClick={onActiveAnchorClear} type="button">選択を解除</button>
            </div>
          ) : (
            <p className="studio-review-comments__selection-help">左側のMarkdown本文から、指摘したい文字を選択してください。</p>
          ) : null}
          <label htmlFor="cms-review-comment">コメント</label>
          <textarea
            id="cms-review-comment"
            maxLength={1_000}
            onChange={(event) => onBodyChange(event.target.value)}
            placeholder="何を、どのように直してほしいかを具体的に書きます。"
            ref={inputRef}
            rows={4}
            value={body}
          />
          <div className="studio-review-comments__form-actions">
            <button
              className="dads-button"
              data-size="md"
              data-type="outline"
              disabled={busy || !body.trim() || (target === "body" && !activeAnchor)}
              type="submit"
            >
              指摘を追加
            </button>
          </div>
        </form>
      ) : null}
    </section>
  );
}

function ReviewCommentCard({
  action,
  busy,
  comment,
  onFocus,
  onStatusChange
}: {
  action: "reopen" | "resolve" | null;
  busy: boolean;
  comment: CmsReviewComment;
  onFocus: (comment: CmsReviewComment) => void;
  onStatusChange: (comment: CmsReviewComment, action: "resolve" | "reopen") => void;
}) {
  return (
    <li className={comment.status === "resolved" ? "is-resolved" : "is-open"}>
      <div className="studio-review-comment__status">
        <strong>{comment.status === "open" ? "未対応" : "対応済み"}</strong>
        <span>revision {comment.revisionNumber}</span>
      </div>
      {comment.anchor ? (
        <button className="studio-review-comment__quote" onClick={() => onFocus(comment)} type="button">
          <span>本文の該当箇所を開く</span>
          <q>{comment.anchor.quote}</q>
        </button>
      ) : null}
      <p>{comment.body}</p>
      <small>
        {comment.target === "body" ? "本文" : comment.target === "metadata" ? "記事情報" : "記事全体"}
        {` · ${comment.authorEmail} · `}
        <time dateTime={comment.createdAt}>{new Date(comment.createdAt).toLocaleString("ja-JP")}</time>
      </small>
      {comment.status === "resolved" && comment.resolvedRevisionNumber !== null ? (
        <small>revision {comment.resolvedRevisionNumber}で対応済み{comment.resolvedByEmail ? ` · ${comment.resolvedByEmail}` : ""}</small>
      ) : null}
      {action ? (
        <button
          className="dads-button studio-review-comment__action"
          data-size="sm"
          data-type="outline"
          disabled={busy}
          onClick={() => onStatusChange(comment, action)}
          type="button"
        >
          {action === "resolve" ? "対応済みにする" : "再度確認する"}
        </button>
      ) : null}
    </li>
  );
}
