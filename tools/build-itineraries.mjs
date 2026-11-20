#!/usr/bin/env node
// Builds itinerary pages from JSON (design mirrors the WSG itinerary PDFs).
//
//   data/itineraries/<event>/_event.json     shared settings for the event (name, theme, logo, venue…)
//   data/itineraries/<event>/<school>.json   one file per school
//   -> public/<event>/<school>/index.html   (live at /<event>/<school>)
//
// Usage:  node tools/build-itineraries.mjs            build everything
//         node tools/build-itineraries.mjs <event>    build one event folder
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data', 'itineraries');
const outDir = join(root, 'public');
const only = process.argv[2];

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// Country name -> flag file in /assets/img/flags (add more as needed)
const FLAGS = { Romania: 'ro', Belgium: 'be', Switzerland: 'ch', Kazakhstan: 'kz', Germany: 'de',
  Turkey: 'tr', 'Türkiye': 'tr', Singapore: 'sg', UAE: 'ae', 'United Arab Emirates': 'ae', 'United Kingdom': 'gb', UK: 'gb' };
const flag = (country, cls = '') => FLAGS[country]
  ? `<img${cls ? ` class="${cls}"` : ''} src="/assets/img/flags/${FLAGS[country]}.svg" alt="" width="20" height="15">` : '';

// City -> airport code for the travel cards (a code written after the city, e.g. "Istanbul SAW", wins)
const AIRPORTS = { Bucharest: 'OTP', Istanbul: 'IST', Antalya: 'AYT', Brussels: 'BRU', Dubai: 'DXB',
  Astana: 'NQZ', Singapore: 'SIN', Frankfurt: 'FRA', Geneva: 'GVA', Zurich: 'ZRH', London: 'LHR' };
const MONTHS = { Jan: 'January', Feb: 'February', Mar: 'March', Apr: 'April', May: 'May', Jun: 'June', Jul: 'July',
  Aug: 'August', Sep: 'September', Oct: 'October', Nov: 'November', Dec: 'December' };
const longDate = d => d.replace(/\b(\w{3})$/, m => MONTHS[m] || m);
const shortDay = day => `${day.date.slice(0, 3)} ${day.short.split(' ')[0]}`;
const mins = t => { const [h, m] = t.split(':').map(Number); return h * 60 + m; };
const isCond = s => /^(if |depends)/i.test(s || '');
const isFlight = it => /^(fly |flight )/i.test(it.title || '');

const PLANE = '<svg viewBox="0 0 24 24"><path d="M21 15.2v-1.9L13 8V3.4c0-.8-.7-1.4-1.5-1.4S10 2.6 10 3.4V8l-8 5.3v1.9l8-2.4V18l-2.5 1.7v1.7l3.5-1 3.5 1v-1.7L12 18v-5.2l9 2.4z" fill="currentColor" transform="rotate(90 12 12)"/></svg>';
const ALERT = '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><circle cx="12" cy="12" r="10"/><path d="M12 7v6M12 16.5v.5"/></svg>';

