chatForm.addEventListener("submit", sendChatMessage);
newChatButton.addEventListener("click", () => createChatSession({ activate: true }));
clearChatHistoryButton.addEventListener("click", clearChatHistory);
importForm.addEventListener("submit", previewImport);
confirmImportButton.addEventListener("click", confirmImport);
subscribeImportButton?.addEventListener("click", () => confirmImport({ subscribe: true }));
globalAddButton?.addEventListener("click", () => switchView("import"));
homeFirstImportButton?.addEventListener("click", () => switchView("import"));
workbenchSearchForm?.addEventListener("submit", openWorkbenchSearch);
workbenchAskButton?.addEventListener("click", openWorkbenchAsk);
stopChatButton?.addEventListener("click", cancelChatRequest);
copyCapturePairingButton?.addEventListener("click", copyCapturePairing);
clearImportButton.addEventListener("click", resetImport);
copyPreviewButton.addEventListener("click", copyPreview);
summarizeButton.addEventListener("click", summarizePreview);
settingsForm.addEventListener("submit", saveSettings);
doNotDisturbToggle?.addEventListener("click", toggleDoNotDisturb);
exportSettingsButton.addEventListener("click", () => downloadExport("/api/export/settings"));
exportDataButton.addEventListener("click", () => downloadExport("/api/export/data"));
importSettingsButton.addEventListener("click", () => settingsImportFile.click());
importDataButton.addEventListener("click", () => dataImportFile.click());
cleanupSnapshotsButton?.addEventListener("click", cleanupSnapshots);
cleanupBrowserCacheButton?.addEventListener("click", cleanupBrowserCache);
settingsImportFile.addEventListener("change", importSettingsFile);
dataImportFile.addEventListener("change", importDataFile);
saveSubscriptionsButton.addEventListener("click", saveSubscriptions);
subscriptionConnectionSettingsButton?.addEventListener("click", async () => {
  state.settingsTab = "capture";
  await switchView("settings");
});
document.querySelector("#addSourceProfileButton")?.addEventListener("click", addSourceProfile);
newSourceHostname?.addEventListener("keydown", (event) => { if (event.key === "Enter") addSourceProfile(event); });
// Unsaved edits live in the drawer; background polling never re-renders it then.
document.querySelector("#subscriptionDrawer")?.addEventListener("input", () => { state.subscriptionDirty = true; });
runAllSubscriptionsButton.addEventListener("click", runAllRefreshJobs);
settingsTabs.forEach((button) => {
  button.addEventListener("click", () => setSettingsTab(button.dataset.settingsTab));
});
tagDialogForm.addEventListener("submit", saveTagDialog);
closeTagDialogButton.addEventListener("click", closeTagDialog);
cancelTagDialogButton.addEventListener("click", closeTagDialog);
addManualTagButton.addEventListener("click", addManualTag);
recommendTagsButton.addEventListener("click", recommendTagsForCurrentItem);
saveSupplementalButton.addEventListener("click", saveSupplementalContext);
suggestSupplementalButton.addEventListener("click", suggestSupplementalContext);
addSupplementalEntryButton.addEventListener("click", addSupplementalEntry);
batchProcessButton.addEventListener("click", openBatchProcessDialog);
classifyListButton.addEventListener("click", openClassifyListDialog);
closeClassifyListButton.addEventListener("click", closeClassifyListDialog);
cancelClassifyListButton.addEventListener("click", closeClassifyListDialog);
addClassifyCategoryButton.addEventListener("click", addClassificationCategory);
classifyCategoryInput.addEventListener("keydown", (event) => {
  if (event.key === "Enter") {
    event.preventDefault();
    addClassificationCategory();
  }
});
runClassifyListButton.addEventListener("click", classifyCurrentList);
classifyListForm.addEventListener("submit", (event) => event.preventDefault());
closeBatchProcessButton.addEventListener("click", closeBatchProcessDialog);
cancelBatchProcessButton.addEventListener("click", closeBatchProcessDialog);
startBatchProcessButton.addEventListener("click", startBatchProcess);
applyBatchTagsButton.addEventListener("click", applyBatchTags);
batchProcessTagsToggle.addEventListener("change", updateBatchProcessCandidates);
batchProcessTagMode.addEventListener("change", updateBatchProcessCandidates);
batchProcessForceToggle.addEventListener("change", updateBatchProcessCandidates);
batchProcessForm.addEventListener("submit", (event) => event.preventDefault());
closeAuthFailureButton?.addEventListener("click", closeAuthFailureDialog);
dismissAuthFailureButton?.addEventListener("click", closeAuthFailureDialog);
openAuthWebdriverButton?.addEventListener("click", openAuthFailureWebdriver);
teamsReadyDialog?.addEventListener("cancel", (event) => event.preventDefault());
confirmTeamsReadyButton?.addEventListener("click", confirmTeamsReady);
cancelTeamsRefreshButton?.addEventListener("click", cancelTeamsReadyRefresh);
addTagButton.addEventListener("click", addSettingsTags);
selectAllTagsButton.addEventListener("click", () => {
  state.selectedSettingsTags = new Set(state.settingsTags.map((tag) => tag.name));
  renderSettingsTags();
});
clearTagSelectionButton.addEventListener("click", () => {
  state.selectedSettingsTags.clear();
  renderSettingsTags();
});
deleteSelectedTagsButton.addEventListener("click", deleteSelectedSettingsTags);
newTagInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addSettingsTags();
});
tagManualInput.addEventListener("keydown", (event) => {
  if (event.key !== "Enter") return;
  event.preventDefault();
  addManualTag();
});
document.querySelectorAll("[data-webdriver-url]").forEach((button) => {
  button.addEventListener("click", () => openWebdriver(button.dataset.webdriverUrl));
});
document.querySelectorAll("[data-save-cookie-url]").forEach((button) => {
  button.addEventListener("click", () => saveWebdriverCookies(button.dataset.saveCookieUrl));
});
importContent.addEventListener("paste", () => setTimeout(() => scheduleAutoPreviewImport(), 0));
importUrl.addEventListener("paste", () => setTimeout(() => scheduleAutoPreviewImport(), 0));
previewContent.addEventListener("input", () => {
  previewReadableContent.innerHTML = renderMarkdown(previewContent.value || "暂无可阅读内容。");
});
dropZone.addEventListener("dragover", handleDragOver);
dropZone.addEventListener("dragleave", handleDragLeave);
dropZone.addEventListener("drop", handleDrop);

document.querySelectorAll(".nav-item").forEach((button) => {
  button.addEventListener("click", async () => {
    await switchView(button.dataset.view);
  });
});

document.querySelectorAll("[data-view-shortcut]").forEach((button) => {
  button.addEventListener("click", async () => {
    await switchView(button.dataset.viewShortcut);
  });
});

searchInput.addEventListener("input", debounce(async () => {
  state.query = searchInput.value.trim();
  await loadItems();
}, 200));

