// Pure time-zone maths, shared by the browser and the tests.
// Written as a plain script that attaches to globalThis (no import/export) so it
// loads via a classic <script> tag on file:// and can still be imported by Node.
(function (root) {
  'use strict';

  const WEEKDAYS = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 0 };

  function isValidZone(timeZone) {
    try { new Intl.DateTimeFormat('en-US', { timeZone }); return true; } catch { return false; }
  }

  // Wall-clock parts of a UTC instant in a given zone.
  function localParts(timeZone, utcMs) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone, hourCycle: 'h23', weekday: 'short',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(new Date(utcMs));
    const get = (t) => parts.find((p) => p.type === t).value;
    return {
      year: Number(get('year')), month: Number(get('month')), day: Number(get('day')),
      hour: Number(get('hour')), minute: Number(get('minute')), weekday: WEEKDAYS[get('weekday')],
    };
  }

  // Minutes the zone is ahead of UTC at that instant (negative = behind).
  function offsetMinutes(timeZone, utcMs) {
    const p = localParts(timeZone, utcMs);
    const asUtc = Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
    return Math.round((asUtc - Math.floor(utcMs / 60000) * 60000) / 60000);
  }

  // UTC instant of a wall-clock time in a zone. Two passes so DST edges land right.
  function zonedToUtc(timeZone, year, month, day, hour = 0, minute = 0) {
    const guess = Date.UTC(year, month - 1, day, hour, minute);
    let utc = guess - offsetMinutes(timeZone, guess) * 60000;
    utc = guess - offsetMinutes(timeZone, utc) * 60000;
    return utc;
  }

  function parseTime(value, label) {
    const m = /^(\d{1,2}):(\d{2})$/.exec(String(value || '').trim());
    if (!m || Number(m[1]) > 24 || Number(m[2]) > 59 || (Number(m[1]) === 24 && Number(m[2]) !== 0)) {
      throw new RangeError(`${label} must be a time like 09:00`);
    }
    return Number(m[1]) * 60 + Number(m[2]);
  }

  function parseDate(value) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(value || '').trim());
    if (!m) throw new RangeError('Date must look like 2026-11-02');
    return { year: Number(m[1]), month: Number(m[2]), day: Number(m[3]) };
  }

  // Is a local minute-of-day inside working hours? Handles shifts that cross midnight (22:00–06:00).
  function inHours(minute, start, end) {
    if (start === end) return false;
    return start < end ? minute >= start && minute < end : minute >= start || minute < end;
  }

  // Builds a day of slots in the base zone and marks who is working in each.
  //   people: [{ name, timeZone, start: '09:00', end: '17:00' }]
  function planDay({ date, baseZone, people, stepMinutes = 30, skipWeekends = true }) {
    if (!isValidZone(baseZone)) throw new RangeError(`Unknown time zone: ${baseZone}`);
    if (!Array.isArray(people) || people.length === 0) throw new RangeError('Add at least one person');
    const d = parseDate(date);
    const list = people.map((p, i) => {
      const label = p.name && String(p.name).trim() ? String(p.name).trim() : `Person ${i + 1}`;
      if (!isValidZone(p.timeZone)) throw new RangeError(`${label}: unknown time zone`);
      return { name: label, timeZone: p.timeZone, start: parseTime(p.start, `${label} start`), end: parseTime(p.end, `${label} end`) };
    });

    const dayStart = zonedToUtc(baseZone, d.year, d.month, d.day);
    const next = new Date(Date.UTC(d.year, d.month - 1, d.day + 1));
    const dayEnd = zonedToUtc(baseZone, next.getUTCFullYear(), next.getUTCMonth() + 1, next.getUTCDate());

    const slots = [];
    for (let t = dayStart; t < dayEnd; t += stepMinutes * 60000) {
      const base = localParts(baseZone, t);
      const cells = list.map((p) => {
        const lp = localParts(p.timeZone, t);
        const weekend = lp.weekday === 0 || lp.weekday === 6;
        const working = inHours(lp.hour * 60 + lp.minute, p.start, p.end) && !(skipWeekends && weekend);
        return { hour: lp.hour, minute: lp.minute, weekend, working };
      });
      slots.push({ utc: t, hour: base.hour, minute: base.minute, cells, everyone: cells.every((c) => c.working) });
    }

    // Merge consecutive all-available slots into windows.
    const windows = [];
    slots.forEach((s, i) => {
      if (!s.everyone) return;
      const last = windows[windows.length - 1];
      if (last && last.endIndex === i - 1) { last.endIndex = i; last.end = s.utc + stepMinutes * 60000; }
      else windows.push({ startIndex: i, endIndex: i, start: s.utc, end: s.utc + stepMinutes * 60000 });
    });

    return {
      people: list,
      slots,
      windows: windows.map((w) => ({ start: w.start, end: w.end, minutes: Math.round((w.end - w.start) / 60000) })),
    };
  }

  function formatTime(timeZone, utcMs) {
    const p = localParts(timeZone, utcMs);
    return `${String(p.hour).padStart(2, '0')}:${String(p.minute).padStart(2, '0')}`;
  }

  root.TimeZones = { planDay, offsetMinutes, zonedToUtc, formatTime, localParts, isValidZone };
})(typeof globalThis !== 'undefined' ? globalThis : this);
