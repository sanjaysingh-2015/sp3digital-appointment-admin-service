/**
 * "Now" in the facility's local time. Slots store a wall-clock date and time
 * with no timezone, so every "is this in the past?" decision must be made in
 * the timezone the facilities operate in — not the server's.
 *
 * APPOINTMENT_TIMEZONE is an IANA name (default Asia/Kolkata).
 * `clock.now` is a property so tests can pin the time.
 */
const timezone = () => process.env.APPOINTMENT_TIMEZONE || 'Asia/Kolkata';

const clock = {
  now: () => new Date(),
};

/** { date: 'YYYY-MM-DD', time: 'HH:MM:SS', isoDow: 1..7 } in the facility timezone. */
function localNow(at = clock.now()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: timezone(),
    year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', second: '2-digit',
    hourCycle: 'h23',
  }).formatToParts(at).reduce((acc, p) => ({ ...acc, [p.type]: p.value }), {});
  const date = `${parts.year}-${parts.month}-${parts.day}`;
  return { date, time: `${parts.hour}:${parts.minute}:${parts.second}`, isoDow: isoDayOfWeek(date) };
}

/** 1 = Monday ... 7 = Sunday, from a YYYY-MM-DD string (calendar math only, no timezone involved). */
function isoDayOfWeek(date) {
  const dow = new Date(`${date}T00:00:00Z`).getUTCDay(); // 0 = Sunday
  return dow === 0 ? 7 : dow;
}

function addDays(date, days) {
  const d = new Date(`${date}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/** "09:30" / "09:30:00" -> minutes since midnight. */
const toMinutes = (time) => {
  const [h, m] = String(time).split(':').map(Number);
  return h * 60 + m;
};

/** minutes since midnight -> "HH:MM:SS". */
const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, '0')}:${String(minutes % 60).padStart(2, '0')}:00`;

/** Normalise a DB TIME ("09:00:00") or HH:MM to "HH:MM:SS" so comparisons are string-safe. */
const normTime = (time) => (time ? toTime(toMinutes(time)) : time);

/** True when the slot date/time is not strictly after the current local time. */
function isPast(slotDate, startTime, now = localNow()) {
  const d = String(slotDate).slice(0, 10);
  return d < now.date || (d === now.date && normTime(startTime) <= now.time);
}

module.exports = { clock, localNow, isoDayOfWeek, addDays, toMinutes, toTime, normTime, isPast, timezone };
