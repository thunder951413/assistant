// Tracks which captured items still belong to a filtered list subscription.
// An item that drops out of the filter is marked "left": it is no longer
// refreshed, and the person decides to delete it or keep it ("kept").

export const MEMBERSHIP_MEMBER = "member";
export const MEMBERSHIP_LEFT = "left";
export const MEMBERSHIP_KEPT = "kept";

/**
 * @param {object} input
 * @param {Array<{id:string,url:string,listMembership?:object}>} input.children items captured from this list
 * @param {Set<string>} input.currentKeys normalized URLs currently in the list
 * @param {boolean} input.complete whether the whole list was observed (no paging gaps, not cut by maxItems)
 * @param {(url:string)=>string} input.normalize
 * @returns {{left: object[], returned: object[]}} items whose membership should change
 */
export function diffListMembership({ children = [], currentKeys = new Set(), complete = false, normalize = (value) => value }) {
  const left = [];
  const returned = [];
  for (const child of children) {
    const status = child.listMembership?.status || MEMBERSHIP_MEMBER;
    const inList = currentKeys.has(normalize(child.url));
    if (inList && status !== MEMBERSHIP_MEMBER) returned.push(child);
    // Only a complete observation can prove that something left the list.
    else if (!inList && complete && status === MEMBERSHIP_MEMBER) left.push(child);
  }
  return { left, returned };
}

export function membershipPatch(status, listUrl, now = new Date().toISOString(), previous = {}) {
  if (status === MEMBERSHIP_MEMBER) return { status, listUrl, seenAt: now };
  if (status === MEMBERSHIP_LEFT) return { status, listUrl, leftAt: now };
  return { status, listUrl, leftAt: previous.leftAt || now, keptAt: now };
}

/** A list-row fingerprint match lets the refresh skip re-fetching the item page. */
export function shouldSkipByListFingerprint(existing, fingerprint, now = Date.now(), maxAgeMs = 7 * 24 * 60 * 60 * 1000) {
  if (!existing || !fingerprint || existing.listFingerprint !== fingerprint) return false;
  const fetchedAt = Date.parse(existing.lastFetchedAt || "");
  return Number.isFinite(fetchedAt) && now - fetchedAt < maxAgeMs;
}
