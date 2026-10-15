// Startup runs last so every declaration above is initialized. Independent
// requests run in parallel; the home view renders once they are all in.
await Promise.all([loadAgentConfig(), loadSettings(), loadLibraryIndex(), loadChatSessions()]);
startRefreshJobMonitor();
renderHomeOverview();
renderView();
api("/api/topics").then((topics) => { state.topics = topics; renderNavTopicsCount(); }).catch(() => {});
