const SESSION_KEY = 'classEditorAssistantSession-v1';
const DAY_MS = 24 * 60 * 60 * 1000;
const browserStorage = (name) => { try { return globalThis[name]; } catch { return null; } };

function safeSnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object' || !snapshot.state?.id) return null;
  const state = Object.fromEntries(['id', 'request', 'status', 'settingsSnapshot', 'counters', 'scopeGrants', 'createdAt', 'updatedAt']
    .filter((key) => Object.hasOwn(snapshot.state, key)).map((key) => [key, snapshot.state[key]]));
  return {
    version: 1,
    savedAt: Date.now(),
    state,
    plan: snapshot.plan || null,
    dataVersion: snapshot.dataVersion ?? null,
    result: snapshot.result || null
  };
}

export function createSessionService({ sessionStorage = browserStorage('sessionStorage'), localStorage = browserStorage('localStorage'), now = () => Date.now() } = {}) {
  function save(snapshot, persistAcrossTabs = false) {
    const safe = safeSnapshot(snapshot);
    if (!safe) return false;
    try { sessionStorage?.setItem(SESSION_KEY, JSON.stringify(safe)); } catch { /* The current tab can continue without recovery. */ }
    try {
      if (persistAcrossTabs) localStorage?.setItem(SESSION_KEY, JSON.stringify({ ...safe, expiresAt: now() + DAY_MS }));
      else localStorage?.removeItem(SESSION_KEY);
    } catch { /* Persistence is best effort; the live workflow remains available. */ }
    return true;
  }

  function read(persistAcrossTabs = false) {
    const stores = persistAcrossTabs ? [localStorage, sessionStorage] : [sessionStorage];
    for (const storage of stores) {
      try {
        const raw = storage?.getItem(SESSION_KEY);
        if (!raw) continue;
        const value = JSON.parse(raw);
        if (value.version !== 1 || !value.state?.id) { storage.removeItem(SESSION_KEY); continue; }
        if (storage === localStorage && (!persistAcrossTabs || !Number.isFinite(value.expiresAt) || value.expiresAt <= now())) {
          storage.removeItem(SESSION_KEY);
          try { sessionStorage?.removeItem(SESSION_KEY); } catch { /* Ignore unavailable storage. */ }
          return null;
        }
        return value;
      } catch { try { storage?.removeItem(SESSION_KEY); } catch { /* Ignore unavailable storage. */ } }
    }
    return null;
  }

  function clear() {
    for (const storage of [sessionStorage, localStorage]) {
      try { storage?.removeItem(SESSION_KEY); } catch { /* Ignore unavailable storage. */ }
    }
  }
  return Object.freeze({ save, read, clear });
}
