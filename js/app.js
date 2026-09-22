/* ============================================
   MeetNote AI — Main Application Controller
   ============================================ */

const App = {
  currentRoute: 'dashboard',
  currentMeetingId: null,
  _activeRecordingMeetingId: null,
  _interimText: '',
  _transcriptSegments: [],
  _translationSegments: [],
  _recordingSaveInProgress: false,
  _backgroundAudioTasks: new Map(),
  _activePollers: new Map(),
  _selectedMeetingIds: new Set(),
  _themeMedia: null,
  _pendingAutoStartMeetingId: null,
  SONIOX_REALTIME_USD_PER_HOUR: 0.12,
  SONIOX_ASYNC_USD_PER_HOUR: 0.10,
  SONIOX_ASYNC_TRANSLATION_USD_PER_HOUR: 0.16,

  /* ──────────────────────────────────────────
     Initialization
     ────────────────────────────────────────── */

  init() {
    this._installDiagnostics();
    this._applyTheme(Storage.getSettings().theme);
    this._bindNavigation();
    this._bindMobileMenu();
    this._bindThemeToggle();
    this._updateMeetingsCount();

    // Route from hash
    const hash = location.hash.slice(1) || 'dashboard';
    this.navigate(hash);
    this._migrateLegacyAudio();
    this._resumeProcessingJobs();

    // Listen for hash changes
    window.addEventListener('hashchange', () => {
      const h = location.hash.slice(1) || 'dashboard';
      this.navigate(h);
    });

    window.addEventListener('beforeunload', (event) => {
      if (this._activeRecordingMeetingId) {
        event.preventDefault();
        event.returnValue = '';
      }
    });

    window.addEventListener('meetnote-storage-error', (event) => {
      this.toast(`Could not write to the storage folder: ${event.detail.message}`, 'error');
      this._logClientEvent('error', 'storage_error', event.detail.message);
    });
  },

  _installDiagnostics() {
    window.addEventListener('error', event => {
      this._logClientEvent('error', 'uncaught_error', event.message || 'Unknown browser error', {
        source: event.filename || '',
        line: event.lineno || 0,
        column: event.colno || 0,
        stack: event.error?.stack || ''
      });
    });
    window.addEventListener('unhandledrejection', event => {
      const reason = event.reason;
      this._logClientEvent('error', 'unhandled_rejection', reason?.message || String(reason || 'Unknown rejection'), {
        stack: reason?.stack || ''
      });
    });
    this._logClientEvent('info', 'app_initialized', 'MeetNote UI initialized', {
      route: location.hash.slice(1) || 'dashboard',
      userAgent: navigator.userAgent
    });
  },

  _logClientEvent(level, event, message, context = {}) {
    fetch('/api/logs', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ level, event, message, context }),
      keepalive: true
    }).catch(() => {});
  },

  _applyTheme(preference) {
    const theme = ['dark', 'light', 'system'].includes(preference) ? preference : 'dark';
    const prefersLight = window.matchMedia('(prefers-color-scheme: light)').matches;
    const resolved = theme === 'system' ? (prefersLight ? 'light' : 'dark') : theme;
    document.documentElement.dataset.theme = resolved;
    document.documentElement.style.colorScheme = resolved;

    const themeColor = document.querySelector('meta[name="theme-color"]');
    if (themeColor) themeColor.content = resolved === 'light' ? '#fbfaf7' : '#002d31';

    const toggle = document.getElementById('theme-toggle');
    if (toggle) {
      const switchTo = resolved === 'light' ? 'dark' : 'light';
      toggle.textContent = resolved === 'light' ? '🌙' : '☀️';
      toggle.title = `Switch to ${switchTo} mode`;
      toggle.setAttribute('aria-label', `Switch to ${switchTo} mode`);
    }
    const themeSelect = document.getElementById('setting-theme');
    if (themeSelect && themeSelect.value !== theme) themeSelect.value = theme;
  },

  _bindThemeToggle() {
    this._themeMedia = window.matchMedia('(prefers-color-scheme: light)');
    this._themeMedia.addEventListener?.('change', () => {
      if (Storage.getSettings().theme === 'system') this._applyTheme('system');
    });

    document.getElementById('theme-toggle')?.addEventListener('click', async () => {
      const nextTheme = document.documentElement.dataset.theme === 'light' ? 'dark' : 'light';
      Storage.saveSettings({ theme: nextTheme });
      this._applyTheme(nextTheme);
      try {
        await Storage.flush();
      } catch (error) {
        this.toast(`Could not save theme: ${error.message}`, 'error');
      }
    });
  },

  /* ──────────────────────────────────────────
     Router
     ────────────────────────────────────────── */

  navigate(route, options = {}) {
    if (
      this._recordingSaveInProgress &&
      this.currentRoute === 'recording' &&
      route !== `recording/${this.currentMeetingId}` &&
      !options.force
    ) {
      this.toast('Please wait while the recording is being saved.', 'info');
      history.replaceState(null, '', `#recording/${this.currentMeetingId}`);
      return;
    }

    const leavingActiveRecording =
      this._activeRecordingMeetingId &&
      this.currentRoute === 'recording' &&
      route !== `recording/${this.currentMeetingId}`;

    if (leavingActiveRecording && !options.force) {
      this._confirmLeaveRecording(route);
      return;
    }

    // Parse route: "meeting/abc-123" → { page: 'meeting', id: 'abc-123' }
    const parts = route.split('/');
    const page = parts[0];
    const id = parts[1] || null;

    this.currentRoute = page;
    this.currentMeetingId = id;

    // Update nav active state
    document.querySelectorAll('.nav-item[data-route]').forEach(el => {
      el.classList.toggle('active', el.dataset.route === page);
    });

    // Update hash without triggering hashchange
    if (location.hash.slice(1) !== route) {
      history.replaceState(null, '', `#${route}`);
    }

    // Close mobile sidebar
    document.getElementById('sidebar').classList.remove('open');
    document.getElementById('sidebar-overlay').classList.remove('open');

    // Render page
    const content = document.getElementById('main-content');
    const title = document.getElementById('page-title');
    const headerActions = document.getElementById('header-actions');
    headerActions.innerHTML = '';

    switch (page) {
      case 'dashboard':
        title.textContent = 'Dashboard';
        content.innerHTML = this._renderDashboard();
        this._bindDashboard();
        break;
      case 'new':
        title.textContent = 'New Meeting';
        content.innerHTML = this._renderNewMeeting();
        this._bindNewMeeting();
        break;
      case 'recording':
        title.textContent = 'Recording';
        content.innerHTML = this._renderRecording(id);
        this._bindRecording(id);
        break;
      case 'meeting':
        title.textContent = 'Meeting Details';
        content.innerHTML = this._renderMeetingDetail(id);
        this._bindMeetingDetail(id);
        break;
      case 'meetings':
        title.textContent = 'All Meetings';
        content.innerHTML = this._renderAllMeetings();
        this._bindAllMeetings();
        break;
      case 'usage':
        title.textContent = 'Usage Log';
        content.innerHTML = this._renderUsageLog();
        this._bindMeetingItemClicks();
        break;
      case 'search':
        title.textContent = 'Search';
        content.innerHTML = this._renderSearch();
        this._bindSearch();
        break;
      case 'settings':
        title.textContent = 'Settings';
        content.innerHTML = this._renderSettings();
        this._bindSettings();
        break;
      case 'report-bug':
        title.textContent = 'Report a Bug';
        content.innerHTML = this._renderBugReport();
        this._bindBugReport();
        break;
      default:
        title.textContent = 'Not Found';
        content.innerHTML = this._renderNotFound();
    }
    this._renderBackgroundTaskIndicator();
  },

  _renderBackgroundTaskIndicator() {
    const container = document.getElementById('header-actions');
    if (!container) return;
    const count = this._backgroundAudioTasks.size;
    if (!count) {
      container.innerHTML = '';
      return;
    }
    container.innerHTML = `
      <button class="btn btn-secondary btn-sm" id="background-audio-status" type="button" title="View processing audio files">
        <span class="spinner"></span>
        ${count} audio ${count === 1 ? 'task' : 'tasks'}
      </button>
    `;
    document.getElementById('background-audio-status')?.addEventListener('click', () => this.navigate('meetings'));
  },

  _refreshMeetingView(meetingId) {
    if (['dashboard', 'meetings', 'usage'].includes(this.currentRoute)) {
      this.navigate(this.currentRoute, { force: true });
    } else if (this.currentRoute === 'meeting' && this.currentMeetingId === meetingId) {
      this.navigate(`meeting/${meetingId}`, { force: true });
    } else {
      this._renderBackgroundTaskIndicator();
    }
  },

  _confirmLeaveRecording(route) {
    if (document.getElementById('confirm-save-leave')) return;

    this.showModal(`
      <div class="modal-header">
        <h3>Recording in progress</h3>
        <button class="btn btn-ghost btn-icon" id="cancel-leave-recording">✕</button>
      </div>
      <p class="text-sm text-secondary">Save or discard the current recording before leaving this page.</p>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="stay-on-recording">Stay</button>
        <button class="btn btn-danger" id="discard-and-leave">Discard & Leave</button>
        <button class="btn btn-primary" id="confirm-save-leave">Save & Leave</button>
      </div>
    `);

    const stay = () => {
      history.replaceState(null, '', `#recording/${this.currentMeetingId}`);
      this.closeModal();
    };
    document.getElementById('modal-backdrop').onclick = stay;
    document.getElementById('cancel-leave-recording').addEventListener('click', stay);
    document.getElementById('stay-on-recording').addEventListener('click', stay);
    document.getElementById('confirm-save-leave').addEventListener('click', async () => {
      this._setRecordingModalBusy(true);
      const saved = await this._saveActiveRecording(this.currentMeetingId);
      if (saved) {
        this.closeModal();
        this.navigate(route, { force: true });
      } else {
        this._setRecordingModalBusy(false);
      }
    });
    document.getElementById('discard-and-leave').addEventListener('click', async () => {
      this._setRecordingModalBusy(true);
      await this._discardActiveRecording(this.currentMeetingId);
      this.closeModal();
      this.navigate(route, { force: true });
    });
  },

  _setRecordingModalBusy(isBusy) {
    ['stay-on-recording', 'discard-and-leave', 'confirm-save-leave', 'cancel-leave-recording']
      .forEach(id => {
        const element = document.getElementById(id);
        if (element) element.disabled = isBusy;
      });
    const saveButton = document.getElementById('confirm-save-leave');
    if (saveButton) saveButton.textContent = isBusy ? 'Saving…' : 'Save & Leave';
  },

  async _migrateLegacyAudio() {
    const meetings = Storage.getAllMeetings().filter(meeting => meeting.audioBlob);
    let migrationSucceeded = true;
    for (const meeting of meetings) {
      try {
        const blob = Recorder.base64ToBlob(meeting.audioBlob);
        await AudioStorage.save(meeting.id, blob);
        meeting.audioId = meeting.id;
        meeting.audioBlob = null;
        Storage.saveMeeting(meeting);
      } catch (error) {
        migrationSucceeded = false;
        console.warn(`Could not migrate audio for meeting ${meeting.id}:`, error);
      }
    }
    if (migrationSucceeded) {
      await Storage.flush();
      localStorage.removeItem(Storage.KEYS.MEETINGS);
      localStorage.removeItem(Storage.KEYS.SETTINGS);
    }
  },

  _cleanupRecordingCallbacks() {
    Recorder.onTick = null;
    Recorder.onWaveform = null;
    Recorder.onStop = null;
    Recorder.onChunk = null;
    Recorder.onSystemAudioLost = null;
    Recorder.onSystemAudioSilent = null;
    Transcriber.onResult = null;
    Transcriber.onError = null;
    Transcriber.onStatusChange = null;
    this._activeRecordingMeetingId = null;
  },

  async _saveActiveRecording(meetingId) {
    if (this._recordingSaveInProgress) return false;
    this._recordingSaveInProgress = true;

    try {
      const duration = Recorder.getElapsedSeconds();
      const blob = await Recorder.stop();
      await Transcriber.stop();
      const meeting = Storage.getMeeting(meetingId);
      if (!meeting) throw new Error('Meeting no longer exists');

      if (blob && blob.size > 0) {
        await AudioStorage.save(meetingId, blob);
        meeting.audioId = meetingId;
        meeting.audioBlob = null;
      }

      meeting.transcript = [...this._transcriptSegments];
      meeting.translations = [...this._translationSegments];
      meeting.duration = duration;
      meeting.status = 'completed';
      if (meeting.sonioxUsage?.startedAt) {
        meeting.sonioxUsage = {
          ...meeting.sonioxUsage,
          endedAt: new Date().toISOString(),
          billableDurationSeconds: duration,
          estimatedCostUsd: this._estimateSonioxCost(duration)
        };
      }
      Storage.saveMeeting(meeting);
      await Storage.flush();
      this._cleanupRecordingCallbacks();
      this._updateMeetingsCount();
      return true;
    } catch (error) {
      console.error('Could not save recording:', error);
      this.toast(`Could not save recording: ${error.message}`, 'error');
      return false;
    } finally {
      this._recordingSaveInProgress = false;
    }
  },

  async _discardActiveRecording(meetingId) {
    this._cleanupRecordingCallbacks();
    await Recorder.stop();
    await Transcriber.stop();
    await AudioStorage.delete(meetingId).catch(error => {
      console.warn('Could not remove recording audio:', error);
    });
    Storage.deleteMeeting(meetingId);
    await Storage.flush();
    this._updateMeetingsCount();
  },

  /* ──────────────────────────────────────────
     Navigation Bindings
     ────────────────────────────────────────── */

  _bindNavigation() {
    document.querySelectorAll('.nav-item[data-route]').forEach(el => {
      el.addEventListener('click', (e) => {
        e.preventDefault();
        this.navigate(el.dataset.route);
      });
    });
  },

  _bindMobileMenu() {
    const toggle = document.getElementById('mobile-toggle');
    const sidebar = document.getElementById('sidebar');
    const overlay = document.getElementById('sidebar-overlay');

    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
      overlay.classList.toggle('open');
    });

    overlay.addEventListener('click', () => {
      sidebar.classList.remove('open');
      overlay.classList.remove('open');
    });
  },

  // R-Z/V11#8 — a merged (multi-part) meeting's audio lives at N part ids,
  // not at `meeting.id`; deleting a meeting must free every one of them or
  // audio quietly piles up forever in storage/audio/ (R-Q).
  _audioIdsForMeeting(meeting) {
    if (Array.isArray(meeting?.parts) && meeting.parts.length > 0) {
      return meeting.parts.map(part => part.partId).filter(Boolean);
    }
    return [meeting.id];
  },

  _updateMeetingsCount() {
    const count = Storage.getAllMeetings().length;
    const badge = document.getElementById('nav-meetings-count');
    if (count > 0) {
      badge.textContent = count;
      badge.style.display = 'flex';
    } else {
      badge.style.display = 'none';
    }
  },

  /* ──────────────────────────────────────────
     Toast Notifications
     ────────────────────────────────────────── */

  toast(message, type = 'info') {
    const container = document.getElementById('toast-container');
    const icons = { success: '✓', warning: '⚠', error: '✕', info: 'ℹ' };
    const toast = document.createElement('div');
    toast.className = `toast toast-${type}`;
    const icon = document.createElement('span');
    icon.textContent = icons[type] || 'ℹ';
    const text = document.createElement('span');
    text.textContent = String(message);
    toast.append(icon, document.createTextNode(' '), text);
    container.appendChild(toast);

    setTimeout(() => {
      toast.style.animation = `toast-slide-out var(--duration-normal) var(--ease-out) forwards`;
      setTimeout(() => toast.remove(), 300);
    }, 3500);
  },

  /* ──────────────────────────────────────────
     Modal
     ────────────────────────────────────────── */

  showModal(content) {
    const backdrop = document.getElementById('modal-backdrop');
    const modal = document.getElementById('modal');
    modal.innerHTML = content;
    backdrop.classList.add('active');
    modal.classList.add('active');

    backdrop.onclick = () => this.closeModal();
  },

  closeModal() {
    document.getElementById('modal-backdrop').classList.remove('active');
    document.getElementById('modal').classList.remove('active');
  },

  /* ══════════════════════════════════════════
     VIEW: Dashboard
     ══════════════════════════════════════════ */

  _renderDashboard() {
    const stats = Storage.getStats();
    const meetings = Storage.getAllMeetings().slice(0, 5);

    return `
      <div class="view-enter">
        <!-- Stats -->
        <div class="grid grid-4 stagger-children" style="margin-bottom: var(--space-8);">
          <div class="card stat-card">
            <div class="stat-icon" style="background: var(--accent-primary-muted); color: var(--accent-primary);">📋</div>
            <div class="stat-value">${stats.totalMeetings}</div>
            <div class="stat-label">Total Meetings</div>
          </div>
          <div class="card stat-card">
            <div class="stat-icon" style="background: var(--accent-secondary-muted); color: var(--accent-secondary);">⏱️</div>
            <div class="stat-value">${stats.totalHours}</div>
            <div class="stat-label">Hours Recorded</div>
          </div>
          <div class="card stat-card">
            <div class="stat-icon" style="background: var(--color-info-muted); color: var(--color-info);">📅</div>
            <div class="stat-value">${stats.thisWeek}</div>
            <div class="stat-label">This Week</div>
          </div>
          <div class="card stat-card" id="dash-pending-actions" style="cursor: pointer;">
            <div class="stat-icon" style="background: var(--color-warning-muted); color: var(--color-warning);">✅</div>
            <div class="stat-value">${stats.pendingActions}</div>
            <div class="stat-label">Pending Actions</div>
          </div>
        </div>

        <!-- Quick Actions -->
        <div class="flex flex-wrap gap-4" style="margin-bottom: var(--space-8);">
          <button class="btn btn-primary btn-lg" id="dash-quick-record">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>
            Quick Record
          </button>
          <button class="btn btn-secondary btn-lg" id="dash-new-meeting">
            Meeting Setup
          </button>
          <button class="btn btn-secondary btn-lg" id="dash-upload">
            <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
            Upload Recording
          </button>
        </div>

        <!-- Recent Meetings -->
        <div class="card" style="padding: 0;">
          <div style="padding: var(--space-5) var(--space-6); border-bottom: 1px solid var(--border-subtle);">
            <div class="flex items-center justify-between">
              <h3 style="font-size: var(--text-base);">Recent Meetings</h3>
              ${meetings.length > 0 ? '<a class="text-sm" style="cursor:pointer; color: var(--accent-primary);" id="dash-view-all">View all →</a>' : ''}
            </div>
          </div>
          <div>
            ${meetings.length > 0 ? meetings.map(m => this._renderMeetingItem(m)).join('') : `
              <div class="empty-state" style="padding: var(--space-10);">
                <div class="empty-icon">🎙️</div>
                <h3>No meetings yet</h3>
                <p>Start your first meeting recording to see it here.</p>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  },

  _bindDashboard() {
    document.getElementById('dash-quick-record')?.addEventListener('click', () => this._quickStartMeeting());
    document.getElementById('dash-new-meeting')?.addEventListener('click', () => this.navigate('new'));
    document.getElementById('dash-view-all')?.addEventListener('click', () => this.navigate('meetings'));
    document.getElementById('dash-upload')?.addEventListener('click', () => Import.open());
    document.getElementById('dash-pending-actions')?.addEventListener('click', () => this._openPendingActionsModal());
    this._bindMeetingItemClicks();
  },

  _openPendingActionsModal() {
    const items = Storage.getPendingActionItems();
    const listHtml = items.length ? items.map(item => `
      <label class="checkbox" data-action-id="${Utils.escapeHtml(item.id)}" data-meeting-id="${Utils.escapeHtml(item.meetingId)}">
        <input type="checkbox">
        <span class="checkbox-label">${Utils.escapeHtml(item.text)}</span>
        ${item.assignee ? `<span class="chip" style="margin-left: auto;">${Utils.escapeHtml(item.assignee)}</span>` : ''}
        ${item.dueDate ? `<span class="chip"${item.assignee ? '' : ' style="margin-left: auto;"'}>${Utils.escapeHtml(item.dueDate)}</span>` : ''}
      </label>
      <div class="text-xs text-tertiary" style="margin: 0 0 var(--space-3) var(--space-8);">
        ${Utils.escapeHtml(item.meetingTitle || 'Untitled Meeting')} · ${Utils.formatDate(item.meetingDate)}
      </div>
    `).join('') : '<p class="text-sm text-tertiary">No pending action items.</p>';

    this.showModal(`
      <div class="modal-header">
        <h3>Pending Actions (${items.length})</h3>
        <button class="btn btn-ghost btn-icon" onclick="App.closeModal()">✕</button>
      </div>
      <div class="modal-body">
        ${listHtml}
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">Close</button>
      </div>
    `);

    document.querySelectorAll('#modal [data-action-id][data-meeting-id]').forEach(el => {
      el.querySelector('input[type="checkbox"]')?.addEventListener('change', () => {
        const meetingId = el.dataset.meetingId;
        const actionId = el.dataset.actionId;
        if (!Storage.getMeeting(meetingId)?.actionItems?.some(a => a.id === actionId)) return;
        Storage.toggleActionItem(meetingId, actionId);
        this._openPendingActionsModal();
      });
    });
  },

  _defaultMeetingTitle(date = new Date()) {
    const pad = value => String(value).padStart(2, '0');
    const formattedDate = `${pad(date.getDate())}/${pad(date.getMonth() + 1)}/${date.getFullYear()}`;
    const formattedTime = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `Meeting — ${formattedDate} · ${formattedTime}`;
  },

  _isDefaultMeetingTitle(title) {
    const value = String(title || '').trim();
    return !value ||
      /^Untitled Meeting$/i.test(value) ||
      /^Meeting\s*[—–-]\s*\d{1,2}\/\d{1,2}\/\d{4}\s*[·•-]\s*\d{1,2}:\d{2}$/i.test(value);
  },

  _quickStartMeeting() {
    const settings = Storage.getSettings();
    const meeting = Storage.saveMeeting({
      title: this._defaultMeetingTitle(),
      participants: [],
      language: settings.language,
      translationLanguage: settings.translationLanguage,
      status: 'draft'
    });
    this._pendingAutoStartMeetingId = meeting.id;
    this.navigate(`recording/${meeting.id}`);
    this._updateMeetingsCount();
  },

  _estimateSonioxCost(durationSeconds, rate = this.SONIOX_REALTIME_USD_PER_HOUR) {
    const seconds = Number.isFinite(Number(durationSeconds)) ? Math.max(0, Number(durationSeconds)) : 0;
    return (seconds / 3600) * rate;
  },

  _formatUsd(value) {
    const amount = Number(value) || 0;
    return `$${amount.toFixed(amount < 0.01 ? 4 : 2)}`;
  },

  _sttProviderName(id) {
    return ({
      soniox: 'Soniox',
      deepgram: 'Deepgram',
      whisper: 'OpenAI Whisper',
      google: 'Google Speech-to-Text'
    })[id] || id || 'Speech-to-text';
  },

  _renderUsageLog() {
    const records = Storage.getAllMeetings()
      .filter(meeting => meeting.sonioxUsage?.startedAt)
      .map(meeting => {
        const usage = meeting.sonioxUsage;
        const provider = usage.provider || 'soniox';
        const duration = usage.billableDurationSeconds || meeting.duration || 0;
        const hasRate = typeof usage.pricingUsdPerHour === 'number' && Number.isFinite(usage.pricingUsdPerHour);
        const hasCost = typeof usage.estimatedCostUsd === 'number' && Number.isFinite(usage.estimatedCostUsd);
        const cost = hasCost ? usage.estimatedCostUsd : (hasRate ? this._estimateSonioxCost(duration, usage.pricingUsdPerHour) : null);
        return { meeting, usage, provider, duration, cost };
      });
    const totalDuration = records.reduce((sum, record) => sum + record.duration, 0);
    const totalCost = records.reduce((sum, record) => sum + (record.cost ?? 0), 0);

    return `
      <div class="view-enter">
        <div class="grid grid-3" style="margin-bottom:var(--space-6);">
          <div class="card stat-card">
            <div class="stat-value">${this._formatUsd(totalCost)}</div>
            <div class="stat-label">Known estimated STT spend</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">${(totalDuration / 3600).toFixed(2)}</div>
            <div class="stat-label">Audio hours</div>
          </div>
          <div class="card stat-card">
            <div class="stat-value">${records.length}</div>
            <div class="stat-label">STT meetings</div>
          </div>
        </div>

        <div class="card" style="padding:0; overflow:hidden;">
          <div style="padding:var(--space-5) var(--space-6); border-bottom:1px solid var(--border-subtle);">
            <div class="flex items-center justify-between gap-4">
              <div>
                <h3 style="font-size:var(--text-base);">Speech-to-text usage by meeting</h3>
                <p class="text-xs">Cost is shown only when MeetNote has a known provider rate.</p>
              </div>
            </div>
          </div>
          <div>
            ${records.length ? records.map(record => `
              <div class="meeting-item" data-meeting-id="${Utils.escapeHtml(record.meeting.id)}">
                <div class="meeting-icon">$</div>
                <div class="meeting-info">
                  <div class="meeting-title">${Utils.escapeHtml(record.meeting.title)}</div>
                  <div class="meeting-meta">
                    <span>${Utils.formatDate(record.meeting.date)}</span>
                    <span class="dot"></span>
                    <span>${Utils.formatDurationHuman(record.duration)}</span>
                    <span class="dot"></span>
                    <span>${Utils.escapeHtml(this._sttProviderName(record.provider))}</span>
                    ${record.usage.translationEnabled ? '<span class="dot"></span><span>Translation</span>' : ''}
                  </div>
                </div>
                <div style="text-align:right;">
                  <strong>${record.cost === null ? '—' : this._formatUsd(record.cost)}</strong>
                  <div class="text-xs text-tertiary">${record.cost === null ? 'check provider billing' : 'estimated'}</div>
                </div>
              </div>
            `).join('') : `
              <div class="empty-state" style="padding:var(--space-10);">
                <div class="empty-icon">📈</div>
                <h3>No speech-to-text usage yet</h3>
                <p>Start a recording and its estimated cost will appear here.</p>
              </div>
            `}
          </div>
        </div>
      </div>
    `;
  },

  /* ══════════════════════════════════════════
     VIEW: New Meeting
     ══════════════════════════════════════════ */

  _renderNewMeeting() {
    const settings = Storage.getSettings();
    const languages = Transcriber.getSupportedLanguages();
    const langOptions = `<option value="auto" ${settings.language === 'auto' ? 'selected' : ''}>Auto-detect multilingual (Recommended)</option>` + languages.map(l =>
      `<option value="${l.code}" ${l.code === settings.language ? 'selected' : ''}>${l.name}</option>`
    ).join('');
    const translationOptions = Transcriber.getTranslationLanguages().map(language =>
      `<option value="${language.sonioxCode}" ${language.sonioxCode === settings.translationLanguage ? 'selected' : ''}>${language.name}</option>`
    ).join('');

    return `
      <div class="view-enter" style="max-width: 600px;">
        <div class="card">
          <h3 style="margin-bottom: var(--space-6);">Meeting Setup</h3>

          <div class="flex flex-col gap-5">
            <div class="input-group">
              <label for="meeting-title">Meeting Title</label>
              <input type="text" class="input" id="meeting-title" value="${Utils.escapeHtml(this._defaultMeetingTitle())}" autofocus>
            </div>

            <div class="input-group">
              <label for="meeting-participants">Participants <span class="text-tertiary">(comma-separated)</span></label>
              <input type="text" class="input" id="meeting-participants" placeholder="e.g. Alice, Bob, Charlie">
            </div>

            <div class="input-group">
              <label for="meeting-type">Meeting type <span class="text-tertiary">(optional)</span></label>
              <select class="input" id="meeting-type">
                ${this._meetingTypeOptions('')}
              </select>
            </div>

            <div class="input-group">
              <label for="meeting-topic">Topic <span class="text-tertiary">(optional)</span></label>
              <input type="text" class="input" id="meeting-topic" maxlength="200" placeholder="e.g. Q4 pricing review">
            </div>

            <div class="input-group">
              <label for="meeting-lead-by">Led by <span class="text-tertiary">(optional)</span></label>
              <input type="text" class="input" id="meeting-lead-by" maxlength="200" placeholder="Who is chairing this meeting?">
            </div>

            <div class="input-group">
              <label for="meeting-language">Spoken Language</label>
              <select class="input" id="meeting-language">
                ${langOptions}
              </select>
              <span class="text-xs text-tertiary">Choose Auto when people may switch between Vietnamese, English, or other languages.</span>
            </div>

            <div class="input-group">
              <label for="meeting-translation-language">Translate To</label>
              <select class="input" id="meeting-translation-language">
                <option value="">Off — original transcript only</option>
                ${translationOptions}
              </select>
              <span class="text-xs text-tertiary" id="meeting-translation-help"></span>
            </div>
          </div>

          ${Recorder.supportsSystemAudio() ? `
          <div class="input-group" style="margin-top: var(--space-4);">
            <label class="system-audio-toggle" id="setup-system-audio-label" title="Capture audio from Zoom/Google Meet and other participants. When enabled, the browser will ask you to select a tab or window to share audio from.">
              <input type="checkbox" id="setup-system-audio" />
              <span class="system-audio-toggle-track">
                <span class="system-audio-toggle-thumb"></span>
              </span>
              <span class="system-audio-toggle-text">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="2" y="6" width="14" height="12" rx="2"/><path d="m22 6-6 4.5L22 15z"/></svg>
                System Audio
              </span>
            </label>
            <span class="text-xs text-tertiary">Enable to capture Zoom/Meet audio from other participants. Browser will ask you to share a tab.</span>
          </div>
          ` : ''}

          <div class="flex gap-3" style="margin-top: var(--space-8);">
            <button class="btn btn-primary btn-lg flex-1" id="start-recording-btn">
              <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="6" fill="currentColor"/></svg>
              Start Recording
            </button>
            <button class="btn btn-secondary btn-lg" id="save-draft-btn">
              Save as Draft
            </button>
          </div>
        </div>

        ${!Transcriber.isSupported() ? `
          <div class="card" style="margin-top: var(--space-4); border-color: var(--color-warning); background: var(--color-warning-muted);">
            <div class="flex items-center gap-3">
              <span>⚠️</span>
              <div>
                <strong style="color: var(--color-warning);">Realtime Audio Not Supported</strong>
                <p class="text-sm" style="margin-top: 4px;">This browser cannot stream microphone audio to Soniox. Please use a current Chrome, Edge, or Safari version.</p>
              </div>
            </div>
          </div>
        ` : ''}
      </div>
    `;
  },

  // BR-25 dropdown, shared by New Meeting and Meeting Detail (T3, T8).
  _meetingTypeOptions(selectedCode) {
    const options = ['<option value="">(chưa chọn)</option>'];
    for (const entry of MEETING_TYPES) {
      options.push(`<option value="${Utils.escapeHtml(entry.code)}" ${entry.code === selectedCode ? 'selected' : ''}>${Utils.escapeHtml(entry.label)}</option>`);
    }
    return options.join('');
  },

  _bindNewMeeting() {
    const translationSelect = document.getElementById('meeting-translation-language');
    const translationHelp = document.getElementById('meeting-translation-help');
    const updateTranslationHelp = () => {
      if (!translationSelect || !translationHelp) return;
      if (!translationSelect.value) {
        translationHelp.textContent = 'Realtime speech-to-text stays on and shows the original words in each detected spoken language.';
        return;
      }
      const targetName = translationSelect.selectedOptions[0]?.textContent?.trim() || translationSelect.value;
      translationHelp.textContent = `Realtime speech-to-text keeps the original transcript and adds a live translation to ${targetName}.`;
    };
    translationSelect?.addEventListener('change', updateTranslationHelp);
    updateTranslationHelp();

    document.getElementById('start-recording-btn')?.addEventListener('click', () => {
      const title = document.getElementById('meeting-title').value.trim() || 'Untitled Meeting';
      const participants = document.getElementById('meeting-participants').value
        .split(',').map(p => p.trim()).filter(Boolean);
      const language = document.getElementById('meeting-language').value;
      const translationLanguage = document.getElementById('meeting-translation-language').value;
      const captureSystemAudio = document.getElementById('setup-system-audio')?.checked || false;
      const meetingType = Storage.normalizeMeetingType(document.getElementById('meeting-type')?.value);
      const topic = Storage.normalizeShortText(document.getElementById('meeting-topic')?.value);
      const leadBy = Storage.normalizeShortText(document.getElementById('meeting-lead-by')?.value);
      const tags = this._initialTagsForMeetingType(meetingType);

      // BR-24: none of these fields ever block Start Recording.
      const meeting = Storage.saveMeeting({
        title,
        participants,
        language,
        translationLanguage,
        captureSystemAudio,
        meetingType,
        topic,
        leadBy,
        tags,
        status: 'draft'
      });

      this._pendingAutoStartMeetingId = meeting.id;
      this.navigate(`recording/${meeting.id}`);
    });

    document.getElementById('save-draft-btn')?.addEventListener('click', () => {
      const title = document.getElementById('meeting-title').value.trim() || 'Untitled Meeting';
      const participants = document.getElementById('meeting-participants').value
        .split(',').map(p => p.trim()).filter(Boolean);
      const language = document.getElementById('meeting-language').value;
      const translationLanguage = document.getElementById('meeting-translation-language').value;
      const meetingType = Storage.normalizeMeetingType(document.getElementById('meeting-type')?.value);
      const topic = Storage.normalizeShortText(document.getElementById('meeting-topic')?.value);
      const leadBy = Storage.normalizeShortText(document.getElementById('meeting-lead-by')?.value);
      const tags = this._initialTagsForMeetingType(meetingType);

      Storage.saveMeeting({ title, participants, language, translationLanguage, meetingType, topic, leadBy, tags, status: 'draft' });
      this.toast('Meeting draft saved', 'success');
      this.navigate('meetings');
      this._updateMeetingsCount();
    });
  },

  // BR-70 applied at meeting-creation time ("lần đầu" meetingType is chosen):
  // New Meeting has no tag editor of its own, so this seeds `tags` with the
  // meetingType's label the same way Meeting Detail's live listener does.
  _initialTagsForMeetingType(meetingType) {
    if (!meetingType) return [];
    const entry = typeof meetingTypeByCode === 'function' ? meetingTypeByCode(meetingType) : null;
    return entry ? [entry.label] : [];
  },

  /* ══════════════════════════════════════════
     VIEW: Recording
     ══════════════════════════════════════════ */

  _eyeIcon(open) {
    return open
      ? '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M1 12s4-7 11-7 11 7 11 7-4 7-11 7-11-7-11-7z"/><circle cx="12" cy="12" r="3"/></svg>'
      : '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M17.94 17.94A10.94 10.94 0 0 1 12 19c-7 0-11-7-11-7a21.8 21.8 0 0 1 5.06-5.94M9.9 4.24A10.94 10.94 0 0 1 12 4c7 0 11 7 11 7a21.8 21.8 0 0 1-2.16 3.19M14.12 14.12a3 3 0 1 1-4.24-4.24"/><line x1="1" y1="1" x2="23" y2="23"/></svg>';
  },

  _renderRecording(meetingId) {
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return this._renderNotFound();

    // Generate waveform bars
    const bars = Array.from({ length: 32 }, () => '<div class="waveform-bar"></div>').join('');

    // Live Transcript / Live Translation are independently hideable (Notes
    // always shows) — a view-only preference remembered across recordings,
    // NOT a pause of the underlying transcription/translation.
    const settings = Storage.getSettings();
    const showTranscript = settings.recordingShowLiveTranscript !== false;
    const showTranslation = settings.recordingShowLiveTranslation !== false;
    const hasTranslation = Boolean(meeting.translationLanguage);
    const initialCols = (showTranscript ? 1 : 0) + (hasTranslation && showTranslation ? 1 : 0) + 1;

    return `
      <div class="view-enter">
        <div class="recording-layout">
          <!-- Top: Meeting info and recording controls -->
          <div class="recording-controls-panel ambient-glow">
            <div class="recording-meeting-info">
              <h2 style="margin-bottom: var(--space-2);">${Utils.escapeHtml(meeting.title)}</h2>
              <p class="text-sm">${meeting.participants.length > 0
                ? meeting.participants.map(participant => Utils.escapeHtml(participant)).join(', ')
                : 'No participants added'}</p>
            </div>

            <div class="recording-live-metrics">
              <div class="timer-display" id="rec-timer">00:00</div>
              <div class="text-xs text-tertiary" id="rec-cost">Soniox estimate: $0.0000</div>
              <div class="waveform-container" id="rec-waveform">
                ${bars}
              </div>
            </div>

            <div class="recording-actions">
              <div class="recording-action-row">
                <button class="btn btn-ghost btn-icon" id="rec-pause" title="Pause" style="display:none;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16" rx="1"/><rect x="14" y="4" width="4" height="16" rx="1"/></svg>
                </button>

                <button class="record-btn" id="rec-toggle" title="Start Recording">
                  <div class="record-inner"></div>
                </button>

                <button class="btn btn-ghost btn-icon" id="rec-resume" title="Resume" style="display:none;">
                  <svg width="24" height="24" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
                </button>

                <button class="btn btn-secondary btn-sm" id="rec-stop" style="display:none;">
                  <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="4" y="4" width="16" height="16" rx="2"/></svg>
                  Stop & Save
                </button>
                <button class="btn btn-ghost btn-sm" id="rec-discard" style="display:none;">
                  Discard
                </button>
              </div>

              <div id="rec-status" class="text-sm text-secondary">
                Press the record button to begin
              </div>
            </div>
          </div>

          <!-- Bottom: Original transcript, optional translation, and live notes -->
          <div class="recording-streams" id="rec-streams" data-cols="${initialCols}">
            <section class="recording-transcript-panel" id="rec-transcript-section" style="${showTranscript ? '' : 'display:none;'}">
              <div class="panel-header">
                <h4 style="font-size: var(--text-sm);">📝 Live Transcript</h4>
                <div class="flex items-center gap-2">
                  <span class="badge badge-primary" id="rec-lang-badge">${Utils.escapeHtml(meeting.language === 'auto' ? 'Auto multilingual' : (meeting.language || 'vi-VN'))}</span>
                  <button class="btn btn-ghost btn-icon btn-sm" id="rec-transcript-visibility-toggle" title="${showTranscript ? 'Hide' : 'Show'} Live Transcript">${this._eyeIcon(showTranscript)}</button>
                </div>
              </div>
              <div class="panel-body" id="rec-transcript-body">
                <div class="empty-state" id="rec-transcript-empty" style="padding: var(--space-8);">
                  <div class="empty-icon" style="width: 56px; height: 56px; font-size: 1.4rem;">💬</div>
                  <p class="text-sm">Original speech will appear here in real-time...</p>
                </div>
                <div id="rec-transcript-list" style="display:none;"></div>
              </div>
            </section>

            ${hasTranslation ? `
              <section class="recording-transcript-panel" id="rec-translation-section" style="${showTranslation ? '' : 'display:none;'}">
                <div class="panel-header">
                  <h4 style="font-size: var(--text-sm);">🌐 Live Translation</h4>
                  <div class="flex items-center gap-2">
                    <span class="badge badge-success">→ ${Utils.escapeHtml(meeting.translationLanguage)}</span>
                    <button class="btn btn-ghost btn-icon btn-sm" id="rec-translation-visibility-toggle" title="${showTranslation ? 'Hide' : 'Show'} Live Translation">${this._eyeIcon(showTranslation)}</button>
                  </div>
                </div>
                <div class="panel-body" id="rec-translation-body">
                  <div class="empty-state" id="rec-translation-empty" style="padding: var(--space-8);">
                    <div class="empty-icon" style="width: 56px; height: 56px; font-size: 1.4rem;">🌐</div>
                    <p class="text-sm">Translated speech will appear here in real-time...</p>
                  </div>
                  <div id="rec-translation-list" style="display:none;"></div>
                </div>
              </section>
            ` : ''}

            <section class="recording-transcript-panel recording-notes-panel" id="rec-notes-section">
              <div class="panel-header">
                <h4 style="font-size: var(--text-sm);">🗒️ Notes</h4>
                <span class="text-xs text-tertiary" id="rec-notes-status">Autosaves as you type</span>
              </div>
              <div class="panel-body recording-notes-body">
                <textarea class="input recording-notes-textarea" id="rec-notes-textarea" placeholder="Jot down anything worth remembering while the meeting is happening...">${Utils.escapeHtml(meeting.notes || '')}</textarea>
              </div>
            </section>
          </div>
        </div>
      </div>
    `;
  },

  _bindRecording(meetingId) {
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return;

    const toggleBtn = document.getElementById('rec-toggle');
    const pauseBtn = document.getElementById('rec-pause');
    const resumeBtn = document.getElementById('rec-resume');
    const stopBtn = document.getElementById('rec-stop');
    const discardBtn = document.getElementById('rec-discard');
    const timerEl = document.getElementById('rec-timer');
    const costEl = document.getElementById('rec-cost');
    const statusEl = document.getElementById('rec-status');
    const waveformEl = document.getElementById('rec-waveform');
    const transcriptBody = document.getElementById('rec-transcript-body');
    const transcriptList = document.getElementById('rec-transcript-list');
    const transcriptEmpty = document.getElementById('rec-transcript-empty');
    const translationBody = document.getElementById('rec-translation-body');
    const translationEmpty = document.getElementById('rec-translation-empty');
    const translationList = document.getElementById('rec-translation-list');
    const notesTextarea = document.getElementById('rec-notes-textarea');
    const notesStatus = document.getElementById('rec-notes-status');

    // Live Transcript / Live Translation visibility toggles — view-only, does
    // NOT pause Recorder/Transcriber; segments keep arriving into the hidden
    // panel's DOM so nothing is lost when it's shown again.
    const streamsEl = document.getElementById('rec-streams');
    const transcriptSection = document.getElementById('rec-transcript-section');
    const translationSection = document.getElementById('rec-translation-section');
    const notesSection = document.getElementById('rec-notes-section');
    const transcriptVisToggle = document.getElementById('rec-transcript-visibility-toggle');
    const translationVisToggle = document.getElementById('rec-translation-visibility-toggle');

    const updateStreamsLayout = () => {
      if (!streamsEl) return;
      const visibleCount = [transcriptSection, translationSection, notesSection]
        .filter(section => section && section.style.display !== 'none')
        .length;
      streamsEl.dataset.cols = String(visibleCount || 1);
    };

    const bindVisibilityToggle = (button, section, panelBody, settingKey, label) => {
      if (!button || !section) return;
      button.addEventListener('click', () => {
        const nextVisible = section.style.display === 'none';
        section.style.display = nextVisible ? '' : 'none';
        button.title = `${nextVisible ? 'Hide' : 'Show'} ${label}`;
        button.innerHTML = this._eyeIcon(nextVisible);
        Storage.saveSettings({ [settingKey]: nextVisible });
        updateStreamsLayout();
        // Segments kept arriving while hidden (scrollTop was a no-op on a
        // display:none panel) — catch the view up now that it's visible again.
        if (nextVisible && panelBody) panelBody.scrollTop = panelBody.scrollHeight;
      });
    };
    bindVisibilityToggle(transcriptVisToggle, transcriptSection, transcriptBody, 'recordingShowLiveTranscript', 'Live Transcript');
    bindVisibilityToggle(translationVisToggle, translationSection, translationBody, 'recordingShowLiveTranslation', 'Live Translation');
    updateStreamsLayout();

    this._transcriptSegments = [...(meeting.transcript || [])];
    this._translationSegments = [...(meeting.translations || [])];
    this._interimText = '';
    let isRecordingActive = false;
    let isRecordingStarting = false;

    const updateWaveform = (data) => {
      const bars = waveformEl.querySelectorAll('.waveform-bar');
      const step = Math.floor(data.length / bars.length);
      bars.forEach((bar, i) => {
        const val = data[i * step] || 0;
        const height = Math.max(4, (val / 255) * 40);
        bar.style.height = `${height}px`;
        bar.style.background = val > 100 ? 'var(--accent-secondary)' : 'var(--accent-primary)';
      });
    };

    const resetWaveform = () => {
      waveformEl.querySelectorAll('.waveform-bar').forEach(bar => {
        bar.style.height = '4px';
        bar.style.background = 'var(--accent-primary)';
      });
    };

    const addTranscriptSegment = (channel, text, time, speaker, language) => {
      const isTranslation = channel === 'translation';
      const segments = isTranslation ? this._translationSegments : this._transcriptSegments;
      const list = isTranslation ? translationList : transcriptList;
      if (!list) return;
      segments.push({
        text,
        time,
        speaker: speaker ? `Speaker ${speaker}` : (isTranslation ? '' : 'Speaker'),
        language: language || ''
      });

      if (isTranslation) {
        if (translationEmpty) translationEmpty.style.display = 'none';
        if (translationList) translationList.style.display = 'block';
      } else {
        transcriptEmpty.style.display = 'none';
        transcriptList.style.display = 'block';
      }

      const block = document.createElement('div');
      block.className = 'transcript-block';
      block.innerHTML = `
        <span class="transcript-time">${Utils.formatTimestamp(time)}</span>
        <div>
          <div class="transcript-speaker">${Utils.escapeHtml(
            speaker ? `Speaker ${speaker}` : (isTranslation ? 'Translation' : 'Speaker')
          )}</div>
          <div class="transcript-text">${Utils.escapeHtml(text)}</div>
        </div>
      `;
      list.appendChild(block);

      // Auto-scroll
      const panelBody = isTranslation ? translationBody : transcriptBody;
      if (!panelBody) return;
      panelBody.scrollTop = panelBody.scrollHeight;
    };

    const updateInterim = (channel, text) => {
      const isTranslation = channel === 'translation';
      const list = isTranslation ? translationList : transcriptList;
      if (!list) return;
      let interimEl = document.getElementById(`rec-interim-${channel}`);
      if (!interimEl) {
        interimEl = document.createElement('div');
        interimEl.id = `rec-interim-${channel}`;
        interimEl.className = 'transcript-block';
        interimEl.style.opacity = '0.5';
        list.appendChild(interimEl);
        if (isTranslation) {
          if (translationEmpty) translationEmpty.style.display = 'none';
          if (translationList) translationList.style.display = 'block';
        } else {
          transcriptEmpty.style.display = 'none';
          transcriptList.style.display = 'block';
        }
      }
      interimEl.innerHTML = `
        <span class="transcript-time" style="color: var(--accent-secondary);">...</span>
        <div>
          <div class="transcript-text" style="color: var(--text-secondary); font-style: italic;">${Utils.escapeHtml(text)}</div>
        </div>
      `;
      const panelBody = isTranslation ? translationBody : transcriptBody;
      if (!panelBody) return;
      panelBody.scrollTop = panelBody.scrollHeight;
    };

    const removeInterim = (channel) => {
      if (channel) document.getElementById(`rec-interim-${channel}`)?.remove();
      else {
        document.getElementById('rec-interim-original')?.remove();
        document.getElementById('rec-interim-translation')?.remove();
      }
    };

    // Live notes — autosave while the meeting is happening (separate from the
    // post-meeting Notes tab, but the same `meeting.notes` field / BR-63 flow).
    let notesSaveTimer = null;
    const saveNotes = () => {
      if (!notesTextarea) return;
      const m = Storage.getMeeting(meetingId);
      if (!m) return;
      m.notes = notesTextarea.value;
      Storage.saveMeeting(m);
      if (notesStatus) notesStatus.textContent = `Saved · ${Utils.formatTimestamp(Recorder.getElapsedSeconds())}`;
    };
    if (notesTextarea) {
      notesTextarea.addEventListener('input', () => {
        if (notesStatus) notesStatus.textContent = 'Saving…';
        clearTimeout(notesSaveTimer);
        notesSaveTimer = setTimeout(saveNotes, 600);
      });
      notesTextarea.addEventListener('blur', () => {
        clearTimeout(notesSaveTimer);
        saveNotes();
      });
    }

    // Recorder callbacks
    Recorder.onTick = (seconds) => {
      timerEl.textContent = Utils.formatDuration(seconds);
      costEl.textContent = `Soniox estimate: ${this._formatUsd(this._estimateSonioxCost(seconds))}`;
    };

    Recorder.onWaveform = (data) => {
      updateWaveform(data);
    };

    Recorder.onStop = null;
    Recorder.onChunk = chunk => Transcriber.sendAudio(chunk);

    // Transcriber callbacks
    Transcriber.onResult = (result) => {
      if (result.isFinal) {
        removeInterim(result.channel);
        addTranscriptSegment(
          result.channel,
          result.text,
          result.timestamp || Recorder.getElapsedSeconds(),
          result.speaker,
          result.language
        );

        // Auto-save transcript periodically
        const m = Storage.getMeeting(meetingId);
        if (m) {
          m.transcript = [...this._transcriptSegments];
          m.translations = [...this._translationSegments];
          Storage.saveMeeting(m);
        }
      } else {
        updateInterim(result.channel, result.text);
      }
    };

    // Mirrors Transcriber._resolveBackend(): only Deepgram has its own live
    // backend, every other provider records live through Soniox.
    const _liveProviderName = this._sttProviderName(
      Storage.getSettings?.().sttProvider === 'deepgram' ? 'deepgram' : 'soniox'
    );

    Transcriber.onStatusChange = (status) => {
      if (status === 'connecting') {
        statusEl.innerHTML = `<span class="badge badge-warning">Connecting to ${_liveProviderName}…</span>`;
      } else if (status === 'listening') {
        statusEl.innerHTML = `<span class="badge badge-recording">● Recording · ${_activeAudioMode} · ${_liveProviderName} live</span>`;
      } else if (status === 'error') {
        statusEl.innerHTML = `<span class="badge badge-warning">Recording audio (${_activeAudioMode}) · transcription unavailable</span>`;
      }
    };
    Transcriber.onError = error => {
      this.toast(error.message || `${_liveProviderName} transcription failed`, 'error');
    };

    // Toggle recording
    let _activeAudioMode = 'Mic';

    const startRecording = async () => {
      if (!isRecordingActive && !isRecordingStarting) {
        isRecordingStarting = true;
        toggleBtn.disabled = true;
        this._pendingAutoStartMeetingId = null;

        const wantSystemAudio = meeting.captureSystemAudio || false;
        statusEl.innerHTML = wantSystemAudio
          ? '<span class="badge badge-warning">Starting microphone + system audio…</span>'
          : '<span class="badge badge-warning">Starting microphone…</span>';

        // Handle system audio share being stopped mid-recording
        Recorder.onSystemAudioLost = () => {
          _activeAudioMode = 'Mic';
          this.toast('System audio share was stopped. Continuing with microphone only.', 'warning');
          statusEl.innerHTML = `<span class="badge badge-recording">● Recording · Mic only · ${_liveProviderName} live</span>`;
        };

        // System audio track was captured but stayed silent — user likely
        // shared the wrong tab or the source is muted. Warn only; recording continues.
        Recorder.onSystemAudioSilent = () => {
          this.toast('Không phát hiện âm thanh hệ thống (system audio) — kiểm tra bạn đã chọn đúng tab đang chạy cuộc họp, hoặc âm thanh đang bị tắt tiếng.', 'warning');
        };

        // Start recorder with optional system audio
        const started = await Recorder.start({ captureSystemAudio: wantSystemAudio });
        if (!started) {
          isRecordingStarting = false;
          toggleBtn.disabled = false;
          this.toast('Could not access microphone. Please allow microphone access.', 'error');
          return;
        }

        const activeMeeting = Storage.getMeeting(meetingId);
        if (activeMeeting) {
          activeMeeting.status = 'recording';
          Storage.saveMeeting(activeMeeting);
        }

        const hasSystemAudio = Recorder.hasSystemAudio;
        _activeAudioMode = hasSystemAudio ? 'Mic + System Audio' : 'Mic';

        // Notify user about system audio status
        if (wantSystemAudio && hasSystemAudio) {
          this.toast('✅ System audio captured! Both mic and remote audio are being recorded.', 'success');
        } else if (wantSystemAudio && !hasSystemAudio) {
          this.toast('System audio was not captured (cancelled or unsupported). Recording mic only.', 'warning');
        }

        const transcriptionStarted = await Transcriber.start({
          meetingId,
          title: meeting.title,
          participants: meeting.participants,
          language: meeting.language || 'vi-VN',
          translationLanguage: meeting.translationLanguage || ''
        });

        if (transcriptionStarted) {
          const usageMeeting = Storage.getMeeting(meetingId);
          if (usageMeeting) {
            // Mirror Transcriber._resolveBackend(): only Deepgram has its own
            // live backend, every other provider records live through Soniox.
            const liveProvider = Storage.getSettings?.().sttProvider === 'deepgram' ? 'deepgram' : 'soniox';
            const isSoniox = liveProvider === 'soniox';
            usageMeeting.sonioxUsage = {
              provider: liveProvider,
              model: isSoniox ? 'stt-rt-v5' : (Storage.getSettings?.().sttModels?.deepgram || 'nova-3'),
              startedAt: new Date().toISOString(),
              // Deepgram's live pricing isn't wired up here yet, so leave cost
              // fields out rather than showing a fabricated number.
              ...(isSoniox ? { pricingUsdPerHour: this.SONIOX_REALTIME_USD_PER_HOUR, estimatedCostUsd: 0 } : {}),
              translationEnabled: Boolean(meeting.translationLanguage)
            };
            Storage.saveMeeting(usageMeeting);
          }
        }

        isRecordingActive = true;
        isRecordingStarting = false;
        this._activeRecordingMeetingId = meetingId;
        toggleBtn.classList.add('recording');
        toggleBtn.title = 'Recording...';
        pauseBtn.style.display = 'flex';
        stopBtn.style.display = 'flex';
        discardBtn.style.display = 'flex';
        timerEl.classList.add('recording');

        statusEl.innerHTML = transcriptionStarted
          ? `<span class="badge badge-recording">● Recording · ${_activeAudioMode} · ${_liveProviderName} live</span>`
          : `<span class="badge badge-warning">Recording audio (${_activeAudioMode}) · transcription unavailable</span>`;
      }
    };
    toggleBtn.addEventListener('click', startRecording);
    if (this._pendingAutoStartMeetingId === meetingId) startRecording();

    // Pause
    pauseBtn.addEventListener('click', () => {
      Recorder.pause();
      Transcriber.pause();
      toggleBtn.classList.remove('recording');
      pauseBtn.style.display = 'none';
      resumeBtn.style.display = 'flex';
      timerEl.classList.remove('recording');
      statusEl.innerHTML = '<span class="badge badge-warning">⏸ Paused</span>';
      resetWaveform();
    });

    // Resume
    resumeBtn.addEventListener('click', () => {
      Recorder.resume();
      Transcriber.resume();
      toggleBtn.classList.add('recording');
      resumeBtn.style.display = 'none';
      pauseBtn.style.display = 'flex';
      timerEl.classList.add('recording');
      statusEl.innerHTML = '<span class="badge badge-recording">● Recording</span>';
    });

    // Stop & Save
    stopBtn.addEventListener('click', async () => {
      stopBtn.disabled = true;
      stopBtn.textContent = 'Saving…';
      removeInterim();
      isRecordingActive = false;
      clearTimeout(notesSaveTimer);
      saveNotes();

      const saved = await this._saveActiveRecording(meetingId);
      if (!saved) {
        stopBtn.disabled = false;
        stopBtn.textContent = 'Stop & Save';
        return;
      }

      this.toast('Meeting saved successfully!', 'success');
      this.navigate(`meeting/${meetingId}`, { force: true });
    });

    // Discard
    discardBtn.addEventListener('click', () => {
      this.showModal(`
        <div class="modal-header">
          <h3>Discard Recording?</h3>
          <button class="btn btn-ghost btn-icon" onclick="App.closeModal()">✕</button>
        </div>
        <p class="text-sm text-secondary">This will stop the recording and delete all data. This action cannot be undone.</p>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-danger" id="confirm-discard">Discard</button>
        </div>
      `);

      document.getElementById('confirm-discard').addEventListener('click', async () => {
        const confirmButton = document.getElementById('confirm-discard');
        confirmButton.disabled = true;
        confirmButton.textContent = 'Discarding…';
        isRecordingActive = false;
        await this._discardActiveRecording(meetingId);
        this.closeModal();
        this.toast('Recording discarded', 'warning');
        this.navigate('dashboard', { force: true });
      });
    });
  },

  /* ══════════════════════════════════════════
     VIEW: Meeting Detail
     ══════════════════════════════════════════ */

  _renderMeetingDetail(meetingId) {
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return this._renderNotFound();

    const statusBadge = {
      completed: '<span class="badge badge-success">Completed</span>',
      recording: '<span class="badge badge-recording">● Recording</span>',
      interrupted: '<span class="badge badge-warning">Interrupted</span>',
      processing: '<span class="badge badge-warning">Processing audio…</span>',
      failed: '<span class="badge badge-warning">Processing failed</span>',
      draft: '<span class="badge badge-primary">Draft</span>'
    }[meeting.status] || '';

    const participantChips = meeting.participants.map(p =>
      `<span class="chip">${Utils.escapeHtml(p)}</span>`
    ).join('');

    // A segment with `.kind` (part-divider/part-gap, TV12/§V4.3) is never
    // contenteditable and renders in its own style so it can't be mistaken
    // for real meeting content (UX §7 `.transcript-gap`). A plain segment
    // (every segment of a single-part meeting) renders EXACTLY as before —
    // test hồi quy for the "1 part = unchanged" acceptance criterion.
    const transcriptHtml = (meeting.transcript || []).map((seg, i) => {
      if (seg.kind === 'part-divider') {
        return `<div class="transcript-part-divider" data-index="${i}">${Utils.escapeHtml(seg.text)}</div>`;
      }
      if (seg.kind === 'part-gap') {
        return `<div class="transcript-gap" data-index="${i}">${Utils.escapeHtml(seg.text)}</div>`;
      }
      return `
      <div class="transcript-block" data-index="${i}">
        <span class="transcript-time">${Utils.formatTimestamp(seg.time)}</span>
        <div class="flex-1">
          <div class="transcript-speaker" data-speaker-seg-index="${i}" title="Click to rename this speaker" style="cursor:pointer;">${Utils.escapeHtml(seg.speaker || 'Speaker')}</div>
          <div class="transcript-text" contenteditable="true" data-seg-index="${i}">${Utils.escapeHtml(seg.text)}</div>
        </div>
      </div>
    `;
    }).join('') || '<div class="empty-state" style="padding:var(--space-8);"><p class="text-sm">No transcript recorded.</p></div>';
    const translationHtml = (meeting.translations || []).map(seg => `
      <div class="transcript-block">
        <span class="transcript-time">${Utils.formatTimestamp(seg.time)}</span>
        <div class="flex-1">
          <div class="transcript-speaker">${Utils.escapeHtml(seg.language || meeting.translationLanguage || 'Translation')}</div>
          <div class="transcript-text">${Utils.escapeHtml(seg.text)}</div>
        </div>
      </div>
    `).join('') || '<div class="empty-state" style="padding:var(--space-8);"><p class="text-sm">No translated transcript recorded.</p></div>';

    const actionItemsHtml = (meeting.actionItems || []).map(item => `
      <label class="checkbox ${item.done ? 'checked' : ''}" data-action-id="${Utils.escapeHtml(item.id)}">
        <input type="checkbox" ${item.done ? 'checked' : ''}>
        <span class="checkbox-label">${Utils.escapeHtml(item.text)}</span>
        ${item.assignee ? `<span class="chip" style="margin-left: auto;">${Utils.escapeHtml(item.assignee)}</span>` : ''}
        ${item.dueDate ? `<span class="chip"${item.assignee ? '' : ' style="margin-left: auto;"'}>${Utils.escapeHtml(item.dueDate)}</span>` : ''}
        <button class="btn btn-ghost btn-icon btn-sm action-delete" data-action-id="${Utils.escapeHtml(item.id)}" title="Delete" style="margin-left:var(--space-2);">
          <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="18" y1="6" x2="6" y2="18"/><line x1="6" y1="6" x2="18" y2="18"/></svg>
        </button>
      </label>
    `).join('') || '';

    // TV12/V11#22: a merged recording has no single combined audio file
    // (Out of Scope, BR-134) — capabilities.singleAudioPlayback is false, so
    // this renders a playlist of the individual part files instead of the
    // single-file player.
    const caps = Parts.meetingCapabilities(meeting);
    const audioPlayerHtml = caps.singleAudioPlayback && (meeting.audioId || meeting.audioBlob) ? `
      <div class="audio-player" style="margin-bottom: var(--space-6);">
        <button class="play-btn" id="detail-play">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>
        </button>
        <div class="progress-bar" id="detail-progress">
          <div class="progress-fill" id="detail-progress-fill" style="width:0%"></div>
        </div>
        <span class="audio-time" id="detail-audio-time">0:00</span>
      </div>
    ` : (caps.multiPart ? this._renderPartsPlaybackCard(meeting) : '');

    const multiPartSectionHtml = caps.multiPart ? this._renderMultiPartSection(meeting) : '';
    const qualityWarningHtml = this._renderQualityWarning(meeting, caps);

    return `
      <div class="view-enter">
        <!-- Header -->
        <div class="meeting-detail-header">
          <div class="meeting-detail-info">
            <div class="flex items-center gap-3" style="margin-bottom: var(--space-2);">
              <h1 id="detail-title" style="cursor:text;" title="Click to edit">${Utils.escapeHtml(meeting.title)}</h1>
              <button class="btn btn-ghost btn-icon btn-sm" id="detail-title-edit" type="button" title="Edit meeting title" aria-label="Edit meeting title">
                <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
              </button>
              ${statusBadge}
              ${meeting.source === 'import' ? '<span class="badge badge-primary" title="Bản ghi nhập từ file ghi âm ngoài">Nhập từ file</span>' : ''}
              ${caps.multiPart && (meeting.missingParts || []).length > 0 ? `<span class="badge badge-warning">Thiếu ${(meeting.missingParts || []).length} phần</span>` : ''}
            </div>
            <div class="meeting-detail-meta">
              <span>📅 ${Utils.formatDate(meeting.date)}${this._dateVsCreatedAtHint(meeting) ? ` · <span class="text-tertiary" style="font-size:0.85em;">${Utils.escapeHtml(this._dateVsCreatedAtHint(meeting))}</span>` : ''}</span>
              <span>⏱️ ${Utils.formatDurationHuman(meeting.duration)}${meeting.durationEstimated ? ' (ước lượng)' : ''}</span>
              ${meeting.sonioxUsage?.startedAt ? (() => {
                const usage = meeting.sonioxUsage;
                const providerName = this._sttProviderName(usage.provider || 'soniox');
                const cost = typeof usage.estimatedCostUsd === 'number' && Number.isFinite(usage.estimatedCostUsd)
                  ? ` · ${this._formatUsd(usage.estimatedCostUsd)}`
                  : '';
                return `<span>🎙️ ${Utils.escapeHtml(providerName)}${cost}</span>`;
              })() : ''}
              ${meeting.participants.length > 0 ? `<span>👥 ${meeting.participants.length} participants</span>` : ''}
            </div>
            ${participantChips ? `<div class="flex flex-wrap gap-2" style="margin-top: var(--space-3);">${participantChips}</div>` : ''}
          </div>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm" id="detail-export-md" title="Export Markdown">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export
            </button>
            <button class="btn btn-danger btn-sm" id="detail-delete" title="Delete Meeting">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/><path d="M10 11v6M14 11v6"/></svg>
            </button>
          </div>
        </div>

        ${meeting.processingError ? `
          <div class="card" style="margin-bottom:var(--space-6); border-color:var(--color-warning); background:var(--color-warning-muted);">
            <strong style="color:var(--color-warning);">Audio processing failed</strong>
            <p class="text-sm" style="margin-top:var(--space-2);">${Utils.escapeHtml(meeting.processingError)}</p>
            <p class="text-xs text-tertiary" style="margin-top:var(--space-2);">The original audio is still stored locally and can be played below.</p>
          </div>
        ` : ''}

        ${multiPartSectionHtml}
        ${qualityWarningHtml}
        ${audioPlayerHtml}

        ${(!meeting.audioId && (meeting.transcript || []).length === 0 && !caps.multiPart) ? `
          <div class="card" style="margin-bottom: var(--space-6);">
            <div class="flex justify-between items-center">
              <div>
                <strong>Chưa có file ghi âm</strong>
                <p class="text-sm text-tertiary" style="margin-top:2px;">Bản ghi này chưa có audio — gắn file ghi âm vào đây khi bạn đi họp về, ngữ cảnh đã điền vẫn được giữ nguyên.</p>
              </div>
              <button class="btn btn-secondary btn-sm" id="attach-recording">Gắn file ghi âm</button>
            </div>
          </div>
        ` : ''}

        <!-- Pre-meeting info (BR-23, BR-24, T3; date+participants: BR-144, T13) -->
        <div class="card" style="margin-bottom: var(--space-6);">
          <div class="flex justify-between items-center" style="margin-bottom: var(--space-4);">
            <h4 style="margin:0;">Pre-meeting info</h4>
            <button class="btn btn-primary btn-sm" id="save-premeeting">Save</button>
          </div>
          ${this._preMeetingStaleHint(meeting)}
          <div class="flex flex-col gap-3">
            <div class="input-group">
              <label for="detail-date">Ngày giờ họp</label>
              ${this._dateEditorHtml(meeting)}
              ${this._dateVsCreatedAtHint(meeting) ? `<span class="text-xs text-tertiary">${Utils.escapeHtml(this._dateVsCreatedAtHint(meeting))}</span>` : ''}
            </div>
            <div class="input-group">
              <label>Người tham dự</label>
              <div class="tag-chip-row" id="detail-participants-list">${this._renderParticipantChips(meeting.participants || [])}</div>
              <div style="position:relative;">
                <input type="text" class="input" id="detail-participant-input" placeholder="Nhập tên rồi bấm Enter" autocomplete="off">
              </div>
            </div>
            <div class="input-group">
              <label for="detail-meeting-type">Meeting type</label>
              <select class="input" id="detail-meeting-type">
                ${this._meetingTypeOptions(meeting.meetingType || '')}
              </select>
            </div>
            <div class="input-group">
              <label for="detail-topic">Topic</label>
              <input type="text" class="input" id="detail-topic" maxlength="200" value="${Utils.escapeHtml(meeting.topic || '')}">
            </div>
            <div class="input-group">
              <label for="detail-lead-by">Led by</label>
              <input type="text" class="input" id="detail-lead-by" maxlength="200" value="${Utils.escapeHtml(meeting.leadBy || '')}">
            </div>
            <div class="input-group">
              <label for="detail-tag-input">Tags</label>
              <div class="tag-chip-row" id="detail-tags-list">${this._renderTagChips(meeting.tags || [], { removable: true })}</div>
              <div style="position:relative;">
                <input type="text" class="input" id="detail-tag-input" maxlength="30" placeholder="Nhập tag rồi bấm Enter" autocomplete="off">
                <div class="tag-suggestions" id="detail-tag-suggestions" style="display:none;"></div>
              </div>
            </div>
          </div>
          <p class="text-xs text-tertiary" id="lead-by-suggestion" style="margin-top: var(--space-2);"></p>
        </div>

        <!-- Tabs -->
        <div class="tabs" style="margin-bottom: var(--space-6);">
          <button class="tab active" data-tab="transcript">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><line x1="16" y1="13" x2="8" y2="13"/><line x1="16" y1="17" x2="8" y2="17"/></svg>
            Transcript
          </button>
          <button class="tab" data-tab="summary">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Summary
          </button>
          ${meeting.translationLanguage ? `
            <button class="tab" data-tab="translation">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M5 8l6 6"/><path d="M4 14l6-6 2-3"/><path d="M2 5h12"/><path d="M7 2h1"/><path d="M22 22l-5-10-5 10"/><path d="M14 18h6"/></svg>
              Translation
            </button>
          ` : ''}
          <button class="tab" data-tab="actions">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M22 11.08V12a10 10 0 1 1-5.93-9.14"/><polyline points="22 4 12 14.01 9 11.01"/></svg>
            Actions <span class="text-xs text-tertiary" style="margin-left:4px;">${(meeting.actionItems||[]).length}</span>
          </button>
          <button class="tab" data-tab="notes">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M11 4H4a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2v-7"/><path d="M18.5 2.5a2.121 2.121 0 0 1 3 3L12 15l-4 1 1-4 9.5-9.5z"/></svg>
            Notes
          </button>
        </div>

        <!-- Tab Content -->
        <div class="meeting-detail-content">
          <div class="tab-content active" id="tab-transcript">
            <div class="flex justify-between items-center" style="margin-bottom: var(--space-4);">
              <span class="text-sm text-secondary">${(meeting.transcript || []).length} segments</span>
              <button class="btn btn-ghost btn-sm" id="copy-transcript">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2" ry="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                Copy All
              </button>
            </div>
            ${transcriptHtml}
          </div>

          <div class="tab-content" id="tab-summary">
            <div class="flex justify-between items-center" style="margin-bottom: var(--space-2); gap: var(--space-2); flex-wrap: wrap;">
              <span class="text-sm text-secondary">AI-generated summary</span>
              <div class="flex gap-2" style="align-items:center; flex-wrap: wrap;">
                <select class="input input-sm" id="summary-preset" style="width: auto;" title="Summary preset">
                  <option value="">Loading presets…</option>
                </select>
                <span class="text-xs text-tertiary" id="summary-preset-suggestion"></span>
                <select class="input input-sm" id="summary-language" style="width: auto;" title="Summary language">
                  ${this._summaryLanguageOptions()}
                </select>
                <select class="input input-sm" id="summary-provider" style="width: auto;">
                  ${this._summaryProviderOptions()}
                </select>
                <button class="btn btn-secondary btn-sm" id="copy-summary" ${meeting.summary ? '' : 'disabled'}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="9" y="9" width="13" height="13" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/></svg>
                  Copy
                </button>
                <button class="btn btn-primary btn-sm" id="generate-summary" ${this._anyPartRunning(meeting) ? 'disabled title="Chờ đủ các phần rồi hãy tạo tóm tắt — tóm tắt trên transcript còn thiếu sẽ bỏ sót nội dung."' : ''}>
                  <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg>
                  ${meeting.summary ? 'Regenerate' : 'Generate Summary'}
                </button>
              </div>
            </div>
            <p class="text-xs text-tertiary" id="summary-provenance" style="margin-bottom: var(--space-1);">${this._summaryProvenance(meeting)}</p>
            <p class="text-xs" id="summary-preset-badge" style="margin-bottom: var(--space-4);"></p>
            <div class="card" id="summary-content" style="line-height: var(--leading-relaxed);">
              ${this._renderSummaryContent(meeting)}
            </div>
          </div>

          ${meeting.translationLanguage ? `
            <div class="tab-content" id="tab-translation">
              <div class="flex justify-between items-center" style="margin-bottom: var(--space-4);">
                <span class="text-sm text-secondary">${(meeting.translations || []).length} translated segments · ${Utils.escapeHtml(meeting.translationLanguage)}</span>
              </div>
              ${translationHtml}
            </div>
          ` : ''}

          <div class="tab-content" id="tab-actions">
            <div class="flex justify-between items-center" style="margin-bottom: var(--space-4);">
              <span class="text-sm text-secondary">${(meeting.actionItems||[]).filter(a=>!a.done).length} pending</span>
              <button class="btn btn-secondary btn-sm" id="add-action">
                <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
                Add Item
              </button>
            </div>
            <div class="card flex flex-col gap-3" id="action-items-list">
              ${actionItemsHtml || '<span class="text-tertiary text-sm">No action items yet.</span>'}
            </div>
          </div>

          <div class="tab-content" id="tab-notes">
            <textarea class="input" id="meeting-notes" style="min-height: 300px; width: 100%;" placeholder="Add your notes here...">${Utils.escapeHtml(meeting.notes || '')}</textarea>
            <button class="btn btn-primary btn-sm" id="save-notes" style="margin-top: var(--space-4);">Save Notes</button>
          </div>
        </div>
      </div>
    `;
  },

  // TV18 (BR-121/Q9) — the per-part playback list doubles as the UI for
  // "sắp xếp lại sau khi đã transcribe" (▲▼, gated on no part still
  // queued/processing so a job in flight never gets its part moved under
  // it) and is where "+ Thêm phần" (Q9) lives, since both act on this same
  // list of parts.
  _renderPartsPlaybackCard(meeting) {
    const parts = [...(meeting.parts || [])].sort((a, b) => a.order - b.order);
    const canReorder = meeting.status !== 'processing' && parts.length > 1;
    const rows = parts.map((part, i) => `
      <div class="flex items-center gap-3">
        <span class="text-xs text-tertiary" style="min-width:60px;">Phần ${part.order}</span>
        ${part.status === 'completed' || part.status === 'failed' || part.status === 'dropped'
          ? `<audio controls preload="none" style="flex:1; height:32px;" src="/api/audio/${encodeURIComponent(part.partId)}"></audio>`
          : `<span class="text-xs text-tertiary" style="flex:1;">Chưa có audio để phát lại</span>`}
        ${canReorder ? `
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="part-move-up" data-part="${part.partId}" ${i === 0 ? 'disabled' : ''} title="Chuyển lên">▲</button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="part-move-down" data-part="${part.partId}" ${i === parts.length - 1 ? 'disabled' : ''} title="Chuyển xuống">▼</button>
        ` : ''}
      </div>
    `).join('');
    return `
      <div class="card" style="margin-bottom: var(--space-6);">
        <div class="flex justify-between items-center" style="margin-bottom:var(--space-3);">
          <p class="text-sm text-secondary" style="margin:0;">Nghe lại từng phần</p>
          ${meeting.status !== 'processing' ? '<button class="btn btn-secondary btn-sm" id="add-part">+ Thêm phần</button>' : ''}
        </div>
        <div class="flex flex-col gap-2">${rows}</div>
      </div>
    `;
  },

  // TV12 — progress card (still running) or error card (has a failed/dropped
  // part), per Architecture §V13/BR-101/106/128/129/132..136. Never a fake
  // percentage bar (BR-101) — only a "N/M phần xong" count + elapsed time.
  _renderMultiPartSection(meeting) {
    const parts = meeting.parts || [];
    const total = parts.length;
    const done = parts.filter(p => p.status === 'completed' || p.status === 'failed' || p.status === 'dropped').length;
    const startedAt = parts.reduce((min, p) => (p.addedAt && (!min || p.addedAt < min)) ? p.addedAt : min, null);
    const elapsedMin = startedAt ? Math.max(0, Math.round((Date.now() - new Date(startedAt).getTime()) / 60000)) : 0;

    const progressCard = meeting.status === 'processing' ? `
      <div class="card" style="margin-bottom: var(--space-6);">
        <div class="flex items-center gap-3">
          <span class="spinner"></span>
          <div>
            <strong>Đang tạo transcript cho bản ghi của bạn</strong>
            <p class="text-sm text-tertiary" style="margin-top:2px;">${done}/${total} phần xong · đã ${elapsedMin} phút</p>
          </div>
        </div>
      </div>
    ` : '';

    const failedOrDropped = parts.filter(p => p.status === 'failed');
    // BR-104/136: Parts.partErrorCopy (js/parts.js) decides title/detail as
    // plain text (BUG-001 fix — no speech detected reads in Vietnamese, not
    // the provider's raw English message); escaping is this renderer's job,
    // same convention as the rest of js/app.js.
    const errorCards = failedOrDropped.map(part => {
      const copy = Parts.partErrorCopy(part);
      return `
        <div class="card" style="margin-bottom: var(--space-4); border-color: var(--color-warning); background: var(--color-warning-muted);" data-part-error="${part.partId}">
          <strong style="color: var(--color-warning);">${Utils.escapeHtml(copy.title)}</strong>
          ${copy.detail ? `<p class="text-xs text-tertiary" style="margin-top:var(--space-2);">${Utils.escapeHtml(copy.detail)}</p>` : ''}
          <div class="flex gap-2" style="margin-top:var(--space-3);">
            <button class="btn btn-secondary btn-sm" data-action="retry-part" data-part="${part.partId}">Thử lại</button>
            <button class="btn btn-secondary btn-sm" data-action="retry-part-other-provider" data-part="${part.partId}">Thử nhà cung cấp khác</button>
            <button class="btn btn-ghost btn-sm" data-action="drop-part" data-part="${part.partId}">Bỏ phần ${part.order} khỏi bản ghi này</button>
          </div>
        </div>
      `;
    }).join('');

    return progressCard + errorCards;
  },

  // BR-106/126/128 — a measured (not guessed) quality warning, skipped when
  // the recording's own duration is an estimate (durationEstimated) so the
  // denominator can't be trusted (capabilities.qualityWarningEligible).
  _renderQualityWarning(meeting, caps) {
    if (!caps.qualityWarningEligible) return '';
    const result = Parts.qualityWarning(meeting);
    if (!result.warn) return '';
    return `
      <div class="card" style="margin-bottom: var(--space-6); border-color: var(--color-warning); background: var(--color-warning-muted);">
        <p class="text-sm" style="margin:0;">⚠ Transcript ngắn hơn nhiều so với độ dài bản ghi. Thường là do micro đặt quá xa người nói.</p>
      </div>
    `;
  },

  _bindMultiPartActions(meetingId) {
    document.querySelectorAll('[data-action="retry-part"]').forEach(btn => btn.addEventListener('click', async () => {
      btn.disabled = true;
      try {
        const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/parts/${encodeURIComponent(btn.dataset.part)}/retry`, {
          method: 'POST', headers: { 'Content-Type': 'application/json' }, body: '{}'
        });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error?.message || 'Không thử lại được phần này.');
        await this._reloadMeetingsFromServer();
        this._backgroundAudioTasks.set(meetingId, { filename: Storage.getMeeting(meetingId)?.title || meetingId, phase: 'transcribing' });
        this._renderBackgroundTaskIndicator();
        this._pollPartsStatus(meetingId);
        this.navigate(`meeting/${meetingId}`, { force: true });
      } catch (error) {
        this.toast(error.message, 'error');
        btn.disabled = false;
      }
    }));

    document.querySelectorAll('[data-action="drop-part"]').forEach(btn => btn.addEventListener('click', () => {
      const meeting = Storage.getMeeting(meetingId);
      const part = (meeting?.parts || []).find(p => p.partId === btn.dataset.part);
      if (!part) return;
      this.showModal(`
        <div class="modal-header"><h3>Bỏ phần ${part.order}?</h3><button class="btn btn-ghost btn-icon" onclick="App.closeModal()">✕</button></div>
        <p class="text-sm text-secondary">Bản ghi sẽ thiếu nội dung của phần ${part.order}. File ghi âm vẫn được giữ trên máy. Bản ghi sẽ được đánh dấu là thiếu nội dung.</p>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="App.closeModal()">Hủy</button>
          <button class="btn btn-danger" id="confirm-drop-part">Vẫn bỏ phần này</button>
        </div>
      `);
      document.getElementById('confirm-drop-part')?.addEventListener('click', async () => {
        try {
          const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/parts/${encodeURIComponent(part.partId)}`, { method: 'DELETE' });
          if (!response.ok) throw new Error('Không bỏ được phần này.');
          await this._reloadMeetingsFromServer();
          this.closeModal();
          this.navigate(`meeting/${meetingId}`, { force: true });
        } catch (error) {
          this.toast(error.message, 'error');
        }
      });
    }));

    document.querySelectorAll('[data-action="retry-part-other-provider"]').forEach(btn => btn.addEventListener('click', async () => {
      let providers = [];
      try {
        const response = await fetch('/api/stt/providers', { cache: 'no-store' });
        const data = await response.json();
        providers = data.providers || [];
      } catch { /* modal still opens, just with no options */ }
      this.showModal(`
        <div class="modal-header"><h3>Thử nhà cung cấp khác</h3><button class="btn btn-ghost btn-icon" onclick="App.closeModal()">✕</button></div>
        <p class="text-sm text-secondary">Nhãn người nói và văn phong của phần này có thể lệch so với các phần còn lại nếu đổi nhà cung cấp.</p>
        <div class="input-group">
          <label>Nhà cung cấp</label>
          <select class="input" id="retry-other-provider">${providers.map(p => `<option value="${Utils.escapeHtml(p.id)}">${Utils.escapeHtml(p.name)}</option>`).join('')}</select>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="App.closeModal()">Hủy</button>
          <button class="btn btn-primary" id="confirm-retry-other">Thử lại với nhà cung cấp này</button>
        </div>
      `);
      document.getElementById('confirm-retry-other')?.addEventListener('click', async () => {
        const provider = document.getElementById('retry-other-provider')?.value;
        try {
          const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/parts/${encodeURIComponent(btn.dataset.part)}/retry`, {
            method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ provider })
          });
          const body = await response.json().catch(() => ({}));
          if (!response.ok) throw new Error(body.error?.message || 'Không thử lại được phần này.');
          await this._reloadMeetingsFromServer();
          this.closeModal();
          this._backgroundAudioTasks.set(meetingId, { filename: Storage.getMeeting(meetingId)?.title || meetingId, phase: 'transcribing' });
          this._renderBackgroundTaskIndicator();
          this._pollPartsStatus(meetingId);
          this.navigate(`meeting/${meetingId}`, { force: true });
        } catch (error) {
          this.toast(error.message, 'error');
        }
      });
    }));

    // TV18 (BR-121) — ▲▼ reorder, never touches provider/summary.
    document.querySelectorAll('[data-action="part-move-up"]').forEach(btn => btn.addEventListener('click', () => this._movePart(meetingId, btn.dataset.part, -1)));
    document.querySelectorAll('[data-action="part-move-down"]').forEach(btn => btn.addEventListener('click', () => this._movePart(meetingId, btn.dataset.part, 1)));

    // TV18 (Q9) — add a part to an already-completed merged meeting.
    document.getElementById('add-part')?.addEventListener('click', () => Import.open({ attachMeetingId: meetingId, mode: 'appendPart' }));
  },

  // TV18 (BR-121) — computes the full permutation client-side (js/parts.js,
  // must include every part id regardless of status — the server rejects
  // anything short of a full permutation) and posts it; never calls a
  // provider, never touches summary/summaryPreset (server-side, tested in
  // test/parts-routes.test.js).
  async _movePart(meetingId, partId, delta) {
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return;
    const order = Parts.computeReorderedPartIds(meeting.parts || [], partId, delta);
    if (!order) return; // already at that edge — no-op, matches the disabled button
    try {
      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/parts/reorder`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ order })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || 'Không sắp xếp lại được thứ tự các phần.');
      await this._reloadMeetingsFromServer();
      this.navigate(`meeting/${meetingId}`, { force: true });
    } catch (error) {
      this.toast(error.message, 'error');
    }
  },

  // E-V1/PRG-13: a part still queued/processing must disable Generate
  // Summary outright (same as "no transcript yet" today); a FAILED/DROPPED
  // part does NOT disable it — that case goes through the BR-135 confirm
  // dialog instead (capabilities.summaryNeedsMissingPartConfirm).
  _anyPartRunning(meeting) {
    return (meeting.parts || []).some(p => p.status === 'queued' || p.status === 'processing');
  },

  // BR-135 (E-V1, Q10): summarizing a recording with a missing part is
  // allowed, but must be confirmed and must name which part(s) are missing.
  // New copy — Architecture.md §V15 E-V1 flags this exact confirmation as
  // not yet in UX §6's microcopy table; see Dev report to PM/UX.
  _confirmMissingPartsSummary(missingParts) {
    return new Promise(resolve => {
      const list = missingParts.join(', ');
      this.showModal(`
        <div class="modal-header"><h3>Tóm tắt khi bản ghi còn thiếu phần?</h3><button class="btn btn-ghost btn-icon" onclick="App.closeModal()">✕</button></div>
        <p class="text-sm text-secondary">Bản ghi này đang thiếu phần ${Utils.escapeHtml(list)} (chưa có transcript). Bản tóm tắt sẽ không có nội dung của phần đó.</p>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="missing-parts-cancel">Hủy</button>
          <button class="btn btn-primary" id="missing-parts-confirm">Vẫn tóm tắt</button>
        </div>
      `);
      const finish = value => { this.closeModal(); resolve(value); };
      document.getElementById('missing-parts-cancel').addEventListener('click', () => finish(false));
      document.getElementById('missing-parts-confirm').addEventListener('click', () => finish(true));
    });
  },

  _LLM_PROVIDER_NAMES: { codex: 'Codex', deepseek: 'DeepSeek', gemini: 'Google Gemini' },

  _llmProviderName(id) {
    return this._LLM_PROVIDER_NAMES[id] || id || 'the selected provider';
  },

  // Language picker for the summary. "Auto" keeps the meeting's own language.
  _summaryLanguageOptions() {
    const options = ['<option value="">Auto — meeting language</option>'];
    for (const lang of Transcriber.getTranslationLanguages()) {
      options.push(`<option value="${Utils.escapeHtml(lang.sonioxCode)}">${Utils.escapeHtml(lang.name)}</option>`);
    }
    return options.join('');
  },

  // Build the meeting-level provider picker ("Use default — X" plus each provider).
  _summaryProviderOptions() {
    const defaultId = Storage.getSettings().llmProvider || 'codex';
    const options = [`<option value="">Use default — ${Utils.escapeHtml(this._llmProviderName(defaultId))}</option>`];
    for (const id of Object.keys(this._LLM_PROVIDER_NAMES)) {
      options.push(`<option value="${id}">${Utils.escapeHtml(this._LLM_PROVIDER_NAMES[id])}</option>`);
    }
    return options.join('');
  },

  // Generic per-section summary renderer (C2, BR-20). Works for both a
  // freshly generated preset summary and legacy summaries with no stored
  // snapshot — the latter renders as the current General Meeting shape.
  _renderSummaryContent(meeting) {
    const snapshot = Summary.virtualSnapshotForLegacy(meeting);
    if (!snapshot) return '<span class="text-tertiary">No summary yet. Click "Generate Summary" to create one.</span>';
    const details = meeting.summaryDetails || {};
    return snapshot.sections.map(section => this._renderSummarySection(section, details[section.key])).join('');
  },

  // Every label/hint is user-entered and every value may come from the LLM —
  // both must go through Utils.escapeHtml (T12 acceptance criteria).
  _renderSummarySection(section, value) {
    const label = Utils.escapeHtml(section.label);
    const empty = `<div class="summary-section" style="margin-bottom:var(--space-4);"><h4 style="margin-bottom:var(--space-1);">${label}</h4><p class="text-tertiary text-sm">Không có nội dung</p></div>`;

    if (section.type === 'paragraph') {
      const text = String(value || '').trim();
      if (!text) return empty;
      return `<div class="summary-section" style="margin-bottom:var(--space-4);"><h4 style="margin-bottom:var(--space-1);">${label}</h4><p style="white-space:pre-wrap;">${Utils.escapeHtml(text)}</p></div>`;
    }

    if (section.type === 'bulletList') {
      const items = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
      if (!items.length) return empty;
      const list = items.map(item => `<li>${Utils.escapeHtml(item)}</li>`).join('');
      return `<div class="summary-section" style="margin-bottom:var(--space-4);"><h4 style="margin-bottom:var(--space-1);">${label}</h4><ul style="margin:0; padding-left:var(--space-5);">${list}</ul></div>`;
    }

    if (section.type === 'actionList') {
      const items = Array.isArray(value) ? value.filter(item => item && item.text) : [];
      if (!items.length) return empty;
      const list = items.map(item => {
        const meta = [item.assignee, item.dueDate].filter(Boolean).map(v => Utils.escapeHtml(v)).join(' · ');
        return `<li>${Utils.escapeHtml(item.text)}${meta ? ` <span class="text-tertiary">(${meta})</span>` : ''}</li>`;
      }).join('');
      return `<div class="summary-section" style="margin-bottom:var(--space-4);"><h4 style="margin-bottom:var(--space-1);">${label}</h4><ul style="margin:0; padding-left:var(--space-5);">${list}</ul></div>`;
    }

    return '';
  },

  // In-memory only, scoped to the current session (BR-56.1) — "the user
  // already changed the preset for this meeting in the current session".
  _manualPresetByMeeting: {},

  // BR-55..BR-58 — thứ tự chọn preset mặc định (Architecture §8).
  // Returns { presetId, suggested } — `suggested` drives the "Gợi ý cho …"
  // label (BR-55), only true for branches 2a/2b.
  async _chooseDefaultPresetId(presets, meeting) {
    const exists = id => presets.some(p => p.id === id);

    // 1. Manual override for this meeting in the current session.
    const manual = this._manualPresetByMeeting[meeting.id];
    if (manual && exists(manual)) return { presetId: manual, suggested: false };

    if (meeting.meetingType) {
      const typeEntry = typeof meetingTypeByCode === 'function' ? meetingTypeByCode(meeting.meetingType) : null;
      const settings = Storage.getSettings();
      const remembered = settings.presetByMeetingType?.[meeting.meetingType];

      // 2a. Preset last used for this meetingType on this machine (BR-57.1).
      if (remembered) {
        if (exists(remembered)) return { presetId: remembered, suggested: true };
        // BR-58: stale entry — prune it and fall through to name matching.
        const pruned = { ...settings.presetByMeetingType };
        delete pruned[meeting.meetingType];
        Storage.saveSettings({ presetByMeetingType: pruned });
      }

      // 2b. Preset whose name matches the meetingType's default name (BR-57.2).
      if (typeEntry) {
        const match = presets.find(p => p.name.trim().toLowerCase() === typeEntry.presetName.trim().toLowerCase());
        if (match) return { presetId: match.id, suggested: true };
      }
    }

    // 3. lastSummaryPresetId (BR-10 of summary-presets, unchanged for meetings without meetingType).
    const lastId = Storage.getSettings().lastSummaryPresetId || '';
    if (lastId && exists(lastId)) return { presetId: lastId, suggested: false };

    // 4. "General Meeting" if present.
    const general = presets.find(p => p.name === 'General Meeting');
    if (general) return { presetId: general.id, suggested: false };

    // 5. First preset in the list.
    if (presets[0]) return { presetId: presets[0].id, suggested: false };

    // 6. No preset at all — legacy path, Generate still works.
    return { presetId: '', suggested: false };
  },

  // Populate the preset dropdown and the "Preset đã bị xóa" badge (T13,
  // BR-10, BR-18). Runs async because presets are fetched over HTTP.
  async _populateSummaryPresetSelect(meetingId) {
    const select = document.getElementById('summary-preset');
    if (!select) return;
    let presets = [];
    try {
      presets = await Presets.list();
    } catch (error) {
      select.innerHTML = '<option value="">Default (General Meeting)</option>';
      return;
    }

    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return;

    const { presetId: defaultId, suggested } = await this._chooseDefaultPresetId(presets, meeting);
    select.innerHTML = presets.map(p =>
      `<option value="${Utils.escapeHtml(p.id)}">${Utils.escapeHtml(p.name)}${p.isBuiltIn ? ' (mẫu)' : ''}</option>`
    ).join('');
    if (defaultId) select.value = defaultId;

    const suggestionEl = document.getElementById('summary-preset-suggestion');
    if (suggestionEl) {
      const typeEntry = suggested && meeting.meetingType && typeof meetingTypeByCode === 'function'
        ? meetingTypeByCode(meeting.meetingType) : null;
      suggestionEl.textContent = typeEntry ? `Gợi ý cho ${typeEntry.label}` : '';
    }
    select.addEventListener('change', () => {
      this._manualPresetByMeeting[meetingId] = select.value;
      if (suggestionEl) suggestionEl.textContent = '';
    });

    const badge = document.getElementById('summary-preset-badge');
    if (!badge) return;
    const usedPresetId = meeting.summaryPreset?.presetId;
    if (usedPresetId && !presets.some(p => p.id === usedPresetId)) {
      const presetName = meeting.summaryPreset?.name ? `: ${Utils.escapeHtml(meeting.summaryPreset.name)}` : '';
      badge.innerHTML = `<span class="badge badge-warning">Preset đã bị xóa${presetName}</span> ` +
        `<button class="btn btn-ghost btn-sm" id="restore-preset-from-snapshot" type="button">Khôi phục thành preset mới</button>`;
      document.getElementById('restore-preset-from-snapshot')?.addEventListener('click', () => this._restorePresetFromSnapshot(meetingId));
    } else {
      badge.innerHTML = '';
    }
  },

  // BR-15: a single confirmation before Generate replaces the current
  // summary. Deviation note: the app has no summary-editing UI today, so
  // there is no signal to detect "edited by hand" for the stronger warning
  // BR-15 also calls for — see docs/CHANGELOG.md.
  _confirmRegenerateSummary() {
    return new Promise(resolve => {
      this.showModal(`
        <div class="modal-header">
          <h3>Tạo lại bản tóm tắt?</h3>
          <button class="btn btn-ghost btn-icon" id="regen-cancel-x">✕</button>
        </div>
        <p class="text-sm text-secondary">Bản tóm tắt hiện tại sẽ bị thay thế hoàn toàn và không thể khôi phục.</p>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="regen-cancel">Hủy</button>
          <button class="btn btn-primary" id="regen-confirm">Tạo lại</button>
        </div>
      `);
      const finish = value => { this.closeModal(); resolve(value); };
      document.getElementById('regen-cancel-x')?.addEventListener('click', () => finish(false));
      document.getElementById('regen-cancel')?.addEventListener('click', () => finish(false));
      document.getElementById('regen-confirm')?.addEventListener('click', () => finish(true));
    });
  },

  /* ══════════════════════════════════════════
     Export .md (T13, BR-41..BR-54)
     ══════════════════════════════════════════ */

  _openExportModal(meetingId) {
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return;
    const hasSummary = Boolean(meeting.summary || meeting.summaryDetails);

    this.showModal(`
      <div class="modal-header">
        <h3>Export .md</h3>
        <button class="btn btn-ghost btn-icon" id="export-modal-close" type="button">✕</button>
      </div>
      ${!hasSummary ? '<p class="text-sm" style="color:var(--color-warning); margin-bottom: var(--space-3);">⚠️ Cuộc họp này chưa có bản tóm tắt — vẫn export được, chỉ gồm thông tin cuộc họp, notes và transcript (BR-53).</p>' : ''}
      ${(meeting.missingParts || []).length > 0 ? `<p class="text-sm" style="color:var(--color-warning); margin-bottom: var(--space-3);">⚠️ Bản ghi này còn thiếu phần ${(meeting.missingParts || []).join(', ')}.</p>` : ''}
      <label class="checkbox">
        <input type="checkbox" id="export-include-transcript" checked>
        <span class="checkbox-label">Kèm theo Transcript</span>
      </label>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="export-modal-cancel" type="button">Hủy</button>
        <button class="btn btn-primary" id="export-modal-confirm" type="button">Export</button>
      </div>
    `);

    document.getElementById('export-modal-close')?.addEventListener('click', () => this.closeModal());
    document.getElementById('export-modal-cancel')?.addEventListener('click', () => this.closeModal());
    document.getElementById('export-modal-confirm')?.addEventListener('click', async event => {
      const includeTranscript = document.getElementById('export-include-transcript')?.checked !== false;
      // BR-54: a soft, non-blocking size warning shown before sending.
      if (includeTranscript && (meeting.transcript || []).length > 20000) {
        this.toast('Transcript khá lớn — export có thể mất một lúc.', 'warning');
      }
      const button = event.currentTarget;
      button.disabled = true;
      button.textContent = 'Đang export…';
      await this._runExport(meetingId, includeTranscript);
      this.closeModal();
    });
  },

  async _runExport(meetingId, includeTranscript) {
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return;

    let settings;
    try {
      settings = await Exporter.getSettings();
    } catch (error) {
      this.toast(error.message || 'Không thể đọc cấu hình xuất file.', 'error');
      return;
    }
    if (!settings.configured) {
      this.toast('Chưa cấu hình thư mục xuất file — mở Cài đặt để chọn thư mục (BR-44).', 'warning');
      this.navigate('settings');
      return;
    }

    // BR-52: only relevant when the summary actually used a preset — a
    // best-effort check against the live preset list, non-fatal on failure.
    let presetDeleted = false;
    const usedPresetId = meeting.summaryPreset?.presetId;
    if (usedPresetId) {
      try {
        const presets = await Presets.list();
        presetDeleted = !presets.some(p => p.id === usedPresetId);
      } catch { /* best-effort — export still proceeds */ }
    }

    const content = Export.toMarkdown(meeting, { includeTranscript, presetDeleted });
    try {
      const result = await Exporter.exportMarkdown(meetingId, content, includeTranscript);
      this._showExportResult(result);
    } catch (error) {
      if (error.code === 'EXPORT_DIR_NOT_CONFIGURED') {
        this.toast('Chưa cấu hình thư mục xuất file — mở Cài đặt để chọn thư mục.', 'warning');
        this.navigate('settings');
        return;
      }
      this.toast(error.message || 'Export thất bại', 'error');
    }
  },

  _EXPORT_WARNING_MESSAGES: {
    EXPORT_NO_SUMMARY: 'Cuộc họp này chưa có bản tóm tắt.',
    EXPORT_LARGE_TRANSCRIPT: 'Transcript khá lớn — quá trình ghi file có thể mất nhiều thời gian hơn bình thường.'
  },

  // BR-48: shows the full path + "Mở thư mục" (macOS, hidden reactively on a
  // 501) + "Copy đường dẫn" (always present — WHY-10).
  _showExportResult(result) {
    const warningsHtml = (result.warnings || [])
      .map(code => this._EXPORT_WARNING_MESSAGES[code] || code)
      .map(message => `<p class="text-xs" style="color:var(--color-warning);">⚠️ ${Utils.escapeHtml(message)}</p>`)
      .join('');

    this.showModal(`
      <div class="modal-header">
        <h3>Đã export thành công</h3>
        <button class="btn btn-ghost btn-icon" id="export-result-close" type="button">✕</button>
      </div>
      ${warningsHtml}
      <p class="text-sm" style="word-break: break-all;">${Utils.escapeHtml(result.path)}</p>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="export-result-copy" type="button">Copy đường dẫn</button>
        <button class="btn btn-primary" id="export-result-open-folder" type="button">Mở thư mục</button>
      </div>
    `);

    document.getElementById('export-result-close')?.addEventListener('click', () => this.closeModal());
    document.getElementById('export-result-copy')?.addEventListener('click', async () => {
      const copied = await Exporter.copyPath(result.path);
      this.toast(copied ? 'Đã copy đường dẫn' : 'Không thể copy đường dẫn', copied ? 'success' : 'error');
    });
    document.getElementById('export-result-open-folder')?.addEventListener('click', async event => {
      try {
        await Exporter.openFolder();
      } catch (error) {
        if (error.statusCode === 501) {
          // §5.3: the server just told us this OS/branch is unsupported —
          // shrink the UI reactively to the fallback that always works.
          event.currentTarget.remove();
          this.toast('Mở thư mục tự động chưa hỗ trợ trên hệ điều hành này. Dùng nút Copy đường dẫn.', 'info');
        } else {
          this.toast(error.message || 'Không thể mở thư mục', 'error');
        }
      }
    });
  },

  // T15: turn a deleted preset's stored snapshot into a brand-new preset
  // (BR-19 — never silently re-select the old, now-nonexistent, preset id).
  async _restorePresetFromSnapshot(meetingId) {
    const meeting = Storage.getMeeting(meetingId);
    const snapshot = meeting?.summaryPreset;
    if (!snapshot) return;
    try {
      const name = `${snapshot.name || 'Restored preset'} (khôi phục)`.slice(0, 60);
      const payload = {
        name,
        description: '',
        instruction: '',
        sections: snapshot.sections.map(s => ({ label: s.label, type: s.type, hint: s.hint || '' }))
      };
      const { preset } = await Presets.create(payload);
      this.toast(`Đã tạo preset mới "${preset.name}" từ bản tóm tắt cũ`, 'success');
      await this._populateSummaryPresetSelect(meetingId);
      const select = document.getElementById('summary-preset');
      if (select) select.value = preset.id;
    } catch (error) {
      this.toast(error.message || 'Không thể khôi phục preset', 'error');
    }
  },

  // In-memory only (not persisted) — mirrors the "current session" scope
  // BR-28/§8 already use for manual preset overrides. A reload resets it,
  // which is acceptable: the nudge is low-stakes and shows again at most
  // once per fresh page load, never repeatedly within one.
  _leadBySuggestionDismissed: new Set(),

  // BR-70 last sentence: meetingId -> Set of lowercase tag labels the user
  // explicitly removed after auto-add, so it is not re-added within "cùng
  // một lần chỉnh sửa" (this session's view of the meeting). Not persisted.
  _autoTagSuppressed: {},

  /* ══════════════════════════════════════════
     Tags (T14, BR-68..BR-71)
     ══════════════════════════════════════════ */

  _renderTagChips(tags, options = {}) {
    const removable = Boolean(options.removable);
    return (tags || []).map(tag => `
      <span class="tag-chip" style="${tagStyle(tag)}" data-tag="${Utils.escapeHtml(tag)}">
        ${Utils.escapeHtml(tag)}
        ${removable ? `<button type="button" class="tag-chip-remove" data-tag="${Utils.escapeHtml(tag)}" aria-label="Xóa tag ${Utils.escapeHtml(tag)}">×</button>` : ''}
      </span>
    `).join('');
  },

  _isAutoTag(meeting, tag) {
    const entry = meeting.meetingType && typeof meetingTypeByCode === 'function'
      ? meetingTypeByCode(meeting.meetingType) : null;
    return Boolean(entry) && entry.label.trim().toLowerCase() === String(tag).trim().toLowerCase();
  },

  // Idempotent: replaces the chip row's innerHTML and rebinds remove
  // handlers on the fresh elements — safe to call repeatedly (unlike
  // re-running _bindTagEditor, which would stack duplicate input listeners).
  _renderTagChipsInto(meetingId) {
    const list = document.getElementById('detail-tags-list');
    if (!list) return;
    const meeting = Storage.getMeeting(meetingId);
    list.innerHTML = this._renderTagChips(meeting?.tags || [], { removable: true });
    list.querySelectorAll('.tag-chip-remove').forEach(btn => {
      btn.addEventListener('click', () => {
        const tag = btn.dataset.tag;
        const current = Storage.getMeeting(meetingId);
        if (!current) return;
        if (this._isAutoTag(current, tag)) {
          this._autoTagSuppressed[meetingId] = this._autoTagSuppressed[meetingId] || new Set();
          this._autoTagSuppressed[meetingId].add(tag.trim().toLowerCase());
        }
        current.tags = (current.tags || []).filter(t => t.trim().toLowerCase() !== tag.trim().toLowerCase());
        Storage.saveMeeting(current);
        this._renderTagChipsInto(meetingId);
      });
    });
  },

  _bindTagEditor(meetingId) {
    const input = document.getElementById('detail-tag-input');
    const suggestionsBox = document.getElementById('detail-tag-suggestions');
    if (!input) return;

    const addTag = (rawTag) => {
      const current = Storage.getMeeting(meetingId);
      if (!current) return;
      const result = canAddTag(current.tags || [], rawTag);
      if (!result.ok) {
        const messages = {
          TAG_DUPLICATE: 'Tag này đã có rồi.',
          TAG_LIMIT_REACHED: 'Mỗi cuộc họp tối đa 10 tag.'
        };
        if (messages[result.code]) this.toast(messages[result.code], 'warning');
        return;
      }
      current.tags = [...(current.tags || []), normalizeTag(rawTag)];
      Storage.saveMeeting(current);
      this._renderTagChipsInto(meetingId);
    };

    input.addEventListener('input', () => {
      if (!suggestionsBox) return;
      const all = collectTags(Storage.getAllMeetings());
      const matches = suggestTags(all, input.value);
      if (!input.value.trim() || matches.length === 0) {
        suggestionsBox.style.display = 'none';
        return;
      }
      suggestionsBox.innerHTML = matches.map(tag =>
        `<div class="tag-suggestion-item" data-tag="${Utils.escapeHtml(tag)}">${Utils.escapeHtml(tag)}</div>`
      ).join('');
      suggestionsBox.style.display = 'block';
      suggestionsBox.querySelectorAll('.tag-suggestion-item').forEach(item => {
        // mousedown (not click) fires before the input's blur hides the box.
        item.addEventListener('mousedown', event => {
          event.preventDefault();
          addTag(item.dataset.tag);
          input.value = '';
          suggestionsBox.style.display = 'none';
        });
      });
    });

    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const value = input.value.trim();
      if (value) addTag(value);
      input.value = '';
      if (suggestionsBox) suggestionsBox.style.display = 'none';
    });

    input.addEventListener('blur', () => {
      setTimeout(() => { if (suggestionsBox) suggestionsBox.style.display = 'none'; }, 150);
    });
  },

  // BR-70: called whenever the meetingType dropdown changes (New Meeting's
  // initial creation is handled separately by _initialTagsForMeetingType,
  // since that form has no tag editor of its own yet to update live).
  _autoAddMeetingTypeTag(meetingId, code) {
    if (!code) return;
    const entry = typeof meetingTypeByCode === 'function' ? meetingTypeByCode(code) : null;
    if (!entry) return;
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return;
    const label = entry.label;
    const suppressed = this._autoTagSuppressed[meetingId];
    if (suppressed && suppressed.has(label.toLowerCase())) return;
    const already = (meeting.tags || []).some(t => t.trim().toLowerCase() === label.toLowerCase());
    if (already || (meeting.tags || []).length >= 10) return;
    meeting.tags = [...(meeting.tags || []), label];
    Storage.saveMeeting(meeting);
    this._renderTagChipsInto(meetingId);
  },

  // BR-144/145, DAT-01: "ngày nhập vào máy" line — only when `date` differs
  // from `createdAt` by more than 1 day, in either direction (5.9.3).
  _dateVsCreatedAtHint(meeting) {
    if (!meeting.date || !meeting.createdAt) return '';
    const deltaMs = Math.abs(new Date(meeting.date).getTime() - new Date(meeting.createdAt).getTime());
    if (!Number.isFinite(deltaMs) || deltaMs <= 24 * 3600 * 1000) return '';
    return `Nhập vào MeetNote ngày ${Parts.formatDDMM(meeting.createdAt)}.`;
  },

  // BR-144, U-V6: <input type="datetime-local"> when the browser supports
  // it; a compact date+time pair otherwise (feature-detected at runtime,
  // same spirit as js/import.js's audio-preview detection — never a
  // hardcoded browser list).
  _supportsDateTimeLocal() {
    if (this.__dtLocalSupport !== undefined) return this.__dtLocalSupport;
    const probe = document.createElement('input');
    probe.setAttribute('type', 'datetime-local');
    this.__dtLocalSupport = probe.type === 'datetime-local';
    return this.__dtLocalSupport;
  },

  _isoToLocalInputValue(iso) {
    const date = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  _dateEditorHtml(meeting) {
    if (this._supportsDateTimeLocal()) {
      return `<input type="datetime-local" class="input" id="detail-date" value="${this._isoToLocalInputValue(meeting.date)}">`;
    }
    const date = new Date(meeting.date);
    const pad = n => String(n).padStart(2, '0');
    const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const t = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `<div class="flex gap-2">
      <input type="date" class="input" id="detail-date-day" value="${d}">
      <input type="time" class="input" id="detail-date-time" value="${t}">
    </div>`;
  },

  // Reads the date editor(s) back into an ISO string, or null if the user
  // left it blank (caller must restore the previous value on blur, never
  // fall through to "now" — BR-144's "xoá trắng -> khôi phục giá trị cũ").
  _readDateEditor() {
    if (this._supportsDateTimeLocal()) {
      const el = document.getElementById('detail-date');
      if (!el || !el.value) return null;
      return new Date(el.value).toISOString();
    }
    const dayEl = document.getElementById('detail-date-day');
    const timeEl = document.getElementById('detail-date-time');
    if (!dayEl || !dayEl.value) return null;
    return new Date(`${dayEl.value}T${timeEl?.value || '00:00'}`).toISOString();
  },

  // Sets the date editor(s) to a specific ISO value — used by BR-94 rejection
  // to put the editor back to the currently-saved date, distinct from
  // `restoreDateIfBlank` (js/app.js `_bindPreMeetingInfo`) which only fires
  // on an empty input.
  _setDateEditorValue(iso) {
    if (this._supportsDateTimeLocal()) {
      const el = document.getElementById('detail-date');
      if (el) el.value = this._isoToLocalInputValue(iso);
      return;
    }
    const dayEl = document.getElementById('detail-date-day');
    const timeEl = document.getElementById('detail-date-time');
    const date = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    if (dayEl) dayEl.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    if (timeEl) timeEl.value = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  /* ── Participants editor (T13, BR-144) — same chip pattern as Tags ── */

  _renderParticipantChips(participants) {
    return (participants || []).map(name => `
      <span class="chip" data-participant="${Utils.escapeHtml(name)}">
        ${Utils.escapeHtml(name)}
        <span class="chip-remove" data-action="remove-participant" data-participant="${Utils.escapeHtml(name)}" role="button" aria-label="Bỏ ${Utils.escapeHtml(name)}">×</span>
      </span>
    `).join('');
  },

  _renderParticipantChipsInto(meetingId) {
    const list = document.getElementById('detail-participants-list');
    if (!list) return;
    const meeting = Storage.getMeeting(meetingId);
    list.innerHTML = this._renderParticipantChips(meeting?.participants || []);
    list.querySelectorAll('[data-action="remove-participant"]').forEach(el => {
      el.addEventListener('click', () => {
        const current = Storage.getMeeting(meetingId);
        if (!current) return;
        current.participants = (current.participants || []).filter(p => p !== el.dataset.participant);
        Storage.saveMeeting(current);
        this._renderParticipantChipsInto(meetingId);
      });
    });
  },

  _bindParticipantEditor(meetingId) {
    const input = document.getElementById('detail-participant-input');
    if (!input) return;
    input.addEventListener('keydown', event => {
      if (event.key !== 'Enter') return;
      event.preventDefault();
      const name = input.value.trim();
      input.value = '';
      if (!name) return;
      const current = Storage.getMeeting(meetingId);
      if (!current) return;
      if ((current.participants || []).some(p => p.toLowerCase() === name.toLowerCase())) return;
      current.participants = [...(current.participants || []), name];
      Storage.saveMeeting(current);
      this._renderParticipantChipsInto(meetingId);
    });
  },

  // BR-146: nudge only when a field that actually feeds the summary prompt
  // (title/date/duration/participants/meetingType/topic/leadBy/notes) changed
  // after the last Generate — NOT `meeting.updatedAt`, which bumps on every
  // save (tag, action item tick, preset choice...) and would nag constantly
  // (BUG-004). Decision lives in js/summary-staleness.js so it's unit
  // testable without a browser.
  _preMeetingStaleHint(meeting) {
    if (!SummaryStaleness.isPreMeetingInfoStale(meeting)) return '';
    return '<p class="text-xs text-tertiary" style="margin-bottom: var(--space-3);">ℹ️ Thông tin cuộc họp có thể mới hơn lần tạo tóm tắt gần nhất — Generate lại nếu muốn AI dùng thông tin mới.</p>';
  },

  _bindPreMeetingInfo(meetingId) {
    const suggestionEl = document.getElementById('lead-by-suggestion');
    const updateLeadBySuggestion = () => {
      if (!suggestionEl || this._leadBySuggestionDismissed.has(meetingId)) return;
      const leadBy = document.getElementById('detail-lead-by')?.value.trim() || '';
      const meeting = Storage.getMeeting(meetingId);
      if (!leadBy || !meeting) { suggestionEl.innerHTML = ''; return; }
      const already = (meeting.participants || []).some(p => p.trim().toLowerCase() === leadBy.toLowerCase());
      if (already) { suggestionEl.innerHTML = ''; return; }
      suggestionEl.innerHTML = `Thêm "${Utils.escapeHtml(leadBy)}" vào danh sách người tham dự? ` +
        `<button class="btn btn-ghost btn-sm" id="add-leadby-to-participants" type="button">Thêm</button> ` +
        `<button class="btn btn-ghost btn-sm" id="dismiss-leadby-suggestion" type="button">Bỏ qua</button>`;
      document.getElementById('add-leadby-to-participants')?.addEventListener('click', () => {
        const m = Storage.getMeeting(meetingId);
        if (m) {
          m.participants = [...m.participants, leadBy];
          Storage.saveMeeting(m);
        }
        this._leadBySuggestionDismissed.add(meetingId);
        suggestionEl.innerHTML = '';
      });
      document.getElementById('dismiss-leadby-suggestion')?.addEventListener('click', () => {
        this._leadBySuggestionDismissed.add(meetingId);
        suggestionEl.innerHTML = '';
      });
    };
    document.getElementById('detail-lead-by')?.addEventListener('blur', updateLeadBySuggestion);

    // BR-144: leaving the date field blank must restore the saved value,
    // never fall through to "now".
    const restoreDateIfBlank = () => {
      const current = Storage.getMeeting(meetingId);
      if (!current) return;
      if (this._supportsDateTimeLocal()) {
        const el = document.getElementById('detail-date');
        if (el && !el.value) el.value = this._isoToLocalInputValue(current.date);
      } else {
        const dayEl = document.getElementById('detail-date-day');
        if (dayEl && !dayEl.value) {
          const date = new Date(current.date);
          const pad = n => String(n).padStart(2, '0');
          dayEl.value = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
        }
      }
    };
    document.getElementById('detail-date')?.addEventListener('blur', restoreDateIfBlank);
    document.getElementById('detail-date-day')?.addEventListener('blur', restoreDateIfBlank);

    this._renderParticipantChipsInto(meetingId);
    this._bindParticipantEditor(meetingId);

    document.getElementById('save-premeeting')?.addEventListener('click', () => {
      const m = Storage.getMeeting(meetingId);
      if (!m) return;
      m.meetingType = Storage.normalizeMeetingType(document.getElementById('detail-meeting-type')?.value);
      m.topic = Storage.normalizeShortText(document.getElementById('detail-topic')?.value);
      m.leadBy = Storage.normalizeShortText(document.getElementById('detail-lead-by')?.value);
      const previousDayKey = new Date(m.date).toDateString();
      let newDateIso = this._readDateEditor();
      // BR-94 applies to hand-typed dates too, not just the file.lastModified
      // suggestion at import time (BUG-003) — reject and keep the previously
      // saved date instead of silently accepting an implausible one.
      if (newDateIso && !MeetingDate.isPlausibleMeetingDate(newDateIso)) {
        this.toast('Ngày không hợp lệ (quá xa trong tương lai hoặc trước năm 2000) — đã giữ nguyên ngày cũ.', 'error');
        this._setDateEditorValue(m.date);
        newDateIso = null;
      }
      if (newDateIso) m.date = newDateIso;
      Storage.saveMeeting(m);
      this.toast('Đã lưu thông tin cuộc họp', 'success');
      // DAT-03: only when the CALENDAR DAY changed, not just the time —
      // this is the one action that can move the meeting elsewhere in the
      // date-sorted All Meetings list (§5.9.2).
      if (newDateIso && new Date(newDateIso).toDateString() !== previousDayKey) {
        this.toast(`Đã chuyển bản ghi này sang ngày ${Parts.formatDDMM(newDateIso)} — trong danh sách nó sẽ nằm ở vị trí của ngày đó.`, 'info');
      }
      updateLeadBySuggestion();
      this.navigate(`meeting/${meetingId}`, { force: true });
    });

    document.getElementById('attach-recording')?.addEventListener('click', () => Import.open({ attachMeetingId: meetingId }));
  },

  // Short provenance line for the current stored summary.
  _summaryProvenance(meeting) {
    const gen = meeting.summaryGeneration;
    if (!gen || !gen.provider) return '';
    const when = gen.generatedAt ? new Date(gen.generatedAt).toLocaleString() : '';
    const parts = [`Generated with ${this._llmProviderName(gen.provider)}`];
    if (gen.model && gen.model !== 'default') parts.push(gen.model);
    if (when) parts.push(when);
    return Utils.escapeHtml(parts.join(' · '));
  },

  _bindMeetingDetail(meetingId) {
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return;

    // Edit the title from within the detail view (reuses the list editor modal).
    const openTitleEditor = () => this._openMeetingTitleEditor(meetingId);
    document.getElementById('detail-title')?.addEventListener('click', openTitleEditor);
    document.getElementById('detail-title-edit')?.addEventListener('click', openTitleEditor);

    // Tabs
    document.querySelectorAll('.tab[data-tab]').forEach(tab => {
      tab.addEventListener('click', () => {
        document.querySelectorAll('.tab[data-tab]').forEach(t => t.classList.remove('active'));
        document.querySelectorAll('.tab-content').forEach(c => c.classList.remove('active'));
        tab.classList.add('active');
        document.getElementById(`tab-${tab.dataset.tab}`).classList.add('active');
      });
    });

    // Edit transcript inline
    document.querySelectorAll('.transcript-text[contenteditable]').forEach(el => {
      el.addEventListener('blur', () => {
        const idx = parseInt(el.dataset.segIndex);
        const m = Storage.getMeeting(meetingId);
        if (m && m.transcript[idx]) {
          m.transcript[idx].text = el.textContent;
          Storage.saveMeeting(m);
        }
      });
    });

    // Rename a speaker label after the fact (post-hoc, not live)
    document.querySelectorAll('.transcript-speaker[data-speaker-seg-index]').forEach(el => {
      el.addEventListener('click', () => {
        const idx = parseInt(el.dataset.speakerSegIndex, 10);
        this._openSpeakerRenameModal(meetingId, idx);
      });
    });

    // Copy transcript
    document.getElementById('copy-transcript')?.addEventListener('click', async () => {
      await Export.copyTranscript(meeting);
      this.toast('Transcript copied to clipboard', 'success');
    });

    document.getElementById('copy-summary')?.addEventListener('click', async () => {
      const current = Storage.getMeeting(meetingId);
      if (!current?.summary) return;
      const copied = await Export.copySummary(current);
      this.toast(copied ? 'Summary copied to clipboard' : 'Could not copy summary', copied ? 'success' : 'error');
    });

    // Pre-meeting info (T3, BR-23..BR-29; date+participants T13, BR-144)
    this._bindPreMeetingInfo(meetingId);

    // Multi-part progress/error card actions (TV12)
    this._bindMultiPartActions(meetingId);

    // Tags (T14, BR-68..BR-70)
    this._bindTagEditor(meetingId);
    document.getElementById('detail-meeting-type')?.addEventListener('change', event => {
      this._autoAddMeetingTypeTag(meetingId, event.target.value);
    });

    // Preset dropdown (T13, BR-10)
    this._populateSummaryPresetSelect(meetingId);

    // Generate summary
    document.getElementById('generate-summary')?.addEventListener('click', async () => {
      const before = Storage.getMeeting(meetingId);
      if (before?.summary) {
        const confirmed = await this._confirmRegenerateSummary();
        if (!confirmed) return;
      }
      const caps = Parts.meetingCapabilities(before || {});
      if (caps.summaryNeedsMissingPartConfirm) {
        const confirmed = await this._confirmMissingPartsSummary(before.missingParts);
        if (!confirmed) return;
      }

      const btn = document.getElementById('generate-summary');
      const content = document.getElementById('summary-content');
      btn.disabled = true;
      btn.innerHTML = '<span class="spinner"></span> Generating...';
      content.innerHTML = '<div class="skeleton skeleton-text" style="width:100%"></div><div class="skeleton skeleton-text" style="width:90%"></div><div class="skeleton skeleton-text" style="width:75%"></div>';

      try {
        const provider = document.getElementById('summary-provider')?.value || '';
        const language = document.getElementById('summary-language')?.value || '';
        const presetId = document.getElementById('summary-preset')?.value || '';
        const result = await Summary.generate(before, { provider, language, presetId });
        const m = Storage.getMeeting(meetingId);
        if (m) {
          m.summary = result.summary;
          m.summaryDetails = result.details;
          m.summaryPreset = result.summaryPreset;
          if (result.generation) m.summaryGeneration = result.generation;
          // Never overwrite action items the user already curated (BR-15/E3).
          if (result.actionItems.length > 0 && m.actionItems.length === 0) {
            m.actionItems = result.actionItems;
          }
          Storage.saveMeeting(m);
          if (presetId) {
            Storage.saveSettings({ lastSummaryPresetId: presetId });
            // BR-57.1: remember this choice for the meeting's type, on this machine.
            if (m.meetingType) {
              const presetByMeetingType = { ...Storage.getSettings().presetByMeetingType, [m.meetingType]: presetId };
              Storage.saveSettings({ presetByMeetingType });
            }
          }
          const provenance = document.getElementById('summary-provenance');
          if (provenance) provenance.textContent = this._summaryProvenance(m);
          content.innerHTML = this._renderSummaryContent(m);
          this._populateSummaryPresetSelect(meetingId);
        }
        const copyButton = document.getElementById('copy-summary');
        if (copyButton) copyButton.disabled = false;
        this.toast('Summary generated!', 'success');
      } catch (e) {
        content.textContent = `Failed to generate summary: ${e.message}`;
        this.toast(e.message || 'Summary generation failed', 'error');
      }

      btn.disabled = false;
      btn.innerHTML = `<svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="13 2 3 14 12 14 11 22 21 10 12 10 13 2"/></svg> Regenerate`;
    });

    // Action items - toggle
    document.querySelectorAll('.checkbox[data-action-id]').forEach(el => {
      const checkbox = el.querySelector('input[type="checkbox"]');
      checkbox.addEventListener('change', () => {
        Storage.toggleActionItem(meetingId, el.dataset.actionId);
        el.classList.toggle('checked');
      });
    });

    // Action items - delete
    document.querySelectorAll('.action-delete').forEach(btn => {
      btn.addEventListener('click', (e) => {
        e.preventDefault();
        e.stopPropagation();
        Storage.removeActionItem(meetingId, btn.dataset.actionId);
        btn.closest('.checkbox').remove();
        this.toast('Action item removed', 'info');
      });
    });

    // Add action item
    document.getElementById('add-action')?.addEventListener('click', () => {
      this.showModal(`
        <div class="modal-header">
          <h3>Add Action Item</h3>
          <button class="btn btn-ghost btn-icon" onclick="App.closeModal()">✕</button>
        </div>
        <div class="modal-body">
          <div class="input-group">
            <label>Task</label>
            <input type="text" class="input" id="new-action-text" placeholder="What needs to be done?" autofocus>
          </div>
          <div class="input-group">
            <label>Assignee <span class="text-tertiary">(optional)</span></label>
            <input type="text" class="input" id="new-action-assignee" placeholder="Who is responsible?">
          </div>
        </div>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-primary" id="save-action">Add</button>
        </div>
      `);

      document.getElementById('save-action').addEventListener('click', () => {
        const text = document.getElementById('new-action-text').value.trim();
        if (!text) return;
        const assignee = document.getElementById('new-action-assignee').value.trim();
        Storage.addActionItem(meetingId, { text, assignee });
        this.closeModal();
        this.toast('Action item added', 'success');
        this.navigate(`meeting/${meetingId}`);
      });
    });

    // Save notes
    document.getElementById('save-notes')?.addEventListener('click', () => {
      const m = Storage.getMeeting(meetingId);
      if (m) {
        m.notes = document.getElementById('meeting-notes').value;
        Storage.saveMeeting(m);
        this.toast('Notes saved', 'success');
      }
    });

    // Export (T13)
    document.getElementById('detail-export-md')?.addEventListener('click', () => {
      this._openExportModal(meetingId);
    });

    // Delete
    document.getElementById('detail-delete')?.addEventListener('click', () => {
      this.showModal(`
        <div class="modal-header">
          <h3>Delete Meeting?</h3>
          <button class="btn btn-ghost btn-icon" onclick="App.closeModal()">✕</button>
        </div>
        <p class="text-sm text-secondary">This will permanently delete "${Utils.escapeHtml(meeting.title)}" and all associated data.</p>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-danger" id="confirm-delete-meeting">Delete</button>
        </div>
      `);
      document.getElementById('confirm-delete-meeting').addEventListener('click', async () => {
        await Promise.allSettled(this._audioIdsForMeeting(meeting).map(id => AudioStorage.delete(id).catch(error => {
          console.warn('Could not remove recording audio:', error);
        })));
        Storage.deleteMeeting(meetingId);
        await Storage.flush();
        this.closeModal();
        this.toast('Meeting deleted', 'warning');
        this._updateMeetingsCount();
        this.navigate('dashboard');
      });
    });

    // Audio player
    if (meeting.audioId || meeting.audioBlob) {
      const playBtn = document.getElementById('detail-play');
      const progressBar = document.getElementById('detail-progress');
      const progressFill = document.getElementById('detail-progress-fill');
      const audioTime = document.getElementById('detail-audio-time');
      let audio = null;
      let isPlaying = false;

      let audioUrl = null;

      playBtn?.addEventListener('click', async () => {
        if (!audio) {
          playBtn.disabled = true;
          try {
            const blob = meeting.audioId
              ? await AudioStorage.get(meeting.audioId)
              : Recorder.base64ToBlob(meeting.audioBlob);
            if (!blob) throw new Error('Recording audio was not found');
            audioUrl = URL.createObjectURL(blob);
            audio = new Audio(audioUrl);
          } catch (error) {
            this.toast(`Could not load audio: ${error.message}`, 'error');
            return;
          } finally {
            playBtn.disabled = false;
          }

          audio.addEventListener('timeupdate', () => {
            const pct = (audio.currentTime / audio.duration) * 100;
            progressFill.style.width = `${pct}%`;
            audioTime.textContent = Utils.formatTimestamp(audio.currentTime);
          });
          audio.addEventListener('ended', () => {
            isPlaying = false;
            playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
          });
        }

        if (isPlaying) {
          audio.pause();
          isPlaying = false;
          playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><polygon points="5 3 19 12 5 21 5 3"/></svg>';
        } else {
          audio.play();
          isPlaying = true;
          playBtn.innerHTML = '<svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="4" width="4" height="16"/><rect x="14" y="4" width="4" height="16"/></svg>';
        }
      });

      progressBar?.addEventListener('click', (e) => {
        if (!audio) return;
        const rect = progressBar.getBoundingClientRect();
        const pct = (e.clientX - rect.left) / rect.width;
        audio.currentTime = pct * audio.duration;
      });
    }
  },

  /* ══════════════════════════════════════════
     VIEW: All Meetings
     ══════════════════════════════════════════ */

  // §10.3/WHY-8: filter+group state lives here, not in the DOM. A reload
  // resets it (in-memory only), same scope as the other App._* view state.
  _meetingsView: { mode: 'list', text: '', tags: new Set() },

  // AND between the text filter and the tag filter; OR between selected
  // tags (BR-72). `matchText` keeps the exact same semantics the old
  // show/hide-DOM filter had — matches against the title only.
  _visibleMeetings(meetings) {
    const view = this._meetingsView;
    const text = (view.text || '').toLowerCase().trim();
    return meetings.filter(meeting => {
      const matchesText = !text || (meeting.title || '').toLowerCase().includes(text);
      const matchesTags = view.tags.size === 0 ||
        (meeting.tags || []).some(tag => view.tags.has(tag.toLowerCase()));
      return matchesText && matchesTags;
    });
  },

  _tagFilterBarHtml(meetings) {
    const entries = collectTags(meetings);
    if (entries.length === 0) return '';
    const chips = entries.map(entry => {
      const key = entry.tag.toLowerCase();
      const active = this._meetingsView.tags.has(key);
      return `<button type="button" class="tag-filter-chip ${active ? 'is-active' : ''}" style="${tagStyle(entry.tag)}" data-tag="${Utils.escapeHtml(key)}">${Utils.escapeHtml(entry.tag)} <span class="tag-filter-count">${entry.count}</span></button>`;
    }).join('');
    return `<div class="tag-filter-bar" id="tag-filter-bar" style="margin-bottom: var(--space-4);">${chips}</div>`;
  },

  // BR-74: 1 meeting with N tags appears in N blocks, block order follows
  // collectTags' recency/frequency ranking, "Chưa gắn tag" always last.
  _renderMeetingsByTag(meetings, allMeetingsForOrder) {
    const groups = new Map();
    const untagged = [];
    for (const meeting of meetings) {
      const tags = meeting.tags || [];
      if (tags.length === 0) { untagged.push(meeting); continue; }
      for (const tag of tags) {
        const key = tag.toLowerCase();
        if (!groups.has(key)) groups.set(key, { label: tag, items: [] });
        groups.get(key).items.push(meeting);
      }
    }
    const blocks = [];
    for (const entry of collectTags(allMeetingsForOrder)) {
      const group = groups.get(entry.tag.toLowerCase());
      if (!group || group.items.length === 0) continue;
      blocks.push(`
        <div class="meeting-tag-group">
          <h4 class="meeting-tag-group-heading" style="${tagStyle(group.label)}">${Utils.escapeHtml(group.label)}</h4>
          <div>${group.items.map(m => this._renderMeetingItem(m, { selectable: true })).join('')}</div>
        </div>
      `);
    }
    if (untagged.length > 0) {
      blocks.push(`
        <div class="meeting-tag-group">
          <h4 class="meeting-tag-group-heading">Chưa gắn tag</h4>
          <div>${untagged.map(m => this._renderMeetingItem(m, { selectable: true })).join('')}</div>
        </div>
      `);
    }
    return blocks.join('');
  },

  // The inner content of #meetings-list-container — split out so re-filtering
  // can replace just this node without recreating the search input (which
  // would drop keyboard focus on every keystroke).
  _meetingsListInnerHtml(allMeetings) {
    if (allMeetings.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-icon">📋</div>
          <h3>No meetings yet</h3>
          <p>Create your first meeting to get started.</p>
          <button class="btn btn-primary" style="margin-top: var(--space-4);" onclick="App.navigate('new')">Create Meeting</button>
        </div>
      `;
    }
    const visible = this._visibleMeetings(allMeetings);
    if (visible.length === 0) {
      return `
        <div class="empty-state">
          <div class="empty-icon">🔍</div>
          <h3>No meetings match this filter</h3>
        </div>
      `;
    }
    if (this._meetingsView.mode === 'byTag') {
      return this._renderMeetingsByTag(visible, allMeetings);
    }
    return `<div id="meetings-list">${visible.map(m => this._renderMeetingItem(m, { selectable: true })).join('')}</div>`;
  },

  _renderAllMeetings() {
    const meetings = Storage.getAllMeetings();
    const selectableIds = new Set(
      meetings.filter(meeting => !['recording', 'processing'].includes(meeting.status)).map(meeting => meeting.id)
    );
    this._selectedMeetingIds = new Set([...this._selectedMeetingIds].filter(id => selectableIds.has(id)));
    const view = this._meetingsView;

    return `
      <div class="view-enter">
        <div class="meetings-list-header" style="margin-bottom: var(--space-4);">
          <div class="search-box" style="width: 320px;">
            <svg class="search-icon" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
            <input type="text" class="input" id="meetings-filter" placeholder="Filter meetings..." value="${Utils.escapeHtml(view.text)}">
          </div>
          <div class="flex gap-2" id="meetings-view-toggle">
            <button class="btn btn-secondary btn-sm ${view.mode === 'list' ? 'is-active' : ''}" id="meetings-view-list" type="button">Danh sách</button>
            <button class="btn btn-secondary btn-sm ${view.mode === 'byTag' ? 'is-active' : ''}" id="meetings-view-byTag" type="button">Theo tag</button>
          </div>
          <button class="btn btn-primary btn-sm" onclick="App.navigate('new')">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><line x1="12" y1="5" x2="12" y2="19"/><line x1="5" y1="12" x2="19" y2="12"/></svg>
            New Meeting
          </button>
        </div>

        ${this._tagFilterBarHtml(meetings)}

        ${meetings.length > 0 ? `
          <div class="meeting-selection-toolbar" id="meeting-selection-toolbar">
            <label class="checkbox meeting-select-all-label">
              <input type="checkbox" id="select-all-meetings" aria-label="Select all visible meetings">
              <span>Select all</span>
            </label>
            <span class="text-sm text-secondary" id="meeting-selection-count">0 selected</span>
            <button class="btn btn-danger btn-sm" id="delete-selected-meetings" type="button" disabled>
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/></svg>
              Delete selected
            </button>
          </div>
        ` : ''}

        <div class="card" style="padding: 0;" id="meetings-list-container">
          ${this._meetingsListInnerHtml(meetings)}
        </div>
      </div>
    `;
  },

  // Re-renders just the list container + tag bar from current state, without
  // touching the search input (keeps keyboard focus while typing).
  _refreshMeetingsList() {
    const meetings = Storage.getAllMeetings();
    const selectableIds = new Set(
      meetings.filter(meeting => !['recording', 'processing'].includes(meeting.status)).map(meeting => meeting.id)
    );
    this._selectedMeetingIds = new Set([...this._selectedMeetingIds].filter(id => selectableIds.has(id)));

    const container = document.getElementById('meetings-list-container');
    if (container) container.innerHTML = this._meetingsListInnerHtml(meetings);

    const oldTagBar = document.getElementById('tag-filter-bar');
    const newTagBarHtml = this._tagFilterBarHtml(meetings);
    if (oldTagBar) {
      if (newTagBarHtml) oldTagBar.outerHTML = newTagBarHtml;
      else oldTagBar.remove();
    }

    document.getElementById('meetings-view-list')?.classList.toggle('is-active', this._meetingsView.mode === 'list');
    document.getElementById('meetings-view-byTag')?.classList.toggle('is-active', this._meetingsView.mode === 'byTag');

    this._bindMeetingItemClicks();
    this._bindMeetingSelectionHandlers();
  },

  _bindAllMeetings() {
    this._bindMeetingItemClicks();
    this._bindMeetingSelectionHandlers();

    // Text filter (BR-30's counterpart in the library — not the global
    // search). Debounced re-render from data, not DOM show/hide (WHY-8).
    const filterInput = document.getElementById('meetings-filter');
    filterInput?.addEventListener('input', Utils.debounce(() => {
      this._meetingsView.text = filterInput.value;
      this._refreshMeetingsList();
    }, 200));

    // Tag filter chips — click toggles membership in the OR-set (BR-72).
    document.getElementById('tag-filter-bar')?.addEventListener('click', event => {
      const chip = event.target.closest('.tag-filter-chip');
      if (!chip) return;
      const tag = chip.dataset.tag;
      if (this._meetingsView.tags.has(tag)) this._meetingsView.tags.delete(tag);
      else this._meetingsView.tags.add(tag);
      this._refreshMeetingsList();
    });

    // View mode toggle (BR-74).
    document.getElementById('meetings-view-list')?.addEventListener('click', () => {
      this._meetingsView.mode = 'list';
      this._refreshMeetingsList();
    });
    document.getElementById('meetings-view-byTag')?.addEventListener('click', () => {
      this._meetingsView.mode = 'byTag';
      this._refreshMeetingsList();
    });
  },

  // Selection checkboxes + bulk delete. Re-bound after every
  // _refreshMeetingsList() call since the list container's innerHTML (and
  // therefore its checkboxes) is replaced on every filter/tag/mode change —
  // `_selectedMeetingIds` itself is the source of truth and survives that,
  // per Architecture §10.3's "chọn nhiều + đổi bộ lọc vẫn đúng" requirement.
  _bindMeetingSelectionHandlers() {
    const updateSelectionUi = () => {
      const selectedCount = this._selectedMeetingIds.size;
      const count = document.getElementById('meeting-selection-count');
      const deleteButton = document.getElementById('delete-selected-meetings');
      if (count) count.textContent = `${selectedCount} selected`;
      if (deleteButton) deleteButton.disabled = selectedCount === 0;

      const visibleCheckboxes = [...document.querySelectorAll('.meeting-select-checkbox:not(:disabled)')];
      const selectedVisible = visibleCheckboxes.filter(checkbox => checkbox.checked).length;
      const selectAll = document.getElementById('select-all-meetings');
      if (selectAll) {
        selectAll.checked = visibleCheckboxes.length > 0 && selectedVisible === visibleCheckboxes.length;
        selectAll.indeterminate = selectedVisible > 0 && selectedVisible < visibleCheckboxes.length;
        selectAll.disabled = visibleCheckboxes.length === 0;
      }
    };

    document.querySelectorAll('.meeting-item').forEach(item => {
      const checkbox = item.querySelector('.meeting-select-checkbox');
      if (checkbox) checkbox.checked = this._selectedMeetingIds.has(item.dataset.meetingId);
      item.classList.toggle('is-selected', this._selectedMeetingIds.has(item.dataset.meetingId));
    });

    document.querySelectorAll('.meeting-select-checkbox').forEach(checkbox => {
      checkbox.addEventListener('change', event => {
        const id = event.currentTarget.closest('.meeting-item')?.dataset.meetingId;
        if (!id) return;
        if (event.currentTarget.checked) this._selectedMeetingIds.add(id);
        else this._selectedMeetingIds.delete(id);
        event.currentTarget.closest('.meeting-item')?.classList.toggle('is-selected', event.currentTarget.checked);
        updateSelectionUi();
      });
    });

    document.getElementById('select-all-meetings')?.addEventListener('change', event => {
      document.querySelectorAll('.meeting-item').forEach(item => {
        const checkbox = item.querySelector('.meeting-select-checkbox:not(:disabled)');
        if (!checkbox) return;
        checkbox.checked = event.currentTarget.checked;
        item.classList.toggle('is-selected', checkbox.checked);
        if (checkbox.checked) this._selectedMeetingIds.add(item.dataset.meetingId);
        else this._selectedMeetingIds.delete(item.dataset.meetingId);
      });
      updateSelectionUi();
    });

    document.getElementById('delete-selected-meetings')?.addEventListener('click', () => {
      const ids = [...this._selectedMeetingIds].filter(id => Storage.getMeeting(id));
      if (!ids.length) return;
      this.showModal(`
        <div class="modal-header">
          <h3>Delete ${ids.length} meetings?</h3>
          <button class="btn btn-ghost btn-icon" id="cancel-bulk-delete" type="button">✕</button>
        </div>
        <p class="text-sm text-secondary">This permanently deletes the selected meetings, recordings, transcripts, and summaries. This action cannot be undone.</p>
        <div class="modal-footer">
          <button class="btn btn-secondary" id="cancel-bulk-delete-footer" type="button">Cancel</button>
          <button class="btn btn-danger" id="confirm-bulk-delete" type="button">Delete ${ids.length} meetings</button>
        </div>
      `);
      document.getElementById('cancel-bulk-delete')?.addEventListener('click', () => this.closeModal());
      document.getElementById('cancel-bulk-delete-footer')?.addEventListener('click', () => this.closeModal());
      document.getElementById('confirm-bulk-delete')?.addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.textContent = 'Deleting…';
        const audioIds = ids.flatMap(id => this._audioIdsForMeeting(Storage.getMeeting(id) || { id }));
        const audioResults = await Promise.allSettled(audioIds.map(id => AudioStorage.delete(id)));
        Storage.deleteMultipleMeetings(ids);
        try {
          await Storage.flush();
          this._selectedMeetingIds.clear();
          this.closeModal();
          this._updateMeetingsCount();
          const audioFailures = audioResults.filter(result => result.status === 'rejected').length;
          this.toast(
            audioFailures ? `${ids.length} meetings deleted; ${audioFailures} audio files could not be removed.` : `${ids.length} meetings deleted.`,
            audioFailures ? 'warning' : 'success'
          );
          this.navigate('meetings', { force: true });
        } catch (error) {
          button.disabled = false;
          button.textContent = `Delete ${ids.length} meetings`;
          this.toast(`Could not delete meetings: ${error.message}`, 'error');
        }
      });
    });

    updateSelectionUi();
  },

  /* ══════════════════════════════════════════
     VIEW: Search
     ══════════════════════════════════════════ */

  _renderSearch() {
    return `
      <div class="view-enter">
        <div class="search-box" style="margin-bottom: var(--space-6);">
          <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="11" cy="11" r="8"/><line x1="21" y1="21" x2="16.65" y2="16.65"/></svg>
          <input type="text" class="input input-lg" id="search-input" placeholder="Search across all meetings, transcripts, notes..." autofocus>
        </div>

        <div id="search-results">
          <div class="empty-state" id="search-empty">
            <div class="empty-icon">🔍</div>
            <h3>Search your meetings</h3>
            <p>Find anything across titles, transcripts, notes, and action items.</p>
          </div>
        </div>
      </div>
    `;
  },

  _bindSearch() {
    const input = document.getElementById('search-input');
    const results = document.getElementById('search-results');

    input?.addEventListener('input', Utils.debounce(() => {
      const q = input.value.trim();
      if (!q) {
        results.innerHTML = `
          <div class="empty-state" id="search-empty">
            <div class="empty-icon">🔍</div>
            <h3>Search your meetings</h3>
            <p>Find anything across titles, transcripts, notes, and action items.</p>
          </div>
        `;
        return;
      }

      const searchResults = Storage.searchMeetings(q);
      if (searchResults.length === 0) {
        results.innerHTML = `
          <div class="empty-state">
            <div class="empty-icon">😕</div>
            <h3>No results found</h3>
            <p>Try a different search term.</p>
          </div>
        `;
        return;
      }

      results.innerHTML = `
        <p class="text-sm text-secondary" style="margin-bottom: var(--space-4);">${searchResults.length} result${searchResults.length !== 1 ? 's' : ''} found</p>
        <div class="flex flex-col gap-3">
          ${searchResults.map(r => `
            <div class="card card-interactive search-result" data-meeting-id="${Utils.escapeHtml(r.meeting.id)}">
              <div class="flex items-center justify-between" style="margin-bottom: var(--space-2);">
                <strong style="font-size: var(--text-sm);">${Utils.highlightText(r.meeting.title, q)}</strong>
                <span class="text-xs text-tertiary">${Utils.formatRelativeTime(r.meeting.date)}</span>
              </div>
              ${r.snippets.map(s => `
                <div class="text-sm text-secondary" style="margin-top: var(--space-2); padding-left: var(--space-3); border-left: 2px solid var(--border-default);">
                  <span class="text-xs text-tertiary">${Utils.escapeHtml(s.field)}${s.speaker ? ` · ${Utils.escapeHtml(s.speaker)}` : ''}</span>
                  <div>${Utils.highlightText(s.text.substring(0, 150), q)}${s.text.length > 150 ? '...' : ''}</div>
                </div>
              `).join('')}
            </div>
          `).join('')}
        </div>
      `;

      // Bind clicks
      results.querySelectorAll('.search-result').forEach(el => {
        el.addEventListener('click', () => {
          App.navigate(`meeting/${el.dataset.meetingId}`);
        });
      });
    }, 300));
  },

  /* ══════════════════════════════════════════
     VIEW: Report a Bug
     ══════════════════════════════════════════ */

  _renderBugReport() {
    return `
      <div class="view-enter report-bug-view">
        <div class="card report-bug-card">
          <div class="report-bug-heading">
            <div class="report-bug-icon">🐞</div>
            <div>
              <h2>Tell us what went wrong</h2>
              <p class="text-sm text-secondary">Describe the issue, download the diagnostic JSON, then send that file to Nguyen Leon through the support channel provided to you.</p>
            </div>
          </div>

          <form id="bug-report-form" class="report-bug-form">
            <label class="input-group">
              <span class="form-label">Short summary</span>
              <input class="input" id="bug-report-summary" maxlength="200" required placeholder="Example: Recording stops after 10 minutes">
            </label>
            <label class="input-group">
              <span class="form-label">What happened?</span>
              <textarea class="input bug-report-description" id="bug-report-description" maxlength="10000" rows="7" required placeholder="What were you doing, what did you expect, and what happened instead?"></textarea>
            </label>
            <label class="input-group">
              <span class="form-label">Contact email <span class="text-tertiary">(optional)</span></span>
              <input class="input" id="bug-report-contact" type="email" maxlength="320" placeholder="you@example.com">
            </label>
            <div class="diagnostic-privacy-note">
              <strong>Included:</strong> app/device information, meeting counts, provider names, and recent diagnostic logs.<br>
              <strong>Excluded:</strong> meeting content, recordings, titles, and credentials.<br>
              <strong>Important:</strong> downloading the report does not send it automatically.
            </div>
            <div class="report-bug-actions">
              <button class="btn btn-primary" id="create-bug-report" type="submit">Create &amp; Download Report</button>
            </div>
          </form>
        </div>
      </div>
    `;
  },

  _bindBugReport() {
    const form = document.getElementById('bug-report-form');
    form?.addEventListener('submit', async event => {
      event.preventDefault();
      const summary = document.getElementById('bug-report-summary').value.trim();
      const description = document.getElementById('bug-report-description').value.trim();
      const contact = document.getElementById('bug-report-contact').value.trim();
      if (!summary || !description) {
        this.toast('Add a summary and description before creating the report.', 'warning');
        return;
      }

      const button = document.getElementById('create-bug-report');
      button.disabled = true;
      button.textContent = 'Creating report…';
      try {
        const response = await fetch('/api/bug-reports', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ summary, description, contact })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not create bug report');

        const blob = new Blob([`${JSON.stringify(data.report, null, 2)}\n`], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const link = document.createElement('a');
        link.href = url;
        link.download = data.filename || 'meetnote-bug-report.json';
        document.body.appendChild(link);
        link.click();
        link.remove();
        window.setTimeout(() => URL.revokeObjectURL(url), 1000);

        form.reset();
        this.toast(`Bug report ${data.report.id.slice(0, 8)} created and downloaded.`, 'success');
        this._logClientEvent('info', 'bug_report_downloaded', 'User downloaded a bug report', {
          reportId: data.report.id
        });
      } catch (error) {
        this.toast(error.message, 'error');
      } finally {
        button.disabled = false;
        button.textContent = 'Create & Download Report';
      }
    });
    document.getElementById('bug-report-summary')?.focus();
  },

  /* ══════════════════════════════════════════
     VIEW: Settings
     ══════════════════════════════════════════ */

  _renderSettings() {
    const settings = Storage.getSettings();
    const stats = Storage.getStats();
    const languages = Transcriber.getSupportedLanguages();
    const langOptions = `<option value="auto" ${settings.language === 'auto' ? 'selected' : ''}>Auto-detect multilingual</option>` + languages.map(l =>
      `<option value="${l.code}" ${l.code === settings.language ? 'selected' : ''}>${l.name}</option>`
    ).join('');
    const translationOptions = Transcriber.getTranslationLanguages().map(language =>
      `<option value="${language.sonioxCode}" ${language.sonioxCode === settings.translationLanguage ? 'selected' : ''}>${language.name}</option>`
    ).join('');

    return `
      <div class="view-enter" style="max-width: 700px;">
        <!-- General -->
        <div class="settings-section">
          <h3 style="margin-bottom: var(--space-4);">General</h3>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4>Default Spoken Language</h4>
              <p>Expected language, or auto-detect for multilingual meetings</p>
            </div>
            <select class="input" id="setting-language" style="width: 200px;">
              ${langOptions}
            </select>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4>Appearance</h4>
              <p>Choose the app color theme</p>
            </div>
            <select class="input" id="setting-theme" style="width: 200px;">
              <option value="dark" ${settings.theme === 'dark' ? 'selected' : ''}>Dark</option>
              <option value="light" ${settings.theme === 'light' ? 'selected' : ''}>Light</option>
              <option value="system" ${settings.theme === 'system' ? 'selected' : ''}>Follow system</option>
            </select>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4>Default Translate To</h4>
              <p>Language used for Soniox live translated captions</p>
            </div>
            <select class="input" id="setting-translation-language" style="width: 200px;">
              <option value="">Off</option>
              ${translationOptions}
            </select>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4>Show Timestamps</h4>
              <p>Display timestamps in transcript view</p>
            </div>
            <label class="toggle">
              <input type="checkbox" id="setting-timestamps" ${settings.showTimestamps ? 'checked' : ''}>
            </label>
          </div>
        </div>

        <!-- Speech & Translation -->
        <div class="settings-section">
          <h3 style="margin-bottom: var(--space-2);">Speech &amp; Translation</h3>
          <p class="text-sm text-secondary" style="margin-bottom: var(--space-4);">Secrets stay in the operating system's secure credential storage — macOS Keychain or Windows DPAPI — and are never returned to the browser. The selected provider transcribes <strong>uploaded recordings</strong>, and also <strong>live recording</strong> when it supports streaming (Soniox, Deepgram). Whisper and Google are upload-only; live recording falls back to Soniox.</p>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4>Default Provider</h4>
              <p>Used to transcribe uploaded recordings</p>
            </div>
            <select class="input" id="setting-stt-provider" style="width: 220px;"></select>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4>Model</h4>
              <p>Model used for the selected provider</p>
            </div>
            <select class="input" id="setting-stt-model" style="width: 220px;"></select>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4 id="stt-status-name">Provider status</h4>
              <p id="stt-status-text">Checking configuration…</p>
            </div>
            <span class="badge badge-warning" id="stt-status-badge">Checking</span>
          </div>

          <div id="stt-key-controls" style="display:none;">
            <div class="settings-row">
              <div class="settings-row-info">
                <h4 id="stt-key-label">API Key</h4>
                <p>Protected by macOS Keychain or Windows DPAPI. Never returned to the browser.</p>
              </div>
              <input type="password" class="input" id="setting-stt-key" placeholder="Enter API key" autocomplete="off" style="width: 280px;">
            </div>
            <div class="flex gap-2" style="margin-top: var(--space-2);">
              <button class="btn btn-secondary btn-sm" id="stt-save-key">Save Key</button>
              <button class="btn btn-ghost btn-sm" id="stt-remove-key">Remove Key</button>
            </div>
          </div>
          <div class="flex gap-2" style="margin-top: var(--space-3);">
            <button class="btn btn-secondary btn-sm" id="stt-test-key">Test Connection</button>
          </div>
        </div>

        <!-- Meeting Notes AI -->
        <div class="settings-section">
          <h3 style="margin-bottom: var(--space-2);">Meeting Notes AI</h3>
          <p class="text-sm text-secondary" style="margin-bottom: var(--space-4);">Transcript text is sent to the selected provider to generate summaries and title suggestions. Audio is never sent.</p>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4>Default Provider</h4>
              <p>Used when generating summaries and titles</p>
            </div>
            <select class="input" id="setting-llm-provider" style="width: 220px;"></select>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4>Model</h4>
              <p>Model used for the selected provider</p>
            </div>
            <select class="input" id="setting-llm-model" style="width: 220px;"></select>
          </div>

          <div class="settings-row">
            <div class="settings-row-info">
              <h4 id="llm-status-name">Provider status</h4>
              <p id="llm-status-text">Checking configuration…</p>
            </div>
            <span class="badge badge-warning" id="llm-status-badge">Checking</span>
          </div>

          <div id="llm-key-controls" style="display:none;">
            <div class="settings-row">
              <div class="settings-row-info">
                <h4 id="llm-key-label">API Key</h4>
                <p>Protected by macOS Keychain or Windows DPAPI. Never returned to the browser.</p>
              </div>
              <input type="password" class="input" id="setting-llm-key" placeholder="Enter API key" autocomplete="off" style="width: 280px;">
            </div>
            <div class="flex gap-2" style="margin-top: var(--space-2);">
              <button class="btn btn-secondary btn-sm" id="llm-save-key">Save Key</button>
              <button class="btn btn-ghost btn-sm" id="llm-remove-key">Remove Key</button>
            </div>
          </div>
          <div class="card" id="llm-cli-setup" style="display:none; margin-top: var(--space-3);">
            <strong class="text-sm">Connect Codex</strong>
            <p class="text-sm text-secondary" style="margin-top: var(--space-2);">Install the Codex CLI, then run <code>codex login</code> in Terminal or PowerShell. Return here and check the connection.</p>
          </div>
          <div class="flex gap-2" style="margin-top: var(--space-3);">
            <button class="btn btn-secondary btn-sm" id="llm-test-key">Test Connection</button>
          </div>
        </div>

        <!-- Summary Presets -->
        <div class="settings-section">
          <h3 style="margin-bottom: var(--space-2);">Summary Presets</h3>
          <p class="text-sm text-secondary" style="margin-bottom: var(--space-1);">Preset tóm tắt được lưu chung cho mọi người dùng trên máy này — không có tài khoản hay phân quyền riêng (BR-21).</p>
          <p class="text-xs text-tertiary" style="margin-bottom: var(--space-4);">Không nhập thông tin bí mật vào hướng dẫn cho AI — nội dung này được gửi tới nhà cung cấp AI đã chọn (BR-22).</p>
          <div id="presets-list" class="flex flex-col gap-2" style="margin-bottom: var(--space-3);">Đang tải…</div>
          <button class="btn btn-secondary btn-sm" id="preset-create-new" type="button">+ Tạo preset mới</button>
        </div>

        <!-- Export (T13, BR-42..BR-44) -->
        <div class="settings-section">
          <h3 style="margin-bottom: var(--space-2);">Xuất file</h3>
          <p class="text-sm text-secondary" style="margin-bottom: var(--space-4);">Thư mục lưu file .md khi export cuộc họp. Đường dẫn phải tuyệt đối và nằm ngoài thư mục dữ liệu/cài đặt của MeetNote.</p>
          <div class="settings-row">
            <div class="settings-row-info">
              <h4>Thư mục lưu file .md</h4>
              <p id="export-dir-status">Đang tải…</p>
            </div>
            <input type="text" class="input" id="export-dir-input" placeholder="/Users/ban/Documents/MeetNote" style="width: 320px;">
          </div>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm" id="export-dir-check" type="button">Kiểm tra thư mục</button>
            <button class="btn btn-primary btn-sm" id="export-dir-save" type="button">Lưu thư mục</button>
          </div>
        </div>

        <!-- Data -->
        <div class="settings-section">
          <h3 style="margin-bottom: var(--space-4);">Data Management</h3>

          <div class="card" style="margin-bottom: var(--space-4);">
            <div class="flex items-center justify-between">
              <div>
                <strong class="text-sm">${stats.totalMeetings}</strong> <span class="text-sm text-secondary">meetings</span>
                <span class="text-tertiary" style="margin: 0 var(--space-2);">·</span>
                <strong class="text-sm">${stats.totalHours}</strong> <span class="text-sm text-secondary">hours</span>
                <span class="text-tertiary" style="margin: 0 var(--space-2);">·</span>
                <strong class="text-sm">${stats.totalActions}</strong> <span class="text-sm text-secondary">action items</span>
              </div>
            </div>
          </div>

          <div class="flex gap-3">
            <button class="btn btn-secondary btn-sm" id="setting-export">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="7 10 12 15 17 10"/><line x1="12" y1="15" x2="12" y2="3"/></svg>
              Export Backup
            </button>
            <button class="btn btn-secondary btn-sm" id="setting-import">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M21 15v4a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2v-4"/><polyline points="17 8 12 3 7 8"/><line x1="12" y1="3" x2="12" y2="15"/></svg>
              Import Backup
            </button>
            <button class="btn btn-danger btn-sm" id="setting-clear">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polyline points="3 6 5 6 21 6"/><path d="M19 6l-2 14H7L5 6"/></svg>
              Clear All Data
            </button>
          </div>
          <p class="text-xs text-tertiary" style="margin-top: var(--space-3);">
            Backups include meeting metadata, transcripts, notes, actions, and settings. Audio recordings remain in <code>storage/audio</code>.
          </p>
          <input type="file" id="import-file-input" accept=".json" style="display:none;">
        </div>

        <!-- Support & diagnostics -->
        <div class="settings-section">
          <h3 style="margin-bottom: var(--space-2);">Support & Diagnostics</h3>
          <p class="text-sm text-secondary" style="margin-bottom: var(--space-4);">
            MeetNote keeps a small rotating local log to help diagnose crashes and failed operations.
          </p>
          <div class="flex gap-3 flex-wrap">
            <button class="btn btn-primary btn-sm" id="setting-bug-report" type="button">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M8 2h8l1 4H7l1-4Z"/><rect x="5" y="6" width="14" height="15" rx="3"/><path d="M2 13h3M19 13h3M9 11v5M15 11v5"/></svg>
              Report a Bug
            </button>
            <button class="btn btn-secondary btn-sm" id="setting-view-logs" type="button">View Recent Logs</button>
          </div>
          <p class="text-xs text-tertiary" style="margin-top: var(--space-3);">
            Bug reports exclude recordings, transcripts, translations, notes, summaries, action items, meeting titles, and API keys.
          </p>
        </div>

        <!-- Save -->
        <div style="margin-top: var(--space-6);">
          <button class="btn btn-primary" id="save-settings">Save Settings</button>
        </div>

        <!-- About -->
        <div class="settings-section" style="border-bottom: none;">
          <div class="text-sm text-tertiary" style="text-align: center; padding: var(--space-4);">
            <strong>MeetNote AI</strong> v1.1.1 · Local-first · Built with ❤️<br>
            Credit by <a class="creator-credit" href="https://nguyenleon.com" target="_blank" rel="noopener noreferrer">Nguyen Leon</a><br>
            Meeting data and recordings are stored locally on this device. Speech recognition and configured AI features may send audio or text to the selected service.
          </div>
        </div>
      </div>
    `;
  },

  /* ══════════════════════════════════════════
     Summary Presets management (T14)
     ══════════════════════════════════════════ */

  async _loadPresetsSettings() {
    const container = document.getElementById('presets-list');
    if (!container) return;
    try {
      const presets = await Presets.list({ force: true });
      container.innerHTML = presets.map(preset => `
        <div class="settings-row" data-preset-id="${Utils.escapeHtml(preset.id)}">
          <div class="settings-row-info">
            <h4>${Utils.escapeHtml(preset.name)} ${preset.isBuiltIn ? '<span class="badge badge-primary">Mẫu</span>' : ''}</h4>
            <p>${preset.sections.length} mục${preset.description ? ` · ${Utils.escapeHtml(preset.description)}` : ''}</p>
          </div>
          <div class="flex gap-2">
            <button class="btn btn-secondary btn-sm preset-edit" data-preset-id="${Utils.escapeHtml(preset.id)}" type="button">Sửa</button>
            <button class="btn btn-danger btn-sm preset-delete" data-preset-id="${Utils.escapeHtml(preset.id)}" type="button">Xóa</button>
          </div>
        </div>
      `).join('') || '<p class="text-sm text-tertiary">Chưa có preset nào.</p>';

      container.querySelectorAll('.preset-edit').forEach(btn => {
        btn.addEventListener('click', () => this._openPresetEditor(btn.dataset.presetId));
      });
      container.querySelectorAll('.preset-delete').forEach(btn => {
        btn.addEventListener('click', () => this._deletePreset(btn.dataset.presetId));
      });
    } catch (error) {
      container.innerHTML = `<p class="text-sm" style="color:var(--color-warning);">Không thể tải danh sách preset: ${Utils.escapeHtml(error.message)}</p>`;
    }
  },

  async _deletePreset(id) {
    if (!confirm('Xóa preset này? Các bản tóm tắt đã tạo bằng preset này vẫn giữ nguyên nội dung (BR-17, BR-18).')) return;
    try {
      await Presets.remove(id);
      this.toast('Đã xóa preset', 'success');
      this._loadPresetsSettings();
    } catch (error) {
      this.toast(error.message || 'Không thể xóa preset', 'error');
    }
  },

  async _openPresetEditor(id) {
    let preset = null;
    if (id) {
      const presets = await Presets.list().catch(() => []);
      preset = presets.find(p => p.id === id) || null;
    }
    this._presetEditorState = {
      id: preset?.id || null,
      name: preset?.name || '',
      description: preset?.description || '',
      instruction: preset?.instruction || '',
      sections: preset
        ? preset.sections.map(s => ({ key: s.key, label: s.label, type: s.type, hint: s.hint || '' }))
        : [{ key: null, label: '', type: 'paragraph', hint: '' }]
    };
    this._renderPresetEditorModal();
  },

  _renderPresetEditorModal() {
    const state = this._presetEditorState;
    this.showModal(`
      <div class="modal-header">
        <h3>${state.id ? 'Sửa preset' : 'Tạo preset mới'}</h3>
        <button class="btn btn-ghost btn-icon" onclick="App.closeModal()">✕</button>
      </div>
      <div class="modal-body" style="max-height:60vh; overflow-y:auto;">
        <p class="text-xs" style="color:var(--color-warning); margin-bottom:var(--space-3);">Preset được lưu chung cho mọi người dùng máy này. Không nhập thông tin bí mật vào hướng dẫn — nội dung này được gửi tới nhà cung cấp AI.</p>
        <div class="input-group">
          <label>Tên preset</label>
          <input type="text" class="input" id="preset-name" value="${Utils.escapeHtml(state.name)}" maxlength="60">
        </div>
        <div class="input-group">
          <label>Mô tả <span class="text-tertiary">(tùy chọn)</span></label>
          <input type="text" class="input" id="preset-description" value="${Utils.escapeHtml(state.description)}" maxlength="300">
        </div>
        <div class="input-group">
          <label>Hướng dẫn cho AI <span class="text-tertiary">(tùy chọn)</span></label>
          <textarea class="input" id="preset-instruction" maxlength="2000" style="min-height:80px;">${Utils.escapeHtml(state.instruction)}</textarea>
        </div>
        <div class="input-group">
          <label>Các mục (section)</label>
          <div id="preset-sections">${this._renderPresetSectionsEditor()}</div>
          <button class="btn btn-secondary btn-sm" id="preset-add-section" type="button" style="margin-top:var(--space-2);">+ Thêm mục</button>
        </div>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" onclick="App.closeModal()">Hủy</button>
        <button class="btn btn-primary" id="preset-save" type="button">Lưu</button>
      </div>
    `);
    this._bindPresetEditorModal();
  },

  _renderPresetSectionsEditor() {
    const state = this._presetEditorState;
    return state.sections.map((section, index) => `
      <div class="card" style="margin-bottom:var(--space-2);" data-section-index="${index}">
        <div class="flex gap-2" style="align-items:flex-end; flex-wrap:wrap;">
          <div class="input-group" style="flex:1; min-width:160px;">
            <label>Tên mục</label>
            <input type="text" class="input input-sm preset-section-label" data-index="${index}" value="${Utils.escapeHtml(section.label)}" maxlength="60">
          </div>
          <div class="input-group" style="width:170px;">
            <label>Kiểu</label>
            <select class="input input-sm preset-section-type" data-index="${index}">
              <option value="paragraph" ${section.type === 'paragraph' ? 'selected' : ''}>Đoạn văn</option>
              <option value="bulletList" ${section.type === 'bulletList' ? 'selected' : ''}>Danh sách</option>
              <option value="actionList" ${section.type === 'actionList' ? 'selected' : ''}>Việc cần làm</option>
            </select>
          </div>
          <div class="flex gap-1">
            <button class="btn btn-ghost btn-icon btn-sm preset-section-up" data-index="${index}" type="button" title="Move up" ${index === 0 ? 'disabled' : ''}>↑</button>
            <button class="btn btn-ghost btn-icon btn-sm preset-section-down" data-index="${index}" type="button" title="Move down" ${index === state.sections.length - 1 ? 'disabled' : ''}>↓</button>
            <button class="btn btn-ghost btn-icon btn-sm preset-section-remove" data-index="${index}" type="button" title="Remove" ${state.sections.length <= 1 ? 'disabled' : ''}>✕</button>
          </div>
        </div>
        <div class="input-group" style="margin-top:var(--space-2);">
          <label>Gợi ý cho AI <span class="text-tertiary">(tùy chọn)</span></label>
          <input type="text" class="input input-sm preset-section-hint" data-index="${index}" value="${Utils.escapeHtml(section.hint)}" maxlength="300">
        </div>
      </div>
    `).join('');
  },

  _syncPresetEditorFields() {
    const state = this._presetEditorState;
    state.name = document.getElementById('preset-name')?.value ?? state.name;
    state.description = document.getElementById('preset-description')?.value ?? state.description;
    state.instruction = document.getElementById('preset-instruction')?.value ?? state.instruction;
  },

  // Bound once per modal render — add-section/save must not accumulate
  // duplicate listeners across _refreshPresetSectionsEditor() calls.
  _bindPresetEditorModal() {
    document.getElementById('preset-add-section')?.addEventListener('click', () => {
      this._syncPresetEditorFields();
      this._presetEditorState.sections.push({ key: null, label: '', type: 'paragraph', hint: '' });
      this._refreshPresetSectionsEditor();
    });

    document.getElementById('preset-save')?.addEventListener('click', async () => {
      this._syncPresetEditorFields();
      const state = this._presetEditorState;
      const payload = {
        name: state.name,
        description: state.description,
        instruction: state.instruction,
        sections: state.sections.map(s => ({ key: s.key || undefined, label: s.label, type: s.type, hint: s.hint }))
      };
      try {
        const result = state.id ? await Presets.update(state.id, payload) : await Presets.create(payload);
        (result.warnings || []).forEach(warning => this.toast(warning.message, 'info'));
        this.toast('Đã lưu preset', 'success');
        this.closeModal();
        this._loadPresetsSettings();
      } catch (error) {
        this.toast(error.message || 'Không thể lưu preset', 'error');
      }
    });

    this._bindPresetSectionItems();
  },

  // Re-bound after every section list change (rows are recreated).
  _bindPresetSectionItems() {
    const state = this._presetEditorState;
    document.querySelectorAll('.preset-section-label').forEach(el => {
      el.addEventListener('input', () => { state.sections[Number(el.dataset.index)].label = el.value; });
    });
    document.querySelectorAll('.preset-section-hint').forEach(el => {
      el.addEventListener('input', () => { state.sections[Number(el.dataset.index)].hint = el.value; });
    });
    document.querySelectorAll('.preset-section-type').forEach(el => {
      el.addEventListener('change', () => { state.sections[Number(el.dataset.index)].type = el.value; });
    });
    document.querySelectorAll('.preset-section-remove').forEach(el => {
      el.addEventListener('click', () => {
        this._syncPresetEditorFields();
        state.sections.splice(Number(el.dataset.index), 1);
        this._refreshPresetSectionsEditor();
      });
    });
    document.querySelectorAll('.preset-section-up').forEach(el => {
      el.addEventListener('click', () => {
        this._syncPresetEditorFields();
        const i = Number(el.dataset.index);
        if (i > 0) [state.sections[i - 1], state.sections[i]] = [state.sections[i], state.sections[i - 1]];
        this._refreshPresetSectionsEditor();
      });
    });
    document.querySelectorAll('.preset-section-down').forEach(el => {
      el.addEventListener('click', () => {
        this._syncPresetEditorFields();
        const i = Number(el.dataset.index);
        if (i < state.sections.length - 1) [state.sections[i + 1], state.sections[i]] = [state.sections[i], state.sections[i + 1]];
        this._refreshPresetSectionsEditor();
      });
    });
  },

  _refreshPresetSectionsEditor() {
    const container = document.getElementById('preset-sections');
    if (container) container.innerHTML = this._renderPresetSectionsEditor();
    this._bindPresetSectionItems();
  },

  /* ══════════════════════════════════════════
     Export settings (T11/T13, BR-42..BR-44)
     ══════════════════════════════════════════ */

  async _loadExportSettings() {
    const input = document.getElementById('export-dir-input');
    const status = document.getElementById('export-dir-status');
    if (!input || !status) return;
    try {
      const settings = await Exporter.getSettings();
      input.value = settings.markdownDir || settings.suggestedDir || '';
      status.textContent = settings.configured
        ? 'Đã cấu hình — bấm Export .md ở một cuộc họp bất kỳ để dùng.'
        : `Chưa cấu hình. Gợi ý: ${settings.suggestedDir}`;
    } catch (error) {
      status.textContent = `Không thể tải cấu hình: ${error.message}`;
    }
  },

  _bindExportSettings() {
    document.getElementById('export-dir-check')?.addEventListener('click', async event => {
      const value = document.getElementById('export-dir-input')?.value || '';
      const button = event.currentTarget;
      button.disabled = true;
      try {
        await Exporter.checkDirectory(value);
        this.toast('Thư mục hợp lệ và ghi được.', 'success');
      } catch (error) {
        this.toast(error.message || 'Thư mục không hợp lệ.', 'error');
      }
      button.disabled = false;
    });

    document.getElementById('export-dir-save')?.addEventListener('click', async event => {
      const value = document.getElementById('export-dir-input')?.value || '';
      const button = event.currentTarget;
      button.disabled = true;
      try {
        const result = await Exporter.saveSettings(value);
        document.getElementById('export-dir-input').value = result.markdownDir;
        const status = document.getElementById('export-dir-status');
        if (status) status.textContent = 'Đã cấu hình — bấm Export .md ở một cuộc họp bất kỳ để dùng.';
        this.toast('Đã lưu thư mục xuất file.', 'success');
      } catch (error) {
        this.toast(error.message || 'Không thể lưu thư mục.', 'error');
      }
      button.disabled = false;
    });
  },

  _bindSettings() {
    document.getElementById('setting-theme')?.addEventListener('change', event => {
      this._applyTheme(event.target.value);
    });

    this._refreshProviders('stt');
    this._bindProviderControls('stt');
    this._refreshProviders('llm');
    this._bindProviderControls('llm');

    this._loadPresetsSettings();
    document.getElementById('preset-create-new')?.addEventListener('click', () => this._openPresetEditor(null));

    this._loadExportSettings();
    this._bindExportSettings();

    // Resolve a provider/model selection, blocking a not-ready default. Returns
    // { provider, models } or null if the chosen provider cannot be the default.
    const resolveSelection = (kind, cfg) => {
      const providerId = document.getElementById(`setting-${cfg.prefix}-provider`)?.value || cfg.fallback;
      const modelId = document.getElementById(`setting-${cfg.prefix}-model`)?.value || '';
      const selected = (this._providerState?.[kind]?.providers || []).find(p => p.id === providerId);
      if (selected && !selected.available) {
        this.toast(`${selected.name} is not ready yet. Configure it before setting it as default.`, 'error');
        return null;
      }
      const models = { ...(Storage.getSettings()[cfg.modelsKey] || {}) };
      if (modelId) models[providerId] = modelId;
      return { provider: providerId, models };
    };

    // Save settings
    document.getElementById('save-settings')?.addEventListener('click', async () => {
      try {
        const llm = resolveSelection('llm', this._PROVIDER_UI.llm);
        if (!llm) return;
        const stt = resolveSelection('stt', this._PROVIDER_UI.stt);
        if (!stt) return;

        Storage.saveSettings({
          language: document.getElementById('setting-language').value,
          translationLanguage: document.getElementById('setting-translation-language').value,
          theme: document.getElementById('setting-theme').value,
          showTimestamps: document.getElementById('setting-timestamps').checked,
          llmProvider: llm.provider,
          llmModels: llm.models,
          sttProvider: stt.provider,
          sttModels: stt.models,
        });
        await Storage.flush();
        this.toast('Settings saved', 'success');
        await this._refreshProviders('stt');
        await this._refreshProviders('llm');
      } catch (error) {
        this.toast(`Could not save settings: ${error.message}`, 'error');
      }
    });

    // Export backup
    document.getElementById('setting-export')?.addEventListener('click', () => {
      Export.downloadBackup();
      this.toast('Backup downloaded', 'success');
    });

    // Import backup
    document.getElementById('setting-import')?.addEventListener('click', () => {
      document.getElementById('import-file-input').click();
    });

    document.getElementById('import-file-input')?.addEventListener('change', async (e) => {
      const file = e.target.files[0];
      if (!file) return;
      const result = await Export.importBackup(file);
      if (result.success) {
        try {
          await Storage.flush();
          await AudioStorage.clear();
          this.toast(`Imported ${result.count} meetings`, 'success');
          this._updateMeetingsCount();
          this.navigate('settings');
        } catch (error) {
          this.toast(`Import could not be written: ${error.message}`, 'error');
        }
      } else {
        this.toast(`Import failed: ${result.error}`, 'error');
      }
    });

    document.getElementById('setting-view-logs')?.addEventListener('click', async () => {
      try {
        const response = await fetch('/api/logs', { cache: 'no-store' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error || 'Could not load diagnostic logs');
        const lines = (data.logs || []).slice(-100).map(entry => {
          const details = entry.details && Object.keys(entry.details).length ? ` ${JSON.stringify(entry.details)}` : '';
          return `${entry.timestamp || ''} [${String(entry.level || 'info').toUpperCase()}] ${entry.event || 'event'}${details}`;
        });
        this.showModal(`
          <div class="modal-header">
            <h3>Recent Diagnostic Logs</h3>
            <button class="btn btn-ghost btn-icon" id="close-diagnostic-logs" type="button">✕</button>
          </div>
          <p class="text-xs text-tertiary" style="margin-bottom: var(--space-3);">Newest events appear at the bottom. Sensitive credential fields are redacted.</p>
          <pre class="diagnostic-log-view">${Utils.escapeHtml(lines.join('\n') || 'No log entries yet.')}</pre>
          <div class="modal-footer">
            <button class="btn btn-secondary" id="close-diagnostic-logs-footer" type="button">Close</button>
          </div>
        `);
        document.getElementById('close-diagnostic-logs')?.addEventListener('click', () => this.closeModal());
        document.getElementById('close-diagnostic-logs-footer')?.addEventListener('click', () => this.closeModal());
      } catch (error) {
        this.toast(error.message, 'error');
      }
    });

    document.getElementById('setting-bug-report')?.addEventListener('click', () => this.navigate('report-bug'));

    // Clear all data
    document.getElementById('setting-clear')?.addEventListener('click', () => {
      this.showModal(`
        <div class="modal-header">
          <h3>⚠️ Clear All Data?</h3>
          <button class="btn btn-ghost btn-icon" onclick="App.closeModal()">✕</button>
        </div>
        <p class="text-sm text-secondary">This will permanently delete all meetings, settings, and recordings. This action cannot be undone.</p>
        <label class="form-group">
          <span class="form-label">Type <strong>DELETE</strong> to confirm</span>
          <input class="input" id="confirm-clear-text" autocomplete="off" spellcheck="false">
        </label>
        <div class="modal-footer">
          <button class="btn btn-secondary" onclick="App.closeModal()">Cancel</button>
          <button class="btn btn-danger" id="confirm-clear-all" disabled>Clear Everything</button>
        </div>
      `);

      const confirmInput = document.getElementById('confirm-clear-text');
      const confirmButton = document.getElementById('confirm-clear-all');
      confirmInput.addEventListener('input', () => {
        confirmButton.disabled = confirmInput.value.trim() !== 'DELETE';
      });
      confirmInput.focus();

      confirmButton.addEventListener('click', async () => {
        confirmButton.disabled = true;
        confirmButton.textContent = 'Clearing…';
        try {
          await Storage.clearAll();
          this.closeModal();
          this.toast('All data cleared', 'warning');
          this._updateMeetingsCount();
          this.navigate('settings');
        } catch (error) {
          confirmButton.disabled = false;
          confirmButton.textContent = 'Clear Everything';
          this.toast(`Could not clear data: ${error.message}`, 'error');
        }
      });
    });
  },

  // Human labels for provider status states.
  _PROVIDER_STATE_LABEL: {
    ready: { text: 'Ready', badge: 'badge-success' },
    setup_required: { text: 'Setup required', badge: 'badge-warning' },
    invalid: { text: 'Invalid credentials', badge: 'badge-danger' },
    unavailable: { text: 'Unavailable', badge: 'badge-warning' }
  },

  // Config for the two provider pickers (Meeting Notes AI + Speech). Both share
  // the same endpoint contract and DOM layout, keyed by element-id prefix.
  _PROVIDER_UI: {
    llm: { endpoint: '/api/llm/providers', prefix: 'llm', providerKey: 'llmProvider', modelsKey: 'llmModels', fallback: 'codex' },
    stt: { endpoint: '/api/stt/providers', prefix: 'stt', providerKey: 'sttProvider', modelsKey: 'sttModels', fallback: 'soniox' }
  },

  // Fetch provider metadata and repopulate the picker for one kind ('llm'|'stt').
  async _refreshProviders(kind) {
    const cfg = this._PROVIDER_UI[kind];
    const providerSelect = document.getElementById(`setting-${cfg.prefix}-provider`);
    if (!providerSelect) return;
    try {
      const response = await fetch(cfg.endpoint, { cache: 'no-store' });
      const data = await response.json();
      if (!response.ok) throw new Error(data.error?.message || data.error || 'Could not load providers');

      this._providerState = this._providerState || {};
      this._providerState[kind] = { providers: data.providers || [], defaultProvider: data.defaultProvider || cfg.fallback };
      const desired = providerSelect.value || Storage.getSettings()[cfg.providerKey] || data.defaultProvider || cfg.fallback;

      providerSelect.innerHTML = data.providers.map(provider => {
        const suffix = provider.available ? '' : ' — setup required';
        return `<option value="${Utils.escapeHtml(provider.id)}">${Utils.escapeHtml(provider.name)}${suffix}</option>`;
      }).join('');
      providerSelect.value = data.providers.some(p => p.id === desired) ? desired : (data.providers[0]?.id || cfg.fallback);

      this._renderProviderDetail(kind);
    } catch (error) {
      const statusText = document.getElementById(`${cfg.prefix}-status-text`);
      const statusBadge = document.getElementById(`${cfg.prefix}-status-badge`);
      if (statusText) statusText.textContent = error.message;
      if (statusBadge) statusBadge.textContent = 'Unavailable';
    }
  },

  // Sync model list, status badge and key controls to the selected provider.
  _renderProviderDetail(kind) {
    const cfg = this._PROVIDER_UI[kind];
    const providerSelect = document.getElementById(`setting-${cfg.prefix}-provider`);
    const modelSelect = document.getElementById(`setting-${cfg.prefix}-model`);
    const statusName = document.getElementById(`${cfg.prefix}-status-name`);
    const statusText = document.getElementById(`${cfg.prefix}-status-text`);
    const statusBadge = document.getElementById(`${cfg.prefix}-status-badge`);
    const keyControls = document.getElementById(`${cfg.prefix}-key-controls`);
    const keyLabel = document.getElementById(`${cfg.prefix}-key-label`);
    const testButton = document.getElementById(`${cfg.prefix}-test-key`);
    const cliSetup = document.getElementById(`${cfg.prefix}-cli-setup`);
    if (!providerSelect || !modelSelect) return;

    const provider = (this._providerState?.[kind]?.providers || []).find(p => p.id === providerSelect.value);
    if (!provider) return;

    const savedModel = (Storage.getSettings()[cfg.modelsKey] || {})[provider.id] || provider.selectedModel;
    modelSelect.innerHTML = (provider.models || []).map(model =>
      `<option value="${Utils.escapeHtml(model.id)}">${Utils.escapeHtml(model.label || model.id)}</option>`
    ).join('');
    if (provider.models?.some(m => m.id === savedModel)) modelSelect.value = savedModel;
    modelSelect.disabled = (provider.models || []).length <= 1;

    const label = this._PROVIDER_STATE_LABEL[provider.state] || this._PROVIDER_STATE_LABEL.setup_required;
    if (statusName) statusName.textContent = `${provider.name} status`;
    if (statusBadge) {
      statusBadge.className = `badge ${label.badge}`;
      statusBadge.textContent = label.text;
    }
    if (statusText) statusText.textContent = provider.message || '';
    if (keyControls) keyControls.style.display = provider.needsKey ? '' : 'none';
    if (keyLabel) keyLabel.textContent = `${provider.name} API Key`;
    if (cliSetup) cliSetup.style.display = provider.kind === 'cli' ? '' : 'none';
    if (testButton) testButton.textContent = provider.kind === 'cli' ? 'Connect / Check Codex' : 'Test Connection';
  },

  _bindProviderControls(kind) {
    const cfg = this._PROVIDER_UI[kind];
    const currentProvider = () => document.getElementById(`setting-${cfg.prefix}-provider`)?.value || '';

    document.getElementById(`setting-${cfg.prefix}-provider`)?.addEventListener('change', () => this._renderProviderDetail(kind));

    document.getElementById(`${cfg.prefix}-save-key`)?.addEventListener('click', async () => {
      const providerId = currentProvider();
      const input = document.getElementById(`setting-${cfg.prefix}-key`);
      const apiKey = input?.value.trim();
      if (!apiKey) { this.toast('Enter an API key first', 'error'); return; }
      try {
        const response = await fetch(`${cfg.endpoint}/${encodeURIComponent(providerId)}/key`, {
          method: 'PUT',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ apiKey })
        });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error?.message || data.error || 'Could not save the key');
        input.value = '';
        this.toast('API key saved', 'success');
        await this._refreshProviders(kind);
      } catch (error) {
        this.toast(error.message, 'error');
      }
    });

    document.getElementById(`${cfg.prefix}-test-key`)?.addEventListener('click', async () => {
      const providerId = currentProvider();
      const btn = document.getElementById(`${cfg.prefix}-test-key`);
      const original = btn.textContent;
      btn.disabled = true;
      btn.textContent = 'Testing…';
      try {
        const response = await fetch(`${cfg.endpoint}/${encodeURIComponent(providerId)}/test`, { method: 'POST' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error?.message || data.error || 'Connection failed');
        this.toast(data.message || 'Connection succeeded', 'success');
      } catch (error) {
        this.toast(error.message, 'error');
      } finally {
        btn.disabled = false;
        btn.textContent = original;
        await this._refreshProviders(kind);
      }
    });

    document.getElementById(`${cfg.prefix}-remove-key`)?.addEventListener('click', async () => {
      const providerId = currentProvider();
      try {
        const response = await fetch(`${cfg.endpoint}/${encodeURIComponent(providerId)}/key`, { method: 'DELETE' });
        const data = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(data.error?.message || data.error || 'Could not remove the key');
        this.toast('API key removed', 'info');
        await this._refreshProviders(kind);
      } catch (error) {
        this.toast(error.message, 'error');
      }
    });
  },

  /* ══════════════════════════════════════════
     Shared Components
     ══════════════════════════════════════════ */

  _renderMeetingItem(meeting, options = {}) {
    const statusBadges = {
      completed: '<span class="badge badge-success">Completed</span>',
      recording: '<span class="badge badge-recording">● Recording</span>',
      interrupted: '<span class="badge badge-warning">Interrupted</span>',
      processing: '<span class="badge badge-warning">Processing…</span>',
      failed: '<span class="badge badge-warning">Failed</span>',
      draft: '<span class="badge badge-primary">Draft</span>'
    };

    const pendingActions = (meeting.actionItems || []).filter(a => !a.done).length;
    const hasTemporaryTitle = this._isDefaultMeetingTitle(meeting.title);
    const selectable = Boolean(options.selectable);
    const selectionDisabled = ['recording', 'processing'].includes(meeting.status);
    const selected = selectable && this._selectedMeetingIds.has(meeting.id);

    return `
      <div class="meeting-item ${hasTemporaryTitle ? 'has-temporary-title' : ''} ${selected ? 'is-selected' : ''}" data-meeting-id="${Utils.escapeHtml(meeting.id)}">
        ${selectable ? `
          <label class="meeting-select-control" title="${selectionDisabled ? 'Wait for processing to finish before deleting' : 'Select meeting'}">
            <input class="meeting-select-checkbox" type="checkbox" ${selected ? 'checked' : ''} ${selectionDisabled ? 'disabled' : ''} aria-label="Select ${Utils.escapeHtml(meeting.title || 'meeting')}">
          </label>
        ` : ''}
        <div class="meeting-icon">📋</div>
        <div class="meeting-info">
          <div class="meeting-title ${hasTemporaryTitle ? 'meeting-title-temporary' : ''}">${Utils.escapeHtml(meeting.title || 'Untitled Meeting')}</div>
          <div class="meeting-meta">
            <span>${Utils.formatRelativeTime(meeting.date)}</span>
            <span class="dot"></span>
            <span>${Utils.formatDurationHuman(meeting.duration)}</span>
            ${pendingActions > 0 ? `<span class="dot"></span><span>${pendingActions} action${pendingActions > 1 ? 's' : ''}</span>` : ''}
          </div>
          ${(meeting.tags || []).length > 0 ? `<div class="tag-chip-row meeting-tag-row">${this._renderTagChips(meeting.tags)}</div>` : ''}
        </div>
        <div class="meeting-actions">
          ${hasTemporaryTitle ? `
            <button class="btn btn-secondary btn-sm ai-title-btn" type="button" title="Suggest a title from the transcript">
              ✨ AI title
            </button>
          ` : ''}
          <button class="btn btn-ghost btn-icon btn-sm edit-title-btn" type="button" title="Edit meeting title" aria-label="Edit meeting title">
            <svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4Z"/></svg>
          </button>
        </div>
        ${statusBadges[meeting.status] || ''}
        ${this._isRecentlyImportedPastDate(meeting) ? '<span class="badge badge-primary">Mới nhập</span>' : ''}
      </div>
    `;
  },

  // DAT-07 (§5.9.3): a meeting whose `date` was just set to a day far in the
  // past would otherwise vanish from the top of a date-sorted list right
  // after import — this badge is the only way to still find it there.
  _isRecentlyImportedPastDate(meeting) {
    if (!meeting.date || !meeting.createdAt) return false;
    const createdAgoMs = Date.now() - new Date(meeting.createdAt).getTime();
    if (!Number.isFinite(createdAgoMs) || createdAgoMs > 24 * 3600 * 1000) return false;
    const deltaMs = Math.abs(new Date(meeting.date).getTime() - new Date(meeting.createdAt).getTime());
    return Number.isFinite(deltaMs) && deltaMs > 24 * 3600 * 1000;
  },

  _bindMeetingItemClicks() {
    document.querySelectorAll('.meeting-item[data-meeting-id]').forEach(el => {
      el.querySelector('.edit-title-btn')?.addEventListener('click', event => {
        event.stopPropagation();
        this._openMeetingTitleEditor(el.dataset.meetingId);
      });
      el.querySelector('.ai-title-btn')?.addEventListener('click', event => {
        event.stopPropagation();
        this._suggestMeetingTitle(el.dataset.meetingId, event.currentTarget);
      });
      el.addEventListener('click', event => {
        if (event.target.closest('button, input, label')) return;
        App.navigate(`meeting/${el.dataset.meetingId}`);
      });
    });
  },

  /**
   * Rename a "Speaker N" label after recording, applied to every segment
   * sharing that exact label WITHIN THE SAME PART (segments carry `partId`
   * once merged from multi-part audio, server/stt/merge.js). Segments with
   * no `partId` belong to a single-part meeting, so the rename applies to
   * the whole transcript — matching current behavior with no part boundaries.
   */
  _openSpeakerRenameModal(meetingId, segIndex) {
    const meeting = Storage.getMeeting(meetingId);
    const segment = meeting?.transcript?.[segIndex];
    if (!meeting || !segment || segment.kind) return;

    const originalLabel = segment.speaker || 'Speaker';

    this.showModal(`
      <div class="modal-header">
        <h3>Rename Speaker</h3>
        <button class="btn btn-ghost btn-icon" id="cancel-speaker-rename" type="button">✕</button>
      </div>
      <div class="input-group">
        <label for="edit-speaker-name">New name for "${Utils.escapeHtml(originalLabel)}"</label>
        <input class="input" id="edit-speaker-name" maxlength="80" value="${Utils.escapeHtml(originalLabel)}">
        <span class="text-xs text-tertiary">Applies to every line labeled "${Utils.escapeHtml(originalLabel)}" in this ${segment.partId ? 'part of the ' : ''}meeting.</span>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-speaker-rename-footer" type="button">Cancel</button>
        <button class="btn btn-primary" id="save-speaker-rename" type="button">Rename</button>
      </div>
    `);

    const input = document.getElementById('edit-speaker-name');
    const save = async () => {
      const newName = input.value.trim();
      if (!newName) {
        this.toast('Speaker name cannot be empty.', 'warning');
        input.focus();
        return;
      }
      const current = Storage.getMeeting(meetingId);
      if (!current) return;
      current.transcript = (current.transcript || []).map(seg => {
        if (seg.kind) return seg;
        if (seg.speaker !== originalLabel) return seg;
        if (segment.partId !== undefined && seg.partId !== segment.partId) return seg;
        return { ...seg, speaker: newName };
      });
      Storage.saveMeeting(current);
      await Storage.flush();
      this.closeModal();
      this.toast('Speaker renamed.', 'success');
      this.navigate(`${this.currentRoute}/${this.currentMeetingId}`, { force: true });
    };

    document.getElementById('save-speaker-rename')?.addEventListener('click', save);
    document.getElementById('cancel-speaker-rename')?.addEventListener('click', () => this.closeModal());
    document.getElementById('cancel-speaker-rename-footer')?.addEventListener('click', () => this.closeModal());
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter') save();
    });
    input?.focus();
    input?.select();
  },

  _openMeetingTitleEditor(meetingId) {
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return;

    this.showModal(`
      <div class="modal-header">
        <h3>Edit Meeting Title</h3>
        <button class="btn btn-ghost btn-icon" id="cancel-title-edit" type="button">✕</button>
      </div>
      <div class="input-group">
        <label for="edit-meeting-title">Meeting Title</label>
        <input class="input" id="edit-meeting-title" maxlength="120" value="${Utils.escapeHtml(meeting.title || '')}">
        <span class="text-xs text-tertiary">The original meeting date and time remain available in its metadata.</span>
      </div>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="cancel-title-edit-footer" type="button">Cancel</button>
        <button class="btn btn-primary" id="save-meeting-title" type="button">Save Title</button>
      </div>
    `);

    const input = document.getElementById('edit-meeting-title');
    const save = async () => {
      const title = input.value.trim();
      if (!title) {
        this.toast('Meeting title cannot be empty.', 'warning');
        input.focus();
        return;
      }
      Storage.saveMeeting({ ...meeting, title });
      await Storage.flush();
      this.closeModal();
      this.toast('Meeting title updated.', 'success');
      // Re-render the current view; rebuild the full route so the detail view
      // (currentRoute 'meeting' + currentMeetingId) is not dropped to the list.
      const route = this.currentMeetingId
        ? `${this.currentRoute}/${this.currentMeetingId}`
        : (this.currentRoute || 'meetings');
      this.navigate(route, { force: true });
    };

    document.getElementById('save-meeting-title')?.addEventListener('click', save);
    document.getElementById('cancel-title-edit')?.addEventListener('click', () => this.closeModal());
    document.getElementById('cancel-title-edit-footer')?.addEventListener('click', () => this.closeModal());
    input?.addEventListener('keydown', event => {
      if (event.key === 'Enter') save();
      if (event.key === 'Escape') this.closeModal();
    });
    input?.focus();
    input?.select();
  },

  async _suggestMeetingTitle(meetingId, button) {
    const meeting = Storage.getMeeting(meetingId);
    if (!meeting) return;
    if (!Array.isArray(meeting.transcript) || meeting.transcript.length === 0) {
      this.toast('A transcript is needed before AI can suggest a title.', 'warning');
      return;
    }

    const originalText = button?.textContent;
    if (button) {
      button.disabled = true;
      button.textContent = 'Suggesting…';
    }
    try {
      const title = await Summary.suggestTitle(meeting);
      Storage.saveMeeting({ ...meeting, title });
      await Storage.flush();
      this.toast(`AI title: ${title}`, 'success');
      this.navigate(this.currentRoute || 'meetings', { force: true });
    } catch (error) {
      this.toast(error.message || 'Could not suggest a meeting title.', 'error');
      if (button) {
        button.disabled = false;
        button.textContent = originalText;
      }
    }
  },

  _renderNotFound() {
    return `
      <div class="empty-state view-enter">
        <div class="empty-icon">🤔</div>
        <h3>Page Not Found</h3>
        <p>The page you're looking for doesn't exist.</p>
        <button class="btn btn-primary" style="margin-top: var(--space-4);" onclick="App.navigate('dashboard')">Go to Dashboard</button>
      </div>
    `;
  },

  // `sttOverride` (BR-87): { provider, model } chosen for THIS import only —
  // the import modal (js/import.js) passes this; the old direct-upload path
  // and job resume/retry paths omit it and fall back to the server's
  // default provider, exactly as before.
  async _processUploadedRecording(meeting, startedAt, filename, sttOverride = {}) {
    try {
      const response = await fetch('/api/import-transcription', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            meetingId: meeting.id,
            language: meeting.language,
            translationLanguage: meeting.translationLanguage,
            ...(sttOverride.provider ? { provider: sttOverride.provider } : {}),
            ...(sttOverride.model ? { model: sttOverride.model } : {})
          })
      });
      const result = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(result.error?.message || result.error || 'Could not start transcription.');

      const jobId = result.jobId;
      if (!jobId) throw new Error('Server did not return a job id.');

      this._backgroundAudioTasks.set(meeting.id, { filename, phase: 'transcribing', jobId });
      this._renderBackgroundTaskIndicator();

      // Start polling.
      this._pollJobStatus(meeting.id, jobId, filename);
    } catch (error) {
      this._backgroundAudioTasks.delete(meeting.id);
      const current = Storage.getMeeting(meeting.id) || meeting;
      current.status = 'failed';
      current.processingError = error.message || 'Could not start transcription.';
      Storage.saveMeeting(current);
      await Storage.flush();
      this._renderBackgroundTaskIndicator();
      this.toast(`Audio processing failed: ${current.processingError}`, 'error');
      this._refreshMeetingView(meeting.id);
    }
  },

  _pollJobStatus(meetingId, jobId, filename) {
    // Clear any existing poller for this meeting.
    if (this._activePollers.has(meetingId)) {
      clearTimeout(this._activePollers.get(meetingId));
    }

    let delay = 3000; // Start at 3s, backoff to 10s.
    const maxDelay = 10000;

    const poll = async () => {
      try {
        const response = await fetch(`/api/jobs/${encodeURIComponent(jobId)}`);
        const job = await response.json().catch(() => ({}));

        if (response.status === 404) {
          // A missing job is not success. Reload the meeting first; if it is not
          // terminal, re-submit and let the server dedupe/recover the work.
          await this._reloadMeetingsFromServer();
          const current = Storage.getMeeting(meetingId);
          if (current?.status === 'completed' || current?.status === 'failed') {
            job.status = current.status;
            job.error = current.processingError ? { message: current.processingError } : null;
          } else if (current) {
            this._activePollers.delete(meetingId);
            this._processUploadedRecording(current, current.createdAt, filename || current.sourceFilename || current.title);
            return;
          } else {
            throw new Error('Transcription job and meeting were not found.');
          }
        } else if (!response.ok) {
          throw new Error(job.error || 'Could not check transcription status.');
        }

        if (job.status === 'completed') {
          // Reload meeting data from server — the server already persisted the transcript.
          await this._reloadMeetingsFromServer();
          this._backgroundAudioTasks.delete(meetingId);
          this._activePollers.delete(meetingId);
          this._renderBackgroundTaskIndicator();
          this.toast(`Transcription completed: ${filename || meetingId}`, 'success');
          this._refreshMeetingView(meetingId);
          return;
        }

        if (job.status === 'failed') {
          await this._reloadMeetingsFromServer();
          this._backgroundAudioTasks.delete(meetingId);
          this._activePollers.delete(meetingId);
          this._renderBackgroundTaskIndicator();
          const errMsg = job.error?.message || 'Transcription failed.';
          this.toast(`Audio processing failed: ${errMsg}`, 'error');
          this._refreshMeetingView(meetingId);
          return;
        }

        // Still processing — schedule next poll with backoff.
        delay = Math.min(delay * 1.5, maxDelay);
        this._activePollers.set(meetingId, setTimeout(poll, delay));
      } catch {
        // Network error — retry with backoff.
        delay = Math.min(delay * 2, maxDelay);
        this._activePollers.set(meetingId, setTimeout(poll, delay));
      }
    };

    this._activePollers.set(meetingId, setTimeout(poll, delay));
  },

  // Multi-part equivalent of _pollJobStatus (V11#24) — one poller per MEETING
  // (not per part/job), reading the compact GET /parts poll shape so N parts
  // still count as exactly 1 background task and fire exactly 1 completion
  // toast (V11#25, UX §5.5), never N.
  _pollPartsStatus(meetingId) {
    if (this._activePollers.has(meetingId)) clearTimeout(this._activePollers.get(meetingId));
    let delay = 3000;
    const maxDelay = 10000;
    const startedAt = Date.now();

    const poll = async () => {
      try {
        const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/parts`);
        if (response.status === 404) { this._activePollers.delete(meetingId); this._backgroundAudioTasks.delete(meetingId); this._renderBackgroundTaskIndicator(); return; }
        const data = await response.json();
        const total = data.parts.length;
        const done = data.parts.filter(p => p.status === 'completed' || p.status === 'failed' || p.status === 'dropped').length;
        const elapsedMin = Math.round((Date.now() - startedAt) / 60000);
        const meeting = Storage.getMeeting(meetingId);
        this._backgroundAudioTasks.set(meetingId, { filename: meeting?.title || meetingId, phase: 'transcribing', progress: `${done}/${total} phần xong · đã ${elapsedMin} phút` });
        this._renderBackgroundTaskIndicator();

        if (data.status === 'processing') {
          delay = Math.min(delay * 1.5, maxDelay);
          this._activePollers.set(meetingId, setTimeout(poll, delay));
          return;
        }

        // Terminal (completed — possibly with missingParts — or failed).
        await this._reloadMeetingsFromServer();
        this._activePollers.delete(meetingId);
        this._backgroundAudioTasks.delete(meetingId);
        this._renderBackgroundTaskIndicator();
        const finished = Storage.getMeeting(meetingId);
        if (data.status === 'failed') {
          this.toast(`Không tạo được transcript cho "${finished?.title || meetingId}".`, 'error');
        } else {
          this.toast(`Transcript đã xong — ${finished?.title || meetingId}`, 'success');
        }
        this._refreshMeetingView(meetingId);
      } catch {
        delay = Math.min(delay * 2, maxDelay);
        this._activePollers.set(meetingId, setTimeout(poll, delay));
      }
    };

    this._activePollers.set(meetingId, setTimeout(poll, delay));
  },

  async _reloadMeetingsFromServer() {
    try {
      const response = await fetch('/api/data', { cache: 'no-store' });
      if (!response.ok) return;
      const data = await response.json();
      if (Array.isArray(data.meetings)) {
        Storage._meetings = data.meetings;
      }
    } catch { /* best effort */ }
  },

  _resumeProcessingJobs() {
    const meetings = Storage.getAllMeetings();
    for (const meeting of meetings) {
      if (meeting.status !== 'processing') continue;
      // Already polling this meeting.
      if (this._activePollers.has(meeting.id)) continue;

      if (Array.isArray(meeting.parts) && meeting.parts.length > 0) {
        this._backgroundAudioTasks.set(meeting.id, { filename: meeting.title, phase: 'transcribing' });
        this._renderBackgroundTaskIndicator();
        this._pollPartsStatus(meeting.id);
        continue;
      }

      const jobId = meeting._activeJobId;
      if (jobId) {
        // Resume polling the existing job.
        this._backgroundAudioTasks.set(meeting.id, { filename: meeting.sourceFilename || meeting.title, phase: 'transcribing', jobId });
        this._renderBackgroundTaskIndicator();
        this._pollJobStatus(meeting.id, jobId, meeting.sourceFilename || meeting.title);
      } else {
        // No jobId — re-submit; server will dedupe if a job already exists.
        this._backgroundAudioTasks.set(meeting.id, { filename: meeting.sourceFilename || meeting.title, phase: 'transcribing' });
        this._renderBackgroundTaskIndicator();
        this._processUploadedRecording(meeting, meeting.createdAt, meeting.sourceFilename || meeting.title);
      }
    }
  }
};

/* ── Start App ── */
document.addEventListener('DOMContentLoaded', async () => {
  try {
    await Storage.init();
    App.init();
  } catch (error) {
    console.error('Could not start MeetNote:', error);
    document.getElementById('page-title').textContent = 'Local server required';
    document.getElementById('main-content').innerHTML = `
      <div class="empty-state">
        <div class="empty-icon">⚠️</div>
        <h3>Could not open local storage</h3>
        <p>${Utils.escapeHtml(error.message)}</p>
        <p class="text-sm text-secondary">Run <code>npm start</code> in the project folder, then open <code>http://127.0.0.1:8765</code>.</p>
      </div>
    `;
  }
});
