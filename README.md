# Host site (Netlify)

One Netlify site that hosts many separate projects as folders, e.g.

```
https://your-domain/                                      -> "not an active page" placeholder
https://your-domain/<event>/<school>                      -> an itinerary
https://your-domain/<anything>/                           -> any other project you drop in
```

## Layout

```
netlify.toml          Netlify settings (publish folder, noindex headers, redirects)
public/               EVERYTHING in here is the live website
  index.html          Homepage placeholder - edit the links list
  404.html            Shown for any unknown URL
  assets/             Shared CSS, JS, logos (brand colours are at the top of base.css)
  volleyball-2026/    Generated itinerary pages (one folder per event)
data/itineraries/     One JSON file per itinerary (source for the pages)
tools/                build-itineraries.mjs - turns the JSON into pages
```

## Adding an itinerary

Each event has a folder in `data/itineraries/` with a `_event.json` that sets the shared
branding for every school in it:

```json
{ "event": "WSG Volleyball 2026", "theme": "wsg-volleyball",
  "eventLogo": "/assets/img/events/wsg-volleyball.png", "location": "Antalya, Turkey",
  "fixturesNote": "...", "note": "..." }
```

Themes live in `public/assets/css/themes/` (`wsg-volleyball` = navy + orange, `wsg` = navy + red).
Copy one to make a theme for a new sport.

To add a school:
1. Copy `data/itineraries/volleyball-2026/cambridge-school-of-bucharest.json` to
   `data/volleyball-2026/<school-slug>.json` (lowercase, hyphens).
2. Put the school's logo in `public/assets/img/schools/` and set `schoolLogo`.
3. Edit `info`, `fixtures` and `days`. On a timeline item you can add `"highlight": true`,
   and `"icon"` (flight, coach, hotel, meal, flag, match, camera, trophy, info). Icons are
   otherwise picked from the title automatically. Set `"pdf": "file.pdf"` to link a PDF
   instead of using the browser's print.
4. Run `node tools/build-itineraries.mjs` (needs Node 18+).
5. For a new event, add a redirect for its folder in `netlify.toml` (copy the volleyball-2026 one).
6. Deploy. The page is live at `/volleyball-2026/<school-slug>`.

## Importing from the itinerary PDFs

If the itineraries come as A4 PDFs (like "School - WSG Volleyball 2026 Itinerary (A4).pdf"):

```
python3 tools/import-pdf-itineraries.py data/itineraries/volleyball-2026 ~/Downloads/*"(A4).pdf"
node tools/build-itineraries.mjs
```

Copy each A4 PDF to `public/volleyball-2026/<school-slug>/<school-slug>.pdf` so the
"Print PDF" button opens it, and put the school's logo in `public/assets/img/schools/<school-slug>.png`.

## Adding any other project

Make a folder in `public/` (e.g. `public/supporters/football-2026/`) with an `index.html`.
It's served at `/supporters/football-2026`. Use `/assets/...` for shared styles, or keep
the project's own files inside its folder.

## Deploying

**Quickest:** in Netlify, *Add new site → Deploy manually*, and drag the `public` folder in.
(Drag-and-drop ignores `netlify.toml`, so the noindex header and redirects won't apply;
the `<meta name="robots" content="noindex">` tags still keep pages out of Google.)

**Recommended:** push this whole folder to a GitHub repo, then *Add new site → Import from Git*.
Netlify reads `netlify.toml` automatically (publish directory `public`, no build command).
Every push redeploys. Optionally set `command = "node tools/build-itineraries.mjs"` in
`netlify.toml` so pages are regenerated from the JSON on each deploy.

**Custom domain:** Site configuration → Domain management → add e.g. `web.yourdomain.com`
and create the CNAME record Netlify shows you.
