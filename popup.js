const LOG_KEY = 'xtlLogs';
const LOG_LIMIT = 500;
const LOG_RENDER_LIMIT = 80;
const X_HOST_RE = /(^|\.)x\.com$/i;
let currentLogs = [];

const els = {
  pageStatus: document.querySelector('#pageStatus'),
  showPanelButton: document.querySelector('#showPanelButton'),
  logCount: document.querySelector('#logCount'),
  logList: document.querySelector('#logList')
};

function tabsQuery(queryInfo) {
  return chrome.tabs.query(queryInfo);
}

function getStorage(defaults) {
  return chrome.storage.local.get(defaults);
}

function sendTabMessage(tabId, message) {
  return chrome.tabs.sendMessage(tabId, message);
}

function executeScript(options) {
  return chrome.scripting.executeScript(options);
}

function formatTime(isoString) {
  try {
    return new Date(isoString).toLocaleTimeString('zh-CN', { hour12: false });
  } catch {
    return '--:--:--';
  }
}

function formatDetails(details) {
  if (!details || Object.keys(details).length === 0) {
    return '';
  }

  const text = JSON.stringify(details);
  return text.length > 220 ? `${text.slice(0, 220)}...` : text;
}

function storeLog(log) {
  if (log?.id && currentLogs.some((item) => item.id === log.id)) {
    return false;
  }

  currentLogs.push(log);
  currentLogs = currentLogs.slice(-LOG_LIMIT);
  return true;
}

function updateLogCount() {
  els.logCount.textContent = `${currentLogs.length} / ${LOG_LIMIT}`;
}

function createLogRow(log) {
  const row = document.createElement('div');
  row.className = `log-row ${log.level || 'info'}`;

  const main = document.createElement('div');
  main.className = 'log-main';

  const time = document.createElement('span');
  time.className = 'log-time';
  time.textContent = formatTime(log.ts);

  const message = document.createElement('span');
  message.className = 'log-message';
  message.textContent = log.message || '';

  main.append(time, message);
  row.append(main);

  const details = formatDetails(log.details);
  if (details) {
    const detailsEl = document.createElement('div');
    detailsEl.className = 'log-details';
    detailsEl.textContent = details;
    row.append(detailsEl);
  }

  return row;
}

function appendRenderedLog(log) {
  updateLogCount();
  const empty = els.logList.querySelector('.empty');
  if (empty) {
    empty.remove();
  }

  els.logList.prepend(createLogRow(log));
  while (els.logList.children.length > LOG_RENDER_LIMIT) {
    els.logList.lastElementChild?.remove();
  }
}

function renderLogs(logs) {
  currentLogs = Array.isArray(logs) ? logs.slice(-LOG_LIMIT) : [];
  updateLogCount();
  els.logList.replaceChildren();

  if (currentLogs.length === 0) {
    const empty = document.createElement('div');
    empty.className = 'empty';
    empty.textContent = '暂无日志';
    els.logList.append(empty);
    return;
  }

  for (const log of currentLogs.slice().reverse().slice(0, LOG_RENDER_LIMIT)) {
    els.logList.append(createLogRow(log));
  }
}

async function getActiveTab() {
  const [tab] = await tabsQuery({ active: true, currentWindow: true });
  return tab;
}

function isXTab(tab) {
  try {
    return X_HOST_RE.test(new URL(tab?.url || '').hostname);
  } catch {
    return false;
  }
}

async function ensureContentScript(tabId) {
  try {
    const response = await sendTabMessage(tabId, { type: 'XTL_PING' });
    if (response?.ok) {
      return;
    }
  } catch {
    // 当前标签页可能还没有注入 content script。
  }

  await executeScript({
    target: { tabId },
    files: ['content.js']
  });
}

async function refreshPageStatus() {
  const tab = await getActiveTab();
  const ok = isXTab(tab);

  els.pageStatus.textContent = ok ? '当前 x.com 标签页可用' : '请先打开已登录的 x.com 页面';
  els.showPanelButton.disabled = !ok;
}

async function showPanel() {
  const tab = await getActiveTab();
  if (!isXTab(tab)) {
    els.pageStatus.textContent = '请先打开已登录的 x.com 页面';
    return;
  }

  await ensureContentScript(tab.id);
  await sendTabMessage(tab.id, { type: 'XTA_SHOW_PANEL' });
  els.pageStatus.textContent = '页面窗口已显示';
}

async function init() {
  const stored = await getStorage({ [LOG_KEY]: [] });
  renderLogs(stored[LOG_KEY]);
  await refreshPageStatus();

  els.showPanelButton.addEventListener('click', showPanel);

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'XTL_LOG_UPDATED') {
      if (message.log) {
        if (storeLog(message.log)) {
          appendRenderedLog(message.log);
        } else {
          updateLogCount();
        }
      } else {
        renderLogs(message.logs || []);
      }
      return;
    }

    if (message?.type === 'XTL_LOGS_CLEARED') {
      renderLogs([]);
    }
  });
}

init().catch((error) => {
  els.pageStatus.textContent = error.message;
});
