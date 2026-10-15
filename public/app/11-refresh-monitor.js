function sourceTypeForSubscription(job) {
  const url = String(job.url || "").toLowerCase();
  if (url.includes("jira") || url.includes("atlassian.net")) return "jira";
  if (url.includes("github")) return "github";
  if (url.includes("teams.microsoft") || url.includes("teams.cloud.microsoft")) return "teams";
  if (url.includes("confluence")) return "confluence";
  return "web";
}

function refreshJobTagsText(tags) {
  return Array.isArray(tags) ? tags.join(", ") : String(tags || "");
}

function isManagedContentPageJob(job) {
  return job?.managedBy === "content-page";
}

function subscriptionSourceLabel(source) {
  return {
    all: "全部",
    content: "普通页面",
    confluence: "Confluence",
    jira: "Jira",
    github: "GitHub",
    teams: "Teams",
    web: "文本"
  }[source] || source;
}

async function runRefreshJob(id) {
  const job = state.refreshJobs.find((candidate) => candidate.id === id);
  refreshJobStatus.textContent = "正在启动刷新任务...";
  try {
    const { run, jobs } = await api(`/api/refresh-jobs/${encodeURIComponent(id)}/run?background=1`, { method: "POST" });
    renderRefreshJobs(jobs || state.refreshJobs);
    await monitorSubscriptionRefreshRun(run, `正在刷新 ${job?.name || id}`);
  } catch (error) {
    refreshJobStatus.textContent = error.message;
    await loadSettings();
  }
}

async function monitorSubscriptionRefreshRun(run, initialMessage = "刷新中") {
  if (!run?.id) throw new Error("刷新任务启动失败：没有返回 runId。");
  stopActiveRefreshRunPolling();
  state.activeRefreshRun.id = run.id;
  state.activeRefreshRun.scope = "subscriptions";
  refreshJobStatus.textContent = `${initialMessage}：0 / ${run.totalJobs || 0}`;
  const timeoutAt = Date.now() + 10 * 60 * 1000;
  let pollErrors = 0;
  return new Promise((resolve) => {
    // Chained timeouts: the next poll starts only after this one finished.
    const schedule = () => {
      if (state.activeRefreshRun.id === run.id) state.activeRefreshRun.pollTimer = setTimeout(tick, 1000);
    };
    const tick = async () => {
      try {
        const { run: latest } = await api(`/api/refresh-runs/${encodeURIComponent(run.id)}`);
        if (!latest) { schedule(); return; }
        syncTeamsReadyDialog(latest);
        pollErrors = 0;
        const live = new Map((latest.jobs || []).map((job) => [job.id, job]));
        state.refreshJobs = (state.refreshJobs || []).map((job) => live.get(job.id) || job);
        renderRefreshJobs(state.refreshJobs);
        const completed = Number(latest.completedJobs || 0);
        const total = Number(latest.totalJobs || 0);
        const failed = Number(latest.failedJobs || 0);
        refreshJobStatus.textContent = `${runStatusText(latest)}：${completed} / ${total}${failed ? `，失败 ${failed}` : ""}`;
        if (["completed", "failed", "canceled"].includes(latest.status)) {
          stopActiveRefreshRunPolling();
          const result = latest.result || {};
          const updated = Number(result.updatedItemCount ?? result.updatedIssueCount ?? 0);
          const newCount = Number(result.newItemCount || 0);
          const aiFailed = Number(result.aiProcessErrorCount || 0);
          const totalItems = Number(result.linkCount ?? result.issueCount ?? 0);
          const skipped = Number(result.skippedItemCount || 0);
          const errorCount = Number(result.errorCount || failed || 0);
          refreshJobStatus.textContent = `${latest.status === "completed" ? "刷新完成" : latest.status === "canceled" ? "刷新已取消" : "刷新结束，有失败"}：更新 ${updated} / ${totalItems} 个内容页，AI 已整理 ${newCount} 个，AI 失败 ${aiFailed} 个，跳过 ${skipped} 个，失败 ${errorCount} 个。`;
          if (errorCount) showRefreshFailureToastFromRun(latest);
          if (state.view === "materials") await loadAll();
          await loadMaterialUpdateCount();
          scheduleReloadAfterRefreshUpdates(newCount);
          resolve(latest);
        } else if (Date.now() > timeoutAt) {
          stopActiveRefreshRunPolling();
          refreshJobStatus.textContent = "刷新仍在后台运行，已停止前台等待；稍后会自动同步状态。";
          resolve(latest);
        } else {
          schedule();
        }
      } catch (error) {
        pollErrors += 1;
        refreshJobStatus.textContent = `刷新进度同步失败：${error.message}`;
        console.warn("Failed to poll refresh run:", error);
        if (pollErrors >= 5) {
          stopActiveRefreshRunPolling();
          refreshJobStatus.textContent = "刷新进度同步连续失败，已恢复按钮；后台任务可能仍在运行。";
          resolve(null);
        } else {
          schedule();
        }
      }
    };
    schedule();
  });
}

