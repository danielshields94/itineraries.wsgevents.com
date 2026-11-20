#!/usr/bin/env node
// Builds itinerary pages from JSON.
//
//   data/itineraries/<event>/_event.json     shared settings for the event (name, theme, logo, location)
//   data/itineraries/<event>/<school>.json   one file per school
//   -> public/itineraries/<event>/<school>/index.html   (live at /itineraries/<event>/<school>)
//
// Usage:  node tools/build-itineraries.mjs            build everything
//         node tools/build-itineraries.mjs <event>    build one event folder
import { readdir, readFile, mkdir, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';
import { join, dirname, basename } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const dataDir = join(root, 'data', 'itineraries');
const outDir = join(root, 'public', 'itineraries');
const only = process.argv[2];

const esc = (s = '') => String(s)
  .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  .replace(/"/g, '&quot;').replace(/'/g, '&#39;');

// ---- Timeline icons (set "icon" on an item, or it is guessed from the title) ----
const S = 'fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round"';
const ICONS = {
  flight: '<svg viewBox="0 0 24 24"><path d="M21 15.2v-1.9L13 8V3.4c0-.8-.7-1.4-1.5-1.4S10 2.6 10 3.4V8l-8 5.3v1.9l8-2.4V18l-2.5 1.7v1.7l3.5-1 3.5 1v-1.7L12 18v-5.2l9 2.4z" fill="currentColor"/></svg>',
  coach: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="4.5" width="18" height="12" rx="2.2"/><path d="M3 10.5h18"/><path d="M7 16.5v2.2M17 16.5v2.2"/></svg>`,
  hotel: `<svg viewBox="0 0 24 24" ${S}><path d="M4 21V10.5L12 4l8 6.5V21"/><path d="M9.5 21v-6.5h5V21"/></svg>`,
  meal: `<svg viewBox="0 0 24 24" ${S}><path d="M5 3v8a2.5 2.5 0 0 0 5 0V3M7.5 11v10"/><path d="M17 3c-1.5 1.5-2 3.5-2 5.5s.5 3 2 3.5v9"/></svg>`,
  flag: `<svg viewBox="0 0 24 24" ${S}><path d="M5 21V4"/><path d="M5 5h11l-2 3 2 3H5"/></svg>`,
  match: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7"><circle cx="12" cy="12" r="9"/><path d="M3.5 9.5c5 .5 9.5 3.5 12 8M20.5 9.5c-5 .5-9.5 3.5-12 8M12 3c2 3 3 6.5 3 9"/></svg>',
  camera: `<svg viewBox="0 0 24 24" ${S}><rect x="3" y="6.5" width="18" height="12" rx="2.3"/><circle cx="12" cy="12.5" r="3.2"/></svg>`,
  trophy: `<svg viewBox="0 0 24 24" ${S}><path d="M8 4h8v5a4 4 0 0 1-8 0V4z"/><path d="M8 6H5a3 3 0 0 0 3 4M16 6h3a3 3 0 0 1-3 4"/><path d="M12 13v4M8.5 20h7M10 17h4"/></svg>`,
  info: `<svg viewBox="0 0 24 24" ${S}><circle cx="12" cy="12" r="9"/><path d="M12 11v5M12 8h.01"/></svg>`,
};
function guessIcon(title = '') {
  const t = title.toLowerCase();
  if (/\bfly\b|flight|→/.test(t)) return 'flight';
  if (/coach|bus|transfer/.test(t)) return 'coach';
  if (/check.?in|check.?out|hotel|arrive/.test(t)) return 'hotel';
  if (/breakfast|lunch|dinner|meal/.test(t)) return 'meal';
  if (/award|presentation|medal ceremony/.test(t)) return 'trophy';
  if (/parade|ceremony|opening/.test(t)) return 'flag';
  if (/photo|media|interview/.test(t)) return 'camera';
  if (/ vs | v |final|match|semi|crossover|game|training/.test(t)) return 'match';
  return 'info';
}

// "value" or { "v": "main", "v2": "smaller line" }
const infoCard = (k, val) => {
  const v = typeof val === 'object' ? val : { v: val };
  return `<div class="infocard"><div class="k">${esc(k)}</div><div class="v">${esc(v.v)}${v.v2 ? `<span class="v2">${esc(v.v2)}</span>` : ''}</div></div>`;
};

function render(ev, d, slug, eventSlug) {
  const eventName = d.event || ev.event;
  const days = d.days || [];
  const id = i => `${slug}-day-${i + 1}`;

  const nav = days.map((day, i) =>
    `<a href="#${id(i)}"${i === 0 ? ' class="on"' : ''}>${esc(day.short || day.date)}<span class="theme">${esc(day.label)}</span></a>`).join('');

  const info = Object.entries(d.info || {}).map(([k, v]) => infoCard(k, v)).join('');

  const fx = d.fixtures || [];
  const sq = d.showSquadColumn ?? new Set(fx.map(f => f.squad)).size > 1;
  const fxTitle = !sq && fx[0]?.squad ? `${fx[0].squad} fixtures` : 'Fixtures';
  const fixtures = fx.length ? `<div class="fixtures"><h2>${esc(fxTitle)}</h2>${(d.fixturesNote ?? ev.fixturesNote) ? `<div class="sub">${esc(d.fixturesNote ?? ev.fixturesNote)}</div>` : ''}<div class="scroll"><table><thead><tr><th>When</th>${sq ? '<th>Squad</th>' : ''}<th>Opponent</th><th>Country</th><th>Stage</th><th>Court</th></tr></thead><tbody>${
    fx.map(f => `<tr><td class="w">${esc(f.when)}</td>${sq ? `<td class="c">${esc(f.squad)}</td>` : ''}<td>${esc(f.opponent)}</td><td class="c">${esc(f.country)}</td><td class="c">${esc(f.stage)}</td><td class="c">${esc(f.court)}</td></tr>`).join('')
  }</tbody></table></div></div>` : '';

  const dayHtml = days.map((day, i) => `<section class="day" id="${id(i)}"><div class="daycard"><div class="dayhead"><div><div class="lbl">Day ${i + 1}</div><div class="dt">${esc(day.date)}</div></div><div class="badge">${esc(day.badge || day.label)}</div></div><ol class="timeline">${
    (day.items || []).map(it => `<li class="${[it.highlight && 'hl', it.tag && /IF |DEPENDS/.test(it.tag) && 'cond'].filter(Boolean).join(' ')}"><div class="time">${esc(it.time)}</div><div class="icon">${ICONS[it.icon] || ICONS[guessIcon(it.title)]}</div><div class="ev">${it.tag ? `<div class="tag">${esc(it.tag)}</div>` : ''}<div class="t">${esc(it.title)}</div>${it.detail ? `<div class="s">${esc(it.detail)}</div>` : ''}</div>${(it.court || (it.tbc && it.time !== 'TBC')) ? `<div class="pills">${it.court ? `<span class="pill">${esc(it.court)}</span>` : ''}${it.tbc && it.time !== 'TBC' ? '<span class="pill tbc">TBC</span>' : ''}</div>` : ''}</li>`).join('')
  }</ol></div></section>`).join('');

  const schoolLogo = d.schoolLogo
    ? `<img class="logo school" src="${esc(d.schoolLogo)}" alt="${esc(d.school)} logo">` : '';
  const eventLogo = (d.eventLogo || ev.eventLogo)
    ? `<img class="logo event" src="${esc(d.eventLogo || ev.eventLogo)}" alt="${esc(ev.eventLogoAlt || eventName + ' logo')}">` : '';
  const sub = [d.location || ev.location, d.dates].filter(Boolean).join(' · ');
  const title = `Itinerary: ${eventName} x ${d.school}`;
  const theme = d.theme || ev.theme || 'wsg';
  const pdf = d.pdf && !d.pdf.includes('/') ? `/itineraries/${eventSlug}/${slug}/${d.pdf}` : d.pdf;
  const printBtn = pdf
    ? `<a class="btn print" href="${esc(pdf)}" target="_blank" rel="noopener">Print PDF</a>`
    : `<button class="btn print" data-print>Print PDF</button>`;

  return `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light">
<meta name="robots" content="noindex">
<title>${esc(title)}</title>
<meta property="og:title" content="${esc(title)}">
<meta property="og:description" content="${esc(sub)}">
${eventLogo ? `<meta property="og:image" content="${esc(d.eventLogo || ev.eventLogo)}">` : ''}
<link rel="icon" href="${esc(d.eventLogo || ev.eventLogo || '/assets/img/favicon.png')}">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Montserrat:wght@500;600;700;800;900&display=swap">
<link rel="stylesheet" href="/assets/css/itinerary.css">
<link rel="stylesheet" href="/assets/css/themes/${esc(theme)}.css">
</head>
<body>
<header class="topbar">
  <div class="brandrow">
    ${schoolLogo}
    ${eventLogo}
    <div class="titles">
      <h1>${esc(d.school)} · ${esc(eventName)}</h1>
      <div class="sub">${esc(sub)}</div>
    </div>
  </div>
</header>
${days.length ? `<nav class="days">${nav}</nav>` : ''}
<main>
${d.notice ? `<div class="notice">${esc(d.notice)}</div>` : ''}
${info ? `<div class="infogrid">${info}</div>` : ''}
${fixtures}
<div class="daygrid">${dayHtml}</div>
${(d.goodToKnow || []).length ? `<section class="gtk"><h2>Good to know</h2><div class="gtkgrid">${d.goodToKnow.map(g => `<div class="infocard"><div class="k">${esc(g.title)}</div><div class="v2">${esc(g.text)}</div></div>`).join('')}</div></section>` : ''}
<p class="note">${esc(d.note || ev.note || 'Times may be subject to change.')}</p>
</main>
<footer class="bar"><button class="btn share" data-share>Share</button>${printBtn}</footer>
<script src="/assets/js/share.js" defer></script>
<script>
const links=[...document.querySelectorAll('nav.days a')];
const io=new IntersectionObserver(es=>es.forEach(en=>{if(en.isIntersecting){links.forEach(l=>l.classList.toggle('on',l.getAttribute('href')==='#'+en.target.id));}}),{rootMargin:'-40% 0px -55% 0px'});
document.querySelectorAll('section.day').forEach(s=>io.observe(s));
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
    console.log(`✓ /itineraries/${event.name}/${slug}`);
    count++;
  }
}
console.log(`${count} itinerary page(s) built.`);
