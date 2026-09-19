/* ============================================
   MeetNote AI — server-side re-export of MEETING_TYPES (BR-25)
   The table itself lives in js/meeting-types.js so the browser and
   Node share exactly one source of truth (Architecture §3.2 WHY-3).
   This file exists only so server modules can `require('../meeting-types')`
   without reaching across into `js/`.
   ============================================ */

module.exports = require('../js/meeting-types.js');
