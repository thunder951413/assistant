// Tags: listing, manual tags, rename and delete across items.
// Extracted from src/server.js; dependencies arrive through the ctx object defined in server.js.
import { canUseMaterial } from "./ai-policy.js";
import { atomicWriteFile } from "./atomic-files.js";
import { exists } from "./fs-helpers.js";
import { normalizeTags, uniqueValues } from "./utils.js";
import { promises as fs } from "node:fs";
import path from "node:path";

export function createTagsService(ctx) {
  // Functions that live elsewhere, resolved when called.
  const listItems = (...args) => ctx.listItems(...args);
  const readItem = (...args) => ctx.readItem(...args);
  const rebuildIndexes = (...args) => ctx.rebuildIndexes(...args);
  const withItemUrlMutationLock = (...args) => ctx.withItemUrlMutationLock(...args);

  async function listTags() {
    const items = await listItems();
    const tagMap = new Map();
    const manualTags = await readManualTags();

    for (const item of items) {
      for (const tag of item.tags || []) {
        tagMap.set(tag, (tagMap.get(tag) || 0) + 1);
      }
    }

    for (const tag of manualTags) {
      if (!tagMap.has(tag)) tagMap.set(tag, 0);
    }

    return [...tagMap.entries()]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  async function addManualTags(tags) {
    const nextTags = normalizeTags(tags);
    if (!nextTags.length) return listTags();
    const manualTags = await readManualTags();
    await writeManualTags([...new Set([...manualTags, ...nextTags])]);
    await rebuildIndexes();
    return listTags();
  }

  async function renameTag(from, to) {
    const [oldTag] = normalizeTags([from]);
    const [newTag] = normalizeTags([to]);
    if (!oldTag || !newTag) {
      throw new Error("请输入有效的原标签和新标签。");
    }
    if (oldTag === newTag) {
      return { oldTag, newTag, touchedItems: [], tags: await listTags() };
    }

    const touchedItems = await retagItems((tags) => tags.includes(oldTag) ? uniqueValues(tags.map((tag) => tag === oldTag ? newTag : tag)) : null);

    const manualTags = await readManualTags();
    const nextManualTags = uniqueValues(manualTags.map((tag) => tag === oldTag ? newTag : tag));
    if (manualTags.includes(oldTag) || !nextManualTags.includes(newTag)) {
      await writeManualTags([...nextManualTags, newTag]);
    } else {
      await writeManualTags(nextManualTags);
    }
    await rebuildIndexes();

    return {
      oldTag,
      newTag,
      touchedItems,
      tags: await listTags()
    };
  }

  // Applies a tag change to every affected item under that item's lock, re-reading
  // the latest version inside it. A damaged item is skipped, not left half-done.
  // nextTagsFor returns the new tag list, or null when the item is unaffected.
  async function retagItems(nextTagsFor) {
    const touched = [];
    for (const candidate of await listItems({ includeLists: true })) {
      if (!nextTagsFor(candidate.tags || [])) continue;
      try {
        await withItemUrlMutationLock(candidate.url || "", async () => {
          const item = await readItem(candidate.id);
          const nextTags = nextTagsFor(item.metadata.tags || []);
          if (!nextTags) return;
          await ctx.store.commit(candidate.id, { metadata: { ...item.metadata, tags: nextTags, updatedAt: new Date().toISOString() } });
          touched.push({ id: candidate.id, title: item.metadata.title });
        });
      } catch (error) {
        console.warn(`Tag change skipped for ${candidate.id}:`, error.message || error);
      }
    }
    return touched;
  }

  async function deleteTags(tags) {
    const targetTags = normalizeTags(tags);
    if (!targetTags.length) {
      return { deletedTags: [], touchedItems: [], tags: await listTags() };
    }

    const targetSet = new Set(targetTags);
    const touchedItems = await retagItems((tags) => tags.some((tag) => targetSet.has(tag)) ? tags.filter((tag) => !targetSet.has(tag)) : null);

    const manualTags = await readManualTags();
    await writeManualTags(manualTags.filter((tag) => !targetSet.has(tag)));
    await rebuildIndexes();

    return {
      deletedTags: targetTags,
      touchedItems,
      tags: await listTags()
    };
  }

  async function readManualTags() {
    const manualPath = path.join(ctx.indexesDir, "tags-manual.json");
    if (!(await exists(manualPath))) return [];
    try {
      const payload = JSON.parse(await fs.readFile(manualPath, "utf8"));
      return normalizeTags(Array.isArray(payload) ? payload : payload.tags || []);
    } catch {
      return [];
    }
  }

  async function writeManualTags(tags) {
    await fs.mkdir(ctx.indexesDir, { recursive: true });
    await atomicWriteFile(path.join(ctx.indexesDir, "tags-manual.json"), `${JSON.stringify({ tags: normalizeTags(tags) }, null, 2)}\n`, "utf8");
  }

  async function modelVisibleTags() {
    const items = await listItems();
    return uniqueValues([...(await readManualTags()), ...items.filter(item => canUseMaterial(item, ctx.settings)).flatMap(item => item.tags || [])]);
  }

  return { listTags, addManualTags, renameTag, deleteTags, modelVisibleTags };
}
