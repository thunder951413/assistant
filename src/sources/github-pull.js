// GitHub pull request discussion: issue comments, reviews and inline review comments.
// `requestCollection(url)` is injected and resolves to `{ data: [], truncated }`.

const REVIEW_STATE_LABELS = {
  APPROVED: "approved",
  CHANGES_REQUESTED: "requested changes",
  COMMENTED: "commented",
  DISMISSED: "dismissed"
};

function clean(value) {
  return String(value ?? "").replace(/\r\n/g, "\n").trim();
}

export function normalizeIssueComment(comment) {
  return {
    id: String(comment?.id || ""),
    kind: "comment",
    author: clean(comment?.user?.login),
    createdAt: clean(comment?.created_at),
    body: clean(comment?.body),
    url: clean(comment?.html_url)
  };
}

export function normalizeReview(review) {
  const state = REVIEW_STATE_LABELS[review?.state] || clean(review?.state).toLowerCase();
  return {
    id: `review-${review?.id}`,
    kind: "review",
    author: clean(review?.user?.login),
    createdAt: clean(review?.submitted_at),
    state,
    body: clean(review?.body) || `_Review ${state || "submitted"}._`,
    url: clean(review?.html_url)
  };
}

export function normalizeReviewComment(comment) {
  // `position` is a diff-hunk offset, not a file line, so it is never shown as one.
  const line = comment?.line ?? comment?.original_line;
  const location = [clean(comment?.path), line ? `L${line}` : ""].filter(Boolean).join(":");
  return {
    id: `review-comment-${comment?.id}`,
    kind: "review-comment",
    author: clean(comment?.user?.login),
    createdAt: clean(comment?.created_at),
    path: clean(comment?.path),
    ...(line ? { line: Number(line) } : {}),
    ...(comment?.in_reply_to_id ? { parentId: `review-comment-${comment.in_reply_to_id}` } : {}),
    ...(comment?.pull_request_review_id ? { reviewId: `review-${comment.pull_request_review_id}` } : {}),
    body: `${location ? `\`${location}\`\n\n` : ""}${clean(comment?.body)}`,
    url: clean(comment?.html_url)
  };
}

// Reviews that only exist as containers for inline comments (state COMMENTED, empty
// body) carry no text of their own; their inline comments already represent them.
function isEmptyContainerReview(review) {
  return review?.state === "COMMENTED" && !clean(review?.body);
}

export async function collectPullRequestDiscussion(apiBase, number, requestCollection) {
  const missing = [];
  let truncated = false;
  const load = async (path, label) => {
    try {
      const result = await requestCollection(`${apiBase}/${path}?per_page=100`);
      truncated ||= Boolean(result?.truncated);
      return Array.isArray(result?.data) ? result.data : [];
    } catch (error) {
      if (error?.name === "AbortError") throw error;
      missing.push(label);
      return [];
    }
  };
  const [issueComments, reviews, reviewComments] = await Promise.all([
    load(`issues/${number}/comments`, "issue comments"),
    load(`pulls/${number}/reviews`, "pull reviews"),
    load(`pulls/${number}/comments`, "review comments")
  ]);
  const comments = [
    ...issueComments.map(normalizeIssueComment),
    ...reviews.filter((review) => !isEmptyContainerReview(review)).map(normalizeReview),
    ...reviewComments.map(normalizeReviewComment)
  ].sort((a, b) => String(a.createdAt).localeCompare(String(b.createdAt)));
  return { comments, raw: { issueComments, reviews, reviewComments }, truncated, missing };
}

export function renderGithubDiscussionEntry(comment) {
  const label = comment.kind === "review" ? ` · review: ${comment.state}` : comment.kind === "review-comment" ? " · inline review" : "";
  return `### ${comment.author} · ${comment.createdAt}${label}\n\n${comment.body}`;
}
