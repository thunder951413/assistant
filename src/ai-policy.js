// Shared by every model request and both retrieval paths.
export function isRemoteEndpoint(endpoint) {
  try {
    const url = new URL(endpoint);
    if (!['http:', 'https:'].includes(url.protocol)) return true;
    return !['localhost', '127.0.0.1', '[::1]', '::1'].includes(url.hostname.toLowerCase());
  } catch { return true; }
}

export function canUseMaterial(metadata = {}, settings = {}, purpose = 'ai') {
  if (metadata.integrityStatus === 'quarantined' || metadata.quarantined) return false;
  const endpoint = purpose === 'embedding' ? settings.embedding?.baseUrl : settings.ai?.baseUrl;
  if (!endpoint || !isRemoteEndpoint(endpoint)) return true;
  let hostname = '';
  try { hostname = new URL(metadata.url).hostname.toLowerCase(); } catch {}
  if (hostname === 'teams.cloud.microsoft' || hostname.endsWith('.teams.microsoft.com')) hostname = 'teams.microsoft.com';
  return metadata.allowRemoteAi !== false && settings.sources?.[hostname]?.allowRemoteAi !== false;
}

export function assertModelMaterials(materials, settings, purpose = 'ai') {
  if (!Array.isArray(materials)) throw new Error('模型请求缺少资料使用策略。');
  if (materials.some(metadata => !canUseMaterial(metadata, settings, purpose))) {
    const error = new Error('资料已隔离，或该来源禁止发送到当前模型服务。');
    error.statusCode = 403;
    throw error;
  }
}

export function matchesMaterialFilters(metadata, filters = {}, settings = {}) {
  if (!metadata || metadata.integrityStatus === 'quarantined' || metadata.quarantined || metadata.pageKind === 'list') return false;
  if (filters.remoteAiOnly && !canUseMaterial(metadata, settings)) return false;
  if (filters.sourceType && metadata.sourceType !== filters.sourceType) return false;
  if (filters.tag && !(metadata.tags || []).includes(filters.tag)) return false;
  const updatedAt = String(metadata.updatedAt || '');
  if (filters.dateFrom && updatedAt < String(filters.dateFrom)) return false;
  const dateTo = /^\d{4}-\d{2}-\d{2}$/.test(filters.dateTo || '') ? `${filters.dateTo}T23:59:59.999Z` : filters.dateTo;
  if (dateTo && updatedAt > String(dateTo)) return false;
  return true;
}

export function normalizeChatHistory(history = []) {
  if (!Array.isArray(history)) return [];
  return history.filter(message => ['user', 'assistant'].includes(message?.role) && !message.error)
    .slice(-12).map(message => ({role: message.role, content: String(message.content ?? message.text ?? '').slice(0, 6000)}))
    .filter(message => message.content.trim());
}