// ---- Travel cards, derived from the first/last day's flights unless d.travel is given ----
function place(label, prev) {
  const m = label.match(/^(.*?)\s+([A-Z]{3})$/);
  if (m) return { code: m[2], city: label, base: m[1] };
  const code = prev && prev.base === label ? prev.code : (AIRPORTS[label] || label.slice(0, 3).toUpperCase());
  return { code, city: label, base: label };
}
function buildDirection(day) {
  if (!day) return null;
  const flights = day.items.filter(isFlight);
  if (!flights.length) return null;
  const allLegs = flights.every(f => /^fly /i.test(f.title) && /→/.test(f.title));
  const dir = { date: longDate(day.date), legs: [], rows: [], notes: [] };
  if (!allLegs) { dir.rows = flights; return dir; }
  let prevTo = null;
  for (const f of flights) {
    const [a, b] = f.title.replace(/^fly /i, '').split('→').map(s => s.trim());
    const from = place(a, prevTo), to = place(b);
    const det = f.detail || '';
    const no = (det.match(/Flight\s+([A-Z0-9]+)/) || [])[1] || '';
    const land = det.match(/lands\s+(\d{2}:\d{2})(?:,\s*([^·]+))?/);
    const extra = det.split('·').map(s => s.trim()).filter(s => s && !/^Flight |^lands /.test(s));
    dir.legs.push({ from, to, dep: f.time, arr: land ? land[1] : '', arrNote: land && land[2] ? land[2].trim() : '', no });
    extra.forEach(x => dir.notes.push(x.charAt(0).toUpperCase() + x.slice(1)));
    prevTo = to;
  }
  return dir;
}
function travelCard(kind, dir) {
  if (!dir) return '';
  let body = '';
  if (dir.legs.length) {
    dir.legs.forEach((l, i) => {
      if (i > 0) {
        const p = dir.legs[i - 1];
        if (p.arr && l.dep !== 'TBC') {
          let gap = mins(l.dep) - mins(p.arr); if (gap < 0) gap += 1440;
          body += `<div class="conn">${Math.floor(gap / 60)} h ${String(gap % 60).padStart(2, '0')} min connection in ${esc(p.to.base)}</div>`;
        }
      }
      const arr = [l.to.city, l.arr].filter(Boolean).join(' · ') + (l.arrNote ? ` (${l.arrNote})` : '');
      body += `<div class="leg"><div><div class="code">${esc(l.from.code)}</div><div class="city">${esc(l.from.city)} · ${esc(l.dep)}</div></div><div class="mid">${PLANE}${esc(l.no)}</div><div class="to"><div class="code">${esc(l.to.code)}</div><div class="city">${esc(arr)}</div></div></div>`;
    });
    dir.notes.forEach(n => body += `<div class="tnote">${esc(n)}</div>`);
  } else {
    body = dir.rows.map(r => `<div class="trow"><div class="tt">${esc(r.time)}</div><div><div class="ti">${esc(r.title)}</div>${r.detail ? `<div class="td">${esc(r.detail)}</div>` : ''}</div></div>`).join('');
  }
  return `<div class="tcard"><div class="tcard-head"><span class="tag-pill">${kind}</span><span class="d">${esc(dir.date)}</span></div><div class="tcard-body">${body}</div></div>`;
}

