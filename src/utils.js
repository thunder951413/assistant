export function cleanText(value) {
  return String(value || "").replace(/\r\n/g, "\n").trim();
}

export function uniqueValues(values) {
  return [...new Set((values || []).filter(Boolean))];
}

export function safeHostname(url) {
  try {
    return new URL(url).hostname.toLowerCase();
  } catch {
    return "";
  }
}

export function safePathname(url) {
  try {
    return new URL(url).pathname;
  } catch {
    return "";
  }
}

export function safeSearch(url) {
  try {
    return new URL(url).search;
  } catch {
    return "";
  }
}

export function slugTag(value) {
  return cleanText(value).toLowerCase().replace(/\s+/g, "-").replace(/[^a-z0-9+._/-]/g, "");
}

export function normalizeTags(tags) {
  const values = Array.isArray(tags) ? tags : String(tags || "").split(",");
  return uniqueValues(values.map((tag) => slugTag(tag)).filter(Boolean));
}

export function slugify(value) {
  const slug = String(value)
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 72);
  return slug || "item";
}
