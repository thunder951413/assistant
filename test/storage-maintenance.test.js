import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { promises as fs } from 'node:fs';
import path from 'node:path';
import os from 'node:os';
import zlib from 'node:zlib';
import { cleanupBrowserCaches, maintainSnapshots, readSnapshotRaw, trimBrowserProfileIfLarge, writeItemSnapshot } from '../src/storage-maintenance.js';

async function tmp() { return fs.mkdtemp(path.join(os.tmpdir(), 'assistant-storage-')); }
async function put(file, content) { await fs.mkdir(path.dirname(file), { recursive: true }); await fs.writeFile(file, content); }
const exists = async (file) => fs.access(file).then(() => true, () => false);

describe('snapshot storage', () => {
  it('keeps text files readable and gzips the raw capture', async () => {
    const root = await tmp();
    const itemDir = path.join(root, 'item');
    const html = '<html>' + 'repeated content '.repeat(5000) + '</html>';
    await put(path.join(itemDir, 'document.md'), '# doc');
    await put(path.join(itemDir, 'metadata.json'), '{}');
    await put(path.join(itemDir, 'raw.html'), html);
    await writeItemSnapshot(itemDir, { rawFileName: 'raw.html' }, '2026-10-13T01:02:03.004Z');
    const snapshotDir = path.join(itemDir, 'snapshots', '2026-10-13T01-02-03-004Z');
    assert.equal(await fs.readFile(path.join(snapshotDir, 'document.md'), 'utf8'), '# doc');
    assert.equal(await exists(path.join(snapshotDir, 'raw.html')), false);
    const packed = await fs.readFile(path.join(snapshotDir, 'raw.html.gz'));
    assert.ok(packed.length < html.length / 10);
    const raw = await readSnapshotRaw(snapshotDir);
    assert.equal(raw.name, 'raw.html');
    assert.equal(raw.content.toString('utf8'), html);
    await fs.rm(root, { recursive: true, force: true });
  });

  it('prunes beyond retention and compresses legacy raw files idempotently', async () => {
    const root = await tmp();
    const itemsDir = path.join(root, 'items');
    for (let index = 0; index < 4; index += 1) {
      const dir = path.join(itemsDir, 'a', 'snapshots', `2026-10-0${index + 1}T00-00-00-000Z`);
      await put(path.join(dir, 'document.md'), `v${index}`);
      await put(path.join(dir, 'raw.html'), 'x'.repeat(20000));
    }
    const first = await maintainSnapshots(itemsDir, { retention: 2 });
    assert.equal(first.removedSnapshots, 2);
    assert.equal(first.compressedFiles, 2);
    assert.ok(first.reclaimedBytes > 40000);
    const kept = (await fs.readdir(path.join(itemsDir, 'a', 'snapshots'))).sort();
    assert.deepEqual(kept, ['2026-10-03T00-00-00-000Z', '2026-10-04T00-00-00-000Z']);
    const gz = await fs.readFile(path.join(itemsDir, 'a', 'snapshots', kept[1], 'raw.html.gz'));
    assert.equal(zlib.gunzipSync(gz).toString(), 'x'.repeat(20000));
    const second = await maintainSnapshots(itemsDir, { retention: 2 });
    assert.equal(second.compressedFiles, 0);
    assert.equal(second.removedSnapshots, 0);
    await fs.rm(root, { recursive: true, force: true });
  });
});

describe('browser profile cache cleanup', () => {
  async function profile(root, name) {
    const dir = path.join(root, name);
    await put(path.join(dir, 'Default/Cookies'), 'cookie-db');
    await put(path.join(dir, 'Default/Local Storage/leveldb/000003.log'), 'tokens');
    await put(path.join(dir, 'Default/IndexedDB/https_teams/0.ldb'), 'msal');
    await put(path.join(dir, 'Default/Cache/Cache_Data/blob'), 'c'.repeat(5000));
    await put(path.join(dir, 'Default/Service Worker/CacheStorage/x'), 's'.repeat(5000));
    await put(path.join(dir, 'Default/Service Worker/ScriptCache/y'), 'j'.repeat(100));
    await put(path.join(dir, 'Default/Service Worker/Database/LOG'), 'reg');
    await put(path.join(dir, 'GrShaderCache/data_0'), 'g'.repeat(100));
    return dir;
  }

  it('removes caches but keeps sign-in state, and skips profiles in use', async () => {
    const root = await tmp();
    const idle = await profile(root, 'teams-microsoft-com');
    const busy = await profile(root, 'jira-example-com');
    const result = await cleanupBrowserCaches(root, { activeProfileDirs: [busy] });
    assert.ok(result.reclaimedBytes >= 10000);
    assert.equal(await exists(path.join(idle, 'Default/Cache')), false);
    assert.equal(await exists(path.join(idle, 'Default/Service Worker')), true);
    assert.equal(await exists(path.join(idle, 'Default/Service Worker/CacheStorage')), false);
    assert.equal(await exists(path.join(idle, 'Default/Service Worker/Database')), false);
    assert.equal(await exists(path.join(idle, 'GrShaderCache')), false);
    for (const kept of ['Default/Cookies', 'Default/Local Storage/leveldb/000003.log', 'Default/IndexedDB/https_teams/0.ldb']) {
      assert.equal(await exists(path.join(idle, kept)), true, kept);
    }
    assert.equal(await exists(path.join(busy, 'Default/Cache/Cache_Data/blob')), true);
    assert.deepEqual(result.profiles.find((entry) => entry.profile === 'jira-example-com').skipped, 'in-use');
    await fs.rm(root, { recursive: true, force: true });
  });

  it('trims a large profile before launch at most once per interval', async () => {
    const root = await tmp();
    const dir = await profile(root, 'github');
    const now = Date.now();
    const first = await trimBrowserProfileIfLarge(dir, { maxCacheBytes: 1000, now });
    assert.equal(first.checked, true);
    assert.ok(first.reclaimedBytes > 0);
    await put(path.join(dir, 'Default/Cache/again'), 'c'.repeat(5000));
    const second = await trimBrowserProfileIfLarge(dir, { maxCacheBytes: 1000, now: now + 1000 });
    assert.equal(second.checked, false);
    assert.equal(await exists(path.join(dir, 'Default/Cache/again')), true);
    assert.equal(await exists(path.join(dir, 'Default/Cookies')), true);
    await fs.rm(root, { recursive: true, force: true });
  });
});
