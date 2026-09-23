/* ============================================
   MeetNote AI — Export Module
   ============================================ */

const Export = {
  /**
   * Export meeting to Markdown format (BR-51..BR-54, Architecture.md §5.6).
   * `options.includeTranscript` defaults to true (BR-54); `options.presetDeleted`
   * lets the caller pass a live-preset-list lookup result (BR-52 "(preset đã
   * bị xóa khỏi ứng dụng)") since this function has no async preset fetch of
   * its own — it stays a pure renderer, same as `Summary.format`.
   */
  toMarkdown(meeting, options = {}) {
    const includeTranscript = options.includeTranscript !== false;
    const lines = [];

    lines.push(`# ${meeting.title}`);
    lines.push('');
    lines.push(`**Ngày:** ${Utils.formatDate(meeting.date)}  **Thời lượng:** ${Utils.formatDurationHuman(meeting.duration)}`);

    // Pre-meeting info block (BR-51) — every field skipped when empty, no
    // trailing blank heading.
    const typeEntry = meeting.meetingType && typeof meetingTypeByCode === 'function'
      ? meetingTypeByCode(meeting.meetingType) : null;
    if (typeEntry) lines.push(`**Loại cuộc họp:** ${typeEntry.label}`);
    if (meeting.topic) lines.push(`**Chủ đề:** ${meeting.topic}`);
    if (meeting.leadBy) lines.push(`**Chủ trì:** ${meeting.leadBy}`);
    if (meeting.participants && meeting.participants.length > 0) {
      lines.push(`**Người tham dự:** ${meeting.participants.join(', ')}`);
    }
    if (meeting.tags && meeting.tags.length > 0) {
      lines.push(`**Tag:** ${meeting.tags.join(', ')}`);
    }
    lines.push('');

    // TV14/BR-129/PRG-17 — a merged recording missing a part must say so up
    // front, not just leave a gap for the reader to notice on their own.
    // A no-op for a single-part meeting (missingParts is always empty/absent).
    if (Array.isArray(meeting.missingParts) && meeting.missingParts.length > 0) {
      lines.push(`⚠ Bản ghi này còn thiếu phần ${meeting.missingParts.join(', ')}.`);
      lines.push('');
    }

    // Summary — rendered per-section from the snapshot (BR-20), one
    // Markdown heading per section (Architecture.md §5.6).
    const summarySnapshot = Summary.virtualSnapshotForLegacy(meeting);
    if (summarySnapshot) {
      for (const section of summarySnapshot.sections) {
        const text = Summary._formatSection(section, (meeting.summaryDetails || {})[section.key]);
        if (!text) continue;
        lines.push(`## ${section.label}`);
        lines.push('');
        lines.push(text);
        lines.push('');
      }

      // BR-52: preset name + generatedAt note.
      const generatedAt = meeting.summaryGeneration?.generatedAt
        ? new Date(meeting.summaryGeneration.generatedAt).toLocaleString()
        : '';
      const deletedNote = options.presetDeleted ? ', đã bị xóa khỏi ứng dụng' : '';
      const noteParts = [`Tóm tắt bằng preset "${summarySnapshot.name}"${deletedNote}`];
      if (generatedAt) noteParts.push(generatedAt);
      lines.push(`> ${noteParts.join(' · ')}`);
      lines.push('');
    }

    // Action Items (meeting.actionItems — the user's own curated list,
    // untouched by preset changes, per Architecture §8/E3).
    if (meeting.actionItems && meeting.actionItems.length > 0) {
      lines.push('## Việc cần làm');
      lines.push('');
      meeting.actionItems.forEach(item => {
        const check = item.done ? 'x' : ' ';
        const assignee = item.assignee ? ` — @${item.assignee}` : '';
        lines.push(`- [${check}] ${item.text}${assignee}`);
      });
      lines.push('');
    }

    // Notes — moved BEFORE Transcript (§5.6, mirrors the prompt ordering
    // rationale in Architecture WHY-7).
    if (meeting.notes) {
      lines.push('## Ghi chú');
      lines.push('');
      lines.push(meeting.notes);
      lines.push('');
    }

    // Transcript — optional (BR-54).
    if (includeTranscript && meeting.transcript && meeting.transcript.length > 0) {
      lines.push('## Transcript');
      lines.push('');
      // A segment with `.kind` (part-divider/part-gap) only ever exists on a
      // merged recording (Architecture §V4.3) — a single-part meeting's
      // transcript has no such segment, so this branch is dead code for it
      // and the .md output stays byte-for-byte identical to before TV14
      // (test hồi quy).
      meeting.transcript.forEach(seg => {
        if (seg.kind === 'part-divider') {
          lines.push(`### ${seg.text.replace(/^—\s*/, '').replace(/\s*—$/, '')}`);
          lines.push('');
          return;
        }
        if (seg.kind === 'part-gap') {
          lines.push(`*⚠ ${seg.text}*`);
          lines.push('');
          return;
        }
        const time = Utils.formatTimestamp(seg.time);
        const speaker = SpeakerNames.resolveSpeakerLabel(seg.speaker, meeting.speakerNames, seg.partId).display;
        lines.push(`**[${time}] ${speaker}:** ${seg.text}`);
        lines.push('');
      });
    }

    return lines.join('\n');
  },

  /**
   * Export meeting to plain text
   */
  toPlainText(meeting) {
    const lines = [];

    lines.push(meeting.title);
    lines.push('='.repeat(meeting.title.length));
    lines.push('');
    lines.push(`Date: ${Utils.formatDate(meeting.date)}`);
    lines.push(`Duration: ${Utils.formatDurationHuman(meeting.duration)}`);

    if (meeting.participants.length > 0) {
      lines.push(`Participants: ${meeting.participants.join(', ')}`);
    }
    lines.push('');

    const summarySnapshotText = Summary.virtualSnapshotForLegacy(meeting);
    if (summarySnapshotText) {
      lines.push('SUMMARY');
      lines.push('-'.repeat(40));
      for (const section of summarySnapshotText.sections) {
        const text = Summary._formatSection(section, (meeting.summaryDetails || {})[section.key]);
        if (!text) continue;
        lines.push(`${section.label}:`);
        lines.push(text);
        lines.push('');
      }
    }

    if (meeting.actionItems && meeting.actionItems.length > 0) {
      lines.push('ACTION ITEMS');
      lines.push('-'.repeat(40));
      meeting.actionItems.forEach(item => {
        const check = item.done ? '✓' : '○';
        lines.push(`${check} ${item.text}`);
      });
      lines.push('');
    }

    if (meeting.transcript && meeting.transcript.length > 0) {
      lines.push('TRANSCRIPT');
      lines.push('-'.repeat(40));
      meeting.transcript.forEach(seg => {
        const time = Utils.formatTimestamp(seg.time);
        const speaker = SpeakerNames.resolveSpeakerLabel(seg.speaker, meeting.speakerNames, seg.partId).display;
        lines.push(`[${time}] ${speaker}: ${seg.text}`);
      });
      lines.push('');
    }

    return lines.join('\n');
  },

  /**
   * Download a file
   */
  download(content, filename, mimeType = 'text/plain') {
    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
  },

  /**
   * Download meeting as Markdown
   */
  downloadMarkdown(meeting) {
    const md = this.toMarkdown(meeting);
    const filename = `${meeting.title.replace(/[^a-zA-Z0-9]/g, '_')}_${Utils.formatDateShort(meeting.date)}.md`;
    this.download(md, filename, 'text/markdown');
  },

  /**
   * Download meeting as plain text
   */
  downloadText(meeting) {
    const txt = this.toPlainText(meeting);
    const filename = `${meeting.title.replace(/[^a-zA-Z0-9]/g, '_')}_${Utils.formatDateShort(meeting.date)}.txt`;
    this.download(txt, filename, 'text/plain');
  },

  /**
   * Copy transcript to clipboard
   */
  async copyTranscript(meeting) {
    const text = (meeting.transcript || [])
      .map(seg => {
        const time = Utils.formatTimestamp(seg.time);
        const speaker = SpeakerNames.resolveSpeakerLabel(seg.speaker, meeting.speakerNames, seg.partId).display;
        return `[${time}] ${speaker}: ${seg.text}`;
      })
      .join('\n');

    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      // Fallback
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      document.execCommand('copy');
      document.body.removeChild(ta);
      return true;
    }
  },

  /**
   * Copy summary to clipboard
   */
  async copySummary(meeting) {
    const text = meeting.summary || '';
    try {
      await navigator.clipboard.writeText(text);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = text;
      document.body.appendChild(ta);
      ta.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(ta);
      return copied;
    }
  },

  /**
   * Download all meetings as JSON backup
   */
  downloadBackup() {
    const json = Storage.exportAll();
    const date = new Date().toISOString().slice(0, 10);
    this.download(json, `meetnote_backup_${date}.json`, 'application/json');
  },

  /**
   * Import from JSON backup file
   */
  async importBackup(file) {
    if (file.size > 10 * 1024 * 1024) {
      return { success: false, error: 'Backup file must be smaller than 10 MB' };
    }

    return new Promise((resolve) => {
      const reader = new FileReader();
      reader.onload = (e) => {
        const result = Storage.importData(e.target.result);
        resolve(result);
      };
      reader.onerror = () => resolve({ success: false, error: 'Failed to read file' });
      reader.readAsText(file);
    });
  }
};

// Testability guard only (same pattern as js/meeting-types.js/js/tags.js) —
// `typeof module` is always 'undefined' in the browser, so this changes
// nothing about how index.html loads/uses `Export`. Lets
// test/export-markdown.test.js exercise `toMarkdown` directly with `Utils`/
// `Summary`/`meetingTypeByCode` provided as globals, for the TV14 mandatory
// single-part byte-for-byte regression test.
if (typeof module !== 'undefined' && module.exports) {
  module.exports = Export;
}
