/* ============================================
   MeetNote AI — Summary Module
   Talks to the provider-neutral /api endpoints. The
   selected provider/model/preset is chosen by the caller;
   this module never assumes a specific service.
   ============================================ */

const Summary = {
  // Canonical 5-field shape (§3.2 of docs/Architecture.md). Must stay in
  // sync with server/llm/preset-schema.js GENERAL_SECTIONS — both exist so
  // BR-20 (legacy summaries render like before, with zero migration) works
  // without a network round-trip on the client.
  GENERAL_SECTIONS: [
    { key: 'summary', label: 'Summary', type: 'paragraph', hint: '' },
    { key: 'keyPoints', label: 'Key Points', type: 'bulletList', hint: '' },
    { key: 'decisions', label: 'Decisions', type: 'bulletList', hint: '' },
    { key: 'actionItems', label: 'Action Items', type: 'actionList', hint: '' },
    { key: 'openQuestions', label: 'Open Questions', type: 'bulletList', hint: '' }
  ],

  _payload(meeting, options = {}) {
    return {
      provider: options.provider || undefined,
      model: options.model || undefined,
      language: options.language || undefined,
      presetId: options.presetId || undefined,
      meeting: {
        id: meeting.id,
        title: meeting.title,
        date: meeting.date,
        duration: meeting.duration,
        participants: meeting.participants,
        // Segments already carry `.kind`/`.part` when this is a merged
        // recording (server/stt/merge.js) — forwarded as-is, same as every
        // other transcript field here (M11, Architecture §V4.2).
        transcript: meeting.transcript,
        // BR-130/BR-135: without these, validateMeetingForSummary/
        // buildContextBlock never learn the recording is merged or missing a
        // part, no matter how complete `transcript` itself is.
        partCount: Array.isArray(meeting.parts) ? meeting.parts.length : 0,
        missingParts: Array.isArray(meeting.missingParts) ? meeting.missingParts : [],
        // BR-32/BR-37 (G1, Architecture §4.1): these 4 fields used to be
        // dropped here, so notes/pre-meeting info never reached the prompt
        // no matter what server.js did with them.
        notes: meeting.notes || '',
        meetingType: meeting.meetingType || '',
        topic: meeting.topic || '',
        leadBy: meeting.leadBy || ''
      }
    };
  },

  // Pull a readable message out of the standard error envelope or legacy string.
  _errorMessage(content, fallback) {
    if (content && typeof content.error === 'object') return content.error.message || fallback;
    if (content && typeof content.error === 'string') return content.error;
    return fallback;
  },

  async suggestTitle(meeting, options = {}) {
    const response = await fetch('/api/title-suggestion', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this._payload(meeting, options))
    });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(this._errorMessage(content, 'Could not suggest a meeting title.'));
    }
    const title = String(content.title || '').trim();
    if (!title) throw new Error('The provider returned an empty meeting title.');
    return title;
  },

  async generate(meeting, options = {}) {
    const response = await fetch('/api/summary', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(this._payload(meeting, options))
    });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) {
      throw new Error(this._errorMessage(content, 'Could not generate the meeting summary.'));
    }

    const { summaryGeneration, summaryPreset, ...details } = content;
    // The server always echoes the snapshot it actually used (BR-16). The
    // only case it can be missing is the legacy no-presetId request path.
    const snapshot = summaryPreset || { presetId: null, name: 'General Meeting', sections: this.GENERAL_SECTIONS, capturedAt: null };

    return {
      summary: this.format(details, snapshot),
      details,
      summaryPreset: snapshot,
      generation: summaryGeneration || null,
      actionItems: this._extractActionItems(details, snapshot)
    };
  },

  // C4: seed meeting.actionItems from the preset's first actionList section,
  // instead of assuming a fixed `actionItems` key (BR-15/E3: caller only
  // applies this when the meeting's own action list is still empty).
  _extractActionItems(details, snapshot) {
    const actionSection = (snapshot?.sections || []).find(section => section.type === 'actionList');
    if (!actionSection) return [];
    const items = Array.isArray(details[actionSection.key]) ? details[actionSection.key] : [];
    return items.filter(item => item && item.text).map(item => ({
      id: Utils.uuid(),
      text: item.text,
      assignee: item.assignee || '',
      dueDate: item.dueDate || '',
      done: false,
      createdAt: new Date().toISOString()
    }));
  },

  // BR-20: a meeting stored before this feature existed has no
  // `summaryPreset`. Build the equivalent snapshot on the fly — never
  // persisted, purely for rendering/exporting.
  virtualSnapshotForLegacy(meeting) {
    if (meeting.summaryPreset) return meeting.summaryPreset;
    if (meeting.summaryDetails) {
      return { presetId: null, name: 'General Meeting', sections: this.GENERAL_SECTIONS, capturedAt: null };
    }
    if (meeting.summary) {
      return {
        presetId: null,
        name: 'General Meeting',
        sections: [{ key: 'summary', label: 'Summary', type: 'paragraph', hint: '' }],
        capturedAt: null
      };
    }
    return null;
  },

  // Flat text used for meeting.summary (copy/export/search — WHY-9). Driven
  // entirely by the snapshot, so it works for both preset and legacy data.
  format(details, snapshot) {
    if (!snapshot) return '';
    const blocks = [];
    for (const section of snapshot.sections) {
      const text = this._formatSection(section, details ? details[section.key] : undefined);
      if (!text) continue;
      blocks.push(section.type === 'paragraph' ? text : `${section.label}\n${text}`);
    }
    return blocks.join('\n\n');
  },

  _formatSection(section, value) {
    if (section.type === 'paragraph') return String(value || '').trim();
    if (section.type === 'bulletList') {
      const values = Array.isArray(value) ? value.map(String).filter(Boolean) : [];
      return values.length ? values.map(item => `• ${item}`).join('\n') : '';
    }
    if (section.type === 'actionList') {
      const values = Array.isArray(value) ? value.filter(item => item && item.text) : [];
      if (!values.length) return '';
      return values.map(item => {
        const meta = [item.assignee, item.dueDate].filter(Boolean).join(' · ');
        return meta ? `• ${item.text} (${meta})` : `• ${item.text}`;
      }).join('\n');
    }
    return '';
  }
};
