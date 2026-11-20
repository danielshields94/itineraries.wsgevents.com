"""Import WSG itinerary A4 PDFs into data/itineraries/<event>/<school>.json.

Usage: python3 tools/import-pdf-itineraries.py data/itineraries/volleyball-2026 "path/to/*(A4).pdf"
Then:  node tools/build-itineraries.mjs
Needs pdftotext (poppler). Check the output pages after importing."""
import re, json, sys, subprocess, pathlib

COUNTRIES = {"ROMANIA": "Romania", "UAE": "UAE", "BELGIUM": "Belgium", "SWITZERLAND": "Switzerland",
             "KAZAKHSTAN": "Kazakhstan", "GERMANY": "Germany", "SINGAPORE": "Singapore", "TURKEY": "Turkey"}
_TOK = re.compile(r'(?<!\S)(\d{2}:\d{2}|AM|PM|TBC)(?!\S)')


class _TimeRe:
    # a time token only counts if everything before it on the line is left-column day meta (col < 15)
    def search(self, line):
        for m in _TOK.finditer(line):
            before = line[:m.start()]
            if not before.strip() or (len(before.rstrip()) < 15):
                return m
        return None


TIME_RE = _TimeRe()
NOISE = re.compile(r'^\s*(World School Volleyball Championships 2026 ·|Match\s+Schedule\s+Depends|Day by day\s*$|WHEN\s+)')


def slugify(s):
    return re.sub(r'[^a-z0-9]+', '-', s.lower()).strip('-')


def split_cols(line, starts):
    """Cut a line into cells using column start positions (snap to word boundaries)."""
    cells = []
    for i, st in enumerate(starts):
        en = starts[i + 1] if i + 1 < len(starts) else len(line) + 1
        cells.append(line[st:en] if st < len(line) else '')
    return [c.strip() for c in cells]


def words_cols(line, starts):
    """Assign each run of text (split on 2+ spaces) to the nearest column start at or left of it."""
    out = [''] * len(starts)
    for m in re.finditer(r'\S+(?: \S+)*', line):
        pos = m.start()
        idx = max([i for i, s in enumerate(starts) if s <= pos + 3] or [0])
        out[idx] = (out[idx] + ' ' + m.group()).strip()
    return out


