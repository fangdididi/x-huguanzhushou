const LOG_KEY = 'xtlLogs';
const TARGET_LOG_KEY = 'xtaTargetLogs';
const LOG_LIMIT = 500;

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

  return false;
});
