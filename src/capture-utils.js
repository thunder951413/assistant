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
  return a === b || a.startsWith(b) || b.startsWith(a);
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
