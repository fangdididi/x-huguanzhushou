const LOG_KEY = 'xtlLogs';
const LOG_LIMIT = 500;

function readStorage(defaults) {
  return chrome.storage.local.get(defaults);
}

async function appendLog(log) {
  const stored = await readStorage({ [LOG_KEY]: [] });
  const logs = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY] : [];
  logs.push(log);
  const nextLogs = logs.slice(-LOG_LIMIT);

  await chrome.storage.local.set({ [LOG_KEY]: nextLogs });

  chrome.runtime.sendMessage({ type: 'XTL_LOG_UPDATED', log, logs: nextLogs }).catch(() => {
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
