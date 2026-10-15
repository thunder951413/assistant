// ---------------------------------------------------------------------------
// Shell, shared presentation helpers
// ---------------------------------------------------------------------------

const SOURCE_ORDER = ["teams", "jira", "confluence", "github", "web", "text"];
const SOURCE_META = {
  teams: { label: "Teams", mark: "T" },
  jira: { label: "Jira", mark: "J" },
  confluence: { label: "Confluence", mark: "C" },
  github: { label: "GitHub", mark: "G" },
  web: { label: "网页", mark: "W" },
  text: { label: "文本", mark: "文" }
};
const homeSummary = document.querySelector("#homeSummary");
const homeAttention = document.querySelector("#homeAttention");
const homeSourceHealth = document.querySelector("#homeSourceHealth");
const homeLibraryStats = document.querySelector("#homeLibraryStats");
const homeMarkAllReadButton = document.querySelector("#homeMarkAllReadButton");
const navUnreadCount = document.querySelector("#navUnreadCount");
const navSubscriptionAlert = document.querySelector("#navSubscriptionAlert");
const railLibraryMeta = document.querySelector("#railLibraryMeta");
const facetViews = document.querySelector("#facetViews");
const facetSources = document.querySelector("#facetSources");
const listScope = document.querySelector("#listScope");
const subsSummary = document.querySelector("#subsSummary");
const subscriptionSearch = document.querySelector("#subscriptionSearch");
const subscriptionDrawer = document.querySelector("#subscriptionDrawer");
const dndHint = document.querySelector("#dndHint");
const settingAutoProcessMode = document.querySelector("#settingAutoProcessMode");
const settingAutoProcessMessages = document.querySelector("#settingAutoProcessMessages");
const settingAutoProcessChars = document.querySelector("#settingAutoProcessChars");
const settingAutoProcessDays = document.querySelector("#settingAutoProcessDays");

Object.assign(state, {
  allItems: [],
  libraryView: "all",
  subscriptionScope: null,
  subscriptionStatusFilter: "all",
  subscriptionQuery: "",
  selectedSubscriptionId: "",
  detailModeFor: { id: "", mode: "" },
  readerMessageLimit: 150
});

homeMarkAllReadButton?.addEventListener("click", markAllHomeUpdatesRead);
document.querySelector("#facetToggleButton")?.addEventListener("click", (event) => {
  const open = !document.body.classList.contains("show-facets");
  document.body.classList.toggle("show-facets", open);
  event.currentTarget.setAttribute("aria-expanded", String(open));
});
document.querySelector("#materialSidebar")?.addEventListener("click", (event) => {
  if (event.target.closest(".facet") && document.body.classList.contains("show-facets")) {
    document.body.classList.remove("show-facets");
    document.querySelector("#facetToggleButton")?.setAttribute("aria-expanded", "false");
  }
});
subscriptionSearch?.addEventListener("input", debounce(() => {
  state.subscriptionQuery = subscriptionSearch.value.trim().toLowerCase();
  renderRefreshJobs(state.refreshJobs);
}, 120));
document.addEventListener("keydown", (event) => {
  if (event.key === "Escape" && !subscriptionDrawer.hidden) closeSubscriptionDrawer();
});
document.addEventListener("click", (event) => {
  // Close open menus when clicking elsewhere.
  document.querySelectorAll("details.menu[open]").forEach((menu) => {
    if (!menu.contains(event.target)) menu.open = false;
  });
});

function sourceLabel(source) {
  return SOURCE_META[normalizeSourceType(source)]?.label || source || "资料";
}

function sourceMark(source, extraClass = "") {
  const key = SOURCE_META[normalizeSourceType(source)] ? normalizeSourceType(source) : "text";
  return `<span class="source-mark ${extraClass}" data-source="${escapeHtml(key)}" aria-hidden="true">${escapeHtml(SOURCE_META[key].mark)}</span>`;
}

function isNewContentItem(item) {
  return Boolean(item?.contentUpdatedAt || item?.pendingContentUpdatedAt);
}

// When the content last changed at its source (latest Teams message, page edit),
// falling back to when this app noticed the change, then to the record's own time.
function itemActivityTime(item) {
  const source = item?.sourceUpdatedAt && !Number.isNaN(Date.parse(item.sourceUpdatedAt)) ? item.sourceUpdatedAt : "";
  return source || item?.contentUpdatedAt || item?.pendingContentUpdatedAt || item?.updatedAt || "";
}