def parse(path):
    txt = subprocess.run(['pdftotext', '-layout', path, '-'], capture_output=True, text=True).stdout
    L = txt.replace('\f', '\n').split('\n')
    d = {}
    d['updated'] = re.search(r'Updated (.+?)\s*$', L[0]).group(1)

    i = next(k for k, l in enumerate(L) if 'T E A M' in l)
    cname = re.sub(r'\s', '', L[i].split('·', 1)[1])
    country = COUNTRIES[cname]
    k = i + 1
    name = []
    while not L[k].startswith('Antalya,'):
        if L[k].strip(): name.append(L[k].strip())
        k += 1
    school = ' '.join(name)
    dates = L[k].split('·', 1)[1].strip()

    # Info row
    h = next(j for j in range(k, len(L)) if L[j].startswith('TRIP'))
    starts = [L[h].index('TRIP'), L[h].index('STAYI'), L[h].index('S Q'), L[h].index('L E A D')]
    rows = []
    j = h + 1
    while not L[j].strip(): j += 1
    while L[j].strip():
        rows.append(words_cols(L[j], starts)); j += 1
    col = lambda c: [r[c] for r in rows if r[c]]
    trip, stay, squad, lead = col(0), col(1), col(2), col(3)
    info = {
        "Dates": {"v": dates, "v2": trip[0]},
        "Staying at": {"v": stay[0], "v2": ' '.join(stay[1:])},
        "Squad": {"v": squad[0], "v2": ' '.join(squad[1:])},
        "Lead contact": {"v": lead[0], "v2": ' '.join(lead[1:])},
        "Country": country,
        "Updated": d['updated'],
    }
    notice = next((l.strip() for l in L if 'Items marked TBC' in l), '')

    # Fixtures
    fx_start = next(j for j, l in enumerate(L) if re.match(r'^(\S.*)?[Ff]ixtures\s*$', l.strip()) and 'Travel' not in l)
    day_start = next(j for j, l in enumerate(L) if l.startswith('Day by day'))
    fixtures, cur_squad, hdr = [], None, None
    group = []

    def flush_fx():
        if not group or not hdr: return
        cells = [''] * len(hdr)
        for gl in group:
            for c, v in enumerate(words_cols(gl, [s for s, _ in hdr])):
                if v: cells[c] = (cells[c] + ' ' + v).strip()
        row = dict(zip([n for _, n in hdr], cells))
        if not row.get('when'): return
        row.setdefault('squad', cur_squad or '')
        fixtures.append(row)

    for l in L[fx_start:day_start]:
        s = l.strip()
        m = re.match(r'^(.+?) fixtures$', s.split('   ')[0].strip())
        if m:
            flush_fx(); group = []; cur_squad = m.group(1); continue
        if s.startswith('WHEN'):
            flush_fx(); group = []
            names = ['when', 'squad', 'opponent', 'country', 'stage', 'court']
            hdr = [(l.index(w), n) for w, n in zip(['WHEN', 'SQUAD', 'OPPONENT', 'COUNTRY', 'STAGE', 'COURT'], names) if w in l]
            continue
        if not s or s.startswith('All matches') or s.startswith('Fixtures') or 'Match    Schedule' in l:
            flush_fx(); group = []; continue
        group.append(l)
    flush_fx()
    for f in fixtures:
        for k in f: f[k] = re.sub(r'\s+', ' ', f[k]).replace('semi- final', 'semi-final')

    # Days
    gtk = next(j for j, l in enumerate(L) if l.startswith('Good to know'))
    days, day, grp = [], None, []
    pending = []

    def flush_item():
        nonlocal grp
        g = [l for l in grp if l.strip()]
        grp = []
        if not g or day is None: return
        tl = next((l for l in g if TIME_RE.search(l)), None)
        if tl is None:
            for l in g:
                ind = len(l) - len(l.lstrip())
                if ind > 15 and not re.search(r'[a-z]', l): pending.append(l.strip())
                else: day['meta'].append(l.strip())
            return
        m = TIME_RE.search(tl)
        tcol = m.start()
        content = []
        for l in g:
            left = l[:tcol].strip()
            if left: day['meta'].append(left)
            rest = l[tcol:]
            if l is tl: rest = l[m.end():]
            rest = rest.strip()
            if rest: content.append(rest)
        it = {"time": m.group(1)}
        title, detail, tags = [], [], pending[:]
        pending.clear()
        for c in content:
            parts = re.split(r'\s{3,}', c)
            main, right = parts[0], parts[1:]
            for r in right:
                if r.startswith('Court'): it['court'] = r
                elif r == 'TBC': it['tbc'] = True
                else: main += ' ' + r
            if main in ('TBC',): it['tbc'] = True; continue
            if main.startswith('Court'): it['court'] = main; continue
            if not re.search(r'[a-z]', main) and len(main) > 3:
                tags.append(main); continue
            if not title:
                title.append(main)
            elif ' vs ' in ' '.join(title) and not detail and not re.match(r'(Court|Please|Elly|Flight|Approx|Sharing)', main):
                title.append(main)
            else:
                detail.append(main)
        it['title'] = ' '.join(title)
        if detail: it['detail'] = '\n'.join(detail)
        if it['time'] == 'TBC': it['tbc'] = True
        if tags: it['tag'] = ' '.join(tags)
        day['items'].append(it)

    for l in L[day_start + 1:gtk]:
        if NOISE.match(l): continue
        m = re.match(r'^\s*DAY (\d+) · (\w+)', l)
        if m:
            flush_item()
            day = {"weekday": m.group(2).title(), "meta": [], "items": []}
            days.append(day); continue
        if not l.strip():
            flush_item(); continue
        grp.append(l)
    flush_item()

    out_days = []
    for dd in days:
        meta = [x for x in dd['meta'] if x]
        date = next(x for x in meta if re.match(r'^\d{1,2} \w{3}$', x))
        label = next((x for x in meta if x.isupper()), '').title().replace('&', '&')
        matches = next((x for x in meta if 'match' in x), '')
        label = label.replace(' And ', ' & ')
        badge = label + (f' · {matches}' if matches else '')
        for it in dd['items']:
            if ' vs ' in it['title'] and not re.search(r'IF |DEPENDS', it.get('tag', '')): it['highlight'] = True
        out_days.append({"short": date, "date": f"{dd['weekday']} {date}", "label": label,
                         "badge": badge, "items": dd['items']})

    # Good to know (3 columns)
    hl = L[gtk + 2] if not L[gtk + 1].strip() else L[gtk + 1]
    hi = next(j for j in range(gtk + 1, gtk + 4) if 'Meals' in L[j])
    gstarts = [L[hi].index('Meals'), L[hi].index('Live fixtures'), L[hi].index('On-site help')]
    gcols = [[], [], []]
    for l in L[hi + 1:]:
        if l.strip().startswith('World School Volleyball'): break
        for c, v in enumerate(words_cols(l, gstarts)):
            if v: gcols[c].append(v)
    gtk_items = [{"title": t, "text": ' '.join(c)} for t, c in zip(['Meals', 'Live fixtures & results', 'On-site help'], gcols)]

    multi = len({f['squad'] for f in fixtures}) > 1
    return slugify(school), {
        "school": school,
        "schoolLogo": f"/assets/img/schools/{slugify(school)}.png",
        "dates": dates,
        "pdf": f"{slugify(school)}.pdf",
        "notice": notice,
        "info": info,
        "showSquadColumn": multi,
        "fixtures": fixtures,
        "days": out_days,
        "goodToKnow": gtk_items,
    }


if __name__ == '__main__':
    outdir = pathlib.Path(sys.argv[1])
    for p in sys.argv[2:]:
        slug, data = parse(p)
        (outdir / f'{slug}.json').write_text(json.dumps(data, indent=2, ensure_ascii=False))
        print('ok', slug, len(data['fixtures']), 'fixtures', len(data['days']), 'days', sum(len(x['items']) for x in data['days']), 'items')
