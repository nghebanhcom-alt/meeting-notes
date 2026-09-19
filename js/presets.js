/* ============================================
   MeetNote AI — Summary Presets client
   Thin wrapper over /api/summary-presets with an
   in-memory cache (T11).
   ============================================ */

const Presets = {
  _cache: null,

  async list({ force = false } = {}) {
    if (this._cache && !force) return this._cache;
    const response = await fetch('/api/summary-presets', { cache: 'no-store' });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) throw this._error(content, 'Could not load summary presets.');
    this._cache = Array.isArray(content.presets) ? content.presets : [];
    return this._cache;
  },

  invalidate() {
    this._cache = null;
  },

  async create(payload) {
    const response = await fetch('/api/summary-presets', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) throw this._error(content, 'Could not create the preset.');
    this.invalidate();
    return content; // { preset, warnings }
  },

  async update(id, payload) {
    const response = await fetch(`/api/summary-presets/${encodeURIComponent(id)}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload)
    });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) throw this._error(content, 'Could not update the preset.');
    this.invalidate();
    return content; // { preset, warnings }
  },

  async remove(id) {
    const response = await fetch(`/api/summary-presets/${encodeURIComponent(id)}`, { method: 'DELETE' });
    const content = await response.json().catch(() => ({}));
    if (!response.ok) throw this._error(content, 'Could not delete the preset.');
    this.invalidate();
    return content; // { success, presets }
  },

  _error(content, fallback) {
    const message = (content && content.error && content.error.message) || fallback;
    const error = new Error(message);
    error.code = (content && content.error && content.error.code) || '';
    return error;
  }
};