function render(ev, d, slug, eventSlug) {
  const eventName = d.event || ev.event;
  const days = d.days || [];
  const id = i => `day-${i + 1}`;
  const country = typeof d.info?.Country === 'object' ? d.info.Country.v : d.info?.Country;
  const val = v => (typeof v === 'object' ? v : { v });

  // Header facts (Trip, Staying at, Squad, Lead contact)
  const info = d.info || {};
  const facts = [['Trip', { v: val(info.Dates || '').v2 || '' }], ['Staying at', info['Staying at']], ['Squad', info.Squad], ['Lead contact', info['Lead contact']]]
    .filter(([, v]) => v).map(([k, v]) => { v = val(v); return `<div><div class="k">${esc(k)}</div><div class="v">${esc(v.v)}</div>${v.v2 ? `<div class="v2">${esc(v.v2)}</div>` : ''}</div>`; }).join('');

  // Travel
  const travel = d.travel || { out: buildDirection(days[0]), back: buildDirection(days[days.length - 1]) };
  const travelHtml = (travel.out || travel.back)
    ? `<section class="sec" id="travel"><div class="sec-head"><h2>Getting there &amp; back</h2></div><div class="travel">${travelCard('Outbound', travel.out)}${travelCard('Return', travel.back)}</div></section>` : '';

  // Fixtures
  const fx = d.fixtures || [];
  const sq = d.showSquadColumn ?? new Set(fx.map(f => f.squad)).size > 1;
  const fxTitle = !sq && fx[0]?.squad ? `${fx[0].squad} fixtures` : 'Fixtures';
  const court = (c, cond) => !c ? '' : (c === 'TBC' ? '<span class="court plain">TBC</span>' : `<span class="court">${esc(c)}</span>`);
  const fixtures = fx.length ? `<section class="sec" id="fixtures"><div class="sec-head"><h2>${esc(fxTitle)}</h2><span class="aside">${esc(ev.fixturesNote || '')}</span></div>
<div class="fx"><table><thead><tr><th>When</th>${sq ? '<th>Squad</th>' : ''}<th>Opponent</th><th>Country</th><th>Stage</th><th>Court</th></tr></thead><tbody>${
    fx.map(f => { const c = isCond(f.stage); return `<tr${c ? ' class="cond"' : ''}><td>${esc(f.when)}</td>${sq ? `<td>${esc(f.squad)}</td>` : ''}<td class="opp"><div class="opp-in">${c ? '' : flag(f.country)}<span>${esc(f.opponent)}</span></div></td><td class="muted">${esc(f.country)}</td><td class="stage">${esc(f.stage)}</td><td>${court(f.court)}</td></tr>`; }).join('')
  }</tbody></table></div>
<div class="fx-cards">${fx.map(f => { const c = isCond(f.stage); return `<div class="fc${c ? ' cond' : ''}"><div class="w">${esc(f.when)}${sq ? ` · ${esc(f.squad)}` : ''}</div><div class="o">${c ? '' : flag(f.country)}${esc(f.opponent)}</div><div class="m">${esc([c ? '' : f.country, f.stage].filter(Boolean).join(' · '))}</div>${court(f.court)}</div>`; }).join('')}</div></section>` : '';

  // Day by day
  const dayHtml = days.map((day, i) => {
    const m = (day.badge || '').split('·').map(s => s.trim());
    const items = (day.items || []).map(it => {
      const cond = /IF |DEPENDS/.test(it.tag || '');
      const match = !cond && / vs /.test(it.title);
      const cls = cond ? 'it cond' : match ? 'it match' : 'it';
      const tbc = it.tbc ? '<span class="tbc">TBC</span>' : '';
      return `<div class="${cls}"><div class="tm">${esc(it.time)}</div><div>${it.tag ? `<div class="tg">${esc(it.tag)}</div>` : ''}<div class="ti">${esc(it.title)}${tbc}</div>${it.detail ? `<div class="ds">${esc(it.detail)}</div>` : ''}</div>${it.court ? `<span class="cp">${esc(it.court)}</span>` : ''}</div>`;
    }).join('');
    return `<section class="day" id="${id(i)}"><div class="dmeta"><div class="dl">Day ${i + 1} · ${esc(day.date.split(' ')[0])}</div><div class="dd">${esc(day.short)}</div><span class="tag-pill">${esc(m[0] || day.label)}</span>${m[1] ? `<div class="dm">${esc(m[1])}</div>` : ''}</div><div class="items">${items}</div></section>`;
  }).join('');

  // Good to know
  const gtk = (d.goodToKnow || []).map(g => {
    const text = esc(g.text).replace(/(\+\d[\d ]{7,})/g, (n) => `<a href="tel:${n.replace(/\s/g, '')}">${n}</a>`);
    return `<div><h3>${esc(g.title)}</h3><p>${text}</p></div>`;
  }).join('');

  const nav = [fixtures && travelHtml ? '<a href="#travel">Travel</a>' : travelHtml ? '<a href="#travel">Travel</a>' : '', fixtures ? '<a href="#fixtures">Fixtures</a>' : '']
    .filter(Boolean).join('') + (days.length ? '<span class="sep"></span>' + days.map((day, i) => `<a href="#${id(i)}">${esc(shortDay(day))}</a>`).join('') : '');

  const eventLogo = d.eventLogo || ev.eventLogo;
  const title = `Itinerary: ${eventName} x ${d.school}`;
  const desc = [d.location || ev.location, d.dates].filter(Boolean).join(' · ');
  const theme = d.theme || ev.theme || 'wsg';
  const pdf = d.pdf && !d.pdf.includes('/') ? `/${eventSlug}/${slug}/${d.pdf}` : d.pdf;
  const updated = val(info.Updated || '').v;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(desc)}">
