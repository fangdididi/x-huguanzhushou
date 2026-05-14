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
  const LOG_RENDER_LIMIT = 80;
  const COUNTDOWN_STATUS_INTERVAL_SECONDS = 10;
  const PAGE_REFRESH_EVERY_ROUNDS = 5;
  const LOG_KEY = 'xtlLogs';
  const TARGET_LOG_KEY = 'xtaTargetLogs';
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
    intervalSeconds: 300,
    targetPageMode: 'latest',
    targetProcessMode: 'none',
    targetCustomPages: 3
  };

  const pendingRuns = new Map();
  const state = {
    running: false,
    stopping: false,
    loopIndex: 0,
    activeTask: '',
    activeTab: 'assistant',
    logs: [],
    targetLogs: [],
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
    },
    targetStats: {
      checked: 0,
      notFollowedBy: 0,
      unfollowed: 0
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

  function defaultTargetStats() {
    return {
      checked: 0,
      notFollowedBy: 0,
      unfollowed: 0
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
    storeLog('logs', log);
    if (state.activeTab === 'assistant') {
      appendRenderedLog(ui.logList, ui.logCount, state.logs, log);
    } else {
      updateLogCount(ui.logCount, state.logs);
    }

    await sendRuntimeMessage({
      type: 'XTL_APPEND_LOG',
      log
    });
  }

  async function appendTargetLog(level, message, details = {}) {
    const log = nowLog(level, message, details);
    storeLog('targetLogs', log);
    if (state.activeTab === 'target-check') {
      appendRenderedLog(ui.targetLogList, ui.targetLogCount, state.targetLogs, log);
    } else {
      updateLogCount(ui.targetLogCount, state.targetLogs);
    }

    await sendRuntimeMessage({
      type: 'XTL_APPEND_TARGET_LOG',
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

  function storeLog(key, log) {
    const logs = Array.isArray(state[key]) ? state[key] : [];
    if (log?.id && logs.some((item) => item.id === log.id)) {
      return false;
    }

    logs.push(log);
    state[key] = logs.slice(-LOG_LIMIT);
    return true;
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
    if (ui.plannedFollowCount) {
      ui.plannedFollowCount.textContent = String(state.stats.plannedFollows);
    }
    if (ui.plannedCommentCount) {
      ui.plannedCommentCount.textContent = String(state.stats.plannedComments);
    }
  }

  function renderTargetStats() {
    if (!ui.targetCheckedCount) {
      return;
    }

    ui.targetCheckedCount.textContent = String(state.targetStats.checked);
    ui.targetNotFollowedByCount.textContent = String(state.targetStats.notFollowedBy);
    ui.targetUnfollowedCount.textContent = String(state.targetStats.unfollowed);
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

  function applyTargetStatsDelta(delta = {}) {
    const nextDelta = {
      checked: normalizeStatsCount(delta.checked),
      notFollowedBy: normalizeStatsCount(delta.notFollowedBy),
      unfollowed: normalizeStatsCount(delta.unfollowed)
    };

    if (!nextDelta.checked && !nextDelta.notFollowedBy && !nextDelta.unfollowed) {
      return;
    }

    state.targetStats.checked += nextDelta.checked;
    state.targetStats.notFollowedBy += nextDelta.notFollowedBy;
    state.targetStats.unfollowed += nextDelta.unfollowed;
    renderTargetStats();
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
    const targetOptions = readTargetCheckOptions();

    return {
      keyword: normalizeSetting(ui.keyword?.value, DEFAULT_SETTINGS.keyword),
      commentFileName: normalizeSetting(state.commentFileCache.name, state.settings.commentFileName || ''),
      loopEnabled: Boolean(ui.loopEnabled?.checked ?? DEFAULT_SETTINGS.loopEnabled),
      testMode: Boolean(ui.testMode?.checked ?? DEFAULT_SETTINGS.testMode),
      onlyBlueVerified: Boolean(ui.onlyBlue?.checked ?? DEFAULT_SETTINGS.onlyBlueVerified),
      loopCount: normalizeInteger(ui.loopCount?.value, DEFAULT_SETTINGS.loopCount, 0),
      intervalSeconds: normalizeInteger(ui.loopInterval?.value, DEFAULT_SETTINGS.intervalSeconds, 1),
      targetPageMode: targetOptions.pageMode,
      targetProcessMode: targetOptions.processMode,
      targetCustomPages: targetOptions.customPages
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
      intervalSeconds: normalizeInteger(settings?.intervalSeconds, DEFAULT_SETTINGS.intervalSeconds, 1),
      targetPageMode: ['latest', 'all', 'custom'].includes(settings?.targetPageMode)
        ? settings.targetPageMode
        : DEFAULT_SETTINGS.targetPageMode,
      targetProcessMode: settings?.targetProcessMode === 'unfollow-all'
        ? 'unfollow-all'
        : DEFAULT_SETTINGS.targetProcessMode,
      targetCustomPages: normalizeInteger(settings?.targetCustomPages, DEFAULT_SETTINGS.targetCustomPages, 1)
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
    const root = getPanelRoot();
    const targetPage = root.querySelector(`input[name="xta-target-pages"][value="${nextSettings.targetPageMode}"]`);
    const targetMode = root.querySelector(`input[name="xta-target-mode"][value="${nextSettings.targetProcessMode}"]`);
    const targetCustomPages = root.querySelector('.xta-target-custom-pages');
    if (targetPage) {
      targetPage.checked = true;
    }
    if (targetMode) {
      targetMode.checked = true;
    }
    if (targetCustomPages) {
      targetCustomPages.value = String(nextSettings.targetCustomPages);
    }
    updateTargetCustomPagesState();

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
      intervalSeconds: normalizeInteger(settings?.intervalSeconds ?? state.settings.intervalSeconds, DEFAULT_SETTINGS.intervalSeconds, 1),
      targetPageMode: ['latest', 'all', 'custom'].includes(settings?.targetPageMode ?? state.settings.targetPageMode)
        ? (settings?.targetPageMode ?? state.settings.targetPageMode)
        : DEFAULT_SETTINGS.targetPageMode,
      targetProcessMode: (settings?.targetProcessMode ?? state.settings.targetProcessMode) === 'unfollow-all'
        ? 'unfollow-all'
        : DEFAULT_SETTINGS.targetProcessMode,
      targetCustomPages: normalizeInteger(
        settings?.targetCustomPages ?? state.settings.targetCustomPages,
        DEFAULT_SETTINGS.targetCustomPages,
        1
      )
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

  async function logPeriodicPageRefreshIfNeeded() {
    if (state.loopIndex <= 0 || state.loopIndex % PAGE_REFRESH_EVERY_ROUNDS !== 0) {
      return;
    }

    await appendLog('info', '达到定期刷新轮次，重新访问页面释放 X 页面资源', {
      已完成次数: state.loopIndex,
      刷新间隔轮次: PAGE_REFRESH_EVERY_ROUNDS
    });
  }

  function updateLogCount(logCount, logs) {
    const safeLogs = Array.isArray(logs) ? logs : [];
    if (logCount) {
      logCount.textContent = `${safeLogs.length} / ${LOG_LIMIT}`;
    }
  }

  function createLogRow(log) {
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

    return row;
  }

  function appendRenderedLog(logList, logCount, logs, log) {
    updateLogCount(logCount, logs);
    if (!logList) {
      return;
    }

    const empty = logList.querySelector('.xta-empty');
    if (empty) {
      empty.remove();
    }

    logList.prepend(createLogRow(log));
    while (logList.children.length > LOG_RENDER_LIMIT) {
      logList.lastElementChild?.remove();
    }
  }

  function renderLogList(logList, logCount, logs, emptyText) {
    updateLogCount(logCount, logs);
    if (!logList) {
      return;
    }

    const safeLogs = Array.isArray(logs) ? logs : [];
    logList.replaceChildren();

    if (safeLogs.length === 0) {
      const empty = document.createElement('div');
      empty.className = 'xta-empty';
      empty.textContent = emptyText;
      logList.append(empty);
      return;
    }

    for (const log of safeLogs.slice().reverse().slice(0, LOG_RENDER_LIMIT)) {
      logList.append(createLogRow(log));
    }
  }

  function renderLogs() {
    if (state.activeTab !== 'assistant') {
      updateLogCount(ui.logCount, state.logs);
      return;
    }

    renderLogList(ui.logList, ui.logCount, state.logs, '暂无日志');
  }

  function renderTargetLogs() {
    if (state.activeTab !== 'target-check') {
      updateLogCount(ui.targetLogCount, state.targetLogs);
      return;
    }

    renderLogList(ui.targetLogList, ui.targetLogCount, state.targetLogs, '暂无检测日志');
  }

  function updateButtons() {
    if (!ui.startButton) {
      return;
    }

    ui.startButton.disabled = state.running;
    ui.stopButton.disabled = !state.running || state.stopping;
    ui.resetButton.disabled = state.running;
    ui.clearButton.disabled = state.running;
    if (ui.targetStartButton) {
      ui.targetStartButton.disabled = state.running;
    }
    if (ui.targetStopButton) {
      ui.targetStopButton.disabled = !state.running || state.stopping;
    }
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
          width: min(920px, calc(100vw - 40px));
          height: min(820px, calc(100vh - 88px));
          overflow: hidden;
          display: flex;
          flex-direction: column;
          gap: 12px;
          padding: 16px;
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
          align-self: flex-start;
          width: min(360px, 100%);
          gap: 4px;
          padding: 2px;
          border: 1px solid var(--border);
          border-radius: 7px;
          background: #0e1112;
        }
        .xta-tab {
          min-height: 32px;
          border: 1px solid transparent;
          border-radius: 5px;
          background: transparent;
          color: var(--muted);
          cursor: pointer;
          font: inherit;
          font-size: 12px;
          font-weight: 700;
          line-height: 1.25;
          padding: 4px 8px;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
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
          padding: 12px;
        }
        .xta-row {
          display: grid;
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 12px;
          align-items: end;
        }
        .xta-settings-row {
          grid-template-columns: 1fr;
        }
        .xta-field {
          display: grid;
          gap: 6px;
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
          min-height: 42px;
          padding: 9px 11px;
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
          gap: 10px;
        }
        .xta-check {
          min-height: 42px;
          display: flex;
          align-items: center;
          gap: 9px;
          padding: 9px 10px;
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
        .xta-option-group {
          display: grid;
          gap: 10px;
        }
        .xta-option-title {
          margin: 0;
          color: var(--text);
          font-size: 13px;
          font-weight: 800;
        }
        .xta-target-options-card {
          display: grid;
          gap: 10px;
        }
        .xta-target-option-block {
          display: grid;
          gap: 7px;
        }
        .xta-target-choice-grid {
          display: grid;
          grid-template-columns: repeat(3, minmax(0, 1fr));
          gap: 6px;
        }
        .xta-target-choice-grid.two {
          grid-template-columns: repeat(2, minmax(0, 1fr));
        }
        .xta-target-choice {
          min-height: 34px;
          display: flex;
          align-items: center;
          justify-content: center;
          padding: 6px 8px;
          border: 1px solid rgba(255, 255, 255, 0.07);
          border-radius: 6px;
          background: #121618;
          cursor: pointer;
        }
        .xta-target-choice input {
          position: absolute;
          opacity: 0;
          pointer-events: none;
        }
        .xta-target-choice span {
          max-width: 100%;
          color: var(--muted);
          font-size: 12px;
          font-weight: 700;
          line-height: 1.2;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .xta-target-choice:has(input:checked) {
          border-color: rgba(65, 214, 123, 0.58);
          background: rgba(65, 214, 123, 0.16);
        }
        .xta-target-choice:has(input:checked) span {
          color: var(--text);
        }
        .xta-target-inline-field {
          grid-template-columns: 86px minmax(0, 1fr);
          align-items: center;
          gap: 8px;
        }
        .xta-target-inline-field .xta-input {
          min-height: 36px;
          padding: 7px 10px;
        }
        .xta-target-inline-field.is-disabled span {
          opacity: 0.55;
        }
        .xta-target-inline-field .xta-input:disabled {
          cursor: not-allowed;
          opacity: 0.58;
          background: #111517;
        }
        .xta-target-note {
          margin-top: 2px;
        }
        .xta-target-actions-card {
          order: -1;
        }
        .xta-actions {
          display: grid;
          grid-template-columns: 1fr 1fr;
          gap: 10px;
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
          grid-template-columns: repeat(2, minmax(0, 1fr));
          gap: 10px;
        }
        .xta-metric {
          min-height: 64px;
          padding: 10px;
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
          font-size: 22px;
          line-height: 1.15;
        }
        .xta-metrics-card {
          margin-top: auto;
          position: sticky;
          bottom: 0;
          z-index: 1;
        }
        .xta-target-metrics {
          grid-template-columns: 1fr;
        }
        .xta-target-metrics .xta-metric {
          min-height: 54px;
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
          grid-template-columns: 320px minmax(0, 1fr);
          gap: 12px;
          flex: 1;
          min-height: 0;
          align-items: stretch;
        }
        .xta-controls {
          display: flex;
          flex-direction: column;
          gap: 10px;
          min-width: 0;
          min-height: 0;
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
          gap: 8px;
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
          padding: 9px;
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
          gap: 8px;
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

            <section class="xta-card xta-metrics-card">
              <div class="xta-metrics">
                <div class="xta-metric"><span>已关注</span><strong class="xta-followed">0</strong></div>
                <div class="xta-metric"><span>已评论</span><strong class="xta-commented">0</strong></div>
              </div>
            </section>
          </div>

          <section class="xta-card xta-log-card">
            <div class="xta-log-head">
              <strong>操作日志</strong>
              <span class="xta-log-count">0 / 500</span>
            </div>
            <div class="xta-log-list xta-assistant-log-list"></div>
          </section>
        </div>
        <div class="xta-body xta-tab-panel" id="xta-tab-target-check" role="tabpanel" aria-labelledby="xta-tab-target-check-button" data-tab-panel="target-check" hidden>
          <div class="xta-controls">
            <section class="xta-card xta-target-actions-card">
              <div class="xta-actions">
                <button class="xta-button primary xta-target-start" type="button">开始检测</button>
                <button class="xta-button danger xta-target-stop" type="button" disabled>停止</button>
              </div>
            </section>

            <section class="xta-card xta-target-options-card">
              <div class="xta-target-option-block">
                <strong class="xta-option-title">检测页数</strong>
                <div class="xta-target-choice-grid">
                  <label class="xta-target-choice">
                    <input type="radio" name="xta-target-pages" value="latest" checked>
                    <span>最新1页</span>
                  </label>
                  <label class="xta-target-choice">
                    <input type="radio" name="xta-target-pages" value="all">
                    <span>全部</span>
                  </label>
                  <label class="xta-target-choice">
                    <input type="radio" name="xta-target-pages" value="custom">
                    <span>自定义</span>
                  </label>
                </div>
                <label class="xta-field xta-target-inline-field">
                  <span>自定义页数</span>
                  <input class="xta-input xta-target-custom-pages" type="number" min="1" step="1" value="3" disabled>
                </label>
              </div>

              <div class="xta-target-option-block">
                <strong class="xta-option-title">处理模式</strong>
                <div class="xta-target-choice-grid two">
                  <label class="xta-target-choice">
                    <input type="radio" name="xta-target-mode" value="none" checked>
                    <span>不处理</span>
                  </label>
                  <label class="xta-target-choice">
                    <input type="radio" name="xta-target-mode" value="unfollow-all">
                    <span>全部取消关注</span>
                  </label>
                </div>
                <div class="xta-help xta-target-note">取消关注间隔随机 5-10 秒。</div>
              </div>
            </section>

            <section class="xta-card xta-metrics-card">
              <div class="xta-metrics xta-target-metrics">
                <div class="xta-metric"><span>已检查关注</span><strong class="xta-target-checked">0</strong></div>
                <div class="xta-metric"><span>未关注我</span><strong class="xta-target-not-followed-by">0</strong></div>
                <div class="xta-metric"><span>已取消关注</span><strong class="xta-target-unfollowed">0</strong></div>
              </div>
            </section>
          </div>

          <section class="xta-card xta-log-card">
            <div class="xta-log-head">
              <strong>检测日志</strong>
              <span class="xta-log-count">0 / 500</span>
            </div>
            <div class="xta-log-list xta-target-log-list"></div>
          </section>
        </div>
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
    ui.targetStartButton = shadow.querySelector('.xta-target-start');
    ui.targetStopButton = shadow.querySelector('.xta-target-stop');
    ui.targetCheckedCount = shadow.querySelector('.xta-target-checked');
    ui.targetNotFollowedByCount = shadow.querySelector('.xta-target-not-followed-by');
    ui.targetUnfollowedCount = shadow.querySelector('.xta-target-unfollowed');
    ui.logLists = Array.from(shadow.querySelectorAll('.xta-log-list'));
    ui.logCounts = Array.from(shadow.querySelectorAll('.xta-log-count'));
    ui.logList = shadow.querySelector('.xta-assistant-log-list') || ui.logLists[0];
    ui.targetLogList = shadow.querySelector('.xta-target-log-list') || ui.logLists[1];
    ui.logCount = ui.logList?.closest('.xta-log-card')?.querySelector('.xta-log-count') || ui.logCounts[0];
    ui.targetLogCount = ui.targetLogList?.closest('.xta-log-card')?.querySelector('.xta-log-count') || ui.logCounts[1];
    ui.tabs = Array.from(shadow.querySelectorAll('.xta-tab'));
    ui.tabPanels = Array.from(shadow.querySelectorAll('.xta-tab-panel'));

    const xLogoIcon = '<img class="xta-x-logo" src="https://abs.twimg.com/favicons/twitter.3.ico" alt="" draggable="false">';

    const activateTab = (tabName) => {
      state.activeTab = tabName;

      ui.tabs.forEach((tab) => {
        const active = tab.dataset.tab === tabName;
        tab.classList.toggle('is-active', active);
        tab.setAttribute('aria-selected', String(active));
      });

      ui.tabPanels.forEach((panel) => {
        const active = panel.dataset.tabPanel === tabName;
        panel.hidden = !active;
      });

      if (tabName === 'target-check') {
        renderTargetLogs();
      } else {
        renderLogs();
      }
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
    ui.targetStartButton.addEventListener('click', startTargetCheck);
    ui.targetStopButton.addEventListener('click', stopLoop);
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
    shadow.querySelectorAll('input[name="xta-target-pages"]').forEach((element) => {
      element.addEventListener('change', () => {
        updateTargetCustomPagesState();
        saveCurrentSettings();
      });
    });
    shadow.querySelectorAll('input[name="xta-target-mode"], .xta-target-custom-pages').forEach((element) => {
      element.addEventListener('change', saveCurrentSettings);
    });
    updateTargetCustomPagesState();
    ui.commentFile.addEventListener('click', () => ui.fileInput.click());
    ui.fileInput.addEventListener('change', handleCommentFileSelect);
  }

  async function loadPersistedState() {
    const stored = await chrome.storage.local.get({
      [LOG_KEY]: [],
      [TARGET_LOG_KEY]: [],
      [STATS_KEY]: defaultStats(),
      [SETTINGS_KEY]: defaultSettings(),
      [COMMENT_FILE_CACHE_KEY]: defaultCommentFileCache()
    });

    state.logs = Array.isArray(stored[LOG_KEY]) ? stored[LOG_KEY].slice(-LOG_LIMIT) : [];
    state.targetLogs = Array.isArray(stored[TARGET_LOG_KEY]) ? stored[TARGET_LOG_KEY].slice(-LOG_LIMIT) : [];
    state.stats = { ...defaultStats(), ...(stored[STATS_KEY] || {}) };
    state.commentFileCache = {
      ...defaultCommentFileCache(),
      ...(stored[COMMENT_FILE_CACHE_KEY] || {})
    };
    applySettings(stored[SETTINGS_KEY]);
    renderLogs();
    renderTargetLogs();
    renderStats();
    renderTargetStats();
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
        type,
        statsDeltaApplied: false,
        targetStatsDeltaApplied: false,
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
    const pending = pendingRuns.get(message.runId);

    if (message.type === 'LOG') {
      const logFn = pending?.type === 'RUN_TARGET_CHECK' ? appendTargetLog : appendLog;
      logFn(message.level || 'info', message.message || '', message.details || {});
      return;
    }

    if (!pending) {
      return;
    }

    if (message.type === 'STATS_DELTA') {
      pending.statsDeltaApplied = true;
      applyStatsDelta(message.delta || {});
      return;
    }

    if (message.type === 'TARGET_STATS_DELTA') {
      pending.targetStatsDeltaApplied = true;
      applyTargetStatsDelta(message.delta || {});
      return;
    }

    if (message.type === 'RESULT') {
      pending.resolve({
        ...(message.result || {}),
        __statsDeltaApplied: Boolean(pending.statsDeltaApplied),
        __targetStatsDeltaApplied: Boolean(pending.targetStatsDeltaApplied)
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

  function getPanelRoot() {
    return ui.panel?.getRootNode?.() || document;
  }

  function updateTargetCustomPagesState() {
    const root = getPanelRoot();
    const isCustom = root.querySelector('input[name="xta-target-pages"]:checked')?.value === 'custom';
    const input = root.querySelector('.xta-target-custom-pages');
    const field = input?.closest('.xta-target-inline-field');
    if (!input) {
      return;
    }

    input.disabled = !isCustom;
    field?.classList.toggle('is-disabled', !isCustom);
  }

  function readTargetCheckOptions() {
    const root = getPanelRoot();
    const pageMode = root.querySelector('input[name="xta-target-pages"]:checked')?.value || 'latest';
    const processMode = root.querySelector('input[name="xta-target-mode"]:checked')?.value || 'none';
    const customPages = normalizeInteger(
      root.querySelector('.xta-target-custom-pages')?.value,
      1,
      1
    );

    return {
      pageMode,
      processMode,
      customPages
    };
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

      if (
        remaining === totalSeconds ||
        remaining <= 3 ||
        remaining % COUNTDOWN_STATUS_INTERVAL_SECONDS === 0
      ) {
        setStatus(`${label} ${remaining} 秒`, 'running');
      }
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
    state.activeTask = 'assistant';
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
      state.activeTask = '';
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
    state.activeTask = 'assistant';
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
      await logPeriodicPageRefreshIfNeeded();
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
        state.activeTask = '';
        updateButtons();
      }
    }
  }

  async function startTargetCheck() {
    if (state.running) {
      return;
    }

    const options = readTargetCheckOptions();
    state.running = true;
    state.stopping = false;
    state.activeTask = 'target';
    state.targetStats = defaultTargetStats();
    renderTargetStats();
    updateButtons();
    setStatus('正在检测已关注目标', 'running');

    try {
      await saveSettings(readSettingsFromUi());
      await appendTargetLog('info', '已关注目标检测开始', {
        检测页数: options.pageMode === 'latest'
          ? '最新1页'
          : options.pageMode === 'all'
            ? '全部页数'
            : options.customPages,
        处理模式: options.processMode === 'unfollow-all' ? '全部取消关注' : '不处理'
      });

      const result = await sendPageRequest('RUN_TARGET_CHECK', options, 60 * 60 * 1000);

      if (!result.__targetStatsDeltaApplied) {
        applyTargetStatsDelta({
          checked: result.checkedCount,
          notFollowedBy: result.notFollowedByCount,
          unfollowed: result.unfollowedCount
        });
      }

      setStatus(result.stopped ? '已停止' : '检测完成', result.stopped ? 'idle' : 'success');
      await appendTargetLog(result.stopped ? 'warn' : 'success', '已关注目标检测结束', {
        是否停止: result.stopped ? '是' : '否',
        检测页数: result.pageCount,
        已检查关注: result.checkedCount,
        未关注我: result.notFollowedByCount,
        已取消关注: result.unfollowedCount
      });
    } catch (error) {
      setStatus('检测错误', 'error');
      await appendTargetLog('error', String(error?.message || error || '未知错误'), {});
    } finally {
      state.running = false;
      state.stopping = false;
      state.activeTask = '';
      updateButtons();
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
    const logFn = state.activeTask === 'target' ? appendTargetLog : appendLog;
    await logFn('warn', '已请求停止', {});
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
      if (message.log) {
        const added = storeLog('logs', message.log);
        if (added && state.activeTab === 'assistant') {
          appendRenderedLog(ui.logList, ui.logCount, state.logs, message.log);
        } else {
          updateLogCount(ui.logCount, state.logs);
        }
      } else if (Array.isArray(message.logs)) {
        state.logs = message.logs.slice(-LOG_LIMIT);
        renderLogs();
      }
      return;
    }

    if (message?.type === 'XTL_TARGET_LOG_UPDATED') {
      if (message.log) {
        const added = storeLog('targetLogs', message.log);
        if (added && state.activeTab === 'target-check') {
          appendRenderedLog(ui.targetLogList, ui.targetLogCount, state.targetLogs, message.log);
        } else {
          updateLogCount(ui.targetLogCount, state.targetLogs);
        }
      } else if (Array.isArray(message.logs)) {
        state.targetLogs = message.logs.slice(-LOG_LIMIT);
        renderTargetLogs();
      }
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
