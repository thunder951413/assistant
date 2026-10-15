async function saveSettings(event) {
  event.preventDefault();
  settingsStatus.textContent = "正在保存...";
  try {
    const { settings } = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        ai: {
          baseUrl: settingBaseUrl.value,
          apiKey: settingApiKey.value === "********" ? undefined : settingApiKey.value,
          model: settingModel.value
        },
        chat: {
          showThinking: settingShowThinking.checked,
          showToolCalls: settingShowToolCalls.checked
        },
        doNotDisturb: {
          enabled: state.doNotDisturb
        },
        notifications: collectNotificationSettings(),
        refreshSchedule: {
          startTime: settingRefreshStartTime.value,
          endTime: settingRefreshEndTime.value
        },
        embedding: {
          enabled: settingEmbeddingEnabled.checked,
          baseUrl: settingEmbeddingBaseUrl.value,
          apiKey: settingEmbeddingApiKey.value === "********" ? undefined : settingEmbeddingApiKey.value,
          model: settingEmbeddingModel.value,
          dimensions: Number(settingEmbeddingDimensions.value || 0)
        },
        processingPrompts: collectProcessingPrompts(),
        autoProcess: {
          mode: settingAutoProcessMode?.value,
          minNewMessages: Number(settingAutoProcessMessages?.value || 20),
          minNewChars: Number(settingAutoProcessChars?.value || 3000),
          maxStaleDays: Number(settingAutoProcessDays?.value || 7)
        },
        documentRoot: settingDocumentRoot.value,
        sources: collectSourceProfiles()
      })
    });
    activeDocumentRoot.textContent = settings.activeDocumentRoot;
    settingApiKey.value = settings.ai.apiKey;
    settingShowThinking.checked = settings.chat?.showThinking !== false;
    settingShowToolCalls.checked = settings.chat?.showToolCalls !== false;
    setDoNotDisturbState(Boolean(settings.doNotDisturb?.enabled), { renderOnly: true });
    settingNotificationsEnabled.checked = settings.notifications?.enabled !== false;
    for (const input of notificationSourceInputs) {
      input.checked = settings.notifications?.sources?.[input.dataset.notificationSource] !== false;
    }
    settingRefreshStartTime.value = settings.refreshSchedule?.startTime || "08:00";
    settingRefreshEndTime.value = settings.refreshSchedule?.endTime || "20:00";
    settingEmbeddingEnabled.checked = Boolean(settings.embedding?.enabled);
    settingEmbeddingApiKey.value = settings.embedding?.apiKey || "";
    settingEmbeddingBaseUrl.value = settings.embedding?.baseUrl || "";
    settingEmbeddingModel.value = settings.embedding?.model || "";
    settingEmbeddingDimensions.value = settings.embedding?.dimensions || "";
    for (const field of processingPromptFields) {
      field.value = settings.processingPrompts?.[field.dataset.processingPrompt] || field.value;
    }
    agentRoot.textContent = settings.activeDocumentRoot;
    fillAutoProcessFields(settings.autoProcess);
    settingsStatus.textContent = "设置已保存。";
    renderRefreshJobs(settings.refreshJobs || []);
    await loadSettingsTags();
  } catch (error) {
    settingsStatus.textContent = error.message;
  }
}

async function toggleDoNotDisturb() {
  if (!doNotDisturbToggle) return;
  const next = !state.doNotDisturb;
  doNotDisturbToggle.disabled = true;
  setDoNotDisturbState(next, { renderOnly: true });
  try {
    const { settings } = await api("/api/settings", {
      method: "PATCH",
      body: JSON.stringify({
        doNotDisturb: {
          enabled: next
        }
      })
    });
    setDoNotDisturbState(Boolean(settings.doNotDisturb?.enabled));
  } catch (error) {
    setDoNotDisturbState(!next);
    console.warn("Failed to update do not disturb mode:", error);
  }
}

async function downloadExport(path) {
  importExportStatus.textContent = "正在生成导出文件...";
  try {
    const response = await fetch(path);
    if (!response.ok) {
      const payload = await response.json().catch(() => ({}));
      throw new Error(payload.error || `导出失败：${response.status}`);
    }
    const blob = await response.blob();
    const filename = filenameFromDisposition(response.headers.get("Content-Disposition"))
      || (path.includes("settings") ? "assistant-settings.json" : "assistant-data.json");
    const href = URL.createObjectURL(blob);
    const link = document.createElement("a");
    link.href = href;
    link.download = filename;
    document.body.append(link);
    link.click();
    link.remove();
    URL.revokeObjectURL(href);
    importExportStatus.textContent = `已导出 ${filename}。`;
  } catch (error) {
    importExportStatus.textContent = error.message;
  }
}

