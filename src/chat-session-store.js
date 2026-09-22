import { promises as fs } from 'node:fs';
import path from 'node:path';
import { randomUUID } from 'node:crypto';

export function normalizeSessionBundle(value = {}) {
  const seen = new Set();
  const sessions = (Array.isArray(value.sessions) ? value.sessions : []).slice(0, 60).filter(session => {
    if (!session || typeof session.id !== 'string' || !session.id || session.id.length > 160 || seen.has(session.id)) return false;
    seen.add(session.id); return true;
  }).map(session => ({
    id: session.id, title: String(session.title || '新对话').slice(0, 160),
    createdAt: String(session.createdAt || ''), updatedAt: String(session.updatedAt || ''),
    messages: (Array.isArray(session.messages) ? session.messages : []).slice(-300).filter(message => ['user', 'assistant', 'event'].includes(message?.role)).map(message => ({
      role: message.role, text: String(message.text || '').slice(0, 60000), at: String(message.at || ''),
      ...(message.title ? {title: String(message.title).slice(0,160)} : {}),
      ...(message.kind ? {kind: String(message.kind).slice(0,80)} : {}),
      ...(message.error ? {error: true} : {})
    }))
  }));
  return {sessions, activeChatId: seen.has(value.activeChatId) ? value.activeChatId : sessions[0]?.id || ''};
}

export function createChatSessionStore(filePath) {
  let writing = Promise.resolve();
  async function read() {
    await writing;
    try { return {...normalizeSessionBundle(JSON.parse(await fs.readFile(filePath, 'utf8'))), initialized: true}; }
    catch (error) { if (error.code === 'ENOENT') return {sessions: [], activeChatId: '', initialized: false}; throw error; }
  }
  function write(value) {
    const bundle = normalizeSessionBundle(value);
    const run = writing.then(async () => {
      await fs.mkdir(path.dirname(filePath), {recursive: true});
      const temp = `${filePath}.${randomUUID()}.tmp`;
      try {
        await fs.writeFile(temp, JSON.stringify(bundle), {encoding:'utf8', mode:0o600});
        await fs.rename(temp, filePath);
      } finally { await fs.rm(temp, {force:true}); }
      return {...bundle, initialized: true};
    });
    writing = run.catch(() => {});
    return run;
  }
  return {read, write};
}
