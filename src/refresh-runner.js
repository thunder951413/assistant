// Refresh scheduling and runs: batches per site, progress, timeouts, AI after refresh, notifications.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { shouldAutoProcess } from "./ai-processing.js";
import { nextDueCaptureSlot } from "./capture-policy.js";
import { normalizeNotificationSettings, refreshFailureState } from "./settings-schema.js";
import { isTeamsWebAppReady } from "./sources/teams-page.js";
import { cleanText, safeHostname } from "./utils.js";
import { execFile } from "node:child_process";

export function createRefreshRunner(ctx) {
  // Functions that live elsewhere, resolved when called.
  const closeWebdriverSession = (...args) => ctx.closeWebdriverSession(...args);
  const detectSourceAdapter = (...args) => ctx.detectSourceAdapter(...args);
  const ensureSessionPage = (...args) => ctx.ensureSessionPage(...args);
  const ensureWebdriverSession = (...args) => ctx.ensureWebdriverSession(...args);
  const fetchUrl = (...args) => ctx.fetchUrl(...args);
  const inferPageKind = (...args) => ctx.inferPageKind(...args);
  const isAuthenticationRequiredError = (...args) => ctx.isAuthenticationRequiredError(...args);
  const isInvalidTeamsRootRefreshJob = (...args) => ctx.isInvalidTeamsRootRefreshJob(...args);
  const normalizeUrlForMatch = (...args) => ctx.normalizeUrlForMatch(...args);
  const prepareTeamsRefreshGroup = (...args) => ctx.prepareTeamsRefreshGroup(...args);
  const processItemWithAi = (...args) => ctx.processItemWithAi(...args);
  const publicRefreshJobs = (...args) => ctx.publicRefreshJobs(...args);
  const readItem = (...args) => ctx.readItem(...args);
  const refreshContentJob = (...args) => ctx.refreshContentJob(...args);
  const refreshListJob = (...args) => ctx.refreshListJob(...args);
  const resolvedRefreshFetchMode = (...args) => ctx.resolvedRefreshFetchMode(...args);
  const shouldPrecheckAuthentication = (...args) => ctx.shouldPrecheckAuthentication(...args);
  const updateRefreshJobState = (...args) => ctx.updateRefreshJobState(...args);
  const verifyWebdriverAuthentication = (...args) => ctx.verifyWebdriverAuthentication(...args);

  function startRefreshScheduler() {
    if (ctx.refreshRuntime.timer) clearInterval(ctx.refreshRuntime.timer);
    ctx.refreshRuntime.timer = setInterval(() => {
      runDueRefreshJobs().catch((error) => {
        console.error("Scheduled refresh failed:", error);
      });
    }, 60 * 1000);
  }

  async function runDueRefreshJobs() {
    if (ctx.libraryMaintenance) return;
    if (ctx.settings.doNotDisturb?.enabled) return;
    const now = new Date();
    const dueJobs = [];
    for (const job of ctx.settings.refreshJobs || []) {
      if (!job.enabled || isRefreshJobActive(job.id)) continue;
      const dueAt = nextDueRefreshSlot(job, now, ctx.settings.refreshSchedule);
      if (dueAt) dueJobs.push(job);
    }
    if (!dueJobs.length) return;

    const teamsJobs = dueJobs.filter((job) => detectSourceAdapter(job.url || "").sourceType === "teams");
    const unattendedJobs = dueJobs.filter((job) => detectSourceAdapter(job.url || "").sourceType !== "teams");
    if (teamsJobs.length) {
      await startRefreshRunByIds(teamsJobs.map((job) => job.id), { sourceType: "teams" });
    }
    if (!unattendedJobs.length) return;

    const result = await runRefreshJobsBatch(unattendedJobs);
    for (const entry of result.results || []) {
      if (entry.status === "failed") {
        console.error(`Scheduled refresh failed for ${entry.id}:`, entry.error || "unknown error");
      }
    }
  }

  function nextDueRefreshSlot(job, now = new Date(), schedule = {}) {
    return nextDueCaptureSlot(job, now, schedule);
  }

  async function runRefreshJobById(id, options = {}) {
    const job = (ctx.settings.refreshJobs || []).find((candidate) => candidate.id === id);
    if (!job) throw new Error("Refresh job not found.");
    if (!options.force && !job.enabled) throw new Error("Refresh job is disabled.");
    const result = await runRefreshJobsBatch([job], options);
    return {
      ...result,
      id: job.id
    };
  }

  async function startRefreshRunByIds(ids, options = {}) {
    const requestedIds = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
    const requested = new Set(requestedIds);
    const jobs = (ctx.settings.refreshJobs || []).filter((job) => requested.has(job.id));
    if (requestedIds.length && jobs.length !== requested.size) {
      throw new Error("Some refresh jobs were not found.");
    }
    if (!options.force) {
      const disabled = jobs.find((job) => !job.enabled);
      if (disabled) throw new Error(`Refresh job is disabled: ${disabled.name || disabled.id}`);
    }
    const runnableJobs = jobs
      .filter((job) => options.force || job.enabled)
      .filter((job) => !isInvalidTeamsRootRefreshJob(job));
    const run = createRefreshRun(runnableJobs, options);
    Promise.resolve()
      .then(async () => {
        updateRefreshRun(run, { status: "running" });
        const result = await runRefreshJobsBatch(runnableJobs, { ...options, run });
        updateRefreshRun(run, {
          status: run.cancelRequested ? "canceled" : result.failureCount ? "failed" : "completed",
          result,
          jobs: publicRefreshJobs(),
          finishedAt: new Date().toISOString(),
          currentJobId: "",
          currentJobName: "",
          completedJobs: result.jobCount || run.totalJobs,
          failedJobs: result.failureCount || 0
        });
      })
      .catch((error) => {
        updateRefreshRun(run, {
          status: run.cancelRequested ? "canceled" : "failed",
          error: error.message || String(error),
          jobs: publicRefreshJobs(),
          finishedAt: new Date().toISOString(),
          currentJobId: "",
          currentJobName: ""
        });
      });
    return publicRefreshRun(run.id);
  }

  function createRefreshRun(jobs, options = {}) {
    cleanupRefreshRuns();
    const now = new Date().toISOString();
    const sourceType = cleanText(options.sourceType || "all");
    const run = {
      id: `refresh-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      status: "queued",
      sourceType,
      jobIds: jobs.map((job) => job.id),
      totalJobs: jobs.length,
      completedJobs: 0,
      failedJobs: 0,
      currentJobId: "",
      currentJobName: "",
      cancelRequested: false,
      refreshContext: null,
      startedAt: now,
      updatedAt: now,
      finishedAt: "",
      result: null,
      error: "",
      jobs: publicRefreshJobs()
    };
    ctx.refreshRuntime.runs.set(run.id, run);
    return run;
  }

  function updateRefreshRun(run, patch = {}) {
    if (!run) return null;
    Object.assign(run, patch, { updatedAt: new Date().toISOString() });
    ctx.refreshRuntime.runs.set(run.id, run);
    return run;
  }

  function publicRefreshRuns() {
    cleanupRefreshRuns();
    return [...ctx.refreshRuntime.runs.values()].map(publicRefreshRunFromRecord);
  }

  function publicRefreshRun(id) {
    cleanupRefreshRuns();
    const run = ctx.refreshRuntime.runs.get(id);
    return run ? publicRefreshRunFromRecord(run) : null;
  }

  function publicRefreshRunFromRecord(run) {
    return {
      id: run.id,
      status: run.status,
      sourceType: run.sourceType,
      jobIds: run.jobIds,
      totalJobs: run.totalJobs,
      completedJobs: run.completedJobs,
      failedJobs: run.failedJobs,
      currentJobId: run.currentJobId,
      currentJobName: run.currentJobName,
      cancelRequested: Boolean(run.cancelRequested),
      startedAt: run.startedAt,
      updatedAt: run.updatedAt,
      finishedAt: run.finishedAt,
      result: run.result,
      error: run.error,
      // Live status of this run's jobs (not the snapshot taken when it started).
      jobs: publicRefreshJobs().filter((job) => (run.jobIds || []).includes(job.id))
    };
  }

  function cleanupRefreshRuns() {
    const cutoff = Date.now() - ctx.REFRESH_RUN_RETENTION_MS;
    for (const [id, run] of ctx.refreshRuntime.runs.entries()) {
      if (!run.finishedAt) continue;
      const finished = Date.parse(run.finishedAt);
      if (!Number.isNaN(finished) && finished < cutoff) ctx.refreshRuntime.runs.delete(id);
    }
  }

  async function cancelRefreshRun(id) {
    const run = ctx.refreshRuntime.runs.get(id);
    if (!run) throw new Error("Refresh run not found.");
    if (["completed", "failed", "canceled"].includes(run.status)) return publicRefreshRunFromRecord(run);
    updateRefreshRun(run, {
      status: "canceling",
      cancelRequested: true,
      error: "用户已请求取消刷新。"
    });
    run.abortController?.abort();
    await closeRefreshRunContext(run);
    return publicRefreshRunFromRecord(run);
  }

  async function closeRefreshRunContext(run) {
    const context = run?.refreshContext;
    if (!context?.webdriverSession) return;
    try {
      await closeWebdriverSession(context.webdriverSession);
    } catch {
      // Best-effort cancellation; the job loop checks cancelRequested between jobs.
    }
  }

  async function runRefreshJobsByIds(ids, options = {}) {
    const requestedIds = Array.isArray(ids) ? ids.map((id) => String(id)) : [];
    const requested = new Set(requestedIds);
    const jobs = (ctx.settings.refreshJobs || []).filter((job) => requested.has(job.id));
    if (requestedIds.length && jobs.length !== requested.size) {
      throw new Error("Some refresh jobs were not found.");
    }
    if (!options.force) {
      const disabled = jobs.find((job) => !job.enabled);
      if (disabled) throw new Error(`Refresh job is disabled: ${disabled.name || disabled.id}`);
    }
    return runRefreshJobsBatch(jobs, options);
  }

  async function runRefreshJobsBatch(jobs, options = {}) {
    const runnableJobs = jobs
      .filter((job) => options.force || job.enabled)
      .filter((job) => options.force || (!job.circuitOpen && (!job.nextRetryAt || Date.parse(job.nextRetryAt) <= Date.now())))
      .filter((job) => !isInvalidTeamsRootRefreshJob(job));
    const queuedIds = [];
    for (const job of runnableJobs) {
      if (ctx.refreshRuntime.running.has(job.id) || ctx.refreshRuntime.queued.has(job.id)) continue;
      ctx.refreshRuntime.queued.add(job.id);
      queuedIds.push(job.id);
    }
    const jobsToRun = runnableJobs.filter((job) => queuedIds.includes(job.id));
    const groups = await buildRefreshGroups(jobsToRun, options);
    const results = [];
    const startedAt = new Date().toISOString();
    const run = options.run || null;
    if (run) updateRefreshRun(run, { totalJobs: jobsToRun.length, queuedJobIds: jobsToRun.map((job) => job.id) });

    try {
      for (const group of groups) {
        if (run?.cancelRequested) break;
        let refreshContext = null;
        const refreshedUrls = new Set(group.jobs.map((job) => normalizeUrlForMatch(job.url)).filter(Boolean));
        try {
          refreshContext = await createRefreshGroupContext(group, run);
          if (run) updateRefreshRun(run, { refreshContext });
          await verifyRefreshGroupAuthentication(group, refreshContext);
          for (const job of group.jobs) {
            if (run?.cancelRequested) break;
            try {
              if (run) updateRefreshRun(run, { currentJobId: job.id, currentJobName: job.name || job.id });
              const result = await runRefreshJob(job, { refreshContext, run });
              results.push({ id: job.id, status: result.status || "ok", result });
              rememberRefreshedContentUrls(refreshedUrls, result);
            } catch (error) {
              if (isAuthenticationRequiredError(error)) {
                keepRefreshGroupOpenForLogin(refreshContext);
                throw error;
              }
              results.push({
                id: job.id,
                status: "failed",
                error: error.message || String(error),
                result: failedRefreshJobResult(job, error)
              });
            } finally {
              if (run) {
                const completedJobs = results.filter((entry) => entry.status !== "running").length;
                const failedJobs = results.filter((entry) => entry.status === "failed").length;
                updateRefreshRun(run, { completedJobs, failedJobs });
              }
            }
          }
        } catch (error) {
          if (isAuthenticationRequiredError(error)) {
            keepRefreshGroupOpenForLogin(refreshContext);
          }
          for (const job of group.jobs) {
            if (results.some((entry) => entry.id === job.id)) continue;
            await markRefreshJobFailed(job, error);
            results.push({
              id: job.id,
              status: "failed",
              error: error.message || String(error),
              result: failedRefreshJobResult(job, error)
            });
          }
      } finally {
        updateRefreshRun(run, { refreshContext: null });
        await closeRefreshGroupContext(refreshContext);
      }
      }

      // Jobs that never started (cancel) must not wait for the AI step to become runnable.
      for (const id of queuedIds) ctx.refreshRuntime.queued.delete(id);
      const aiProcessing = await processUpdatedItemsAfterRefresh(results, { signal: run?.abortController?.signal });
      await annotateRefreshResultsWithAiProcessing(results, aiProcessing);
      const summary = summarizeRefreshBatch(results, startedAt, groups, aiProcessing);
      if (run?.cancelRequested) {
        summary.canceled = true;
        summary.errorCount = Number(summary.errorCount || 0) + 1;
      }
      await notifyRefreshBatchResult(summary);
      await ctx.refreshHistory.append({
        id: run?.id || `refresh-${Date.now()}`,
        sourceType: cleanText(options.sourceType || "all"),
        startedAt: summary.startedAt,
        finishedAt: summary.finishedAt,
        jobCount: summary.jobCount,
        successCount: summary.successCount,
        failureCount: summary.failureCount,
        updatedItemCount: summary.updatedItemCount,
        errorCount: summary.errorCount,
        canceled: Boolean(summary.canceled)
      });
      return summary;
    } finally {
      for (const id of queuedIds) ctx.refreshRuntime.queued.delete(id);
    }
  }

  function keepRefreshGroupOpenForLogin(refreshContext) {
    if (!refreshContext?.webdriverSession) return;
    refreshContext.closeWhenDone = false;
    refreshContext.webdriverSession.manual = true;
    refreshContext.webdriverSession.autoClose = false;
  }

  async function markRefreshJobFailed(job, error) {
    const unreachable = isNetworkUnavailableForJob(job, error);
    const lastError = unreachable ? networkUnavailableMessage(job) : error.message || String(error);
    const retry = refreshFailureState(job);
    await updateRefreshJobState(job.id, {
      status: unreachable ? "unreachable" : "failed",
      lastRunAt: new Date().toISOString(),
      lastError,
      lastResult: failedRefreshJobResult(job, lastError),
      ...retry
    });
  }

  function failedRefreshJobResult(job, error) {
    const message = typeof error === "string" ? error : error?.message || String(error || "unknown error");
    return {
      id: job?.id || "",
      sourceType: detectSourceAdapter(job?.url || "").sourceType,
      failedAt: new Date().toISOString(),
      linkCount: job?.pageKind === "content" ? 1 : 0,
      updatedItemCount: 0,
      skippedItemCount: 0,
      errorCount: 1,
      updatedItems: [],
      skippedItems: [],
      errors: [{ url: job?.url || "", error: message }]
    };
  }

  function isRefreshJobActive(id) {
    return ctx.refreshRuntime.running.has(id) || ctx.refreshRuntime.queued.has(id);
  }

  async function reconcileStaleRunningRefreshJobs() {
    const staleJobs = (ctx.settings.refreshJobs || []).filter((job) => job.status === "running" && !isRefreshJobActive(job.id));
    if (!staleJobs.length) return 0;
    const now = new Date().toISOString();
    ctx.settings = {
      ...ctx.settings,
      refreshJobs: (ctx.settings.refreshJobs || []).map((job) => {
        if (!staleJobs.some((stale) => stale.id === job.id)) return job;
        const error = "刷新任务已中断：服务重启或浏览器会话结束，已自动恢复为失败状态。";
        return {
          ...job,
          status: "failed",
          lastRunAt: job.lastRunAt || now,
          lastError: job.lastError || error,
          lastResult: failedRefreshJobResult(job, job.lastError || error)
        };
      })
    };
    await ctx.persistSettings({ runtimeOnly: true });
    return staleJobs.length;
  }

  function groupRefreshJobsBySource(jobs) {
    const byKey = new Map();
    for (const job of jobs) {
      const adapter = detectSourceAdapter(job.url || "");
      const key = `${adapter.sourceType || "web"}:${adapter.hostname || safeHostname(job.url || "") || "unknown"}`;
      if (!byKey.has(key)) {
        byKey.set(key, {
          key,
          sourceType: adapter.sourceType || "web",
          hostname: adapter.hostname || safeHostname(job.url || ""),
          seedUrl: job.url || "",
          jobs: []
        });
      }
      byKey.get(key).jobs.push(job);
    }
    return sortRefreshGroups([...byKey.values()]);
  }

  async function buildRefreshGroups(jobs, options = {}) {
    return groupRefreshJobsBySource(jobs);
  }

  function sortRefreshGroups(groups) {
    return [...groups].sort((a, b) => {
      const priority = { jira: 1, teams: 2 };
      return (priority[a.sourceType] || 10) - (priority[b.sourceType] || 10);
    });
  }

  async function createRefreshGroupContext(group, run = null) {
    const needsWebdriver = group.jobs.some((job) => {
      const adapter = detectSourceAdapter(job.url || "");
      return resolvedRefreshFetchMode(job, adapter) === "webdriver";
    });
    if (!needsWebdriver) return null;
    const targetUrl = group.seedUrl || group.jobs[0]?.url || "";
    const adapter = detectSourceAdapter(targetUrl);
    const sessionUrl = group.sourceType === "teams" ? `https://${adapter.hostname}` : targetUrl;
    const session = await ensureWebdriverSession(adapter.hostname, sessionUrl, {
      autoClose: false,
      headed: group.sourceType === "teams",
      manual: group.sourceType === "teams",
      windowMode: group.sourceType === "teams" ? "background" : group.sourceType === "jira" ? "normal" : undefined
    });
    const page = await ensureSessionPage(session);
    session.page = page;

    const refreshContext = {
      adapter,
      run,
      webdriverSession: session,
      webdriverPage: page,
      closeWhenDone: group.sourceType === "teams" ? false : !session.manual
    };
    if (run) updateRefreshRun(run, { refreshContext });

    if (group.sourceType === "teams") {
      await prepareTeamsRefreshGroup(page, adapter, run, session);
    }

    return refreshContext;
  }

  async function verifyRefreshGroupAuthentication(group, refreshContext = null) {
    const targetUrl = group.seedUrl || group.jobs[0]?.url || "";
    const adapter = detectSourceAdapter(targetUrl);
    if (!shouldPrecheckAuthentication(adapter)) return;

    if (refreshContext?.webdriverPage && resolvedRefreshFetchMode({ url: targetUrl, pageKind: inferPageKind(targetUrl, adapter) }, adapter) === "webdriver") {
      await verifyWebdriverAuthentication(refreshContext.webdriverPage, targetUrl, adapter);
      return;
    }

    await fetchUrl(targetUrl, { pageKind: inferPageKind(targetUrl, adapter) });
  }

  async function confirmTeamsRefreshReady(runId) {
    const run = ctx.refreshRuntime.runs.get(runId);
    if (!run) throw new Error("Refresh run not found.");
    if (run.status !== "waiting_for_teams_confirmation") {
      throw new Error("当前刷新任务不在等待 Teams 确认状态。");
    }
    const session = run.refreshContext?.webdriverSession;
    const page = run.refreshContext?.webdriverPage;
    if (!session || !page || page.isClosed()) {
      throw new Error("Teams WebDriver 会话已经关闭，请重新启动刷新。");
    }
    if (!(await isTeamsWebAppReady(page))) {
      throw new Error("尚未检测到 Teams 聊天主界面。请在 WebDriver 中完成登录、选择“使用 Web 应用”，并确认聊天列表可见。");
    }
    const confirmedAt = new Date().toISOString();
    session.teamsUserConfirmedAt = confirmedAt;
    updateRefreshRun(run, {
      teamsReadyConfirmed: true,
      teamsReadyConfirmedAt: confirmedAt,
      status: "running",
      currentJobName: "Teams 页面已确认，准备定位目标对话"
    });
    return publicRefreshRunFromRecord(run);
  }

  async function closeRefreshGroupContext(refreshContext) {
    if (!refreshContext?.webdriverSession || !refreshContext.closeWhenDone) return;
    await closeWebdriverSession(refreshContext.webdriverSession);
  }

  function rememberRefreshedContentUrls(refreshedUrls, result) {
    const entries = [
      ...(result?.updatedItems || []),
      ...(result?.skippedItems || []),
      ...(result?.errors || [])
    ];
    for (const entry of entries) {
      for (const value of [entry.url, entry.sourceUrl]) {
        const normalized = normalizeUrlForMatch(value || "");
        if (normalized) refreshedUrls.add(normalized);
      }
    }
  }

  async function processUpdatedItemsAfterRefresh(results, options = {}) {
    const itemIds = options.signal?.aborted ? [] : await collectRefreshItemIdsNeedingAi(results);
    if (!itemIds.length) {
      return { requestedCount: 0, processedCount: 0, skippedCount: 0, errorCount: 0, processedItems: [], errors: [] };
    }
    if (!ctx.settings.ai?.baseUrl || !ctx.settings.ai?.apiKey || !ctx.settings.ai?.model) {
      return {
        requestedCount: itemIds.length,
        processedCount: 0,
        skippedCount: itemIds.length,
        errorCount: 0,
        processedItems: [],
        errors: [],
        note: "未配置 AI 接口，原文更新已保存并显示为未读。"
      };
    }

    const processedItems = [];
    const errors = [];
    for (const itemId of itemIds) {
      if (options.signal?.aborted) break;
      try {
        const item = await processItemWithAi(itemId, options);
        processedItems.push({
          itemId,
          title: item.metadata.title,
          url: item.metadata.url,
          sourceType: item.metadata.sourceType,
          contentUpdatedAt: item.metadata.contentUpdatedAt || ""
        });
      } catch (error) {
        errors.push({ itemId, error: error.message || String(error) });
      }
    }
    return {
      requestedCount: itemIds.length,
      processedCount: processedItems.length,
      skippedCount: 0,
      errorCount: errors.length,
      processedItems,
      errors
    };
  }

  async function collectRefreshItemIdsNeedingAi(results) {
    const candidateIds = collectRefreshCandidateItemIds(results);
    const itemIds = [];
    for (const itemId of candidateIds) {
      try {
        const item = await readItem(itemId);
        // Message streams wait until enough has accumulated (settings.autoProcess);
        // below the threshold the item stays marked stale and the reader shows the
        // original messages.
        if (shouldAutoProcess(item, ctx.settings.autoProcess).process) itemIds.push(itemId);
      } catch {
        // Ignore missing items; the refresh result may be stale.
      }
    }
    return itemIds;
  }

  function collectRefreshCandidateItemIds(results) {
    const ids = [];
    const seen = new Set();
    for (const entry of results || []) {
      const result = entry?.result || {};
      const candidates = [
        ...(result.updatedItems || []),
        ...(result.updatedIssues || []),
        ...(result.skippedItems || [])
      ];
      for (const item of candidates) {
        const itemId = cleanText(item.itemId || "");
        if (!itemId || seen.has(itemId)) continue;
        seen.add(itemId);
        ids.push(itemId);
      }
    }
    return ids;
  }

  async function annotateRefreshResultsWithAiProcessing(results, aiProcessing) {
    const processed = new Set((aiProcessing.processedItems || []).map((item) => item.itemId));
    const failed = new Set((aiProcessing.errors || []).map((item) => item.itemId));
    for (const entry of results || []) {
      if (!entry?.result) continue;
      const updatedEntries = [
        ...(entry.result.updatedItems || []),
        ...(entry.result.updatedIssues || []),
        ...(entry.result.skippedItems || [])
      ];
      const aiProcessedCount = updatedEntries.filter((item) => processed.has(item.itemId)).length;
      const aiProcessErrorCount = updatedEntries.filter((item) => failed.has(item.itemId)).length;
      entry.result = {
        ...entry.result,
        newItemCount: Number(entry.result.updatedItemCount ?? entry.result.updatedIssueCount ?? 0),
        aiProcessedCount,
        aiProcessErrorCount,
        aiProcessingErrors: (aiProcessing.errors || []).filter((item) => updatedEntries.some((updated) => updated.itemId === item.itemId))
      };
    }
    await updateRefreshJobsLastResults(results);
  }

  async function updateRefreshJobsLastResults(results) {
    const byId = new Map((results || [])
      .filter((entry) => entry?.id && entry.result)
      .map((entry) => [entry.id, entry.result]));
    if (!byId.size) return;
    ctx.settings = {
      ...ctx.settings,
      refreshJobs: (ctx.settings.refreshJobs || []).map((job) => (
        byId.has(job.id) ? { ...job, lastResult: byId.get(job.id) } : job
      ))
    };
    await ctx.persistSettings({ runtimeOnly: true });
  }

  function summarizeRefreshBatch(results, startedAt, groups, aiProcessing = null) {
    const successful = results.filter((entry) => entry.status !== "failed" && entry.status !== "running");
    const failed = results.filter((entry) => entry.status === "failed");
    const running = results.filter((entry) => entry.status === "running");
    const sum = (field, fallback) => successful.reduce((total, entry) => total + Number(entry.result?.[field] ?? (fallback ? entry.result?.[fallback] : 0) ?? 0), 0);
    const aiProcessedCount = Number(aiProcessing?.processedCount || 0);
    const aiProcessErrorCount = Number(aiProcessing?.errorCount || 0);
    return {
      id: "batch-refresh",
      startedAt,
      finishedAt: new Date().toISOString(),
      groupCount: groups.length,
      jobCount: results.length,
      successCount: successful.length,
      runningCount: running.length,
      failureCount: failed.length,
      linkCount: sum("linkCount", "issueCount"),
      updatedItemCount: sum("updatedItemCount", "updatedIssueCount"),
      newItemCount: sum("updatedItemCount", "updatedIssueCount"),
      aiProcessedCount,
      aiProcessErrorCount,
      aiProcessing: aiProcessing || { requestedCount: 0, processedCount: 0, skippedCount: 0, errorCount: 0, processedItems: [], errors: [] },
      skippedItemCount: sum("skippedItemCount"),
      errorCount: failed.length + sum("errorCount"),
      results
    };
  }

  async function runRefreshJob(job, options = {}) {
    if (ctx.refreshRuntime.running.has(job.id)) {
      return { id: job.id, status: "running" };
    }

    ctx.refreshRuntime.queued.delete(job.id);
    ctx.refreshRuntime.running.add(job.id);
    const startedAt = new Date().toISOString();
    await updateRefreshJobState(job.id, {
      status: "running",
      lastStartedAt: startedAt,
      lastError: ""
    });

    try {
      const result = await withRefreshJobTimeout(job, options.run, async (abortSignal) => {
        const refreshContext = { ...(options.refreshContext || {}), abortSignal };
        return job.pageKind === "content"
          ? refreshContentJob({ ...job, lastStartedAt: startedAt }, refreshContext)
          : refreshListJob({ ...job, lastStartedAt: startedAt }, refreshContext);
      });
      await updateRefreshJobState(job.id, {
        status: "idle",
        lastRunAt: new Date().toISOString(),
        lastResult: result,
        lastError: "",
        quarantined: false,
        quarantineReason: "",
        consecutiveFailures: 0,
        nextRetryAt: "",
        circuitOpen: false
      });
      return result;
    } catch (error) {
      const unreachable = isNetworkUnavailableForJob(job, error);
      const lastError = unreachable ? networkUnavailableMessage(job) : error.message || String(error);
      const retry = refreshFailureState(job);
      await updateRefreshJobState(job.id, {
        status: unreachable ? "unreachable" : "failed",
        lastRunAt: new Date().toISOString(),
        lastError,
        lastResult: failedRefreshJobResult(job, lastError),
        ...retry
      });
      if (unreachable) {
        const friendlyError = new Error(lastError);
        friendlyError.code = "NETWORK_UNAVAILABLE";
        throw friendlyError;
      }
      throw error;
    } finally {
      ctx.refreshRuntime.running.delete(job.id);
    }
  }

  function refreshJobTimeoutMs(job) {
    const adapter = detectSourceAdapter(job.url || "");
    if (adapter.sourceType === "teams") return ctx.TEAMS_REFRESH_JOB_TIMEOUT_MS;
    // List jobs open one page per changed child; give them room, and they stop early on their own.
    if (job.pageKind === "list" || inferPageKind(job.url || "", adapter) === "list") return ctx.LIST_REFRESH_JOB_TIMEOUT_MS;
    return ctx.REFRESH_JOB_TIMEOUT_MS;
  }

  async function withRefreshJobTimeout(job, run, task) {
    let timer;
    let timedOut = false;
    const controller = new AbortController();
    if (run) run.abortController = controller;
    const timeoutMs = refreshJobTimeoutMs(job);
    const timeout = new Promise((_, reject) => {
      timer = setTimeout(async () => {
        timedOut = true;
        controller.abort();
        const error = new Error(`刷新任务超时：${job.name || job.id} 超过 ${Math.round(timeoutMs / 60000)} 分钟未完成。`);
        error.code = "REFRESH_JOB_TIMEOUT";
        if (run) updateRefreshRun(run, { error: error.message });
        await closeRefreshRunContext(run);
        reject(error);
      }, timeoutMs);
    });
    try {
      return await Promise.race([task(controller.signal), timeout]);
    } finally {
      clearTimeout(timer);
      if (run?.abortController === controller) run.abortController = null;
      if (timedOut && run) updateRefreshRun(run, { status: "failed" });
    }
  }

  function assertRefreshActive(refreshContext) {
    if (refreshContext?.abortSignal?.aborted) {
      const error = new Error("刷新任务已取消或超时，已阻止写入。");
      error.code = "REFRESH_ABORTED";
      throw error;
    }
  }

  function isNetworkUnavailableForJob(job, error) {
    const adapter = detectSourceAdapter(job.url || "");
    if (!requiresCompanyNetwork(adapter.hostname)) return false;
    return isNetworkAccessError(error);
  }

  function requiresCompanyNetwork(hostname) {
    return [
      "jira.amlogic.com",
      "confluence.amlogic.com"
    ].includes(String(hostname || "").toLowerCase());
  }

  function isNetworkAccessError(error) {
    const message = String(error?.message || error || "");
    return /ERR_CONNECTION_CLOSED|ERR_CONNECTION_TIMED_OUT|ERR_NAME_NOT_RESOLVED|ERR_ADDRESS_UNREACHABLE|ERR_NETWORK_CHANGED|ECONNREFUSED|ETIMEDOUT|ENOTFOUND|EHOSTUNREACH/i.test(message);
  }

  function networkUnavailableMessage(job) {
    const hostname = safeHostname(job.url || "") || detectSourceAdapter(job.url || "").hostname;
    return `当前网络无法访问 ${hostname}。如果不在公司网络或 VPN 未连接，本次刷新会跳过；连接公司网络后再刷新即可。`;
  }

  async function notifyRefreshBatchResult(summary) {
    const processedItems = summary?.aiProcessing?.processedItems || [];
    if (!processedItems.length) return;
    const sourceType = processedItems[0]?.sourceType || "web";
    if (!shouldNotifySource(sourceType)) return;

    const title = `资料更新：AI 已整理 ${processedItems.length} 条`;
    const firstTitle = cleanText(processedItems[0]?.title || "");
    const message = processedItems.length === 1
      ? firstTitle || "检测到 1 条新内容"
      : `${firstTitle || "检测到新内容"} 等 ${processedItems.length} 条`;
    await sendSystemNotification(title, message);
  }

  function shouldNotifySource(sourceType) {
    const notifications = normalizeNotificationSettings(ctx.settings.notifications || {});
    if (!notifications.enabled) return false;
    return notifications.sources?.[sourceType] !== false;
  }

  async function sendSystemNotification(title, message) {
    if (process.platform !== "darwin") {
      console.log(`[notification] ${title}: ${message}`);
      return;
    }
    await new Promise((resolve) => {
      const child = execFile("osascript", [
        "-e",
        `display notification ${JSON.stringify(message)} with title ${JSON.stringify(title)} sound name "Glass"`
      ], () => resolve());
      setTimeout(() => {
        try {
          child.kill();
        } catch {
          // The notification process may have already exited.
        }
        resolve();
      }, 3000).unref();
    });
  }

  return { startRefreshScheduler, runRefreshJobById, startRefreshRunByIds, updateRefreshRun, publicRefreshRuns, publicRefreshRun, cancelRefreshRun, runRefreshJobsByIds, reconcileStaleRunningRefreshJobs, confirmTeamsRefreshReady, refreshJobTimeoutMs, assertRefreshActive, sendSystemNotification };
}
