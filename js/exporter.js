/* ============================================
   MeetNote AI — Export settings + export API client (T13)
   Named differently from export.js (the Markdown/text renderer) — this
   module only talks to /api/export* over HTTP. It never sends a path: the
   server always reads the configured directory itself (Architecture §4.2/§5.5).
   ============================================ */

const Exporter = {
  // Pull a readable message out of the standard error envelope.
  _errorMessage(content, fallback) {
    if (content && typeof content.error === 'object') return content.error.message || fallback;
    if (content && typeof content.error === 'string') return content.error;
    return fallback;
  },

  async getSettings() {
    const response = await fetch('/api/export-settings', { cache: 'no-store' });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) throw new Error(this._errorMessage(content, 'Could not load export settings.'));
    return content;
  },

  async saveSettings(markdownDir) {
    const response = await fetch('/api/export-settings', {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ markdownDir })
    });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(this._errorMessage(content, 'Could not save the export folder.'));
      error.code = content?.error?.code || '';
      throw error;
    }
    return content;
  },

  async checkDirectory(markdownDir) {
    const response = await fetch('/api/export-settings/check', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(markdownDir === undefined ? {} : { markdownDir })
    });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(this._errorMessage(content, 'Thư mục không hợp lệ.'));
      error.code = content?.error?.code || '';
      throw error;
    }
    return content;
  },

  // `content` is the fully-rendered Markdown (Export.toMarkdown output) —
  // this function never sends meeting metadata or a path (BR-41).
  async exportMarkdown(meetingId, content, includeTranscript) {
    const response = await fetch('/api/export/markdown', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ meetingId, content, includeTranscript: Boolean(includeTranscript) })
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(this._errorMessage(data, 'Could not export the meeting.'));
      error.code = data?.error?.code || '';
      throw error;
    }
    return data;
  },

  async openFolder() {
    const response = await fetch('/api/export/open-folder', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: '{}'
    });
    const data = await response.json().catch(() => ({}));
    if (!response.ok) {
      const error = new Error(this._errorMessage(data, 'Could not open the folder.'));
      error.code = data?.error?.code || '';
      error.statusCode = response.status;
      throw error;
    }
    return data;
  },

  async copyPath(fullPath) {
    try {
      await navigator.clipboard.writeText(fullPath);
      return true;
    } catch {
      const ta = document.createElement('textarea');
      ta.value = fullPath;
      document.body.appendChild(ta);
      ta.select();
      const copied = document.execCommand('copy');
      document.body.removeChild(ta);
      return copied;
    }
  }
};