async function importSettingsFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  importExportStatus.textContent = "正在导入设置...";
  try {
    const payload = JSON.parse(await file.text());
    const { settings } = await api("/api/import/settings", {
      method: "POST",
      body: JSON.stringify(payload)
    });
    await loadSettings();
    activeDocumentRoot.textContent = settings.activeDocumentRoot;
    agentRoot.textContent = settings.activeDocumentRoot;
    importExportStatus.textContent = "设置导入完成。";
  } catch (error) {
    importExportStatus.textContent = error.message;
  }
}

async function importDataFile(event) {
  const file = event.target.files?.[0];
  event.target.value = "";
  if (!file) return;
  importExportStatus.textContent = "正在导入数据...";
  try {
    const bundle = JSON.parse(await file.text());
    const result = await api("/api/import/data", {
      method: "POST",
      body: JSON.stringify({
        bundle,
        mode: replaceDataOnImport.checked ? "replace" : "merge"
      })
    });
    await loadTags();
    if (state.view === "materials") await loadItems();
    importExportStatus.textContent = `数据导入完成：写入 ${result.writtenFileCount} 个文件。`;
  } catch (error) {
    importExportStatus.textContent = error.message;
  }
}

function filenameFromDisposition(disposition) {
  const value = String(disposition || "");
  const utf8Match = value.match(/filename\*=UTF-8''([^;]+)/i);
  if (utf8Match) return decodeURIComponent(utf8Match[1]);
  const plainMatch = value.match(/filename="?([^";]+)"?/i);
  return plainMatch ? plainMatch[1] : "";
}

function collectProcessingPrompts() {
  return Object.fromEntries(processingPromptFields.map((field) => [
    field.dataset.processingPrompt,
    field.value
  ]));
}

function collectNotificationSettings() {
  return {
    enabled: settingNotificationsEnabled.checked,
    sources: Object.fromEntries(notificationSourceInputs.map((input) => [
      input.dataset.notificationSource,
      input.checked
    ]))
  };
}

async function loadSettingsTags() {
  const { tags } = await api("/api/tags");
  state.settingsTags = tags || [];
  state.selectedSettingsTags = new Set([...state.selectedSettingsTags].filter((tag) => state.settingsTags.some((item) => item.name === tag)));
  renderSettingsTags();
}

function renderSettingsTags() {
  if (!settingsTagList) return;
  const selectedCount = state.selectedSettingsTags.size;
  tagManagerStatus.textContent = selectedCount
    ? `已选择 ${selectedCount} 个标签。`
    : `共 ${state.settingsTags.length} 个标签。`;
  deleteSelectedTagsButton.disabled = selectedCount === 0;
  clearTagSelectionButton.disabled = selectedCount === 0;
  selectAllTagsButton.disabled = state.settingsTags.length === 0 || selectedCount === state.settingsTags.length;

  settingsTagList.innerHTML = state.settingsTags.length
    ? state.settingsTags.map((tag) => `
        <div class="settings-tag-row">
          <label class="settings-tag-check">
            <input type="checkbox" data-settings-tag="${escapeHtml(tag.name)}" ${state.selectedSettingsTags.has(tag.name) ? "checked" : ""} />
            <span>${escapeHtml(tag.name)}</span>
          </label>
          <small>${escapeHtml(tag.count)} 条资料</small>
          <button type="button" data-rename-settings-tag="${escapeHtml(tag.name)}">改名</button>
        </div>
      `).join("")
    : `<div class="empty-inline">还没有标签。</div>`;

  settingsTagList.querySelectorAll("[data-settings-tag]").forEach((checkbox) => {
    checkbox.addEventListener("change", () => {
      if (checkbox.checked) {
        state.selectedSettingsTags.add(checkbox.dataset.settingsTag);
      } else {
        state.selectedSettingsTags.delete(checkbox.dataset.settingsTag);
      }
      renderSettingsTags();
    });
  });
  settingsTagList.querySelectorAll("[data-rename-settings-tag]").forEach((button) => {
    button.addEventListener("click", () => renameSettingsTag(button.dataset.renameSettingsTag));
  });
}

