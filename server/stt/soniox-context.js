/* ============================================
   MeetNote AI — Soniox `context` builder (T-W6, Architecture §W5.4/§W6)
   Shared shape with js/transcriber.js:_buildContext (live path). Batch
   (server/stt/providers/soniox.js) previously sent no context at all
   (Architecture W1.11) — this brings it up to parity, plus the
   experimental `speakers` count pair (D-W2) and the >15 warning (D-W3).
   ============================================ */

// Soniox: `general` should stay <=10 key-value pairs, total context
// <=~10,000 chars (~8,000 tokens) or the API returns invalid_request
// (Architecture W5.2, §W9-S2).
const MAX_GENERAL_PAIRS = 10;
const MAX_CONTEXT_CHARS = 10_000;
const MAX_SPEAKERS_FOR_DIARIZATION = 15;

// Doc calls this experimental (§W9-S2) — never claim it improves accuracy,
// only describe what it does (E-W5).
function buildSonioxContext({ title, participants } = {}, { onWarning } = {}) {
  const general = [];

  general.push({ key: 'domain', value: 'Business meeting' });
  general.push({ key: 'topic', value: String(title || 'Meeting').slice(0, 500) });

  const names = Array.isArray(participants)
    ? participants.map(name => String(name).trim()).filter(Boolean)
    : [];

  if (names.length) {
    // D-W3: not a hard limit, just a heads-up that diarization won't
    // separate more than Soniox's supported speaker count.
    if (names.length > MAX_SPEAKERS_FOR_DIARIZATION) {
      onWarning?.(
        `Soniox diarization supports up to ${MAX_SPEAKERS_FOR_DIARIZATION} speakers; ` +
        `this meeting has ${names.length} participants.`
      );
    }
    // D-W2: official example shape is "<N> speakers" (Architecture W5.2).
    general.push({ key: 'speakers', value: `${names.length} speakers` });
    // Sanity ceiling only (protects against one pathologically long string) —
    // the real budget enforcement is enforceLimits() below, which drops this
    // whole pair first when the overall context is over budget.
    general.push({ key: 'participants', value: names.join(', ').slice(0, 20_000) });
  }

  return { general: enforceLimits(general) };
}

// Priority order when trimming to fit MAX_GENERAL_PAIRS / MAX_CONTEXT_CHARS:
// keep 'speakers' and 'topic' first (Architecture §W6 acceptance), drop the
// rest before shrinking those two.
const KEEP_FIRST_KEYS = ['speakers', 'topic'];

function pairLength(pair) {
  return JSON.stringify(pair).length;
}

function totalLength(pairs) {
  return JSON.stringify({ general: pairs }).length;
}

function enforceLimits(pairs) {
  let result = pairs.slice(0, MAX_GENERAL_PAIRS);

  if (totalLength(result) <= MAX_CONTEXT_CHARS) return result;

  const kept = KEEP_FIRST_KEYS
    .map(key => result.find(pair => pair.key === key))
    .filter(Boolean);
  const rest = result.filter(pair => !KEEP_FIRST_KEYS.includes(pair.key));

  result = [...kept, ...rest];
  while (result.length > 0 && totalLength(result) > MAX_CONTEXT_CHARS) {
    // Drop from the back first — kept keys were moved to the front above.
    result.pop();
  }
  return result;
}

module.exports = { buildSonioxContext, MAX_GENERAL_PAIRS, MAX_CONTEXT_CHARS, MAX_SPEAKERS_FOR_DIARIZATION };
