const state = {
  view: "home",
  items: [],
  tags: [],
  chatSessions: [],
  activeChatId: "",
  importPreview: null,
  importPreviewRequest: 0,
  importPreviewController: null,
  importSubmitting: false,
  itemSelectionRequest: 0,
  chatRequest: null,
  chatSessionsHydrated: false,
  chatSessionsLocalOnly: false,
  chatPersistQueue: Promise.resolve(),
  refreshJobs: [],
  tagEditor: {
    item: null,
    selected: [],
    recommended: []
  },
  batchProcess: {
    items: [],
    tagAssignments: [],
    tagOptions: [],
    selectedTags: [],
    errors: [],
    cancelRequested: false,
    running: false
  },
  settingsTags: [],
  selectedSettingsTags: new Set(),
  supplementalEntries: [],
  updateCount: 0,
  refreshMonitorTimer: null,
  activeRefreshRun: {
    id: "",
    scope: "",
    pollTimer: null
  },
  seenRefreshRunKey: localStorage.getItem("materialOrganizer.seenRefreshRunKey") || "",
  seenRefreshFailureKey: localStorage.getItem("materialOrganizer.seenRefreshFailureKey") || "",
  toastTimers: new Map(),
  authFailurePrompt: null,
  teamsReadyRunId: "",
  listClassification: null,
  listClassifying: false,
  listClassifier: {
    categories: loadStoredListCategories()
  },
  subscriptionDirty: false,
  settingsTab: "ai",
  doNotDisturb: false,
  detailMode: localStorage.getItem("materialOrganizer.detailMode") || "processed",
  selectedId: null,
  sourceType: "",
  integrityStatus: "",
  tag: "",
  query: "",
  page: 1,
  pageSize: 50,
  totalItems: 0,
  settings: null
};

