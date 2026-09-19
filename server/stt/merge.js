/* ============================================
   MeetNote AI — merge N transcribed parts into one timeline
   Pure functions (Architecture v3.0 §V4.3): no I/O, no server
   state. `computeTimeline` assigns spanSeconds/offsetSeconds
   (BR-125); `buildMergedTranscript` turns ordered, timelined
   parts into the flat transcript every other pipeline step
   (prompts, export, search) already knows how to read.
   ============================================ */

const DEFAULT_GAP_SECONDS = 1;

function byOrder(a, b) {
  return (Number(a.order) || 0) - (Number(b.order) || 0);
}

function lastSegmentTime(part) {
  const transcript = Array.isArray(part?.transcript) ? part.transcript : [];
  if (transcript.length === 0) return 0;
  return Number(transcript[transcript.length - 1].time) || 0;
}

// BR-125: for a completed part, the audio may report a shorter `duration`
// than its own last transcript segment (e.g. Whisper gpt-4o-* always reports
// 0) — taking the max is what keeps offsets strictly increasing with no
// overlap. Non-completed parts have no real duration yet; `clientDurationSeconds`
// only reserves a plausible-looking gap on the timeline, never counted into
// `duration`/cost.
function spanSecondsFor(part) {
  if (part?.status === 'completed') {
    return Math.max(Number(part.duration) || 0, lastSegmentTime(part));
  }
  return Math.max(0, Number(part?.clientDurationSeconds) || 0);
}

// Returns `parts` in THEIR ORIGINAL ARRAY ORDER (callers persist this back
// into meeting.parts[] and must not have it silently reordered), each with
// spanSeconds/offsetSeconds computed by walking the parts in `order` sequence.
function computeTimeline(parts, { gapSeconds = DEFAULT_GAP_SECONDS } = {}) {
  const ordered = [...parts].sort(byOrder);
  let offset = 0;
  const timelineByPartId = new Map();
  for (const part of ordered) {
    const spanSeconds = spanSecondsFor(part);
    timelineByPartId.set(part.partId, { spanSeconds, offsetSeconds: offset });
    offset += spanSeconds + gapSeconds;
  }
  return parts.map(part => ({ ...part, ...timelineByPartId.get(part.partId) }));
}

// mm:ss (or h:mm:ss past the first hour) — elapsed time WITHIN the merged
// transcript timeline. This is the only clock buildMergedTranscript can use:
// it receives no meeting.date/wall-clock context (BR-136 gap message keeps
// its exact wall-clock wording as a later client-side concern — see
// docs/CHANGELOG.md decision log for TV3).
function formatClock(totalSeconds) {
  const total = Math.max(0, Math.round(Number(totalSeconds) || 0));
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = total % 60;
  const ss = String(seconds).padStart(2, '0');
  if (hours > 0) return `${hours}:${String(minutes).padStart(2, '0')}:${ss}`;
  return `${minutes}:${ss}`;
}

function dividerSegment(part, total) {
  return {
    time: part.offsetSeconds,
    kind: 'part-divider',
    part: part.order,
    partId: part.partId,
    speaker: '',
    text: `— Phần ${part.order}/${total} · ${part.filename || ''} —`
  };
}

function gapSegment(part) {
  const base = { time: part.offsetSeconds, kind: 'part-gap', part: part.order, partId: part.partId, speaker: '' };
  if (part.status === 'queued' || part.status === 'processing') {
    return { ...base, text: `Phần ${part.order} đang được tạo transcript…` };
  }
  if (part.status === 'dropped') {
    const start = formatClock(part.offsetSeconds);
    const end = formatClock(part.offsetSeconds + part.spanSeconds);
    return { ...base, text: `Thiếu đoạn ${start} → ${end} (đã bỏ phần ${part.order}).` };
  }
  // 'failed' — includes a part whose provider returned an empty transcript
  // (normalizeResult already turned that into STT_TRANSCRIBE_FAILED upstream,
  // so it never reaches here as anything but a failed part).
  return { ...base, text: `Phần ${part.order} chưa có transcript` };
}

/**
 * @param {Array} parts parts that already went through computeTimeline
 * @returns {{transcript:Array, translations:Array, duration:number, durationEstimated:boolean, missingParts:Array<number>, partCount:number}}
 */
function buildMergedTranscript(parts) {
  const ordered = [...parts].sort(byOrder);
  const total = ordered.length;

  const transcript = [];
  const translations = [];
  const missingParts = [];
  let duration = 0;
  let durationEstimated = false;

  for (const part of ordered) {
    transcript.push(dividerSegment(part, total));

    if (part.status === 'completed') {
      duration += part.spanSeconds;
      if (part.durationKind !== 'audio-length') durationEstimated = true;

      (Array.isArray(part.transcript) ? part.transcript : []).forEach((segment, srcIndex) => {
        transcript.push({
          ...segment,
          time: part.offsetSeconds + (Number(segment.time) || 0),
          part: part.order,
          partId: part.partId,
          srcIndex
        });
      });
      (Array.isArray(part.translations) ? part.translations : []).forEach(segment => {
        translations.push({ ...segment, time: part.offsetSeconds + (Number(segment.time) || 0), part: part.order, partId: part.partId });
      });
    } else {
      transcript.push(gapSegment(part));
      if (part.status === 'failed' || part.status === 'dropped') missingParts.push(part.order);
    }
  }

  return { transcript, translations, duration, durationEstimated, missingParts, partCount: total };
}

module.exports = { computeTimeline, buildMergedTranscript, spanSecondsFor, lastSegmentTime, formatClock };