<link rel="icon" href="${esc(eventLogo || '/assets/img/favicon.png')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&display=swap">
<link rel="stylesheet" href="/assets/css/itinerary.css">
<link rel="stylesheet" href="/assets/css/themes/${esc(theme)}.css">
</head>
<body>
<header class="hero">
  <div class="wrap">
    <div class="hero-top">
      <div class="brand">${eventLogo ? `<img src="${esc(eventLogo)}" alt="${esc(ev.eventLogoAlt || eventName)}">` : ''}<div><div class="b1">${esc(ev.brandLine1 || eventName)}</div><div class="b2">${esc(ev.brandLine2 || '')}</div></div></div>
      <div class="hero-actions">${updated ? `<span class="chip">Updated ${esc(updated)}</span>` : ''}<button class="chip act" data-share>Share</button>${pdf ? `<a class="chip solid act" href="${esc(pdf)}" target="_blank" rel="noopener">Print PDF</a>` : '<button class="chip solid act" data-print>Print PDF</button>'}</div>
    </div>
    <div class="hero-main">
      <div>
        <div class="eyebrow">Team itinerary · ${esc(country || '')}${flag(country)}</div>
        <h1>${esc(d.school)}</h1>
        <div class="dates">${esc(desc)}</div>
      </div>
      ${d.schoolLogo ? `<img class="school-logo" src="${esc(d.schoolLogo)}" alt="${esc(d.school)} logo">` : ''}
    </div>
    <div class="facts">${facts}</div>
  </div>
</header>
<nav class="sections"><div class="wrap">${nav}</div></nav>
<main class="wrap">
${d.notice ? `<div class="notice">${ALERT}<span>${esc(d.notice)}</span></div>` : ''}
${travelHtml}
${fixtures}
<section class="sec"><div class="sec-head"><h2>Day by day</h2><div class="legend"><span><i class="lm"></i>Match</span><span><i class="ls"></i>Schedule</span><span><i class="ld"></i>Depends on results</span></div></div>${dayHtml}</section>
${gtk ? `<section class="sec"><div class="sec-head"><h2>Good to know</h2></div><div class="gtk">${gtk}</div></section>` : ''}
</main>
<footer class="foot"><div class="wrap"><span>${esc(ev.footer || eventName)}</span><span>Itinerary for ${esc(d.school)}${updated ? ` · updated ${esc(updated)}` : ''}</span></div></footer>
<script src="/assets/js/share.js" defer></script>
<script>
const links=[...document.querySelectorAll('nav.sections a')];
const io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){links.forEach(l=>l.classList.toggle('on',l.getAttribute('href')==='#'+en.target.id));}}),{rootMargin:'-30% 0px -65% 0px'});
document.querySelectorAll('#travel,#fixtures,section.day').forEach(s=>io.observe(s));
</script>
</body>
</html>
`;
}

let count = 0;
for (const event of await readdir(dataDir, { withFileTypes: true })) {
  if (!event.isDirectory() || (only && event.name !== only)) continue;
  const evFile = join(dataDir, event.name, '_event.json');
  const ev = existsSync(evFile) ? JSON.parse(await readFile(evFile, 'utf8')) : {};
  for (const file of await readdir(join(dataDir, event.name))) {
    if (!file.endsWith('.json') || file.startsWith('_')) continue;
    const slug = basename(file, '.json');
    const data = JSON.parse(await readFile(join(dataDir, event.name, file), 'utf8'));
    const dest = join(outDir, event.name, slug);
    await mkdir(dest, { recursive: true });
    await writeFile(join(dest, 'index.html'), render(ev, data, slug, event.name));
    console.log(`✓ /${event.name}/${slug}`);
    count++;
  }
}
console.log(`${count} itinerary page(s) built.`);
