import { normalizeConversationMemory } from './conversation-memory.js';

const HISTORY_KEY = 'classEditorAssistantHistory-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_ENTRIES = 100;
const MAX_MESSAGE_LENGTH = 20000;
const MAX_RECORD_CHARACTERS = 120000;
const MAX_STORAGE_CHARACTERS = 3500000;
const browserStorage = (name) => { try { return globalThis[name]; } catch { return null; } };

function cleanRecord(record) {
  if (!record || typeof record !== 'object' || typeof record.id !== 'string' || !record.id) return null;
  const normalizedItems = Array.isArray(record.items) ? record.items.filter((item) => item?.type === 'message'
    && ['user', 'assistant'].includes(item.role) && typeof item.text === 'string')
    .map((item) => ({ type: 'message', role: item.role, text: item.text.slice(0, MAX_MESSAGE_LENGTH) })).slice(-100) : [];
  const items = [];
  let totalCharacters = 0;
  if (normalizedItems.length) {
    const first = normalizedItems[0];
    items.push(first);
    totalCharacters = first.text.length;
    const recent = [];
    for (let index = normalizedItems.length - 1; index > 0; index -= 1) {
      const item = normalizedItems[index];
      if (totalCharacters + item.text.length > MAX_RECORD_CHARACTERS) continue;
      recent.push(item);
      totalCharacters += item.text.length;
    }
    items.push(...recent.reverse());
  }
  if (!items.some((item) => item.role === 'user')) return null;
  return {
    id: record.id,
    title: typeof record.title === 'string' && record.title.trim() ? record.title.trim().slice(0, 80) : '新しい相談',
    updatedAt: Number.isFinite(record.updatedAt) ? record.updatedAt : Date.now(),
    selectedIds: Array.isArray(record.selectedIds) ? record.selectedIds.filter((id) => typeof id === 'string') : [],
    assistantMode: 'agent',
    workflowMemory: normalizeConversationMemory(record.workflowMemory),
    items
  };
}

function parseStored(storage, now, acceptExpired = false) {
  try {
    const value = JSON.parse(storage?.getItem(HISTORY_KEY) || 'null');
    if (!value || value.version !== 1 || !Array.isArray(value.items)) return [];
    if (Number.isFinite(value.expiresAt) && value.expiresAt <= now && !acceptExpired) {
      storage?.removeItem(HISTORY_KEY);
      return [];
    }
    return value.items.map(cleanRecord).filter(Boolean);
  } catch {
    try { storage?.removeItem(HISTORY_KEY); } catch { /* Ignore unavailable storage. */ }
    return [];
  }
}

function mergeRecords(...lists) {
  const byId = new Map();
  lists.flat().forEach((record) => {
    const previous = byId.get(record.id);
    if (!previous || record.updatedAt >= previous.updatedAt) byId.set(record.id, record);
  });
  return [...byId.values()].sort((left, right) => right.updatedAt - left.updatedAt).slice(0, MAX_ENTRIES);
}

export function createHistoryService({ sessionStorage = browserStorage('sessionStorage'), localStorage = browserStorage('localStorage'), now = () => Date.now() } = {}) {
  const write = (storage, items, expiresAt = null) => {
    try {
      if (!storage) return false;
      const retained = [];
      let size = 100;
      for (const item of items) {
        const itemSize = JSON.stringify(item).length + 1;
        if (retained.length && size + itemSize > MAX_STORAGE_CHARACTERS) continue;
        retained.push(item);
        size += itemSize;
      }
      storage.setItem(HISTORY_KEY, JSON.stringify({ version: 1, ...(expiresAt ? { expiresAt } : {}), items: retained }));
      return true;
    } catch { return false; }
  };

  function read(persistAcrossTabs = false) {
    const tabItems = parseStored(sessionStorage, now());
    const sharedItems = persistAcrossTabs ? parseStored(localStorage, now()) : [];
    return mergeRecords(tabItems, sharedItems);
  }

  function upsert(record, persistAcrossTabs = false) {
    const safe = cleanRecord(record);
    if (!safe) return false;
    const records = mergeRecords(parseStored(sessionStorage, now()),
      persistAcrossTabs ? parseStored(localStorage, now()) : [], [safe]);
    const tabSaved = write(sessionStorage, records);
    try {
      if (persistAcrossTabs) write(localStorage, records, now() + DAY_MS);
      else localStorage?.removeItem(HISTORY_KEY);
    } catch { /* Keep the tab-local history. */ }
    return tabSaved;
  }

  function setPersistAcrossTabs(enabled) {
    if (!enabled) {
      try { localStorage?.removeItem(HISTORY_KEY); } catch { /* Ignore unavailable storage. */ }
      return true;
    }
    return write(localStorage, parseStored(sessionStorage, now()), now() + DAY_MS);
  }

  function clear() {
    for (const storage of [sessionStorage, localStorage]) {
      try { storage?.removeItem(HISTORY_KEY); } catch { /* Ignore unavailable storage. */ }
    }
  }

  return Object.freeze({ read, upsert, setPersistAcrossTabs, clear });
}