function stopActiveRefreshRunPolling() {
  if (state.activeRefreshRun.pollTimer) clearTimeout(state.activeRefreshRun.pollTimer);
  state.activeRefreshRun.pollTimer = null;
  state.activeRefreshRun.id = "";
  state.activeRefreshRun.scope = "";
}

function scheduleReloadAfterRefreshUpdates(updatedCount) {
  if (!updatedCount) return;
  refreshJobStatus.textContent = `${refreshJobStatus.textContent} 已同步资料更新。`;
  loadMaterialUpdateCount();
  loadHomeOverview();
  if (state.view === "materials") loadItems();
}

function startRefreshJobMonitor() {
  if (state.refreshMonitorTimer) clearInterval(state.refreshMonitorTimer);
  state.refreshMonitorTimer = setInterval(checkRefreshJobsForUpdates, 60 * 1000);
}

async function checkRefreshJobsForUpdates() {
  try {
    const [{ jobs }, { runs }] = await Promise.all([
      api("/api/refresh-jobs"),
      api("/api/refresh-runs")
    ]);
    const waitingTeamsRun = (runs || []).find((run) => run.status === "waiting_for_teams_confirmation");
    if (waitingTeamsRun) syncTeamsReadyDialog(waitingTeamsRun);
    state.refreshJobs = jobs || state.refreshJobs;
    renderHomeOverview();
    if (state.view === "subscriptions") renderRefreshJobs(state.refreshJobs);
    showNewRefreshFailureToast(jobs || []);
    const latest = latestUpdatedRefreshRun(jobs || []);
    if (!latest || latest.key <= state.seenRefreshRunKey) return;
    const updated = refreshResultUpdatedCount(latest.job.lastResult);
    if (!updated) return;
    rememberRefreshRunKey(latest.key);
    schedulePageReloadForBackgroundRefresh(updated);
  } catch (error) {
    console.warn("Failed to check refresh jobs:", error);
  }
}

function rememberLatestRefreshRun(jobs) {
  const latest = latestUpdatedRefreshRun(jobs || []);
  if (!latest || latest.key <= state.seenRefreshRunKey) return;
  rememberRefreshRunKey(latest.key);
}

function rememberRefreshRunKey(key) {
  state.seenRefreshRunKey = key;
  localStorage.setItem("materialOrganizer.seenRefreshRunKey", key);
}

function rememberRefreshFailureKey(key) {
  state.seenRefreshFailureKey = key;
  localStorage.setItem("materialOrganizer.seenRefreshFailureKey", key);
}

function latestUpdatedRefreshRun(jobs) {
  return (jobs || [])
    .filter((job) => job.lastRunAt && refreshResultUpdatedCount(job.lastResult) > 0)
    .map((job) => ({
      job,
      key: `${job.lastRunAt}|${job.id}`
    }))
    .sort((a, b) => b.key.localeCompare(a.key))[0] || null;
}

function refreshResultUpdatedCount(result) {
  if (Object.prototype.hasOwnProperty.call(result || {}, "newItemCount")) {
    return Number(result?.newItemCount || 0);
  }
  return Number(result?.updatedItemCount ?? result?.updatedIssueCount ?? 0);
}

function showRefreshFailureToastFromRun(run) {
  const entries = [
    ...(run?.result?.results || [])
  ].filter((entry) => entry?.status === "failed" || Number(entry?.result?.errorCount || 0) > 0);
  const failures = entries.map((entry) => ({
    sourceType: entry.result?.sourceType || run?.sourceType || "refresh",
    name: entry.name || entry.id || "刷新任务",
    url: entry.result?.errors?.find((item) => item?.url)?.url || "",
    error: refreshResultErrorText(entry.result) || entry.error || run?.error || "刷新失败"
  })).filter((entry) => entry.error);
  if (!failures.length && run?.error) {
    failures.push({
      sourceType: run.sourceType || "refresh",
      name: "刷新任务",
      url: "",
      error: run.error
    });
  }
  if (!failures.length) return;
  showRefreshFailureToast(failures);
}

function showNewRefreshFailureToast(jobs) {
  const latest = latestFailedRefreshJob(jobs);
  if (!latest || latest.key <= state.seenRefreshFailureKey) return;
  rememberRefreshFailureKey(latest.key);
  showRefreshFailureToast([{
    sourceType: sourceTypeForSubscription(latest.job),
    name: latest.job.name || latest.job.id,
    url: latest.job.url || latest.job.lastResult?.errors?.find((entry) => entry?.url)?.url || "",
    error: refreshJobErrorText(latest.job)
  }]);
}