function byActivityDesc(a, b) {
  return String(itemActivityTime(b)).localeCompare(String(itemActivityTime(a)));
}

function formatInterval(minutes) {
  const value = Number(minutes) || 60;
  if (value < 60) return `每 ${value} 分钟`;
  if (value % 1440 === 0) return value === 1440 ? "每天" : `每 ${value / 1440} 天`;
  const hours = Math.round(value / 60);
  return hours === 1 ? "每小时" : `每 ${hours} 小时`;
}

function dayBucket(value) {
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "更早";
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const day = 86400000;
  if (date >= startOfToday) return "今天";
  if (date >= new Date(startOfToday - day)) return "昨天";
  if (date >= new Date(startOfToday - 6 * day)) return "本周";
  if (date >= new Date(startOfToday - 30 * day)) return "本月";
  return "更早";
}

async function loadAll() {
  await Promise.all([loadTags(), loadLibraryIndex()]);
  await loadItems();
}

async function loadLibraryIndex() {
  try {
    const [{ items }] = await Promise.all([api("/api/items"), loadPreviews()]);
    state.allItems = items || [];
    state.updateCount = state.allItems.filter(isNewContentItem).length;
  } catch (error) {
    console.warn("Failed to load library index:", error);
  }
  renderLibraryFacets();
  renderMaterialsNewBadge();
}

function renderView() {
  const views = { home: homeView, chat: chatView, materials: materialsView, topics: topicsView, import: importView, supplemental: supplementalView, subscriptions: subscriptionsView, settings: settingsView };
  for (const [name, element] of Object.entries(views)) {
    if (element) element.hidden = state.view !== name;
  }
  document.querySelectorAll(".nav-item").forEach((item) => {
    const active = item.dataset.view === state.view;
    item.classList.toggle("is-active", active);
    if (active) item.setAttribute("aria-current", "page");
    else item.removeAttribute("aria-current");
  });
  globalAddButton?.classList.toggle("is-active", state.view === "import");
  document.body.dataset.activeView = state.view;
  if (state.view === "settings") setSettingsTab(state.settingsTab);
  if (state.view !== "subscriptions") closeSubscriptionDrawer();
  renderMaterialsNewBadge();
}

async function switchView(view) {
  state.view = view;
  renderView();
  if (view === "home") await loadHomeOverview();
  if (view === "materials") await loadAll();
  if (view === "topics") await loadTopics();
  if (view === "settings") await loadSettings();
  if (view === "subscriptions") {
    await Promise.all([loadSettings(), loadLibraryIndex()]);
    renderRefreshJobs(state.refreshJobs);
  }
  if (view === "supplemental") await loadSupplementalContext();
}

function renderMaterialsNewBadge() {
  const unread = state.updateCount || 0;
  for (const badge of [materialsNewBadge, navUnreadCount]) {
    if (!badge) continue;
    badge.hidden = !unread;
    badge.textContent = unread > 99 ? "99+" : String(unread);
    badge.title = unread ? `${unread} 条资料有未读的新内容` : "";
  }
  const problems = (state.refreshJobs || []).filter((job) => subscriptionState(job).key === "error").length;
  if (navSubscriptionAlert) {
    navSubscriptionAlert.hidden = !problems;
    navSubscriptionAlert.textContent = String(problems);
    navSubscriptionAlert.title = problems ? `${problems} 个订阅刷新失败` : "";
  }
  if (railLibraryMeta && state.allItems?.length) railLibraryMeta.textContent = `${state.allItems.length} 条资料`;
}

function setDoNotDisturbState(enabled, options = {}) {
  state.doNotDisturb = Boolean(enabled);
  if (!doNotDisturbToggle) return;
  doNotDisturbToggle.classList.toggle("is-active", state.doNotDisturb);
  doNotDisturbToggle.setAttribute("aria-checked", String(state.doNotDisturb));
  doNotDisturbToggle.title = state.doNotDisturb ? "关闭免打扰，恢复定时刷新" : "开启免打扰，暂停定时刷新和通知";
  if (dndHint) dndHint.textContent = state.doNotDisturb ? "定时刷新已暂停" : "定时刷新照常进行";
  if (!options.renderOnly) doNotDisturbToggle.disabled = false;
  if (state.view === "home") renderHomeAttention();
}