const itemList = document.querySelector("#itemList");
const tagList = document.querySelector("#tagList");
const materialsNewBadge = document.querySelector("#materialsNewBadge");
const materialSidebar = document.querySelector("#materialSidebar");
const homeRecentUpdates = document.querySelector("#homeRecentUpdates");
const workbenchSearchForm = document.querySelector("#workbenchSearchForm");
const workbenchSearchInput = document.querySelector("#workbenchSearchInput");
const workbenchAskButton = document.querySelector("#workbenchAskButton");
const homeFirstImportButton = document.querySelector("#homeFirstImportButton");
const homeView = document.querySelector("#homeView");
const doNotDisturbToggle = document.querySelector("#doNotDisturbToggle");
const chatView = document.querySelector("#chatView");
const materialsView = document.querySelector("#materialsView");
const importView = document.querySelector("#importView");
const supplementalView = document.querySelector("#supplementalView");
const subscriptionsView = document.querySelector("#subscriptionsView");
const settingsView = document.querySelector("#settingsView");
const detailPanel = document.querySelector("#detailPanel");
const materialsTitle = document.querySelector("#materialsTitle");
const resultCount = document.querySelector("#resultCount");
const searchInput = document.querySelector("#searchInput");
const classifyListButton = document.querySelector("#classifyListButton");
const batchProcessButton = document.querySelector("#batchProcessButton");
const agentRoot = document.querySelector("#agentRoot");
const chatSessionTitle = document.querySelector("#chatSessionTitle");
const chatHistoryList = document.querySelector("#chatHistoryList");
const newChatButton = document.querySelector("#newChatButton");
const clearChatHistoryButton = document.querySelector("#clearChatHistoryButton");
const chatMessages = document.querySelector("#chatMessages");
const chatForm = document.querySelector("#chatForm");
const chatInput = document.querySelector("#chatInput");
const importForm = document.querySelector("#importForm");
const importContent = document.querySelector("#importContent");
const importSourceType = document.querySelector("#importSourceType");
const importFetchMode = document.querySelector("#importFetchMode");
const importPageKind = document.querySelector("#importPageKind");
const importUrl = document.querySelector("#importUrl");
const dropZone = document.querySelector("#dropZone");
const previewStatus = document.querySelector("#previewStatus");
const previewBadge = document.querySelector("#previewBadge");
const confirmTitle = document.querySelector("#confirmTitle");
const confirmTags = document.querySelector("#confirmTags");
const previewContent = document.querySelector("#previewContent");
const previewReadableContent = document.querySelector("#previewReadableContent");
const summarizeButton = document.querySelector("#summarizeButton");
const summaryStatus = document.querySelector("#summaryStatus");
const summaryContent = document.querySelector("#summaryContent");
const confirmImportButton = document.querySelector("#confirmImportButton");
const clearImportButton = document.querySelector("#clearImportButton");
const copyPreviewButton = document.querySelector("#copyPreviewButton");
const settingsForm = document.querySelector("#settingsForm");
const settingsTabs = [...document.querySelectorAll("[data-settings-tab]")];
const settingsPanels = [...document.querySelectorAll("[data-settings-panel]")];
const settingBaseUrl = document.querySelector("#settingBaseUrl");
const settingApiKey = document.querySelector("#settingApiKey");
const settingModel = document.querySelector("#settingModel");
const aiPrivacyNotice = document.querySelector("#aiPrivacyNotice");
const settingShowThinking = document.querySelector("#settingShowThinking");
const settingShowToolCalls = document.querySelector("#settingShowToolCalls");
const settingNotificationsEnabled = document.querySelector("#settingNotificationsEnabled");
const notificationSourceInputs = [...document.querySelectorAll("[data-notification-source]")];
const settingRefreshStartTime = document.querySelector("#settingRefreshStartTime");
const settingRefreshEndTime = document.querySelector("#settingRefreshEndTime");
const settingEmbeddingEnabled = document.querySelector("#settingEmbeddingEnabled");
const settingEmbeddingBaseUrl = document.querySelector("#settingEmbeddingBaseUrl");
const settingEmbeddingApiKey = document.querySelector("#settingEmbeddingApiKey");
const settingEmbeddingModel = document.querySelector("#settingEmbeddingModel");
const settingEmbeddingDimensions = document.querySelector("#settingEmbeddingDimensions");
const processingPromptFields = [...document.querySelectorAll("[data-processing-prompt]")];
const settingDocumentRoot = document.querySelector("#settingDocumentRoot");
const activeDocumentRoot = document.querySelector("#activeDocumentRoot");
const storageStatsElement = document.querySelector("#storageStats");
const cleanupSnapshotsButton = document.querySelector("#cleanupSnapshotsButton");
const cleanupBrowserCacheButton = document.querySelector("#cleanupBrowserCacheButton");
const storageCleanupStatus = document.querySelector("#storageCleanupStatus");
const settingsStatus = document.querySelector("#settingsStatus");
const exportSettingsButton = document.querySelector("#exportSettingsButton");
const importSettingsButton = document.querySelector("#importSettingsButton");
const exportDataButton = document.querySelector("#exportDataButton");
const importDataButton = document.querySelector("#importDataButton");
const settingsImportFile = document.querySelector("#settingsImportFile");
const dataImportFile = document.querySelector("#dataImportFile");
const toastRegion = document.querySelector("#toastRegion");
const replaceDataOnImport = document.querySelector("#replaceDataOnImport");
const importExportStatus = document.querySelector("#importExportStatus");
const sourceProfiles = document.querySelector("#sourceProfiles");
const addSourceProfileForm = document.querySelector("#addSourceProfileForm");
const newSourceHostname = document.querySelector("#newSourceHostname");
const newSourceType = document.querySelector("#newSourceType");
const webdriverStatus = document.querySelector("#webdriverStatus");
const subscriptionTabs = document.querySelector("#subscriptionTabs");
const runAllSubscriptionsButton = document.querySelector("#runAllSubscriptionsButton");
const saveSubscriptionsButton = document.querySelector("#saveSubscriptionsButton");
const subscriptionConnectionSettingsButton = document.querySelector("#subscriptionConnectionSettingsButton");
const refreshJobs = document.querySelector("#refreshJobs");
const refreshJobStatus = document.querySelector("#refreshJobStatus");
const newTagInput = document.querySelector("#newTagInput");
const addTagButton = document.querySelector("#addTagButton");
const tagManagerStatus = document.querySelector("#tagManagerStatus");
const selectAllTagsButton = document.querySelector("#selectAllTagsButton");
const clearTagSelectionButton = document.querySelector("#clearTagSelectionButton");
const deleteSelectedTagsButton = document.querySelector("#deleteSelectedTagsButton");
const settingsTagList = document.querySelector("#settingsTagList");
const tagDialog = document.querySelector("#tagDialog");
const tagDialogForm = document.querySelector("#tagDialogForm");
const tagDialogSubtitle = document.querySelector("#tagDialogSubtitle");
const closeTagDialogButton = document.querySelector("#closeTagDialogButton");
const cancelTagDialogButton = document.querySelector("#cancelTagDialogButton");
const tagManualInput = document.querySelector("#tagManualInput");
const addManualTagButton = document.querySelector("#addManualTagButton");
const selectedTagChips = document.querySelector("#selectedTagChips");
const existingTagChips = document.querySelector("#existingTagChips");
const recommendedTagChips = document.querySelector("#recommendedTagChips");
const recommendTagsButton = document.querySelector("#recommendTagsButton");
const tagRecommendStatus = document.querySelector("#tagRecommendStatus");
const supplementalSummary = document.querySelector("#supplementalSummary");
const supplementalList = document.querySelector("#supplementalList");
const supplementalStatus = document.querySelector("#supplementalStatus");
const saveSupplementalButton = document.querySelector("#saveSupplementalButton");
const suggestSupplementalButton = document.querySelector("#suggestSupplementalButton");
const addSupplementalEntryButton = document.querySelector("#addSupplementalEntryButton");
const batchProcessDialog = document.querySelector("#batchProcessDialog");
const batchProcessForm = document.querySelector("#batchProcessForm");
const closeBatchProcessButton = document.querySelector("#closeBatchProcessButton");
const cancelBatchProcessButton = document.querySelector("#cancelBatchProcessButton");
const startBatchProcessButton = document.querySelector("#startBatchProcessButton");
const applyBatchTagsButton = document.querySelector("#applyBatchTagsButton");
const batchProcessTagsToggle = document.querySelector("#batchProcessTagsToggle");
const batchProcessTagMode = document.querySelector("#batchProcessTagMode");
const batchProcessForceToggle = document.querySelector("#batchProcessForceToggle");
const batchProcessConcurrency = document.querySelector("#batchProcessConcurrency");
const batchProcessStatus = document.querySelector("#batchProcessStatus");
const batchProcessCount = document.querySelector("#batchProcessCount");
const batchProcessProgress = document.querySelector("#batchProcessProgress");
const batchProcessSubtitle = document.querySelector("#batchProcessSubtitle");
const batchTagReview = document.querySelector("#batchTagReview");
const batchTagGroups = document.querySelector("#batchTagGroups");
const classifyListDialog = document.querySelector("#classifyListDialog");
const classifyListForm = document.querySelector("#classifyListForm");
const closeClassifyListButton = document.querySelector("#closeClassifyListButton");
const cancelClassifyListButton = document.querySelector("#cancelClassifyListButton");
const runClassifyListButton = document.querySelector("#runClassifyListButton");
const classifyCategoryInput = document.querySelector("#classifyCategoryInput");
const addClassifyCategoryButton = document.querySelector("#addClassifyCategoryButton");
const classificationCategoryChips = document.querySelector("#classificationCategoryChips");
const classificationStatus = document.querySelector("#classificationStatus");
const classificationCount = document.querySelector("#classificationCount");
const classificationProgress = document.querySelector("#classificationProgress");
const classifyListSubtitle = document.querySelector("#classifyListSubtitle");
const authFailureDialog = document.querySelector("#authFailureDialog");
const authFailureMessage = document.querySelector("#authFailureMessage");
const closeAuthFailureButton = document.querySelector("#closeAuthFailureButton");
const dismissAuthFailureButton = document.querySelector("#dismissAuthFailureButton");
const openAuthWebdriverButton = document.querySelector("#openAuthWebdriverButton");
const teamsReadyDialog = document.querySelector("#teamsReadyDialog");
const teamsReadyStatus = document.querySelector("#teamsReadyStatus");
const confirmTeamsReadyButton = document.querySelector("#confirmTeamsReadyButton");
const cancelTeamsRefreshButton = document.querySelector("#cancelTeamsRefreshButton");
const globalAddButton = document.querySelector("#globalAddButton");
const previewImportButton = document.querySelector("#previewImportButton");
const subscribeImportButton = document.querySelector("#subscribeImportButton");
const chatSubmitButton = document.querySelector("#chatSubmitButton");
const stopChatButton = document.querySelector("#stopChatButton");
const chatSessionStatus = document.querySelector("#chatSessionStatus");
const copyCapturePairingButton = document.querySelector("#copyCapturePairingButton");
const capturePairingStatus = document.querySelector("#capturePairingStatus");