async function addSettingsTags() {
  const value = newTagInput.value.trim();
  if (!value) return;
  tagManagerStatus.textContent = "正在新增标签...";
  try {
    const { tags } = await api("/api/tags", {
      method: "POST",
      body: JSON.stringify({ tags: value })
    });
    newTagInput.value = "";
    state.settingsTags = tags || [];
    await loadTags();
    renderSettingsTags();
    tagManagerStatus.textContent = "标签已新增。";
  } catch (error) {
    tagManagerStatus.textContent = error.message;
  }
}

async function deleteSelectedSettingsTags() {
  const tags = [...state.selectedSettingsTags];
  if (!tags.length) return;
  const totalUsage = state.settingsTags
    .filter((tag) => state.selectedSettingsTags.has(tag.name))
    .reduce((sum, tag) => sum + Number(tag.count || 0), 0);
  const ok = confirm(`确认删除 ${tags.length} 个标签？这些标签会从 ${totalUsage} 处资料标签中移除，资料本身不会删除。`);
  if (!ok) return;

  tagManagerStatus.textContent = "正在删除标签...";
  try {
    const result = await api("/api/tags", {
      method: "DELETE",
      body: JSON.stringify({ tags })
    });
    state.selectedSettingsTags.clear();
    state.settingsTags = result.tags || [];
    await loadTags();
    if (state.view === "materials") await loadItems();
    renderSettingsTags();
    tagManagerStatus.textContent = `已删除 ${result.deletedTags.length} 个标签，影响 ${result.touchedItems.length} 条资料。`;
  } catch (error) {
    tagManagerStatus.textContent = error.message;
  }
}

async function renameSettingsTag(oldTag) {
  const tag = state.settingsTags.find((item) => item.name === oldTag);
  const nextName = prompt(`将标签“${oldTag}”改名为：`, oldTag);
  if (nextName === null) return;
  const normalized = slugTagClient(nextName);
  if (!normalized || normalized === oldTag) return;
  const exists = state.settingsTags.some((item) => item.name === normalized && item.name !== oldTag);
  const ok = exists
    ? confirm(`标签“${normalized}”已存在。继续会把“${oldTag}”合并到这个标签，并更新 ${tag?.count || 0} 条资料。`)
    : confirm(`确认将“${oldTag}”改名为“${normalized}”？会更新 ${tag?.count || 0} 条资料。`);
  if (!ok) return;

  tagManagerStatus.textContent = "正在改名标签...";
  try {
    const wasSelected = state.selectedSettingsTags.has(oldTag);
    const result = await api("/api/tags", {
      method: "PATCH",
      body: JSON.stringify({ from: oldTag, to: normalized })
    });
    state.selectedSettingsTags.delete(oldTag);
    if (wasSelected) state.selectedSettingsTags.add(result.newTag);
    state.settingsTags = result.tags || [];
    await loadTags();
    await loadItems();
    renderSettingsTags();
    tagManagerStatus.textContent = `已将 ${result.oldTag} 改名为 ${result.newTag}，影响 ${result.touchedItems.length} 条资料。`;
  } catch (error) {
    tagManagerStatus.textContent = error.message;
  }
}

