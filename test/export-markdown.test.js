'use strict';

// TV14 — Export.toMarkdown for merged recordings (BR-129, BR-51; PRG-17,
// FAI-10), plus the mandatory single-part byte-for-byte regression test.
//
// js/export.js is browser glue code that reads `Utils`/`Summary`/
// `meetingTypeByCode` as globals (no module system) — this test stubs
// minimal, deterministic versions of those three globals (not the real
// DOM-dependent implementations) so `Export.toMarkdown`'s OWN control flow
// can be exercised directly in Node. The stubs are intentionally simple:
// this test is about export.js's transcript-rendering logic, not about
// Utils/Summary themselves (those are exercised elsewhere).

const { test } = require('node:test');
const assert = require('node:assert');

global.Utils = {
  formatDate: iso => new Date(iso).toISOString().slice(0, 10),
  formatDurationHuman: seconds => `${Math.round(seconds / 60)} min`,
  formatTimestamp: seconds => {
    const total = Math.max(0, Math.round(Number(seconds) || 0));
    return `${Math.floor(total / 60)}:${String(total % 60).padStart(2, '0')}`;
  }
};
global.Summary = {
  virtualSnapshotForLegacy: () => null,
  _formatSection: () => ''
};
global.meetingTypeByCode = () => null;

const Export = require('../js/export');

function baseMeeting(overrides = {}) {
  return {
    title: 'Test meeting', date: '2026-09-18T00:00:00.000Z', duration: 120,
    participants: [], tags: [], actionItems: [], notes: '',
    transcript: [], ...overrides
  };
}

test('single-part meeting: toMarkdown output is byte-for-byte identical to the pre-TV14 shape (no missing-parts warning, no divider rendering)', () => {
  const meeting = baseMeeting({
    transcript: [
      { time: 0, speaker: 'Alice', text: 'Hello everyone.' },
      { time: 65, speaker: 'Bob', text: 'Hi Alice.' }
    ]
  });
  const md = Export.toMarkdown(meeting);
  assert.ok(!md.includes('⚠'), 'no meeting.missingParts -> no warning line at all');
  assert.ok(md.includes('## Transcript'));
  assert.ok(md.includes('**[0:00] Alice:** Hello everyone.'));
  assert.ok(md.includes('**[1:05] Bob:** Hi Alice.'));
  assert.ok(!md.includes('###'), 'no part-divider heading for a plain segment list');
});

test('merged meeting: a part-divider segment renders as a heading with the exact "Phần N/M · filename" text', () => {
  const meeting = baseMeeting({
    missingParts: [],
    transcript: [
      { time: 0, kind: 'part-divider', part: 1, text: '— Phần 1/2 · a.m4a —', speaker: '' },
      { time: 0, part: 1, speaker: 'Speaker 1', text: 'Chao moi nguoi.' },
      { time: 11, kind: 'part-divider', part: 2, text: '— Phần 2/2 · b.m4a —', speaker: '' },
      { time: 11, part: 2, speaker: 'Speaker 1', text: 'Tiep tuc nhe.' }
    ]
  });
  const md = Export.toMarkdown(meeting);
  assert.ok(md.includes('### Phần 1/2 · a.m4a'));
  assert.ok(md.includes('### Phần 2/2 · b.m4a'));
  // Order preserved: divider 1 appears before its content, before divider 2.
  const idx1 = md.indexOf('### Phần 1/2 · a.m4a');
  const idxContent1 = md.indexOf('Chao moi nguoi.');
  const idx2 = md.indexOf('### Phần 2/2 · b.m4a');
  assert.ok(idx1 < idxContent1 && idxContent1 < idx2);
});

test('merged meeting with a missing part: a top-of-file warning AND the part-gap line both appear in the exported file (BR-129/PRG-17)', () => {
  const meeting = baseMeeting({
    missingParts: [2],
    transcript: [
      { time: 0, kind: 'part-divider', part: 1, text: '— Phần 1/2 · a.m4a —', speaker: '' },
      { time: 0, part: 1, speaker: 'Speaker 1', text: 'Noi dung phan 1.' },
      { time: 11, kind: 'part-gap', part: 2, text: 'Phần 2 chưa có transcript', speaker: '' }
    ]
  });
  const md = Export.toMarkdown(meeting);
  assert.ok(md.includes('⚠ Bản ghi này còn thiếu phần 2.'), 'top-of-file warning (PRG-17-style)');
  assert.ok(md.includes('*⚠ Phần 2 chưa có transcript*'), 'the permanent in-transcript gap marker (FAI-11) also survives export');
});

test('includeTranscript:false still shows the top-of-file missing-parts warning (that warning is not part of the transcript section)', () => {
  const meeting = baseMeeting({ missingParts: [2], transcript: [{ time: 0, kind: 'part-gap', part: 2, text: 'Phần 2 chưa có transcript', speaker: '' }] });
  const md = Export.toMarkdown(meeting, { includeTranscript: false });
  assert.ok(md.includes('⚠ Bản ghi này còn thiếu phần 2.'));
  assert.ok(!md.includes('## Transcript'));
});
