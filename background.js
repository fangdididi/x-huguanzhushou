const LOG_KEY = 'xtlLogs';
const TARGET_LOG_KEY = 'xtaTargetLogs';
const TASK_LOCK_KEY = 'xtaTaskLock';
const LOG_LIMIT = 500;
const TASK_LOCK_TTL_MS = 90 * 1000;

function readStorage(defaults) {
  return chrome.storage.local.get(defaults);
}

async function appendLog(log, key = LOG_KEY, updateType = 'XTL_LOG_UPDATED') {
  const stored = await readStorage({ [key]: [] });
  const logs = Array.isArray(stored[key]) ? stored[key] : [];
  logs.push(log);
  const nextLogs = logs.slice(-LOG_LIMIT);

  await chrome.storage.local.set({ [key]: nextLogs });

  chrome.runtime.sendMessage({ type: updateType, log, count: nextLogs.length }).catch(() => {
    // Popup may be closed.
  });
}

function getSenderTabId(sender) {
  return sender?.tab?.id ?? null;
}

function getPublicLock(lock) {
  if (!lock) {
    return null;
  }

  return {
    task: lock.task || '',
    tabId: lock.tabId ?? null,
    updatedAt: lock.updatedAt || 0,
    expiresAt: lock.expiresAt || 0
  };
}

async function acquireTaskLock(message, sender) {
  const tabId = getSenderTabId(sender);
  const runId = String(message.runId || '').trim();
  if (tabId === null || !runId) {
    throw new Error('无法识别当前页面，不能申请运行锁');
  }

  const now = Date.now();
  const stored = await readStorage({ [TASK_LOCK_KEY]: null });
  const lock = stored[TASK_LOCK_KEY];
  const expired = !lock || Number(lock.expiresAt || 0) <= now;
  const sameOwner = lock?.tabId === tabId && lock?.runId === runId;

  if (!expired && !sameOwner) {
    return {
      ok: false,
      locked: true,
      lock: getPublicLock(lock)
    };
  }

  const nextLock = {
    task: String(message.task || 'task'),
    tabId,
    runId,
    createdAt: sameOwner ? lock.createdAt : now,
    updatedAt: now,
    expiresAt: now + TASK_LOCK_TTL_MS
  };

  await chrome.storage.local.set({ [TASK_LOCK_KEY]: nextLock });
  return {
    ok: true,
    lock: getPublicLock(nextLock)
  };
}

async function refreshTaskLock(message, sender) {
  const tabId = getSenderTabId(sender);
  const runId = String(message.runId || '').trim();
  const stored = await readStorage({ [TASK_LOCK_KEY]: null });
  const lock = stored[TASK_LOCK_KEY];

  if (!lock || lock.tabId !== tabId || lock.runId !== runId) {
    return {
      ok: false,
      lock: getPublicLock(lock)
    };
  }

  const now = Date.now();
  const nextLock = {
    ...lock,
    updatedAt: now,
    expiresAt: now + TASK_LOCK_TTL_MS
  };

  await chrome.storage.local.set({ [TASK_LOCK_KEY]: nextLock });
  return {
    ok: true,
    lock: getPublicLock(nextLock)
  };
}

async function releaseTaskLock(message, sender) {
  const tabId = getSenderTabId(sender);
  const runId = String(message.runId || '').trim();
  const stored = await readStorage({ [TASK_LOCK_KEY]: null });
  const lock = stored[TASK_LOCK_KEY];

  if (lock && lock.tabId === tabId && (!runId || lock.runId === runId)) {
    await chrome.storage.local.remove(TASK_LOCK_KEY);
  }

  return { ok: true };
}

chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message?.type === 'XTL_APPEND_LOG') {
    appendLog(message.log)
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'XTL_APPEND_TARGET_LOG') {
    appendLog(message.log, TARGET_LOG_KEY, 'XTL_TARGET_LOG_UPDATED')
      .then(() => sendResponse({ ok: true }))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'XTL_CLEAR_LOGS') {
    chrome.storage.local
      .set({ [LOG_KEY]: [] })
      .then(() => {
        chrome.runtime.sendMessage({ type: 'XTL_LOGS_CLEARED' }).catch(() => {});
        sendResponse({ ok: true });
      })
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'XTA_ACQUIRE_TASK_LOCK') {
    acquireTaskLock(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'XTA_REFRESH_TASK_LOCK') {
    refreshTaskLock(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  if (message?.type === 'XTA_RELEASE_TASK_LOCK') {
    releaseTaskLock(message, sender)
      .then((result) => sendResponse(result))
      .catch((error) => sendResponse({ ok: false, error: error.message }));
    return true;
  }

  return false;
});