async function openWebdriver(url) {
  webdriverStatus.textContent = "正在打开登录浏览器...";
  try {
    const { session } = await api("/api/webdriver/open", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    webdriverStatus.textContent = `已打开 ${session.hostname}，登录态会保存到 ${session.userDataDir}`;
  } catch (error) {
    webdriverStatus.textContent = error.message;
  }
}

async function saveWebdriverCookies(url) {
  webdriverStatus.textContent = "正在保存当前登录 Cookie...";
  try {
    const { saved, settings } = await api("/api/webdriver/save-cookies", {
      method: "POST",
      body: JSON.stringify({ url })
    });
    renderSourceProfiles(settings.sources || {});
    webdriverStatus.textContent = `已保存 ${saved.hostname} 的 ${saved.cookieCount} 个 Cookie，后续普通抓取会优先使用 Cookie。`;
  } catch (error) {
    webdriverStatus.textContent = error.message;
  }
}

function renderSourceProfiles(profiles) {
  const labels = {
    "confluence.amlogic.com": "Amlogic Confluence",
    "jira.amlogic.com": "Amlogic Jira",
    "roku.atlassian.net": "Roku Atlassian",
    "github.ecodesamsung.com": "Samsung GitHub",
    "teams.microsoft.com": "Microsoft Teams"
  };
  sourceProfiles.innerHTML = Object.entries(profiles).map(([hostname, profile]) => `
    <section class="source-profile" data-hostname="${escapeHtml(hostname)}">
      <div>
        <strong>${escapeHtml(labels[hostname] || hostname)}</strong>
        <span>${escapeHtml(hostname)} · ${escapeHtml(sourceLabel(profile.sourceType || "web"))}</span>
      </div>
      <input data-field="sourceType" type="hidden" value="${escapeHtml(profile.sourceType || "web")}" />
      <label>
        认证方式
        <select data-field="authMode">
          <option value="none" ${profile.authMode === "none" ? "selected" : ""}>无</option>
          <option value="cookie" ${profile.authMode === "cookie" ? "selected" : ""}>Cookie</option>
          <option value="basic" ${profile.authMode === "basic" ? "selected" : ""}>用户名密码 / Basic</option>
          <option value="bearer" ${profile.authMode === "bearer" ? "selected" : ""}>Bearer Token</option>
        </select>
      </label>
      <label class="checkbox-row">
        <input data-field="webdriverHeadless" type="checkbox" ${profile.webdriverHeadless ? "checked" : ""} />
        <span>后台抓取使用无头浏览器</span>
      </label>
      <label class="checkbox-row">
        <input data-field="allowRemoteAi" type="checkbox" ${profile.allowRemoteAi !== false ? "checked" : ""} />
        <span>允许将该来源的相关片段发送到远程 AI</span>
      </label>
      <label>
        Webdriver 窗口模式
        <select data-field="webdriverWindowMode">
          <option value="compact" ${profile.webdriverWindowMode !== "normal" && profile.webdriverWindowMode !== "minimized" ? "selected" : ""}>小窗口后台</option>
          <option value="normal" ${profile.webdriverWindowMode === "normal" ? "selected" : ""}>正常窗口</option>
          <option value="minimized" ${profile.webdriverWindowMode === "minimized" ? "selected" : ""}>尝试最小化</option>
        </select>
      </label>
      <label data-auth-field="basic">
        用户名
        <input data-field="username" value="${escapeHtml(profile.username || "")}" placeholder="Basic 认证时使用" />
      </label>
      <label data-auth-field="basic">
        密码
        <input data-field="password" type="password" value="${escapeHtml(profile.password || "")}" placeholder="Basic 认证时使用" />
      </label>
      <label data-auth-field="cookie">
        Cookie
        <textarea data-field="cookie" rows="2" placeholder="从浏览器复制 Cookie 请求头">${escapeHtml(profile.cookie || "")}</textarea>
      </label>
      <label data-auth-field="bearer">
        Token
        <input data-field="token" type="password" value="${escapeHtml(profile.token || "")}" placeholder="Bearer token" />
      </label>
    </section>
  `).join("");

  sourceProfiles.querySelectorAll(".source-profile").forEach((section) => {
    const select = section.querySelector('[data-field="authMode"]');
    updateAuthFields(section);
    select.addEventListener("change", () => updateAuthFields(section));
  });
}

function addSourceProfile(event) {
  event?.preventDefault();
  const hostname = newSourceHostname?.value.trim().replace(/^https?:\/\//i, "").replace(/\/.*$/, "").toLowerCase();
  if (!hostname || /\s/.test(hostname)) return;
  const profiles = collectSourceProfiles();
  if (!profiles[hostname]) {
    profiles[hostname] = { sourceType: newSourceType?.value || "web", authMode: "none", allowRemoteAi: true, webdriverWindowMode: "compact" };
  }
  state.settings = { ...(state.settings || {}), sources: profiles };
  renderSourceProfiles(profiles);
  newSourceHostname.value = "";
}

function collectSourceProfiles() {
  const profiles = {};
  sourceProfiles.querySelectorAll(".source-profile").forEach((section) => {
    const hostname = section.dataset.hostname;
    profiles[hostname] = {};
    section.querySelectorAll("[data-field]").forEach((field) => {
      profiles[hostname][field.dataset.field] = field.type === "checkbox" ? field.checked : field.value;
    });
  });
  return profiles;
}

function updateAuthFields(section) {
  const authMode = section.querySelector('[data-field="authMode"]')?.value || "none";
  section.querySelectorAll("[data-auth-field]").forEach((field) => {
    field.hidden = field.dataset.authField !== authMode;
  });
}

