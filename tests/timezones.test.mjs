import test from 'node:test';
import assert from 'node:assert/strict';

// timezones.js is a classic script that registers itself on globalThis.
await import('../timezones.js');
const { planDay, offsetMinutes, zonedToUtc, formatTime } = globalThis.TimeZones;

const at = (zone, ms) => formatTime(zone, ms);

test('offsets, including half-hour zones and daylight saving', () => {
  assert.equal(offsetMinutes('Asia/Karachi', Date.UTC(2026, 6, 1)), 300);
  assert.equal(offsetMinutes('Asia/Kolkata', Date.UTC(2026, 6, 1)), 330);
  assert.equal(offsetMinutes('America/New_York', Date.UTC(2026, 6, 1)), -240);
  assert.equal(offsetMinutes('America/New_York', Date.UTC(2026, 11, 1)), -300);
  assert.equal(offsetMinutes('Europe/London', Date.UTC(2026, 0, 15)), 0);
});

test('converts a local wall-clock time to UTC', () => {
  assert.equal(zonedToUtc('Asia/Karachi', 2026, 11, 2, 9, 0), Date.UTC(2026, 10, 2, 4, 0));
  assert.equal(zonedToUtc('America/New_York', 2026, 11, 2, 9, 0), Date.UTC(2026, 10, 2, 14, 0));
});

test('Karachi and London, 9 to 5 each: overlap is 14:00–17:00 Karachi time (London is on GMT in November)', () => {
  const r = planDay({
    date: '2026-11-02', baseZone: 'Asia/Karachi',
    people: [
      { name: 'Me', timeZone: 'Asia/Karachi', start: '09:00', end: '17:00' },
      { name: 'Client', timeZone: 'Europe/London', start: '09:00', end: '17:00' },
    ],
  });
  assert.equal(r.slots.length, 48);
  assert.equal(r.windows.length, 1);
  assert.equal(at('Asia/Karachi', r.windows[0].start), '14:00');
  assert.equal(at('Asia/Karachi', r.windows[0].end), '17:00');
  assert.equal(at('Europe/London', r.windows[0].start), '09:00');
  assert.equal(r.windows[0].minutes, 180);
});

test('no overlap when working days never meet', () => {
  const r = planDay({
    date: '2026-11-02', baseZone: 'Asia/Karachi',
    people: [
      { name: 'Me', timeZone: 'Asia/Karachi', start: '09:00', end: '17:00' },
      { name: 'Client', timeZone: 'America/Los_Angeles', start: '09:00', end: '17:00' },
    ],
  });
  assert.equal(r.windows.length, 0);
});

test('late shift that crosses midnight', () => {
  const r = planDay({
    date: '2026-11-02', baseZone: 'Asia/Karachi',
    people: [
      { name: 'Me', timeZone: 'Asia/Karachi', start: '18:00', end: '03:00' },
      { name: 'Client', timeZone: 'America/New_York', start: '09:00', end: '17:00' },
    ],
  });
  // New York 09:00 EST = 19:00 Karachi; Karachi shift ends 03:00 = 17:00 New York.
  // 00:00–03:00 Karachi on Monday is still Sunday in New York, so only the evening counts.
  const starts = r.windows.map((w) => at('Asia/Karachi', w.start));
  assert.deepEqual(starts, ['19:00']);
  assert.equal(at('Asia/Karachi', r.windows[0].end), '00:00');
});

test('weekends count as off unless turned on', () => {
  const people = [{ name: 'Me', timeZone: 'Europe/London', start: '09:00', end: '17:00' }];
  assert.equal(planDay({ date: '2026-10-31', baseZone: 'Europe/London', people }).windows.length, 0);
  assert.equal(planDay({ date: '2026-10-31', baseZone: 'Europe/London', people, skipWeekends: false }).windows.length, 1);
});

test('a daylight-saving day is 25 hours long', () => {
  const r = planDay({ date: '2026-10-25', baseZone: 'Europe/London', people: [{ timeZone: 'Europe/London', start: '09:00', end: '17:00' }], skipWeekends: false });
  assert.equal(r.slots.length, 50);
});

test('rejects bad input', () => {
  const ok = { name: 'A', timeZone: 'Europe/London', start: '09:00', end: '17:00' };
  assert.throws(() => planDay({ date: '2026-11-02', baseZone: 'Mars/Base', people: [ok] }), /Unknown time zone/);
  assert.throws(() => planDay({ date: '2026-11-02', baseZone: 'Europe/London', people: [] }), /at least one/);
  assert.throws(() => planDay({ date: 'tomorrow', baseZone: 'Europe/London', people: [ok] }), /Date/);
  assert.throws(() => planDay({ date: '2026-11-02', baseZone: 'Europe/London', people: [{ ...ok, start: '9am' }] }), /time like/);
  assert.throws(() => planDay({ date: '2026-11-02', baseZone: 'Europe/London', people: [{ ...ok, timeZone: 'Nowhere' }] }), /unknown time zone/);
});