function latestFailedRefreshJob(jobs) {
  return (jobs || [])
    .filter((job) => job.lastRunAt && ["failed", "unreachable"].includes(job.status) && refreshJobErrorText(job))
    .map((job) => ({
      job,
      key: `${job.lastRunAt}|${job.id}|${refreshJobErrorText(job)}`
    }))
    .sort((a, b) => b.key.localeCompare(a.key))[0] || null;
}

function refreshJobErrorText(job) {
  return job?.lastError || refreshResultErrorText(job?.lastResult);
}

function refreshResultErrorText(result) {
  return result?.errors?.find((entry) => entry?.error)?.error || "";
}

function showRefreshFailureToast(failures) {
  const authFailure = failures.find(isAuthenticationFailure);
  if (authFailure) {
    showAuthFailureDialog(authFailure);
  }
  const nonAuthFailures = authFailure ? failures.filter((failure) => !isAuthenticationFailure(failure)) : failures;
  if (!nonAuthFailures.length) return;
  failures = nonAuthFailures;
  const visible = failures.slice(0, 3);
  const title = failures.length > 1 ? `${failures.length} 个刷新任务失败` : `${subscriptionSourceLabel(visible[0].sourceType)} 刷新失败`;
  const lines = visible.map((failure) => {
    const name = failure.name ? `${failure.name}：` : "";
    return `${subscriptionSourceLabel(failure.sourceType)} · ${name}${failure.error}`;
  });
  if (failures.length > visible.length) lines.push(`还有 ${failures.length - visible.length} 个失败任务，请到订阅管理查看。`);
  showToast({
    title,
    message: lines.join("\n")
  });
}

function isAuthenticationFailure(failure) {
  const text = `${failure?.sourceType || ""} ${failure?.name || ""} ${failure?.url || ""} ${failure?.error || ""}`;
  return /未登录|401|Unauthorized|Unauthori[sz]ed|authentication|required|登录态|login/i.test(text);
}

function showAuthFailureDialog(failure) {
  if (!authFailureDialog || !authFailureMessage) return;
  const source = subscriptionSourceLabel(failure.sourceType);
  const loginUrl = authFailureLoginUrl(failure);
  state.authFailurePrompt = { ...failure, loginUrl };
  authFailureMessage.textContent = `${source} 的登录态已失效，刷新任务“${failure.name || "未命名"}”无法继续。`;
  if (openAuthWebdriverButton) {
    openAuthWebdriverButton.textContent = `打开 ${source} 登录`;
  }
  if (!authFailureDialog.open) authFailureDialog.showModal();
}

function closeAuthFailureDialog() {
  authFailureDialog?.close();
}

async function openAuthFailureWebdriver() {
  const url = state.authFailurePrompt?.loginUrl;
  closeAuthFailureDialog();
  if (!url) return;
  await openWebdriver(url);
  showToast({
    title: "已打开 WebDriver 登录",
    message: "请在新打开的浏览器窗口完成登录，然后回到订阅管理重新刷新。"
  });
}

function authFailureLoginUrl(failure) {
  const text = `${failure?.sourceType || ""} ${failure?.url || ""} ${failure?.error || ""}`;
  if (/confluence/i.test(text)) return "https://confluence.amlogic.com";
  if (/jira/i.test(text)) return failure?.url || "https://jira.amlogic.com/issues/?filter=50724";
  return failure?.url || "";
}

function showToast({ title, message, duration = 9000, tone = "" }) {
  if (!toastRegion) return;
  const toast = document.createElement("div");
  toast.className = "toast";
  if (tone) toast.dataset.tone = tone;
  toast.innerHTML = `
    <div><strong>${escapeHtml(title || "提示")}</strong></div>
    <button type="button" aria-label="关闭提示">×</button>
    <p>${escapeHtml(message || "").replace(/\n/g, "<br>")}</p>
  `;
  const close = () => {
    const timer = state.toastTimers.get(toast);
    if (timer) clearTimeout(timer);
    state.toastTimers.delete(toast);
    toast.remove();
  };
  toast.querySelector("button")?.addEventListener("click", close);
  toastRegion.append(toast);
  const timer = setTimeout(close, duration);
  state.toastTimers.set(toast, timer);
}

function schedulePageReloadForBackgroundRefresh(updatedCount) {
  if (!updatedCount) return;
  loadMaterialUpdateCount();
  loadHomeOverview();
  if (state.view === "materials") loadItems();
}

