export function normalizeComparableTitle(value) {
  return String(value || "")
    .trim()
    .toLowerCase()
    .replace(/\s+refresh$/i, "")
    .replace(/\s+/g, " ");
}

export function areCaptureTitlesConsistent(expected, actual) {
  const a = normalizeComparableTitle(expected);
  const b = normalizeComparableTitle(actual);
  if (!a || !b) return true;
  if (a === b) return true;
  // A prefix only counts when the shorter title was visibly truncated by Teams
  // ("Samsung 项目 CXD6866ER…"); otherwise "BM Test" must not match "BM Test 2".
  const truncated = (value) => /(?:…|\.\.\.)$/.test(value);
  const stem = (value) => value.replace(/(?:…|\.\.\.)$/, "").trim();
  if (truncated(a) && stem(a) && b.startsWith(stem(a))) return true;
  if (truncated(b) && stem(b) && a.startsWith(stem(b))) return true;
  return false;
}

export function paginate(values, page = 1, pageSize = values.length || 1) {
  const safePage = Math.max(1, Number(page) || 1);
  const safePageSize = Math.min(200, Math.max(1, Number(pageSize) || 1));
  const start = (safePage - 1) * safePageSize;
  return {
    items: values.slice(start, start + safePageSize),
    total: values.length,
    page: safePage,
    pageSize: safePageSize
  };
}

export function isSupportedCaptureContentType(contentType) {
  const value = String(contentType || "").toLowerCase();
  return !value || /(text\/|application\/(json|xml|xhtml\+xml))/.test(value);
}
