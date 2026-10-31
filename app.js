// UI wiring: reads the form, calls TimeZones.planDay, renders the overlap list
// and the timeline, and remembers inputs in localStorage.
(function () {
  'use strict';

  const STORAGE_KEY = 'meeting-time-zone-planner:v1';
  const localZone = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const ZONES = (typeof Intl.supportedValuesOf === 'function' ? Intl.supportedValuesOf('timeZone') : [
    'UTC', 'Europe/London', 'Europe/Berlin', 'Europe/Paris', 'Asia/Dubai', 'Asia/Karachi', 'Asia/Kolkata',
    'Asia/Singapore', 'Asia/Tokyo', 'Australia/Sydney', 'America/New_York', 'America/Chicago',
    'America/Denver', 'America/Los_Angeles', 'America/Toronto',
  ]).slice();
  if (!ZONES.includes(localZone)) ZONES.unshift(localZone);
  if (!ZONES.includes('UTC')) ZONES.unshift('UTC');

  const $ = (id) => document.getElementById(id);
  let lastSummary = '';

  function today() {
    const p = TimeZones.localParts(localZone, Date.now());
    return `${p.year}-${String(p.month).padStart(2, '0')}-${String(p.day).padStart(2, '0')}`;
  }

  function defaults() {
    return {
      date: today(), baseZone: localZone, skipWeekends: true,
      people: [
        { name: 'Me', timeZone: localZone, start: '09:00', end: '17:00' },
        { name: 'Client', timeZone: localZone === 'America/New_York' ? 'Europe/London' : 'America/New_York', start: '09:00', end: '17:00' },
      ],
    };
  }

  function load() {
    try {
      const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null');
      return saved && Array.isArray(saved.people) && saved.people.length ? { ...defaults(), ...saved, date: today() } : defaults();
    } catch { return defaults(); }
  }

  function save(state) {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify(state)); } catch { /* storage unavailable */ }
  }

  // Offsets change with daylight saving, so labels follow the chosen date (noon UTC).
  function labelInstant() {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec($('date').value);
    return m ? Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]), 12) : Date.now();
  }

  function zoneLabel(zone, at) {
    return `${zone.replace(/_/g, ' ')} (${offsetLabel(zone, at)})`;
  }

  function relabelZones() {
    const at = labelInstant();
    const cache = new Map();
    document.querySelectorAll('.zone-select').forEach((select) => {
      [...select.options].forEach((o) => {
        if (!cache.has(o.value)) cache.set(o.value, zoneLabel(o.value, at));
        o.textContent = cache.get(o.value);
      });
    });
  }

  function offsetLabel(zone, at) {
    const mins = TimeZones.offsetMinutes(zone, at);
    const sign = mins < 0 ? '−' : '+';
    const a = Math.abs(mins);
    return `UTC${sign}${Math.floor(a / 60)}${a % 60 ? ':' + String(a % 60).padStart(2, '0') : ''}`;
  }

  function fillZones(select, value) {
    if (!select.options.length) {
      const frag = document.createDocumentFragment();
      const at = labelInstant();
      ZONES.forEach((z) => frag.append(new Option(zoneLabel(z, at), z)));
      select.append(frag);
    }
    select.value = ZONES.includes(value) ? value : localZone;
  }

  function addPersonRow(p) {
    const row = $('person-row').content.firstElementChild.cloneNode(true);
    row.querySelector('.p-name').value = p.name || '';
    fillZones(row.querySelector('.p-zone'), p.timeZone);
    row.querySelector('.p-start').value = p.start || '09:00';
    row.querySelector('.p-end').value = p.end || '17:00';
    row.querySelector('.p-remove').addEventListener('click', () => {
      if ($('people').children.length > 1) { row.remove(); render(); }
    });
    $('people').append(row);
  }

  function readForm() {
    return {
      date: $('date').value,
      baseZone: $('baseZone').value,
      skipWeekends: $('skipWeekends').checked,
      people: [...$('people').children].map((row) => ({
        name: row.querySelector('.p-name').value,
        timeZone: row.querySelector('.p-zone').value,
        start: row.querySelector('.p-start').value,
        end: row.querySelector('.p-end').value,
      })),
    };
  }

  function writeForm(state) {
    $('date').value = state.date;
    fillZones($('baseZone'), state.baseZone);
    $('skipWeekends').checked = state.skipWeekends !== false;
    $('people').replaceChildren();
    state.people.forEach(addPersonRow);
    relabelZones();
  }

  const pad = (n) => String(n).padStart(2, '0');
  const duration = (m) => (m >= 60 ? `${Math.floor(m / 60)} h${m % 60 ? ` ${m % 60} min` : ''}` : `${m} min`);

  function renderTimeline(plan, baseZone) {
    const table = $('timeline');
    const head = document.createElement('tr');
    head.append(document.createElement('th'));
    plan.slots.forEach((s) => {
      const th = document.createElement('th');
      th.scope = 'col';
      th.textContent = s.minute === 0 ? pad(s.hour) : '';
      if (s.everyone) th.className = 'both';
      head.append(th);
    });
    const rows = plan.people.map((p, i) => {
      const tr = document.createElement('tr');
      const th = document.createElement('th');
      th.scope = 'row';
      th.textContent = p.name;
      tr.append(th);
      plan.slots.forEach((s) => {
        const c = s.cells[i];
        const td = document.createElement('td');
        td.className = s.everyone ? 'both' : c.working ? 'work' : 'off';
        td.title = `${p.name}: ${pad(c.hour)}:${pad(c.minute)}${c.weekend ? ' (weekend)' : ''}`;
        tr.append(td);
      });
      return tr;
    });
    table.replaceChildren(head, ...rows);
    $('base-label').textContent = baseZone.replace(/_/g, ' ');
  }

  function render() {
    const state = readForm();
    save(state);
    try {
      const plan = TimeZones.planDay(state);
      $('error').hidden = true;
      $('output').hidden = false;

      const items = plan.windows.map((w) => {
        const li = document.createElement('li');
        const strong = document.createElement('strong');
        strong.textContent = `${TimeZones.formatTime(state.baseZone, w.start)}–${TimeZones.formatTime(state.baseZone, w.end)}`;
        const len = document.createElement('span');
        len.className = 'muted';
        len.textContent = ` ${duration(w.minutes)}`;
        const each = document.createElement('ul');
        plan.people.forEach((p) => {
          const sub = document.createElement('li');
          sub.textContent = `${p.name}: ${TimeZones.formatTime(p.timeZone, w.start)}–${TimeZones.formatTime(p.timeZone, w.end)}`;
          each.append(sub);
        });
        li.append(strong, len, each);
        return li;
      });
      $('windows').replaceChildren(...items);
      $('none').hidden = plan.windows.length > 0;
      renderTimeline(plan, state.baseZone);

      lastSummary = plan.windows.length
        ? [`Times that work for everyone on ${state.date}:`, ...plan.windows.map((w) =>
            plan.people.map((p) => `${p.name} ${TimeZones.formatTime(p.timeZone, w.start)}–${TimeZones.formatTime(p.timeZone, w.end)}`).join(' / '))].join('\n')
        : `No time on ${state.date} falls inside everyone's working hours.`;
    } catch (err) {
      $('error').textContent = err.message;
      $('error').hidden = false;
      $('output').hidden = true;
    }
  }

  async function copySummary() {
    try {
      await navigator.clipboard.writeText(lastSummary);
      $('copy-status').textContent = 'Copied.';
    } catch {
      $('copy-status').textContent = 'Could not copy. Select the times and copy them manually.';
    }
  }

  writeForm(load());
  $('plan-form').addEventListener('input', render);
  $('plan-form').addEventListener('change', render);
  $('date').addEventListener('change', relabelZones);
  $('plan-form').addEventListener('submit', (e) => e.preventDefault());
  $('add-person').addEventListener('click', () => { addPersonRow({ name: '', timeZone: localZone }); render(); });
  $('reset').addEventListener('click', () => { writeForm(defaults()); render(); });
  $('copy').addEventListener('click', copySummary);
  render();
})();
