/* ============================================
   MeetNote AI — Import modal (TV10/TV11/TV15, Architecture v3.0 §V8.1)
   State machine for the "Nhập bản ghi âm" modal: state A (empty) / B (1
   file) / C (N files, "nhiều cuộc họp riêng") / 4b (N files, "1 cuộc họp
   gồm N phần"). Uses `.modal-backdrop`/`.modal`/App.showModal() like every
   other modal in this app; only the import-specific classes added to
   css/components.css are new.

   Browser-only glue code (like js/app.js/js/export.js) — the actual
   business rules it calls into (js/import-preflight.js classify(), the
   natural-sort/gap/capabilities helpers in js/parts.js) are the pure,
   independently-tested modules.
   ============================================ */

const Import = {
  _providersPayload: null,
  _state: null,
  _attachMeetingId: null,
  _attachMode: null, // null (legacy TV15 attach-to-audioless-meeting) | 'appendPart' (Q9)
  _previewAudioEl: null,
  _previewObjectUrl: null,
  _windowDropBound: false,

  // Feature-detected once (V8.3/U-V6) — never a hardcoded browser list.
  supportsDateTimeLocal() {
    if (this._dtLocalSupport !== undefined) return this._dtLocalSupport;
    const probe = document.createElement('input');
    probe.setAttribute('type', 'datetime-local');
    this._dtLocalSupport = probe.type === 'datetime-local';
    return this._dtLocalSupport;
  },

  /* ── Entry point ── */

  async open(options = {}) {
    this._attachMeetingId = options.attachMeetingId || null;
    this._attachMode = options.mode || null;
    const settings = Storage.getSettings();
    this._state = {
      entries: [],
      // Q9 (TV18): appending parts to an existing merged meeting reuses the
      // merged-mode list (gap hints, blocking-errors-block-Start, ▲▼) since
      // it IS a cluster of parts, even when the user starts with just one.
      mode: this._attachMode === 'appendPart' ? 'merged' : 'separate',
      orderMethod: 'original',
      sttOverrideNotice: '', // ERR-03c "Sẽ dùng X cho lần nhập này" text, cleared on Hoàn tác
      context: {
        participants: [], meetingType: '', topic: '', leadBy: '', tags: [], notes: '',
        provider: (this._providersPayload && this._providersPayload.defaultProvider) || settings.sttProvider || 'soniox',
        model: '', language: settings.language || 'auto', translationLanguage: settings.translationLanguage || ''
      }
    };
    if (this._attachMeetingId) {
      const meeting = Storage.getMeeting(this._attachMeetingId);
      if (this._attachMode === 'appendPart') {
        if (!meeting || !(meeting.parts || []).length) {
          App.toast('Không tìm thấy bản ghi ghép nhiều phần này.', 'error');
          this._attachMeetingId = null;
          this._attachMode = null;
          return;
        }
      } else if (!meeting || meeting.audioId || (meeting.transcript || []).length > 0) {
        App.toast('Bản ghi này đã có audio hoặc transcript — không gắn thêm được. Hãy tạo bản ghi mới.', 'error');
        this._attachMeetingId = null;
        return;
      }
    }
    try {
      const response = await fetch('/api/stt/providers', { cache: 'no-store' });
      this._providersPayload = response.ok ? await response.json() : null;
    } catch {
      this._providersPayload = null; // BR-142: fail-open, never fail-closed.
    }
    if (this._providersPayload) this._state.context.provider = this._providersPayload.defaultProvider || this._state.context.provider;
    this._bindWindowDropOverlay();
    this._render();
  },

  /* ── File intake ── */

  _makeEntry(file) {
    return {
      id: Utils.uuid(), file, name: file.name, size: file.size, lastModified: file.lastModified,
      title: file.name.replace(/\.[^.]+$/, ''),
      dateIso: this._suggestedDateIso(file.lastModified),
      dateSource: this._suggestedDateSource(file.lastModified),
      clientDurationSeconds: null,
      previewState: 'pending', // pending|ready|unavailable
      order: 0
    };
  },

  // BR-93/94: file.lastModified if plausible, else the import moment.
  _suggestedDateIso(lastModified) {
    const ms = Number(lastModified) || 0;
    const now = Date.now();
    if (ms > 0 && ms <= now + 24 * 3600 * 1000 && ms >= Date.UTC(2000, 0, 1)) {
      return new Date(ms).toISOString();
    }
    return new Date().toISOString();
  },

  _suggestedDateSource(lastModified) {
    const ms = Number(lastModified) || 0;
    const now = Date.now();
    if (!(ms > 0 && ms <= now + 24 * 3600 * 1000 && ms >= Date.UTC(2000, 0, 1))) return 'import';
    return (now - ms) < 30 * 60 * 1000 ? 'recent-copy' : 'file';
  },

  addFiles(fileList) {
    const incoming = Array.from(fileList || []).filter(file => file && typeof file.name === 'string');
    if (incoming.length === 0) return;

    // TV15 legacy attach: exactly 1 file onto a meeting that has no audio yet.
    if (this._attachMeetingId && this._attachMode !== 'appendPart') {
      if (this._state.entries.length > 0 || incoming.length > 1) {
        App.toast('Chỉ gắn được 1 file vào bản ghi có sẵn.', 'warning');
        return;
      }
      this._state.entries = [this._makeEntry(incoming[0])];
      this._afterEntriesChanged();
      return;
    }

    // Q9 (TV18): appending N new parts onto an existing merged meeting still
    // respects the server's MAX_PARTS_PER_MEETING=10 total (existing + new).
    const existingPartCount = this._attachMode === 'appendPart'
      ? (Storage.getMeeting(this._attachMeetingId)?.parts || []).length
      : 0;
    const room = 10 - existingPartCount - this._state.entries.length;
    const { accepted, rejectedCount } = ImportPreflight.capImportBatch(incoming, Math.max(0, room));
    for (const file of accepted) this._state.entries.push(this._makeEntry(file));
    if (rejectedCount > 0 || incoming.length > room) {
      const totalRejected = incoming.length - accepted.length;
      const limitReason = this._attachMode === 'appendPart' ? 'vượt quá giới hạn số phần của bản ghi này' : 'vượt quá 10 file/lần';
      App.toast(`Đã nhận ${accepted.length} file. ${totalRejected} file chưa được nhận vì ${limitReason}.`, 'warning');
    }
    if (this._attachMode !== 'appendPart') this._applySuggestedOrder();
    this._afterEntriesChanged();
  },

  // TV18 (MRG-18/19): removing an entry from the MIDDLE of a not-yet-started
  // merged cluster (mode 'merged', which Q9's appendPart flow also uses)
  // leaves no trace anywhere once it happens — unlike dropping an
  // ALREADY-registered part (js/app.js drop-part, which keeps a permanent
  // `dropped` + FAI-10 gap record). Confirm first, same as the last entry
  // in the list is exempt (shortens the meeting, doesn't open a hole in it).
  removeEntry(entryId) {
    const index = this._state.entries.findIndex(entry => entry.id === entryId);
    if (index < 0) return;
    if (this._state.mode === 'merged' && Parts.removingCreatesGap(index, this._state.entries.length)) {
      this._confirmRemoveEntry(entryId, index);
      return;
    }
    this._removeEntryNow(entryId);
    if (this._state.mode === 'merged') this._notifyRemovedEntry();
  },

  _removeEntryNow(entryId) {
    this._state.entries = this._state.entries.filter(entry => entry.id !== entryId);
    this._afterEntriesChanged();
  },

  _confirmRemoveEntry(entryId, index) {
    const entries = this._state.entries;
    const prev = entries[index - 1];
    const next = entries[index + 1];
    const range = prev && next ? Parts.formatGapRangeClock(prev.lastModified, next.lastModified) : '';
    App.showModal(`
      <div class="modal-header"><h3>Bỏ phần này?</h3><button class="btn btn-ghost btn-icon" id="import-remove-close">✕</button></div>
      <p class="text-sm text-secondary">Bỏ phần này ra thì cuộc họp sẽ thiếu đoạn giữa${range ? ` (${range})` : ''}.</p>
      <div class="modal-footer">
        <button class="btn btn-secondary" id="import-remove-cancel">Hủy</button>
        <button class="btn btn-danger" id="import-remove-confirm">Vẫn bỏ phần này</button>
      </div>
    `);
    const back = () => this._render();
    document.getElementById('import-remove-close')?.addEventListener('click', back);
    document.getElementById('import-remove-cancel')?.addEventListener('click', back);
    document.getElementById('import-remove-confirm')?.addEventListener('click', () => {
      this._removeEntryNow(entryId);
      this._notifyRemovedEntry();
    });
  },

  // IMP-27 — only ever relevant in merged mode (a user removing a file from
  // "N cuộc họp riêng" isn't at risk of losing a middle segment).
  _notifyRemovedEntry() {
    App.toast('Còn file của buổi họp khác? Nhập xong lần này rồi nhập tiếp lần nữa — thông tin bạn vừa điền không mất đi đâu cả.', 'info');
  },

  _applySuggestedOrder() {
    if (this._state.entries.length < 2) return;
    const { order, method } = Parts.suggestPartOrder(this._state.entries.map(entry => ({ name: entry.name, lastModified: entry.lastModified })));
    this._state.entries = order.map(i => this._state.entries[i]);
    this._state.orderMethod = method;
  },

  _afterEntriesChanged() {
    this._state.entries.forEach((entry, i) => { entry.order = i + 1; });
    this._reclassify();
    this._render();
  },

  // Re-runs preflight for every entry against the CURRENTLY selected
  // provider — must re-run whenever the provider changes too (ERR-03b).
  _reclassify() {
    const provider = this._state.context.provider;
    const otherFiles = this._state.entries.map(entry => ({ name: entry.name, size: entry.size }));
    for (const entry of this._state.entries) {
      entry.preflight = ImportPreflight.classify({ name: entry.name, size: entry.size }, provider, this._providersPayload);
      entry.duplicateInBatch = ImportPreflight.findDuplicateInBatch({ name: entry.name, size: entry.size }, otherFiles.filter(f => f !== entry));
      entry.duplicateMeeting = ImportPreflight.findDuplicateMeeting({ name: entry.name, size: entry.size }, Storage.getAllMeetings());
      entry.dismissedDuplicateWarning = entry.dismissedDuplicateWarning || false;
    }
  },

  _isBlocking(entry) {
    return entry.preflight && (entry.preflight.level === 'blockA' || entry.preflight.level === 'blockB');
  },

  _validEntries() {
    return this._state.entries.filter(entry => !this._isBlocking(entry));
  },

  /* ── Provider override (ERR-03b/03c) ── */

  useAlternativeProvider(providerId) {
    this._state.context.provider = providerId;
    this._state.sttOverrideNotice = providerId;
    this._reclassify();
    this._render();
    const summary = document.getElementById('import-stt-summary');
    if (summary) {
      summary.classList.add('import-highlight-flash');
      setTimeout(() => summary.classList.remove('import-highlight-flash'), 650);
    }
  },

  undoProviderOverride() {
    const settings = Storage.getSettings();
    this._state.context.provider = (this._providersPayload && this._providersPayload.defaultProvider) || settings.sttProvider || 'soniox';
    this._state.sttOverrideNotice = '';
    this._reclassify();
    this._render();
  },

  /* ── Mode switch (MRG-01..05) ── */

  setMode(mode) {
    this._state.mode = mode;
    this._render();
  },

  reorder(fromIndex, toIndex) {
    const entries = this._state.entries;
    const [moved] = entries.splice(fromIndex, 1);
    entries.splice(toIndex, 0, moved);
    this._state.orderMethod = 'manual';
    entries.forEach((entry, i) => { entry.order = i + 1; });
    this._render();
  },

  moveEntry(entryId, delta) {
    const entries = this._state.entries;
    const index = entries.findIndex(entry => entry.id === entryId);
    const target = index + delta;
    if (index < 0 || target < 0 || target >= entries.length) return;
    this.reorder(index, target);
  },

  /* ── Audio preview (V8.3 — feature-detect at runtime, never a format list) ── */

  previewEntry(entry, part) { // part: 'head' | 'tail'
    if (this._previewObjectUrl) { URL.revokeObjectURL(this._previewObjectUrl); this._previewObjectUrl = null; }
    if (this._previewAudioEl) { this._previewAudioEl.pause(); this._previewAudioEl = null; }

    const url = URL.createObjectURL(entry.file);
    this._previewObjectUrl = url;
    const audio = new Audio(url);
    this._previewAudioEl = audio;
    let settled = false;

    const timeout = setTimeout(() => { if (!settled) onError(); }, 5000);
    const onError = () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      entry.previewState = 'unavailable';
      entry.clientDurationSeconds = null;
      this._render();
    };
    audio.addEventListener('error', onError);
    audio.addEventListener('loadedmetadata', () => {
      if (settled) return;
      settled = true;
      clearTimeout(timeout);
      const duration = Number.isFinite(audio.duration) ? audio.duration : null;
      entry.clientDurationSeconds = duration;
      entry.previewState = duration ? 'ready' : 'unavailable';
      if (!part) { this._render(); return; }
      audio.currentTime = part === 'tail' && duration ? Math.max(0, duration - 10) : 0;
      audio.play().catch(() => {});
      setTimeout(() => audio.pause(), 10000);
      this._render();
    });
  },

  closePreview() {
    if (this._previewAudioEl) { this._previewAudioEl.pause(); this._previewAudioEl = null; }
    if (this._previewObjectUrl) { URL.revokeObjectURL(this._previewObjectUrl); this._previewObjectUrl = null; }
  },

  /* ── Drag & drop ── */

  _bindWindowDropOverlay() {
    if (this._windowDropBound) return;
    this._windowDropBound = true;
    let dragDepth = 0;
    const overlay = () => document.getElementById('import-app-dropzone');
    window.addEventListener('dragenter', event => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      dragDepth += 1;
      const el = overlay();
      if (el) el.classList.add('active');
    });
    window.addEventListener('dragleave', () => {
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) { const el = overlay(); if (el) el.classList.remove('active'); }
    });
    window.addEventListener('dragover', event => { if (Array.from(event.dataTransfer?.types || []).includes('Files')) event.preventDefault(); });
    window.addEventListener('drop', event => {
      if (!Array.from(event.dataTransfer?.types || []).includes('Files')) return;
      event.preventDefault();
      dragDepth = 0;
      const el = overlay();
      if (el) el.classList.remove('active');
      const files = Array.from(event.dataTransfer.files || []).filter(f => f.size > 0 || f.name);
      if (files.length === 0) return; // BR-78: a dropped folder yields no File entries here — no-op.
      const modalOpen = document.getElementById('modal-backdrop')?.classList.contains('active');
      if (!modalOpen) this.open();
      // Give open() a tick to fetch /api/stt/providers before rendering with files.
      setTimeout(() => this.addFiles(files), 0);
    });
  },

  /* ── Rendering ── */

  _render() {
    App.showModal(this._html());
    this._bind();
  },

  _title() {
    if (this._attachMode === 'appendPart') return 'Thêm phần vào bản ghi này';
    if (this._attachMeetingId) return 'Gắn file ghi âm vào bản ghi này';
    const n = this._state.entries.length;
    return n <= 1 ? 'Nhập bản ghi âm' : `Nhập bản ghi âm (${n} file)`;
  },

  _html() {
    const s = this._state;
    const hasFiles = s.entries.length > 0;
    const showModeSwitch = !this._attachMeetingId && s.entries.length >= 2;
    const showMergedList = s.mode === 'merged' && (showModeSwitch || this._attachMode === 'appendPart');
    return `
      <div class="modal-header">
        <h3>${Utils.escapeHtml(this._title())}</h3>
        <button class="btn btn-ghost btn-icon" id="import-close">✕</button>
      </div>
      <div class="modal-body modal-lg">
        ${this._dropzoneHtml()}
        ${hasFiles && showModeSwitch ? this._modeSwitchHtml() : ''}
        ${hasFiles ? (showMergedList ? this._mergedListHtml() : this._separateListHtml()) : ''}
        ${hasFiles ? this._contextHtml() : ''}
        ${hasFiles ? this._sttConfigHtml() : ''}
      </div>
      <div class="modal-footer" style="flex-direction:column; align-items:stretch; gap:var(--space-2);">
        ${this._summaryLineHtml()}
        <div class="flex justify-end gap-3">
          <button class="btn btn-secondary" id="import-cancel">Hủy</button>
          <button class="btn btn-primary" id="import-start" ${this._startDisabled() ? 'disabled' : ''}>${Utils.escapeHtml(this._startLabel())}</button>
        </div>
      </div>
    `;
  },

  _dropzoneHtml() {
    return `
      <div class="import-dropzone" id="import-dropzone">
        <div>📁 Kéo file ghi âm vào đây</div>
        <div class="text-tertiary text-sm" style="margin: var(--space-2) 0;">hoặc</div>
        <button type="button" class="btn btn-secondary btn-sm" id="import-choose-file">Chọn file…</button>
        <div class="text-xs text-tertiary" style="margin-top:var(--space-3);">Định dạng hỗ trợ: m4a, mp3, wav, aac, flac, ogg, webm, amr, aiff, asf, mp4</div>
        ${this._state.entries.length === 0 ? '<div class="text-xs text-tertiary" style="margin-top:var(--space-2);">Ghi âm bằng điện thoại? Hãy đặt máy gần người nói — tiếng thu từ trong túi rất khó nhận dạng.</div>' : ''}
        <input type="file" id="import-file-input" accept=".aac,.aiff,.amr,.asf,.flac,.mp3,.ogg,.wav,.webm,.m4a,.mp4" ${(this._attachMeetingId && this._attachMode !== 'appendPart') ? '' : 'multiple'} style="display:none;">
      </div>
    `;
  },

  _modeSwitchHtml() {
    const s = this._state;
    const n = s.entries.length;
    return `
      <div>
        <p class="text-sm" style="margin-bottom:var(--space-2);">${n <= 9 ? this._countWordVi(n) : 'Các'} file này là gì?</p>
        <div class="import-mode-switch">
          <label class="import-mode-option ${s.mode === 'separate' ? 'is-selected' : ''}">
            <input type="radio" name="import-mode" value="separate" ${s.mode === 'separate' ? 'checked' : ''} style="display:none;">
            <div class="import-mode-title">${n} cuộc họp riêng</div>
            <div class="import-mode-desc">Mỗi file thành một bản ghi riêng.</div>
          </label>
          <label class="import-mode-option ${s.mode === 'merged' ? 'is-selected' : ''}">
            <input type="radio" name="import-mode" value="merged" ${s.mode === 'merged' ? 'checked' : ''} style="display:none;">
            <div class="import-mode-title">1 cuộc họp gồm ${n} phần</div>
            <div class="import-mode-desc">Ghép nối tiếp thành một transcript duy nhất.</div>
          </label>
        </div>
      </div>
    `;
  },

  _countWordVi(n) {
    return ({ 2: 'Hai', 3: 'Ba', 4: 'Bốn', 5: 'Năm', 6: 'Sáu', 7: 'Bảy', 8: 'Tám', 9: 'Chín' })[n] || String(n);
  },

  _fileErrorLine(entry) {
    const pf = entry.preflight;
    if (!pf) return '';
    if (pf.level === 'ok') return '';
    if (pf.code === 'EMPTY_FILE') return `<div class="import-file-row-error">⚠ File này rỗng.</div>`;
    if (pf.code === 'EXT_UNSUPPORTED') {
      return `<div class="import-file-row-error">⚠ MeetNote chưa hỗ trợ định dạng .${Utils.escapeHtml(pf.extension || '?')}. Hãy bỏ file này ra, hoặc chuyển sang m4a/mp3 trước rồi nhập lại.</div>`;
    }
    // blockB: PROVIDER_REJECTS_FORMAT / TOO_LARGE_FOR_PROVIDER — build the
    // 2-line B1/B2/B3 message from `alternatives`.
    const providerName = (pf.provider && pf.provider.name) || this._state.context.provider;
    const mainLine = pf.code === 'PROVIDER_REJECTS_FORMAT'
      ? `${Utils.escapeHtml(providerName)} không nhận định dạng .${Utils.escapeHtml(pf.extension)}.`
      : (pf.microcopyId === 'ERR-02'
        ? `File này nặng ${ImportPreflight.formatMbVi(pf.sizeBytes)}. ${Utils.escapeHtml(providerName)} chỉ nhận tối đa ${ImportPreflight.formatMbVi(pf.provider.maxUploadBytes)}.`
        : `File này nặng ${ImportPreflight.formatMbVi(pf.sizeBytes)}. MeetNote giới hạn ${ImportPreflight.formatMbVi(pf.provider.maxUploadBytes)} cho ${Utils.escapeHtml(providerName)}.`);
    const ready = (pf.alternatives || []).find(a => a.ready);
    const notReady = (pf.alternatives || []).find(a => !a.ready);
    let secondLine = '';
    if (this._state.sttOverrideNotice) {
      secondLine = `<div class="text-xs" style="color:var(--color-success);">✓ Sẽ dùng ${Utils.escapeHtml(this._providerNameById(this._state.sttOverrideNotice))} cho lần nhập này. <a href="#" data-action="undo-provider" style="text-decoration:underline;">Hoàn tác</a></div>`;
    } else if (ready) {
      secondLine = `<div class="text-xs">${Utils.escapeHtml(ready.name)} nhận được file này. <button type="button" class="btn btn-ghost btn-sm" data-action="use-provider" data-provider="${Utils.escapeHtml(ready.id)}">Dùng ${Utils.escapeHtml(ready.name)} cho lần này</button></div>`;
    } else if (notReady) {
      secondLine = `<div class="text-xs">${Utils.escapeHtml(notReady.name)} nhận được file này nhưng chưa có API key. <a href="#/settings" style="text-decoration:underline;">Mở Cài đặt</a></div>`;
    } else {
      secondLine = `<div class="text-xs">File này nặng ${ImportPreflight.formatMbVi(pf.sizeBytes)}, lớn hơn hạn mức của mọi nhà cung cấp bạn đã cấu hình. Hãy nén hoặc cắt nhỏ file rồi nhập lại. Cắt thành nhiều file? Nhập cả loạt rồi chọn "1 cuộc họp gồm nhiều phần".</div>`;
    }
    return `<div class="import-file-row-error">⚠ ${mainLine}</div>${secondLine}`;
  },

  _providerNameById(id) {
    const found = (this._providersPayload && this._providersPayload.providers || []).find(p => p.id === id);
    return found ? found.name : id;
  },

  _duplicateLineHtml(entry) {
    if (entry.dismissedDuplicateWarning) return '';
    if (entry.duplicateMeeting) {
      const when = Parts.formatDDMM(entry.duplicateMeeting.date || entry.duplicateMeeting.createdAt);
      return `<div class="text-xs" style="color:var(--color-warning);">Có vẻ bạn đã nhập file này ngày ${Utils.escapeHtml(when)}. <button type="button" class="btn btn-ghost btn-sm" data-action="dismiss-dup" data-entry="${entry.id}">Vẫn nhập</button></div>`;
    }
    if (entry.duplicateInBatch) {
      return `<div class="text-xs" style="color:var(--color-warning);">Có thể bạn đã chọn nhầm cùng một file hai lần.</div>`;
    }
    return '';
  },

  _separateListHtml() {
    const rows = this._state.entries.map(entry => `
      <div class="import-file-row ${this._isBlocking(entry) ? 'has-error' : ''}" data-entry="${entry.id}">
        <div style="font-size:20px;">🎵</div>
        <div class="import-file-row-main">
          <div class="import-file-row-head">
            <input type="text" class="input input-sm" style="flex:1;min-width:120px;" value="${Utils.escapeHtml(entry.title)}" data-field="title" data-entry="${entry.id}">
            <span class="text-xs text-tertiary">${ImportPreflight.formatMbVi(entry.size)}</span>
          </div>
          <div class="import-file-row-head">
            ${this._dateInputHtml(entry)}
            <span class="text-xs text-tertiary">${entry.dateSource === 'file' ? 'Lấy từ thông tin file — bạn kiểm tra lại giúp.' : entry.dateSource === 'recent-copy' ? 'Có vẻ đây là lúc bạn chép file vào máy. Hãy chọn đúng ngày họp.' : ''}</span>
          </div>
          ${this._fileErrorLine(entry)}
          ${this._duplicateLineHtml(entry)}
        </div>
        <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="remove" data-entry="${entry.id}">✕</button>
      </div>
    `).join('');
    return `<div class="flex flex-col gap-2">${rows}</div>`;
  },

  _dateInputHtml(entry) {
    if (this.supportsDateTimeLocal()) {
      const local = this._isoToLocalInputValue(entry.dateIso);
      return `<input type="datetime-local" class="input input-sm" style="width:auto;" value="${local}" data-field="date" data-entry="${entry.id}">`;
    }
    const date = new Date(entry.dateIso);
    const pad = n => String(n).padStart(2, '0');
    const d = `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;
    const t = `${pad(date.getHours())}:${pad(date.getMinutes())}`;
    return `<input type="date" class="input input-sm" style="width:auto;" value="${d}" data-field="date-day" data-entry="${entry.id}">
            <input type="time" class="input input-sm" style="width:auto;" value="${t}" data-field="date-time" data-entry="${entry.id}">`;
  },

  _isoToLocalInputValue(iso) {
    const date = new Date(iso);
    const pad = n => String(n).padStart(2, '0');
    return `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}T${pad(date.getHours())}:${pad(date.getMinutes())}`;
  },

  _mergedListHtml() {
    const s = this._state;
    const total = s.entries.reduce((sum, e) => sum + (e.clientDurationSeconds || 0), 0);
    const allHaveDuration = s.entries.every(e => e.clientDurationSeconds);
    const title = allHaveDuration ? `Các phần · tổng ${Utils.formatDurationHuman(total)}` : `Các phần · ${s.entries.length} phần`;
    const orderLine = s.orderMethod === 'name' ? 'Đang sắp theo tên file.'
      : s.orderMethod === 'lastModified' ? 'Đang sắp theo thời gian tạo file.' : '';
    const rows = s.entries.map((entry, i) => {
      const prev = s.entries[i - 1];
      const gapSeconds = prev ? Parts.gapWarningSeconds(prev, entry) : null;
      const gapLevel = Parts.classifyGap(gapSeconds);
      const canPreview = !entry.file.type || true; // feature-detected per-click via previewEntry, never blocked in advance
      return `
      <div class="import-part-row ${this._isBlocking(entry) ? 'has-error' : ''}" draggable="true" data-entry="${entry.id}" data-index="${i}">
        <div class="import-part-handle">⠿</div>
        <div class="import-part-row-main">
          <div class="import-part-row-head">
            <strong>${i + 1}.</strong>
            <span>${Utils.escapeHtml(entry.name)}</span>
            <span class="text-xs text-tertiary">${ImportPreflight.formatMbVi(entry.size)}${entry.clientDurationSeconds ? ' · ' + Utils.formatDurationHuman(entry.clientDurationSeconds) : ''}</span>
          </div>
          ${gapLevel === 'negative' ? `<div class="import-file-row-error">⚠ Phần ${i + 1} bắt đầu trước khi phần ${i} kết thúc — kiểm tra lại thứ tự.</div>` : ''}
          ${gapLevel === 'large' ? `<div class="import-file-row-error">⚠ Phần ${i + 1} cách phần ${i} hơn 2 tiếng — có thể đây là hai buổi họp khác nhau.</div>` : ''}
          ${gapLevel === 'normal' && gapSeconds !== null ? `<div class="text-xs text-tertiary">cách phần ${i}: ${Utils.formatDurationHuman(Math.max(0, gapSeconds))}</div>` : ''}
          ${this._fileErrorLine(entry)}
          <div class="flex gap-2">
            <button type="button" class="btn btn-ghost btn-sm" data-action="preview-head" data-entry="${entry.id}" ${entry.previewState === 'unavailable' ? 'disabled title="Trình duyệt không phát được định dạng này — kiểm tra thứ tự bằng tên file và giờ tạo file."' : ''}>▶ Nghe 10 giây đầu</button>
            <button type="button" class="btn btn-ghost btn-sm" data-action="preview-tail" data-entry="${entry.id}" ${entry.previewState === 'unavailable' ? 'disabled' : ''}>▶ Nghe 10 giây cuối</button>
          </div>
        </div>
        <div class="flex flex-col">
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="move-up" data-entry="${entry.id}" ${i === 0 ? 'disabled' : ''}>▲</button>
          <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="move-down" data-entry="${entry.id}" ${i === s.entries.length - 1 ? 'disabled' : ''}>▼</button>
        </div>
        <button type="button" class="btn btn-ghost btn-icon btn-sm" data-action="remove" data-entry="${entry.id}">✕</button>
      </div>`;
    }).join('');
    const warn6 = s.entries.length >= 6 ? '<p class="text-xs" style="color:var(--color-warning);">Từ 6 phần trở lên sẽ tốn nhiều thời gian và chi phí hơn để xử lý.</p>' : '';
    return `
      <div>
        <div class="flex justify-between items-center" style="margin-bottom:var(--space-2);">
          <strong class="text-sm">${title}</strong>
          <span class="text-xs text-tertiary">${orderLine}</span>
        </div>
        <p class="text-xs text-tertiary" style="margin-bottom:var(--space-2);">Nghe thử 10 giây cuối phần trước và 10 giây đầu phần sau để chắc chắn thứ tự đúng — sai thứ tự thì transcript sẽ lộn xộn.</p>
        <div class="flex flex-col gap-2">${rows}</div>
        ${warn6}
      </div>
    `;
  },

  _contextHtml() {
    const c = this._state.context;
    const multi = this._state.entries.length >= 2 && this._state.mode === 'separate';
    const heading = this._attachMeetingId ? '' : (this._state.entries.length <= 1
      ? 'Thông tin cuộc họp (không bắt buộc — giúp tóm tắt tốt hơn)'
      : (multi ? 'Thông tin cuộc họp — áp dụng cho tất cả file' : 'Thông tin cuộc họp'));
    if (this._attachMeetingId) return '';
    return `
      <div class="card" style="padding:var(--space-4);">
        <p class="text-sm" style="margin-bottom:var(--space-3);">${Utils.escapeHtml(heading)}</p>
        <div class="flex flex-col gap-3">
          <div class="input-group">
            <label>Người tham dự (cách nhau bằng dấu phẩy)</label>
            <input type="text" class="input" id="import-participants" placeholder="ví dụ: Hieu, Lan, khách ABC" value="${Utils.escapeHtml(c.participants.join(', '))}">
          </div>
          <div class="input-group">
            <label>Loại cuộc họp</label>
            <select class="input" id="import-meeting-type">${App._meetingTypeOptions(c.meetingType)}</select>
          </div>
          <div class="input-group">
            <label>Chủ đề</label>
            <input type="text" class="input" id="import-topic" maxlength="200" value="${Utils.escapeHtml(c.topic)}">
          </div>
          <div class="input-group">
            <label>Người chủ trì</label>
            <input type="text" class="input" id="import-lead-by" maxlength="200" value="${Utils.escapeHtml(c.leadBy)}">
          </div>
        </div>
      </div>
    `;
  },

  _sttConfigHtml() {
    const c = this._state.context;
    const providers = (this._providersPayload && this._providersPayload.providers) || [];
    const languages = Transcriber.getSupportedLanguages();
    const translations = Transcriber.getTranslationLanguages();
    return `
      <div class="card" style="padding:var(--space-4);" id="import-stt-summary">
        <p class="text-sm" style="margin-bottom:var(--space-3);">Cấu hình nhận dạng giọng nói</p>
        ${!this._providersPayload ? '<p class="text-xs" style="color:var(--color-warning);">Chưa kiểm tra trước được định dạng/dung lượng cho lần này (không lấy được thông tin nhà cung cấp).</p>' : ''}
        <div class="flex gap-3 flex-wrap">
          <select class="input" id="import-provider" style="flex:1;min-width:140px;">
            ${providers.map(p => `<option value="${Utils.escapeHtml(p.id)}" ${p.id === c.provider ? 'selected' : ''}>${Utils.escapeHtml(p.name)}${p.available ? '' : ' — cần cấu hình'}</option>`).join('')}
          </select>
          <select class="input" id="import-language" style="flex:1;min-width:140px;">
            <option value="auto" ${c.language === 'auto' ? 'selected' : ''}>Tự nhận diện nhiều ngôn ngữ</option>
            ${languages.map(l => `<option value="${Utils.escapeHtml(l.code)}" ${l.code === c.language ? 'selected' : ''}>${Utils.escapeHtml(l.name)}</option>`).join('')}
          </select>
          <select class="input" id="import-translation" style="flex:1;min-width:140px;">
            <option value="">Không dịch — chỉ bản gốc</option>
            ${translations.map(l => `<option value="${Utils.escapeHtml(l.sonioxCode)}" ${l.sonioxCode === c.translationLanguage ? 'selected' : ''}>${Utils.escapeHtml(l.name)}</option>`).join('')}
          </select>
        </div>
        <p class="text-xs text-tertiary" style="margin-top:var(--space-2);">Chỉ áp dụng cho lần nhập này.</p>
      </div>
    `;
  },

  _summaryLineHtml() {
    const s = this._state;
    if (s.entries.length === 0) return '';
    const blocked = s.entries.filter(e => this._isBlocking(e));
    if (s.mode === 'merged') {
      if (blocked.length > 0) return `<p class="text-xs" style="color:var(--color-warning);">Bỏ phần bị lỗi ra trước khi bắt đầu.</p>`;
      return '';
    }
    if (blocked.length > 0) return `<p class="text-xs" style="color:var(--color-warning);">${blocked.length} file có lỗi sẽ không được nhập.</p>`;
    return '';
  },

  _startDisabled() {
    const s = this._state;
    if (s.entries.length === 0) return true;
    if (s.mode === 'merged') return s.entries.some(e => this._isBlocking(e));
    return this._validEntries().length === 0;
  },

  _startLabel() {
    const s = this._state;
    if (this._attachMode === 'appendPart') return s.entries.length <= 1 ? 'Thêm phần' : `Thêm ${s.entries.length} phần`;
    if (this._attachMeetingId) return 'Gắn file';
    if (s.entries.length <= 1) return 'Bắt đầu tạo transcript';
    if (s.mode === 'merged') return `Bắt đầu — tạo 1 cuộc họp gồm ${s.entries.length} phần`;
    return `Bắt đầu — tạo ${this._validEntries().length} cuộc họp`;
  },

  /* ── Event binding ── */

  _bind() {
    document.getElementById('import-close')?.addEventListener('click', () => this._close());
    document.getElementById('import-cancel')?.addEventListener('click', () => this._close());

    const dropzone = document.getElementById('import-dropzone');
    const fileInput = document.getElementById('import-file-input');
    dropzone?.addEventListener('click', () => fileInput?.click());
    fileInput?.addEventListener('change', event => { this.addFiles(event.target.files); event.target.value = ''; });
    dropzone?.addEventListener('dragover', event => { event.preventDefault(); dropzone.classList.add('is-dragover'); });
    dropzone?.addEventListener('dragleave', () => dropzone.classList.remove('is-dragover'));
    dropzone?.addEventListener('drop', event => {
      event.preventDefault();
      dropzone.classList.remove('is-dragover');
      const files = Array.from(event.dataTransfer.files || []).filter(f => f.type || f.size > 0);
      if (files.length === 0 && event.dataTransfer.items?.length) {
        App.toast('Không nhận được file — có thể bạn vừa kéo một thư mục.', 'warning');
        return;
      }
      this.addFiles(files);
    });

    document.querySelectorAll('input[name="import-mode"]').forEach(radio => {
      radio.addEventListener('change', () => this.setMode(radio.value));
    });

    document.querySelectorAll('[data-action="remove"]').forEach(btn => btn.addEventListener('click', () => this.removeEntry(btn.dataset.entry)));
    document.querySelectorAll('[data-action="move-up"]').forEach(btn => btn.addEventListener('click', () => this.moveEntry(btn.dataset.entry, -1)));
    document.querySelectorAll('[data-action="move-down"]').forEach(btn => btn.addEventListener('click', () => this.moveEntry(btn.dataset.entry, 1)));
    document.querySelectorAll('[data-action="use-provider"]').forEach(btn => btn.addEventListener('click', () => this.useAlternativeProvider(btn.dataset.provider)));
    document.querySelectorAll('[data-action="undo-provider"]').forEach(a => a.addEventListener('click', event => { event.preventDefault(); this.undoProviderOverride(); }));
    document.querySelectorAll('[data-action="dismiss-dup"]').forEach(btn => btn.addEventListener('click', () => {
      const entry = this._state.entries.find(e => e.id === btn.dataset.entry);
      if (entry) { entry.dismissedDuplicateWarning = true; this._render(); }
    }));
    document.querySelectorAll('[data-action="preview-head"]').forEach(btn => btn.addEventListener('click', () => {
      const entry = this._state.entries.find(e => e.id === btn.dataset.entry);
      if (entry) this.previewEntry(entry, 'head');
    }));
    document.querySelectorAll('[data-action="preview-tail"]').forEach(btn => btn.addEventListener('click', () => {
      const entry = this._state.entries.find(e => e.id === btn.dataset.entry);
      if (entry) this.previewEntry(entry, 'tail');
    }));

    // Per-row title/date fields update THAT entry only, no full re-render
    // (keeps focus while typing).
    document.querySelectorAll('[data-field="title"]').forEach(input => input.addEventListener('input', () => {
      const entry = this._state.entries.find(e => e.id === input.dataset.entry);
      if (entry) entry.title = input.value;
    }));
    document.querySelectorAll('[data-field="date"]').forEach(input => input.addEventListener('change', () => {
      const entry = this._state.entries.find(e => e.id === input.dataset.entry);
      if (!entry || !input.value) return;
      const iso = new Date(input.value).toISOString();
      // BR-94 applies to hand-typed dates too, not just the file.lastModified
      // suggestion (BUG-003) — reject and restore the previous value instead
      // of silently accepting an implausible date.
      if (!MeetingDate.isPlausibleMeetingDate(iso)) {
        App.toast('Ngày không hợp lệ (quá xa trong tương lai hoặc trước năm 2000) — đã giữ nguyên ngày cũ.', 'error');
        input.value = this._isoToLocalInputValue(entry.dateIso);
        return;
      }
      entry.dateIso = iso; entry.dateSource = 'manual';
    }));
    document.querySelectorAll('[data-field="date-day"],[data-field="date-time"]').forEach(input => input.addEventListener('change', () => {
      const entry = this._state.entries.find(e => e.id === input.dataset.entry);
      if (!entry) return;
      const dayEl = document.querySelector(`[data-field="date-day"][data-entry="${entry.id}"]`);
      const timeEl = document.querySelector(`[data-field="date-time"][data-entry="${entry.id}"]`);
      if (!dayEl?.value) return;
      const iso = new Date(`${dayEl.value}T${timeEl?.value || '00:00'}`).toISOString();
      if (!MeetingDate.isPlausibleMeetingDate(iso)) {
        App.toast('Ngày không hợp lệ (quá xa trong tương lai hoặc trước năm 2000) — đã giữ nguyên ngày cũ.', 'error');
        const prevDate = new Date(entry.dateIso);
        const pad = n => String(n).padStart(2, '0');
        dayEl.value = `${prevDate.getFullYear()}-${pad(prevDate.getMonth() + 1)}-${pad(prevDate.getDate())}`;
        if (timeEl) timeEl.value = `${pad(prevDate.getHours())}:${pad(prevDate.getMinutes())}`;
        return;
      }
      entry.dateIso = iso; entry.dateSource = 'manual';
    }));

    // Drag-and-drop reordering for merged mode (native HTML5 DnD).
    let dragFromIndex = null;
    document.querySelectorAll('.import-part-row').forEach(row => {
      row.addEventListener('dragstart', () => { dragFromIndex = Number(row.dataset.index); row.classList.add('is-dragging'); });
      row.addEventListener('dragend', () => row.classList.remove('is-dragging'));
      row.addEventListener('dragover', event => { event.preventDefault(); row.classList.add('is-drop-target'); });
      row.addEventListener('dragleave', () => row.classList.remove('is-drop-target'));
      row.addEventListener('drop', event => {
        event.preventDefault();
        row.classList.remove('is-drop-target');
        const toIndex = Number(row.dataset.index);
        if (dragFromIndex !== null && dragFromIndex !== toIndex) this.reorder(dragFromIndex, toIndex);
        dragFromIndex = null;
      });
    });

    document.getElementById('import-provider')?.addEventListener('change', event => {
      this._state.context.provider = event.target.value;
      this._state.sttOverrideNotice = '';
      this._reclassify();
      this._render();
    });
    document.getElementById('import-language')?.addEventListener('change', event => { this._state.context.language = event.target.value; });
    document.getElementById('import-translation')?.addEventListener('change', event => { this._state.context.translationLanguage = event.target.value; });
    document.getElementById('import-participants')?.addEventListener('change', event => {
      this._state.context.participants = event.target.value.split(',').map(p => p.trim()).filter(Boolean);
    });
    document.getElementById('import-meeting-type')?.addEventListener('change', event => { this._state.context.meetingType = Storage.normalizeMeetingType(event.target.value); });
    document.getElementById('import-topic')?.addEventListener('change', event => { this._state.context.topic = Storage.normalizeShortText(event.target.value); });
    document.getElementById('import-lead-by')?.addEventListener('change', event => { this._state.context.leadBy = Storage.normalizeShortText(event.target.value); });

    document.getElementById('import-start')?.addEventListener('click', () => this._start());
  },

  _close() {
    this.closePreview();
    App.closeModal();
  },

  /* ── Submit ── */

  async _start() {
    const startButton = document.getElementById('import-start');
    if (startButton) { startButton.disabled = true; startButton.textContent = 'Đang bắt đầu…'; }
    try {
      if (this._attachMode === 'appendPart') {
        await this._startAppendParts();
      } else if (this._attachMeetingId) {
        await this._startAttach();
      } else if (this._state.mode === 'merged' && this._state.entries.length >= 2) {
        await this._startMerged();
      } else {
        await this._startSeparate();
      }
    } catch (error) {
      App.toast(error.message || 'Không thể bắt đầu nhập file.', 'error');
      if (startButton) { startButton.disabled = false; startButton.textContent = this._startLabel(); }
    }
  },

  _tagsForContext(context) {
    return App._initialTagsForMeetingType(context.meetingType);
  },

  async _startSeparate() {
    const entries = this._validEntries();
    const c = this._state.context;
    this._close();
    App.toast(entries.length > 1 ? `Đang tạo transcript cho ${entries.length} bản ghi. Bạn cứ dùng MeetNote bình thường.` : 'Đang tạo transcript cho bản ghi của bạn.', 'info');
    for (const entry of entries) {
      const meeting = Storage.saveMeeting({
        title: entry.title || entry.name.replace(/\.[^.]+$/, ''),
        date: entry.dateIso,
        status: 'processing',
        participants: c.participants,
        duration: 0,
        transcript: [],
        translations: [],
        language: c.language,
        translationLanguage: c.translationLanguage,
        meetingType: c.meetingType,
        topic: c.topic,
        leadBy: c.leadBy,
        tags: this._tagsForContext(c),
        source: 'import',
        sourceFilename: entry.name,
        sourceSizeBytes: entry.size
      });
      const startedAt = new Date().toISOString();
      try {
        App._backgroundAudioTasks.set(meeting.id, { filename: entry.name, phase: 'saving' });
        App._renderBackgroundTaskIndicator();
        await AudioStorage.save(meeting.id, entry.file);
        meeting.audioId = meeting.id;
        Storage.saveMeeting(meeting);
        await Storage.flush();
        App._processUploadedRecording(meeting, startedAt, entry.name, { provider: c.provider, model: '' });
      } catch (error) {
        App._backgroundAudioTasks.delete(meeting.id);
        Storage.saveMeeting({ ...meeting, status: 'failed', processingError: error.message || 'Could not save this audio file.' });
        await Storage.flush();
        App._renderBackgroundTaskIndicator();
      }
    }
    App._updateMeetingsCount();
    App._refreshMeetingView();
  },

  async _startMerged() {
    const c = this._state.context;
    const first = this._state.entries[0];
    this._close();
    App.toast(`Đang tạo transcript cho cuộc họp gồm ${this._state.entries.length} phần.`, 'info');

    const meeting = Storage.saveMeeting({
      title: first.title || first.name.replace(/\.[^.]+$/, ''),
      date: first.dateIso,
      status: 'processing',
      participants: c.participants,
      duration: 0,
      transcript: [],
      translations: [],
      language: c.language,
      translationLanguage: c.translationLanguage,
      meetingType: c.meetingType,
      topic: c.topic,
      leadBy: c.leadBy,
      tags: this._tagsForContext(c),
      source: 'import',
      sourceFilename: first.name,
      sourceSizeBytes: first.size
    });

    App._backgroundAudioTasks.set(meeting.id, { filename: `${this._state.entries.length} phần`, phase: 'saving' });
    App._renderBackgroundTaskIndicator();

    const partIdFor = () => `part-${Utils.uuid()}`;
    const partsPayload = [];
    try {
      for (const entry of this._state.entries) {
        const partId = partIdFor();
        await AudioStorage.save(partId, entry.file);
        partsPayload.push({ partId, filename: entry.name, sizeBytes: entry.size, clientDurationSeconds: entry.clientDurationSeconds, order: partsPayload.length + 1 });
      }
      const response = await fetch(`/api/meetings/${encodeURIComponent(meeting.id)}/parts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: partsPayload, provider: c.provider, model: '', language: c.language, translationLanguage: c.translationLanguage })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || 'Could not register the recording parts.');
      // Pull `meeting.parts` into the local cache right away so Meeting
      // Detail shows the multi-part progress card immediately if the user
      // navigates there before the first poll tick (~3s later).
      await App._reloadMeetingsFromServer();
      App._backgroundAudioTasks.set(meeting.id, { filename: meeting.title, phase: 'transcribing' });
      App._renderBackgroundTaskIndicator();
      App._pollPartsStatus(meeting.id);
    } catch (error) {
      App._backgroundAudioTasks.delete(meeting.id);
      Storage.saveMeeting({ ...Storage.getMeeting(meeting.id), status: 'failed', processingError: error.message });
      await Storage.flush();
      App._renderBackgroundTaskIndicator();
      App.toast(`Không thể bắt đầu: ${error.message}`, 'error');
    }
    App._updateMeetingsCount();
    App._refreshMeetingView();
  },

  async _startAttach() {
    const entry = this._state.entries[0];
    const meeting = Storage.getMeeting(this._attachMeetingId);
    if (!meeting) throw new Error('Không tìm thấy bản ghi.');
    this._close();
    const startedAt = new Date().toISOString();
    try {
      App._backgroundAudioTasks.set(meeting.id, { filename: entry.name, phase: 'saving' });
      App._renderBackgroundTaskIndicator();
      await AudioStorage.save(meeting.id, entry.file);
      const updated = { ...meeting, audioId: meeting.id, status: 'processing', source: 'import', sourceFilename: entry.name, sourceSizeBytes: entry.size };
      Storage.saveMeeting(updated);
      await Storage.flush();
      App._processUploadedRecording(updated, startedAt, entry.name);
      App._refreshMeetingView(meeting.id);
    } catch (error) {
      App._backgroundAudioTasks.delete(meeting.id);
      App.toast(`Không thể gắn file: ${error.message}`, 'error');
    }
  },

  // Q9/TV18 — "thêm phần vào một bản ghi ghép đã xong": POSTs to the SAME
  // /api/meetings/:id/parts route TV6's initial merged import uses
  // (`_startMerged` above), just against an EXISTING meetingId instead of a
  // freshly created one. `registerParts` (server/meeting-parts.js) appends
  // the new part(s) after the current last order; BR-121's reorder UI in
  // Meeting Detail is how the user then moves it into the right spot if it
  // isn't actually last — never auto-regenerates the summary (BR-121/BR-29).
  async _startAppendParts() {
    const meetingId = this._attachMeetingId;
    const c = this._state.context;
    const entries = this._state.entries;
    this._close();
    App.toast(entries.length > 1 ? `Đang thêm ${entries.length} phần vào bản ghi.` : 'Đang thêm phần vào bản ghi.', 'info');

    App._backgroundAudioTasks.set(meetingId, { filename: `${entries.length} phần`, phase: 'saving' });
    App._renderBackgroundTaskIndicator();

    const partIdFor = () => `part-${Utils.uuid()}`;
    const partsPayload = [];
    try {
      for (const entry of entries) {
        const partId = partIdFor();
        await AudioStorage.save(partId, entry.file);
        partsPayload.push({ partId, filename: entry.name, sizeBytes: entry.size, clientDurationSeconds: entry.clientDurationSeconds, order: partsPayload.length + 1 });
      }
      const response = await fetch(`/api/meetings/${encodeURIComponent(meetingId)}/parts`, {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ parts: partsPayload, provider: c.provider, model: '', language: c.language, translationLanguage: c.translationLanguage })
      });
      const body = await response.json().catch(() => ({}));
      if (!response.ok) throw new Error(body.error?.message || 'Could not register the recording parts.');
      await App._reloadMeetingsFromServer();
      App._backgroundAudioTasks.set(meetingId, { filename: Storage.getMeeting(meetingId)?.title || meetingId, phase: 'transcribing' });
      App._renderBackgroundTaskIndicator();
      App._pollPartsStatus(meetingId);
      App.navigate(`meeting/${meetingId}`, { force: true });
    } catch (error) {
      App._backgroundAudioTasks.delete(meetingId);
      App._renderBackgroundTaskIndicator();
      App.toast(`Không thể thêm phần: ${error.message}`, 'error');
    }
    App._updateMeetingsCount();
    App._refreshMeetingView();
  }
};
