(() => {
  if (globalThis.__xtaContentLoaded) {
    return;
  }

  globalThis.__xtaContentLoaded = true;

  const PANEL_ID = 'xta-page-panel';
  const INJECTED_FLAG = 'xtaPageScriptInjected';
  const TO_PAGE_SOURCE = 'xta-content';
  const FROM_PAGE_SOURCE = 'xta-page';
  const LOG_LIMIT = 500;
  const LOG_KEY = 'xtlLogs';
  const STATS_KEY = 'xtaStats';
  const PENDING_RUN_KEY = 'xtaPendingRun';
  const SETTINGS_KEY = 'xtaSettings';
  const COMMENT_FILE_CACHE_KEY = 'xtaCommentFileCache';
  const DEFAULT_SETTINGS = {
    keyword: '互关',
    commentFileName: '',
    loopEnabled: false,
    testMode: true,
    onlyBlueVerified: false,
    loopCount: 1,
    intervalSeconds: 300
  };

  const pendingRuns = new Map();
  const state = {
    running: false,
    stopping: false,
    loopIndex: 0,
    logs: [],
    settings: {
      ...DEFAULT_SETTINGS
    },
    commentFileCache: {
      name: '',
      text: '',
      updatedAt: 0
    },
    stats: {
      followed: 0,
      commented: 0,
      plannedFollows: 0,
      plannedComments: 0
    }
  };

  const ui = {};

  function defaultStats() {
    return {
      followed: 0,
      commented: 0,
      plannedFollows: 0,
      plannedComments: 0
    };
  }

  function defaultSettings() {
    return { ...DEFAULT_SETTINGS };
  }

  function defaultCommentFileCache() {
    return {
      name: '',
      text: '',
      updatedAt: 0
    };
  }

  function nowLog(level, message, details = {}) {
    return {
      id: `${Date.now()}-${Math.random().toString(16).slice(2)}`,
      ts: new Date().toISOString(),
      level,
      message,
      details
    };
  }

  function sendRuntimeMessage(message) {
    return chrome.runtime.sendMessage(message).catch(() => undefined);
  }

  async function appendLog(level, message, details = {}) {
    const log = nowLog(level, message, details);
    state.logs.push(log);
    state.logs = state.logs.slice(-LOG_LIMIT);
    renderLogs();

    await sendRuntimeMessage({
      type: 'XTL_APPEND_LOG',
      log
    });
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
    return text.length > 180 ? `${text.slice(0, 180)}...` : text;
  }

  function setStatus(text, tone = 'idle') {
    if (!ui.status) {
      return;
    }

    ui.status.textContent = text;
    ui.status.dataset.tone = tone;
  }

  function renderStats() {
    if (!ui.followedCount) {
      return;
    }

    ui.followedCount.textContent = String(state.stats.followed);
    ui.commentedCount.textContent = String(state.stats.commented);
    ui.plannedFollowCount.textContent = String(state.stats.plannedFollows);
    ui.plannedCommentCount.textContent = String(state.stats.plannedComments);
  }

  async function saveStats() {
    await chrome.storage.local.set({ [STATS_KEY]: state.stats });
  }

  function normalizeStatsCount(value) {
    const number = Number(value || 0);
    return Number.isFinite(number) ? Math.max(0, number) : 0;
  }

  function applyStatsDelta(delta = {}) {
    const nextDelta = {
      followed: normalizeStatsCount(delta.followed),
      commented: normalizeStatsCount(delta.commented),
      plannedFollows: normalizeStatsCount(delta.plannedFollows),
      plannedComments: normalizeStatsCount(delta.plannedComments)
    };

    if (!nextDelta.followed && !nextDelta.commented && !nextDelta.plannedFollows && !nextDelta.plannedComments) {
      return;
    }

    state.stats.followed += nextDelta.followed;
    state.stats.commented += nextDelta.commented;
    state.stats.plannedFollows += nextDelta.plannedFollows;
    state.stats.plannedComments += nextDelta.plannedComments;
    renderStats();
    saveStats();
  }

  function normalizeSetting(value, fallback) {
    const text = String(value || '').trim();
    return text || fallback;
  }

  function normalizeBoolean(value, fallback) {
    return typeof value === 'boolean' ? value : fallback;
  }

  function normalizeInteger(value, fallback, min) {
    const number = Number.parseInt(value, 10);
    return Number.isFinite(number) ? Math.max(min, number) : fallback;
  }

  function readSettingsFromUi() {
    return {
      keyword: normalizeSetting(ui.keyword?.value, DEFAULT_SETTINGS.keyword),
      commentFileName: normalizeSetting(state.commentFileCache.name, state.settings.commentFileName || ''),
      loopEnabled: Boolean(ui.loopEnabled?.checked ?? DEFAULT_SETTINGS.loopEnabled),
      testMode: Boolean(ui.testMode?.checked ?? DEFAULT_SETTINGS.testMode),
      onlyBlueVerified: Boolean(ui.onlyBlue?.checked ?? DEFAULT_SETTINGS.onlyBlueVerified),
      loopCount: normalizeInteger(ui.loopCount?.value, DEFAULT_SETTINGS.loopCount, 0),
      intervalSeconds: normalizeInteger(ui.loopInterval?.value, DEFAULT_SETTINGS.intervalSeconds, 1)
    };
  }

  function renderCommentFileState() {
    if (!ui.commentFile) {
      return;
    }

    const fileName = state.commentFileCache.name || state.settings.commentFileName;
    if (fileName) {
      ui.commentFile.value = fileName;
      return;
    }

    ui.commentFile.value = '点击选择评论文件';
  }

  function applySettings(settings) {
    const nextSettings = {
      keyword: normalizeSetting(settings?.keyword, DEFAULT_SETTINGS.keyword),
      commentFileName: normalizeSetting(settings?.commentFileName, ''),
      loopEnabled: normalizeBoolean(settings?.loopEnabled, DEFAULT_SETTINGS.loopEnabled),
      testMode: normalizeBoolean(settings?.testMode, DEFAULT_SETTINGS.testMode),
      onlyBlueVerified: normalizeBoolean(settings?.onlyBlueVerified, DEFAULT_SETTINGS.onlyBlueVerified),
      loopCount: normalizeInteger(settings?.loopCount, DEFAULT_SETTINGS.loopCount, 0),
      intervalSeconds: normalizeInteger(settings?.intervalSeconds, DEFAULT_SETTINGS.intervalSeconds, 1)
    };
    state.settings = nextSettings;

    if (ui.keyword) {
      ui.keyword.value = normalizeSetting(nextSettings.keyword, DEFAULT_SETTINGS.keyword);
    }
    if (ui.loopEnabled) {
      ui.loopEnabled.checked = nextSettings.loopEnabled;
    }
    if (ui.testMode) {
      ui.testMode.checked = nextSettings.testMode;
    }
    if (ui.onlyBlue) {
      ui.onlyBlue.checked = nextSettings.onlyBlueVerified;
    }
    if (ui.loopCount) {
      ui.loopCount.value = String(nextSettings.loopCount);
    }
    if (ui.loopInterval) {
      ui.loopInterval.value = String(nextSettings.intervalSeconds);
    }

    renderCommentFileState();
  }

  async function saveSettings(settings) {
    state.settings = {
      keyword: normalizeSetting(settings?.keyword ?? state.settings.keyword, DEFAULT_SETTINGS.keyword),
      commentFileName: normalizeSetting(settings?.commentFileName ?? state.settings.commentFileName, ''),
      loopEnabled: normalizeBoolean(settings?.loopEnabled ?? state.settings.loopEnabled, DEFAULT_SETTINGS.loopEnabled),
      testMode: normalizeBoolean(settings?.testMode ?? state.settings.testMode, DEFAULT_SETTINGS.testMode),
      onlyBlueVerified: normalizeBoolean(settings?.onlyBlueVerified ?? state.settings.onlyBlueVerified, DEFAULT_SETTINGS.onlyBlueVerified),
      loopCount: normalizeInteger(settings?.loopCount ?? state.settings.loopCount, DEFAULT_SETTINGS.loopCount, 0),
      intervalSeconds: normalizeInteger(settings?.intervalSeconds ?? state.settings.intervalSeconds, DEFAULT_SETTINGS.intervalSeconds, 1)
    };

    await chrome.storage.local.set({
      [SETTINGS_KEY]: state.settings
    });

    renderCommentFileState();
  }

  async function saveCurrentSettings() {
    await saveSettings(readSettingsFromUi());
  }

  function readFileAsText(file) {
    return new Promise((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => resolve(String(reader.result || ''));
      reader.onerror = () => reject(new Error('读取本机评论文件失败'));
      reader.readAsText(file);
    });
  }

  async function handleCommentFileSelect(event) {
    const file = event.target.files?.[0];
    if (!file) {
      return;
    }

    try {
      const text = await readFileAsText(file);
      const cache = {
        name: file.name,
        text,
        updatedAt: Date.now()
      };

      state.commentFileCache = cache;
      await chrome.storage.local.set({ [COMMENT_FILE_CACHE_KEY]: cache });
      await saveSettings({
        ...readSettingsFromUi(),
        commentFileName: file.name
      });
      await appendLog('success', '已选择并缓存评论文件', {
        文件: file.name,
        字节: file.size
      });
    } catch (error) {
      await appendLog('error', error.message, {
        文件: file.name
      });
    } finally {
      event.target.value = '';
    }
  }

  async function savePendingRun(pendingRun) {
    await chrome.storage.local.set({ [PENDING_RUN_KEY]: pendingRun });
  }

  async function clearPendingRun() {
    await chrome.storage.local.remove(PENDING_RUN_KEY);
  }

  function buildSearchCaptureUrl(keyword) {
    const url = new URL('https://x.com/search');
    url.searchParams.set('q', normalizeSetting(keyword, DEFAULT_SETTINGS.keyword));
    url.searchParams.set('src', 'recent_search_click');
    url.searchParams.set('f', 'live');
    return url.toString();
  }

  function navigateSearchForCapture(keyword) {
    const searchUrl = buildSearchCaptureUrl(keyword);
    if (window.location.href === searchUrl) {
      window.location.reload();
      return;
    }

    window.location.assign(searchUrl);
  }

  function renderLogs() {
    if (!ui.logList) {
      return;
    }

    ui.logCount.textContent = `${state.logs.length} / ${LOG_LIMIT}`;
    ui.logList.replaceChildren();

    if (state.logs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'xta-empty';
      empty.textContent = '暂无日志';
      ui.logList.append(empty);
      return;
    }

    for (const log of state.logs.slice().reverse().slice(0, 80)) {
      const row = document.createElement('div');
      row.className = `xta-log ${log.level || 'info'}`;

      const main = document.createElement('div');
      main.className = 'xta-log-main';

      const time = document.createElement('span');
      time.textContent = formatTime(log.ts);

      const msg = document.createElement('strong');
      msg.textContent = log.message || '';

      main.append(time, msg);
      row.append(main);

      const details = formatDetails(log.details);
      if (details) {
        const detailEl = document.createElement('div');
        detailEl.className = 'xta-log-detail';
        detailEl.textContent = details;
        row.append(detailEl);
      }

      ui.logList.append(row);
    }
  }

  function updateButtons() {
    if (!ui.startButton) {
      return;
    }

    ui.startButton.disabled = state.running;
    ui.stopButton.disabled = !state.running || state.stopping;
    ui.resetButton.disabled = state.running;
    ui.clearButton.disabled = state.running;
  }

  function createPanel() {
    if (document.getElementById(PANEL_ID)) {
      return;
    }

    const host = document.createElement('section');
    host.id = PANEL_ID;
    host.style.position = 'fixed';
    host.style.right = '18px';
    host.style.top = '86px';
    host.style.zIndex = '2147483647';

    const shadow = host.attachShadow({ mode: 'open' });
    shadow.innerHTML = `
      <style>
        :host {
          all: initial;
          color-scheme: dark;
          --bg: #101315;
          --surface: #191e21;
          --surface-2: #22292d;
          --border: #344047;
          --text: #f4f7f8;
          --muted: #9facb3;
          --green: #41d67b;
          --green-2: #25b966;
          --cyan: #67c9ea;
          --amber: #f5bd5f;
          --red: #f36f6f;
          font-family: "Microsoft YaHei", "PingFang SC", "Segoe UI", Arial, sans-serif;
          letter-spacing: 0;
        }
        * { box-sizing: border-box; }
        .xta-panel {
          width: min(760px, calc(100vw - 36px));
          height: min(760px, calc(100vh - 108px));
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 10px;
          padding: 14px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--bg);
          color: var(--text);
          box-shadow: 0 18px 42px rgba(0, 0, 0, 0.38);
          font-size: 14px;
          line-height: 1.5;
        }
        .xta-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 10px;
          cursor: move;
          user-select: none;
        }
        .xta-head.dragging {
          cursor: grabbing;
        }
        .xta-title {
          margin: 0;
          font-size: 18px;
          font-weight: 700;
          line-height: 1.2;
        }
        .xta-status {
          min-height: 28px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          padding: 3px 10px;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: var(--surface);
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
          white-space: nowrap;
        }
        .xta-head-actions {
          display: inline-flex;
          align-items: center;
          gap: 8px;
          flex-shrink: 0;
        }
        .xta-toggle {
          min-height: 28px;
          padding: 3px 10px;
          border: 1px solid var(--border);
          border-radius: 999px;
          background: var(--surface);
          color: var(--text);
          font-size: 12px;
          font-weight: 700;
        }
        .xta-toggle:hover {
          opacity: 0.92;
        }
        .xta-tabs {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 6px;
          padding: 4px;
          border: 1px solid var(--border);
          border-radius: 8px;
          background: #0e1112;
        }
        .xta-tab {
          min-height: 38px;
          border: 1px solid transparent;
          border-radius: 6px;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          font: inherit;
          font-size: 13px;
          font-weight: 700;
          line-height: 1.25;
          padding: 6px 8px;
          overflow-wrap: anywhere;
        }
        .xta-tab:hover {
          color: var(--text);
          background: var(--surface);
        }
        .xta-tab.is-active {
          color: #07110b;
          background: var(--green);
        }
        .xta-tab-panel[hidden] {
          display: none !important;
        }
        .xta-status[data-tone="running"] { color: var(--cyan); border-color: rgba(103, 201, 234, 0.48); }
        .xta-status[data-tone="success"] { color: var(--green); border-color: rgba(65, 214, 123, 0.48); }
        .xta-status[data-tone="error"] { color: var(--red); border-color: rgba(243, 111, 111, 0.52); }
        .xta-card {
          border: 1px solid var(--border);
          border-radius: 8px;
          background: var(--surface);
          padding: 10px;
        }
        .xta-row {
          display: grid;
          grid-template-columns: 1fr 112px;
          gap: 10px;
          align-items: end;
        }
        .xta-settings-row {
          grid-template-columns: 1fr;
        }
        .xta-field {
          display: grid;
          gap: 5px;
        }
        .xta-field span,
        .xta-check span {
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }
        .xta-help {
          color: var(--muted);
          font-size: 11px;
          line-height: 1.35;
          overflow-wrap: anywhere;
        }
        .xta-file-input {
          display: none;
        }
        .xta-comment-file {
          cursor: pointer;
          text-align: left;
        }
        .xta-input {
          width: 100%;
          min-height: 40px;
          padding: 8px 10px;
          border: 1px solid var(--border);
          border-radius: 6px;
          outline: none;
          background: #0e1112;
          color: var(--text);
          font: inherit;
        }
        .xta-input:focus,
        .xta-button:focus-visible,
        .xta-tab:focus-visible,
        .xta-check input:focus-visible {
          border-color: var(--green);
          box-shadow: 0 0 0 3px rgba(65, 214, 123, 0.22);
        }
        .xta-checks {
          display: grid;
          gap: 8px;
        }
        .xta-check {
          min-height: 38px;
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 7px 8px;
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 6px;
          background: #121618;
          cursor: pointer;
        }
        .xta-check input {
          width: 18px;
          height: 18px;
          accent-color: var(--green);
        }
        .xta-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 8px;
        }
        .xta-button {
          min-height: 44px;
          display: inline-flex;
          align-items: center;
          justify-content: center;
          gap: 7px;
          border: 1px solid transparent;
          border-radius: 6px;
          cursor: pointer;
          font: inherit;
          font-weight: 700;
          transition: background-color 160ms ease, border-color 160ms ease, opacity 160ms ease, transform 160ms ease;
        }
        .xta-button:hover { transform: translateY(-1px); }
        .xta-button:active { transform: translateY(0); }
        .xta-button:disabled {
          cursor: not-allowed;
          opacity: 0.55;
          transform: none;
        }
        .xta-button.primary {
          color: #07110b;
          background: var(--green);
        }
        .xta-button.primary:hover { background: var(--green-2); }
        .xta-button.secondary {
          color: var(--text);
          background: var(--surface-2);
          border-color: var(--border);
        }
        .xta-button.danger {
          color: #fff;
          background: #923333;
          border-color: #b64a4a;
        }
        .xta-metrics {
          display: grid;
          grid-template-columns: repeat(4, minmax(0, 1fr));
          gap: 8px;
        }
        .xta-metric {
          min-height: 58px;
          padding: 8px;
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 6px;
          background: #121618;
        }
        .xta-metric span {
          display: block;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }
        .xta-metric strong {
          display: block;
          margin-top: 2px;
          font-size: 20px;
          line-height: 1.15;
        }
        .xta-log-head {
          display: flex;
          align-items: center;
          justify-content: space-between;
          gap: 8px;
          margin-bottom: 8px;
        }
        .xta-log-head strong {
          font-size: 13px;
        }
        .xta-log-head span {
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
        }
        .xta-body {
          display: grid;
          grid-template-columns: 260px minmax(0, 1fr);
          gap: 10px;
          flex: 1;
          min-height: 0;
          align-items: stretch;
        }
        .xta-controls {
          display: flex;
          flex-direction: column;
          gap: 8px;
          min-width: 0;
          min-height: 0;
          overflow: auto;
          padding-right: 2px;
          scrollbar-gutter: stable;
        }
        .xta-controls > .xta-card {
          flex-shrink: 0;
        }
        .xta-log-card {
          min-width: 0;
          min-height: 0;
          display: flex;
          flex-direction: column;
        }
        .xta-log-list {
          max-height: none;
          min-height: 0;
          flex: 1;
          overflow: auto;
          display: flex;
          flex-direction: column;
          gap: 7px;
          padding-right: 2px;
        }
        .xta-empty {
          padding: 12px;
          border: 1px dashed var(--border);
          border-radius: 6px;
          color: var(--muted);
          text-align: center;
        }
        .xta-log {
          padding: 8px;
          border-left: 3px solid var(--cyan);
          border-radius: 6px;
          background: #121618;
        }
        .xta-log.success { border-left-color: var(--green); }
        .xta-log.warn { border-left-color: var(--amber); }
        .xta-log.error { border-left-color: var(--red); }
        .xta-log-main {
          display: grid;
          grid-template-columns: 74px minmax(0, 1fr);
          gap: 7px;
        }
        .xta-log-main span {
          color: var(--muted);
          font-size: 12px;
          font-family: Consolas, "Microsoft YaHei", monospace;
        }
        .xta-log-main strong {
          min-width: 0;
          color: var(--text);
          font-size: 12px;
          font-weight: 700;
          overflow-wrap: anywhere;
        }
        .xta-log-detail {
          margin-top: 3px;
          color: var(--muted);
          font-size: 12px;
          overflow-wrap: anywhere;
        }
        .xta-coming-soon {
          flex: 1;
          min-height: 0;
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 8px;
          text-align: center;
        }
        .xta-coming-soon strong {
          font-size: 18px;
        }
        .xta-coming-soon span {
          color: var(--muted);
          font-size: 14px;
        }
        @media (max-width: 760px) {
          .xta-panel {
            width: calc(100vw - 24px);
          }
          .xta-body {
            grid-template-columns: 1fr;
          }
          .xta-controls {
            flex: 0 0 auto;
          }
          .xta-log-card {
            min-height: 260px;
          }
          .xta-log-list {
            min-height: 0;
          }
        }
        @media (prefers-reduced-motion: reduce) {
          .xta-button { transition: none; }
          .xta-button:hover,
          .xta-button:active { transform: none; }
        }
        .xta-panel.is-collapsed {
          width: 54px;
          height: 54px;
          padding: 0;
          border-radius: 50%;
          background: #000;
          overflow: hidden;
          box-shadow: 0 10px 28px rgba(0, 0, 0, 0.35);
        }
        .xta-panel.is-collapsed .xta-head {
          width: 100%;
          height: 100%;
          justify-content: center;
          gap: 0;
          cursor: grab;
        }
        .xta-panel.is-collapsed .xta-head.dragging {
          cursor: grabbing;
        }
        .xta-panel.is-collapsed .xta-head > div:not(.xta-head-actions),
        .xta-panel.is-collapsed .xta-status {
          display: none;
        }
        .xta-panel.is-collapsed .xta-head-actions {
          width: 100%;
          height: 100%;
        }
        .xta-panel.is-collapsed .xta-toggle {
          width: 100%;
          height: 100%;
          min-height: 54px;
          padding: 0;
          border: 0;
          border-radius: 50%;
          background: #000;
          color: #fff;
          cursor: grab;
          display: grid;
          place-items: center;
          font-size: 16px;
          font-weight: 800;
        }
        .xta-panel.is-collapsed .xta-head.dragging .xta-toggle {
          cursor: grabbing;
        }
        .xta-x-logo {
          width: 30px;
          height: 30px;
          display: block;
          object-fit: contain;
          pointer-events: none;
          user-select: none;
        }
        .xta-panel.is-collapsed .xta-body {
          display: none;
        }
        .xta-panel.is-collapsed .xta-tabs,
        .xta-panel.is-collapsed .xta-tab-panel {
          display: none;
        }
        @media (max-height: 720px) {
          .xta-body {
            gap: 7px;
          }
          .xta-log-card {
            min-height: 0;
          }
          .xta-log-list {
            min-height: 0;
          }
        }
      </style>
        <div class="xta-panel" role="region" aria-label="互关助手控制窗口">
          <header class="xta-head">
            <div>
              <h1 class="xta-title">互关助手</h1>
            </div>
          <div class="xta-head-actions">
            <span class="xta-status" data-tone="idle">待机</span>
            <button class="xta-button secondary xta-toggle" type="button" aria-expanded="true">收起</button>
          </div>
        </header>

        <nav class="xta-tabs" role="tablist" aria-label="功能切换">
          <button class="xta-tab is-active" id="xta-tab-assistant-button" type="button" role="tab" aria-selected="true" aria-controls="xta-tab-assistant" data-tab="assistant">互关助手</button>
          <button class="xta-tab" id="xta-tab-target-check-button" type="button" role="tab" aria-selected="false" aria-controls="xta-tab-target-check" data-tab="target-check">已关注目标检测</button>
        </nav>

        <div class="xta-body xta-tab-panel" id="xta-tab-assistant" role="tabpanel" aria-labelledby="xta-tab-assistant-button" data-tab-panel="assistant">
          <div class="xta-controls">
            <section class="xta-card">
              <div class="xta-metrics">
                <div class="xta-metric"><span>已关注</span><strong class="xta-followed">0</strong></div>
                <div class="xta-metric"><span>已评论</span><strong class="xta-commented">0</strong></div>
                <div class="xta-metric"><span>计划关注</span><strong class="xta-planned-follow">0</strong></div>
                <div class="xta-metric"><span>计划评论</span><strong class="xta-planned-comment">0</strong></div>
              </div>
            </section>

            <section class="xta-card">
              <div class="xta-row xta-settings-row">
                <label class="xta-field">
                  <span>命中关键词</span>
                  <input class="xta-input xta-keyword" type="text" value="互关">
                </label>
                <label class="xta-field">
                  <span>评论文件</span>
                  <input class="xta-input xta-comment-file" type="text" readonly value="点击选择评论文件">
                </label>
              </div>
              <input class="xta-file-input" type="file" accept=".txt,text/plain">
              <div class="xta-help">点击评论文件框选择本机 txt 文件，选择后会自动记忆。</div>
            </section>

            <section class="xta-card xta-checks">
              <label class="xta-check">
                <input class="xta-loop-enabled" type="checkbox">
                <span>循环执行</span>
              </label>
              <label class="xta-check">
                <input class="xta-test-mode" type="checkbox" checked>
                <span>测试模式，不真正关注和评论</span>
              </label>
              <label class="xta-check">
                <input class="xta-only-blue" type="checkbox">
                <span>只关注蓝V</span>
              </label>
              <div class="xta-row">
                <label class="xta-field">
                  <span>循环次数，0 表示不限</span>
                  <input class="xta-input xta-loop-count" type="number" min="0" step="1" value="1">
                </label>
                <label class="xta-field">
                  <span>间隔秒</span>
                  <input class="xta-input xta-loop-interval" type="number" min="1" step="1" value="300">
                </label>
              </div>
            </section>

            <section class="xta-card">
              <div class="xta-actions">
                <button class="xta-button primary xta-start" type="button">开始执行</button>
                <button class="xta-button danger xta-stop" type="button" disabled>停止</button>
                <button class="xta-button secondary xta-reset" type="button">重置统计</button>
                <button class="xta-button secondary xta-clear" type="button">清空日志</button>
              </div>
            </section>
          </div>

          <section class="xta-card xta-log-card">
            <div class="xta-log-head">
              <strong>操作日志</strong>
              <span class="xta-log-count">0 / 500</span>
            </div>
            <div class="xta-log-list"></div>
          </section>
        </div>
        <section class="xta-card xta-tab-panel xta-coming-soon" id="xta-tab-target-check" role="tabpanel" aria-labelledby="xta-tab-target-check-button" data-tab-panel="target-check" hidden>
          <strong>已关注目标检测</strong>
          <span>正在开发中，敬请期待</span>
        </section>
      </div>
    `;

    document.documentElement.append(host);

    ui.status = shadow.querySelector('.xta-status');
    ui.startButton = shadow.querySelector('.xta-start');
    ui.stopButton = shadow.querySelector('.xta-stop');
    ui.resetButton = shadow.querySelector('.xta-reset');
    ui.clearButton = shadow.querySelector('.xta-clear');
    ui.panel = shadow.querySelector('.xta-panel');
    ui.toggleButton = shadow.querySelector('.xta-toggle');
    ui.head = shadow.querySelector('.xta-head');
    ui.keyword = shadow.querySelector('.xta-keyword');
    ui.commentFile = shadow.querySelector('.xta-comment-file');
    ui.fileInput = shadow.querySelector('.xta-file-input');
    ui.loopEnabled = shadow.querySelector('.xta-loop-enabled');
    ui.testMode = shadow.querySelector('.xta-test-mode');
    ui.onlyBlue = shadow.querySelector('.xta-only-blue');
    ui.loopCount = shadow.querySelector('.xta-loop-count');
    ui.loopInterval = shadow.querySelector('.xta-loop-interval');
    ui.followedCount = shadow.querySelector('.xta-followed');
    ui.commentedCount = shadow.querySelector('.xta-commented');
    ui.plannedFollowCount = shadow.querySelector('.xta-planned-follow');
    ui.plannedCommentCount = shadow.querySelector('.xta-planned-comment');
    ui.logList = shadow.querySelector('.xta-log-list');
    ui.logCount = shadow.querySelector('.xta-log-count');
    ui.tabs = Array.from(shadow.querySelectorAll('.xta-tab'));
    ui.tabPanels = Array.from(shadow.querySelectorAll('.xta-tab-panel'));

    const xLogoIcon = '<img class="xta-x-logo" src="https://abs.twimg.com/favicons/twitter.3.ico" alt="" draggable="false">';

    const activateTab = (tabName) => {
      ui.tabs.forEach((tab) => {
        const active = tab.dataset.tab === tabName;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });

      ui.tabPanels.forEach((panel) => {
        const active = panel.dataset.tabPanel === tabName;
        panel.hidden = !active;
      });
    };

    const updatePanelCollapsed = (collapsed) => {
      ui.panel.classList.toggle('is-collapsed', collapsed);
      ui.toggleButton.innerHTML = collapsed ? xLogoIcon : '收起';
      ui.toggleButton.setAttribute('aria-expanded', String(!collapsed));
    };

    const clampPanelToViewport = () => {
      const rect = host.getBoundingClientRect();
      const left = rect.left;
      const top = rect.top;
      const clampedLeft = Math.min(Math.max(left, 0), Math.max(0, window.innerWidth - rect.width));
      const clampedTop = Math.min(Math.max(top, 0), Math.max(0, window.innerHeight - rect.height));

      host.style.left = `${clampedLeft}px`;
      host.style.top = `${clampedTop}px`;
      host.style.right = '';
    };

    let suppressToggleClick = false;

    const onTogglePanel = () => {
      if (suppressToggleClick) {
        suppressToggleClick = false;
        return;
      }

      updatePanelCollapsed(!ui.panel.classList.contains('is-collapsed'));
      if (ui.panel.classList.contains('is-collapsed')) {
        ui.toggleButton.setAttribute('aria-label', '展开面板');
      } else {
        ui.toggleButton.setAttribute('aria-label', '收起面板');
      }
      clampPanelToViewport();
    };

    ui.toggleButton.addEventListener('click', onTogglePanel);
    updatePanelCollapsed(false);
    ui.toggleButton.setAttribute('aria-label', '收起面板');

    let isDragging = false;
    let dragPointerId = null;
    let dragStartX = 0;
    let dragStartY = 0;
    let dragBaseLeft = 0;
    let dragBaseTop = 0;
    let dragMoved = false;
    let dragStartedOnCollapsedToggle = false;

    const onPanelPointerDown = (event) => {
      const target = event.target;

      if (!(target instanceof HTMLElement)) {
        return;
      }

      const isCollapsedToggle = ui.panel.classList.contains('is-collapsed') && Boolean(target.closest('.xta-toggle'));
      if (target.closest('button, input, textarea, select, label') && !isCollapsedToggle) {
        return;
      }

      isDragging = true;
      dragPointerId = event.pointerId;
      dragStartX = event.clientX;
      dragStartY = event.clientY;
      dragMoved = false;
      dragStartedOnCollapsedToggle = isCollapsedToggle;

      const rect = host.getBoundingClientRect();
      dragBaseLeft = rect.left;
      dragBaseTop = rect.top;

      host.style.left = `${dragBaseLeft}px`;
      host.style.top = `${dragBaseTop}px`;
      host.style.right = '';

      ui.head.classList.add('dragging');
      ui.head.setPointerCapture(dragPointerId);
      event.preventDefault();

      window.addEventListener('pointermove', onPanelPointerMove);
      window.addEventListener('pointerup', onPanelPointerUp, true);
      window.addEventListener('pointercancel', onPanelPointerUp, true);
    };

    const onPanelPointerMove = (event) => {
      if (!isDragging || event.pointerId !== dragPointerId) {
        return;
      }

      const deltaX = event.clientX - dragStartX;
      const deltaY = event.clientY - dragStartY;
      if (Math.abs(deltaX) > 4 || Math.abs(deltaY) > 4) {
        dragMoved = true;
      }

      const nextLeft = dragBaseLeft + deltaX;
      const nextTop = dragBaseTop + deltaY;
      const rect = host.getBoundingClientRect();
      const clampedLeft = Math.min(Math.max(nextLeft, 0), Math.max(0, window.innerWidth - rect.width));
      const clampedTop = Math.min(Math.max(nextTop, 0), Math.max(0, window.innerHeight - rect.height));

      host.style.left = `${clampedLeft}px`;
      host.style.top = `${clampedTop}px`;
    };

    const onPanelPointerUp = (event) => {
      if (!isDragging || (dragPointerId !== null && event.pointerId !== dragPointerId)) {
        return;
      }

      isDragging = false;
      dragPointerId = null;

      try {
        ui.head.releasePointerCapture(event.pointerId);
      } catch (_) {
      }

      ui.head.classList.remove('dragging');
      window.removeEventListener('pointermove', onPanelPointerMove);
      window.removeEventListener('pointerup', onPanelPointerUp, true);
      window.removeEventListener('pointercancel', onPanelPointerUp, true);
      clampPanelToViewport();
      if (dragStartedOnCollapsedToggle && !dragMoved && event.type !== 'pointercancel') {
        updatePanelCollapsed(false);
        ui.toggleButton.setAttribute('aria-label', '收起面板');
        clampPanelToViewport();
      }
      if (dragStartedOnCollapsedToggle) {
        suppressToggleClick = true;
        window.setTimeout(() => {
          suppressToggleClick = false;
        }, 250);
      }
      dragStartedOnCollapsedToggle = false;
    };

    ui.head.addEventListener('pointerdown', onPanelPointerDown);
    window.addEventListener('resize', clampPanelToViewport);

    ui.startButton.addEventListener('click', startLoop);
    ui.stopButton.addEventListener('click', stopLoop);
    ui.resetButton.addEventListener('click', resetStats);
    ui.clearButton.addEventListener('click', clearLogs);
    ui.tabs.forEach((tab) => {
      tab.addEventListener('click', () => activateTab(tab.dataset.tab || 'assistant'));
    });
    activateTab('assistant');
    [ui.keyword, ui.loopCount, ui.loopInterval].forEach((element) => {
      element.addEventListener('change', saveCurrentSettings);
    });
    [ui.loopEnabled, ui.testMode, ui.onlyBlue].forEach((element) => {
      element.addEventListener('change', saveCurrentSettings);
    });
    ui.commentFile.addEventListener('click', () => ui.fileInput.click());
    ui.fileInput.addEventListener('change', handleCommentFileSelect);
  }

  async function loadPersistedState() {
    const stored = await chrome.storage.local.get({
      [LOG_KEY]: [],
      [STATS_KEY]: defaultStats(),
      [SETTINGS_KEY]: defaultSettings(),
      [COMMENT_FILE_CACHE_KEY]: defaultCommentFileCache()
    });

    state.logs = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY].slice(-LOG_LIMIT) : [];
    state.stats = { ...defaultStats(), ...(stored[STATS_KEY] || {}) };
    state.commentFileCache = {
      ...defaultCommentFileCache(),
      ...(stored[COMMENT_FILE_CACHE_KEY] || {})
    };
    applySettings(stored[SETTINGS_KEY]);
    renderLogs();
    renderStats();
  }

  function injectPageScript() {
    if (document.documentElement.dataset[INJECTED_FLAG] === '1') {
      return Promise.resolve();
    }

    return new Promise((resolve, reject) => {
      const script = document.createElement('script');
      script.src = chrome.runtime.getURL('injected.js');
      script.async = false;

      script.onload = () => {
        document.documentElement.dataset[INJECTED_FLAG] = '1';
        script.remove();
        resolve();
      };

      script.onerror = () => {
        script.remove();
        reject(new Error('页面脚本注入失败'));
      };

      (document.head || document.documentElement).append(script);
    });
  }

  function sendPageRequest(type, payload = {}, timeoutMs = 30 * 60 * 1000) {
    const runId = `${Date.now()}-${Math.random().toString(16).slice(2)}`;

    return injectPageScript().then(() => new Promise((resolve, reject) => {
      const timeoutId = window.setTimeout(() => {
        pendingRuns.delete(runId);
        reject(new Error('页面执行超时'));
      }, timeoutMs);

      pendingRuns.set(runId, {
        statsDeltaApplied: false,
        resolve: (result) => {
          window.clearTimeout(timeoutId);
          pendingRuns.delete(runId);
          resolve(result);
        },
        reject: (error) => {
          window.clearTimeout(timeoutId);
          pendingRuns.delete(runId);
          reject(error);
        }
      });

      window.postMessage({
        source: TO_PAGE_SOURCE,
        type,
        runId,
        payload
      }, '*');
    }));
  }

  function sendStopToPage() {
    window.postMessage({
      source: TO_PAGE_SOURCE,
      type: 'STOP'
    }, '*');
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window || event.data?.source !== FROM_PAGE_SOURCE) {
      return;
    }

    const message = event.data;
    if (message.type === 'LOG') {
      appendLog(message.level || 'info', message.message || '', message.details || {});
      return;
    }

    const pending = pendingRuns.get(message.runId);
    if (!pending) {
      return;
    }

    if (message.type === 'STATS_DELTA') {
      pending.statsDeltaApplied = true;
      applyStatsDelta(message.delta || {});
      return;
    }

    if (message.type === 'RESULT') {
      pending.resolve({
        ...(message.result || {}),
        __statsDeltaApplied: Boolean(pending.statsDeltaApplied)
      });
      return;
    }

    if (message.type === 'ERROR') {
      pending.reject(new Error(message.error || '未知错误'));
    }
  });

  function parseComments(text) {
    const comments = text
      .split(/\r?\n/)
      .map((line) => line.trim())
      .filter(Boolean);

    if (comments.length === 0) {
      throw new Error('评论文件没有可用评论');
    }

    return comments;
  }

  async function loadComments() {
    if (!state.commentFileCache.text) {
      throw new Error('请先选择本机评论文件');
    }

    return parseComments(state.commentFileCache.text);
  }

  function readOptions() {
    return readSettingsFromUi();
  }

  function randomJitterSeconds(baseSeconds) {
    const offset = Math.floor(Math.random() * 201) - 100;
    return Math.max(1, baseSeconds + offset);
  }

  function randomSeconds(min, max) {
    return Math.floor(Math.random() * (max - min + 1)) + min;
  }

  function isTimelineCaptureTimeout(error) {
    const message = String(error?.message || error || '').toLowerCase();
    return message.includes('searchtimeline')
      && (message.includes('超时') || message.includes('timed out') || message.includes('timeout'));
  }

  function sleep(ms) {
    return new Promise((resolve) => window.setTimeout(resolve, ms));
  }

  async function sleepWithStop(totalSeconds, label) {
    for (let remaining = totalSeconds; remaining > 0; remaining -= 1) {
      if (state.stopping) {
        return false;
      }

      setStatus(`${label} ${remaining} 秒`, 'running');
      await sleep(1000);
    }

    return !state.stopping;
  }

  async function startLoop() {
    if (state.running) {
      return;
    }

    const options = readOptions();
    state.running = true;
    state.stopping = false;
    state.loopIndex = 0;
    updateButtons();
    setStatus('准备访问实时搜索页', 'running');

    try {
      await saveSettings(options);

      const comments = await loadComments();
      await appendLog('success', '评论库已加载', {
        数量: comments.length,
        来源: options.commentFileName
      });

      await savePendingRun({
        active: true,
        options,
        comments,
        loopIndex: 0,
        nextRunAt: 0,
        createdAt: Date.now()
      });

      await appendLog('info', '准备访问 X 实时搜索页并抓取真实搜索时间线响应', {
        地址: buildSearchCaptureUrl(options.keyword)
      });
      navigateSearchForCapture(options.keyword);
    } catch (error) {
      setStatus('执行错误', 'error');
      await appendLog('error', error.message, {});
      state.running = false;
      state.stopping = false;
      updateButtons();
    }
  }

  async function resumePendingRun() {
    const stored = await chrome.storage.local.get({ [PENDING_RUN_KEY]: null });
    const pendingRun = stored[PENDING_RUN_KEY];

    if (!pendingRun?.active || !location.hostname.endsWith('x.com')) {
      return;
    }

    const options = pendingRun.options || {};
    let navigating = false;

    state.running = true;
    state.stopping = false;
    state.loopIndex = Number(pendingRun.loopIndex || 0);
    applySettings(options);
    updateButtons();

    try {
      const nextRunAt = Number(pendingRun.nextRunAt || 0);
      if (nextRunAt > Date.now()) {
        const remainingSeconds = Math.max(1, Math.ceil((nextRunAt - Date.now()) / 1000));
        await appendLog('info', '继续等待下一轮刷新', {
          剩余秒: remainingSeconds,
          计划时间: new Date(nextRunAt).toLocaleTimeString('zh-CN', { hour12: false })
        });

        const shouldWait = await sleepWithStop(remainingSeconds, '下轮倒计时');
        if (!shouldWait) {
          await clearPendingRun();
          setStatus('已停止', 'idle');
          return;
        }

        pendingRun.nextRunAt = 0;
        await savePendingRun(pendingRun);
        navigating = true;
        navigateSearchForCapture(options.keyword);
        return;
      }

      if (options.loopCount > 0 && state.loopIndex >= options.loopCount) {
        await clearPendingRun();
        setStatus('已完成', 'success');
        return;
      }

      const nextLoopNumber = state.loopIndex + 1;

      setStatus(`第 ${nextLoopNumber} 次等待抓包`, 'running');
      await appendLog('info', `第 ${nextLoopNumber} 次开始，等待页面真实时间线响应`, {
        已完成次数: state.loopIndex,
        测试模式: options.testMode !== false,
        只关注蓝V: Boolean(options.onlyBlueVerified),
        循环: Boolean(options.loopEnabled),
        关键词: normalizeSetting(options.keyword, DEFAULT_SETTINGS.keyword)
      });

      const result = await sendPageRequest('RUN_CYCLE', {
        testMode: options.testMode !== false,
        onlyBlueVerified: Boolean(options.onlyBlueVerified),
        keyword: normalizeSetting(options.keyword, DEFAULT_SETTINGS.keyword),
        comments: Array.isArray(pendingRun.comments) ? pendingRun.comments : []
      }, 60 * 60 * 1000);

      if (!result.__statsDeltaApplied) {
        applyStatsDelta({
          followed: result.followedCount,
          commented: result.commentedCount,
          plannedFollows: result.plannedFollowCount,
          plannedComments: result.plannedCommentCount
        });
      }

      const matchedCount = Number(result.matchedCount || 0);
      const actionableCount = Number(result.actionableCount || 0);
      if (actionableCount > 0) {
        state.loopIndex += 1;
        pendingRun.loopIndex = state.loopIndex;
        await savePendingRun(pendingRun);
      }

      await appendLog(actionableCount > 0 ? 'success' : 'warn', `第 ${nextLoopNumber} 次完成`, {
        时间线条数: result.entriesCount,
        命中条数: matchedCount,
        需执行数: actionableCount,
        是否消耗次数: actionableCount > 0 ? '是' : '否',
        已完成次数: state.loopIndex,
        本次关注: result.followedCount,
        本次评论: result.commentedCount,
        计划关注: result.plannedFollowCount,
        计划评论: result.plannedCommentCount
      });

      if (actionableCount === 0 && !state.stopping) {
        const waitSeconds = randomSeconds(30, 60);
        pendingRun.nextRunAt = Date.now() + waitSeconds * 1000;
        pendingRun.loopIndex = state.loopIndex;
        await savePendingRun(pendingRun);
        await appendLog('warn', '本轮没有需要执行的关注评论，不消耗循环次数，稍后刷新重试', {
          命中条数: matchedCount,
          需执行数: actionableCount,
          实际等待秒: waitSeconds,
          计划时间: new Date(pendingRun.nextRunAt).toLocaleTimeString('zh-CN', { hour12: false })
        });

        const shouldRetry = await sleepWithStop(waitSeconds, '无可执行项重试倒计时');
        if (!shouldRetry) {
          await clearPendingRun();
          setStatus('已停止', 'idle');
          return;
        }

        pendingRun.nextRunAt = 0;
        await savePendingRun(pendingRun);
        navigating = true;
        navigateSearchForCapture(options.keyword);
        return;
      }

      if (!options.loopEnabled || state.stopping || (options.loopCount > 0 && state.loopIndex >= options.loopCount)) {
        await clearPendingRun();
        setStatus(state.stopping ? '已停止' : '已完成', state.stopping ? 'idle' : 'success');
        return;
      }

      const waitSeconds = randomJitterSeconds(Number(options.intervalSeconds || 300));
      pendingRun.nextRunAt = Date.now() + waitSeconds * 1000;
      pendingRun.loopIndex = state.loopIndex;
      await savePendingRun(pendingRun);
      await appendLog('info', '等待下一轮重新访问实时搜索页', {
        设置间隔秒: options.intervalSeconds,
        实际等待秒: waitSeconds,
        计划时间: new Date(pendingRun.nextRunAt).toLocaleTimeString('zh-CN', { hour12: false })
      });

      const shouldContinue = await sleepWithStop(waitSeconds, '下轮倒计时');
      if (!shouldContinue) {
        await clearPendingRun();
        setStatus('已停止', 'idle');
        return;
      }

      pendingRun.nextRunAt = 0;
      await savePendingRun(pendingRun);
      navigating = true;
      navigateSearchForCapture(options.keyword);
    } catch (error) {
      const errorMessage = String(error?.message || error || '未知错误');
      if (isTimelineCaptureTimeout(error) && !state.stopping) {
        pendingRun.nextRunAt = 0;
        pendingRun.loopIndex = state.loopIndex;
        await savePendingRun(pendingRun);
        setStatus('抓包超时，重新访问实时搜索页', 'running');
        await appendLog('warn', 'SearchTimeline 抓包超时，重新访问实时搜索页', {
          错误: errorMessage,
          地址: buildSearchCaptureUrl(options.keyword)
        });
        navigating = true;
        navigateSearchForCapture(options.keyword);
        return;
      }

      await clearPendingRun();
      setStatus('执行错误', 'error');
      await appendLog('error', errorMessage, {});
    } finally {
      if (!navigating) {
        state.running = false;
        state.stopping = false;
        updateButtons();
      }
    }
  }

  async function stopLoop() {
    if (!state.running) {
      return;
    }

    state.stopping = true;
    updateButtons();
    setStatus('正在停止', 'running');
    await clearPendingRun();
    sendStopToPage();
    await appendLog('warn', '已请求停止', {});
  }

  async function resetStats() {
    state.stats = defaultStats();
    await saveStats();
    renderStats();
    await appendLog('info', '统计已重置', {});
  }

  async function clearLogs() {
    state.logs = [];
    renderLogs();
    await sendRuntimeMessage({ type: 'XTL_CLEAR_LOGS' });
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message?.type === 'XTL_PING') {
      sendResponse({ ok: true });
      return false;
    }

    if (message?.type === 'XTA_SHOW_PANEL') {
      createPanel();
      sendResponse({ ok: true });
      return false;
    }

    return false;
  });

  chrome.runtime.onMessage.addListener((message) => {
    if (message?.type === 'XTL_LOG_UPDATED') {
      state.logs = Array.isArray(message.logs) ? message.logs.slice(-LOG_LIMIT) : state.logs;
      renderLogs();
      return;
    }

    if (message?.type === 'XTL_LOGS_CLEARED') {
      state.logs = [];
      renderLogs();
    }
  });

  injectPageScript().catch((error) => {
    appendLog('error', error.message, {});
  });
  createPanel();
  loadPersistedState().then(() => resumePendingRun()).catch((error) => {
    appendLog('error', error.message, {});
  });
})();
