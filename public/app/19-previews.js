// ---------------------------------------------------------------------------
// Inbox-style previews: the newest message under each item, like a mail list
// ---------------------------------------------------------------------------
const feedPreviewToggle = document.querySelector("#feedPreviewToggle");
const listPreviewToggle = document.querySelector("#listPreviewToggle");
state.previews = {};
state.showPreview = (() => { try { return localStorage.getItem("materialOrganizer.showPreview") !== "off"; } catch { return true; } })();

async function loadPreviews() {
  try {
    const { previews } = await api("/api/previews");
    state.previews = previews || {};
  } catch {
    // Previews are optional; lists render without them.
  }
  return {};
}

function previewLine(item) {
  if (!state.showPreview) return "";
  const preview = state.previews?.[item.id];
  if (!preview?.text) return "";
  const unread = isNewContentItem(item);
  const count = !unread || preview.kind !== "message" ? ""
    : preview.newCount > 0 ? `<span class="preview-count">${escapeHtml(preview.newCount)} 条新</span>`
    : preview.newCount === null ? `<span class="preview-count">新</span>` : "";
  return `<span class="item-preview">${count}${preview.author ? `<span class="preview-author">${escapeHtml(preview.author)}：</span>` : ""}${escapeHtml(preview.text)}</span>`;
}

function setShowPreview(on) {
  state.showPreview = on;
  try { localStorage.setItem("materialOrganizer.showPreview", on ? "on" : "off"); } catch {}
  for (const button of [feedPreviewToggle, listPreviewToggle]) button?.setAttribute("aria-pressed", String(on));
  if (state.view === "home") renderHomeOverview();
  if (state.view === "materials") renderItems();
}

for (const button of [feedPreviewToggle, listPreviewToggle]) button?.addEventListener("click", () => setShowPreview(!state.showPreview));
for (const button of [feedPreviewToggle, listPreviewToggle]) button?.setAttribute("aria-pressed", String(state.showPreview));

