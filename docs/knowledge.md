# Wissen zu sarfile_analyzer_web

Gesammelte Erkenntnisse aus der Entwicklung (Phasen 2–4, Admin-Settings,
Lab-Deployment, Stand 21.10.2026). Jeder `##`-Abschnitt steht für sich und
kann einzeln in eine Wissens-Collection (z. B. cloud-memory) übernommen
werden. Kurzfassung für Agenten: [`../CLAUDE.md`](../CLAUDE.md).

---

## 1. Projekt und Zusammenspiel der Repos

- **sarfile_analyzer_web** (`github.com/jschaef/sarfile_analyzer_web`,
  früher `jschaef-sarfile_analyzer_web`; alte URL leitet GitHub weiter):
  neues Web-Frontend (Next.js) plus eigenes Backend **sar-web-api**
  (`backend/`, FastAPI, Prefix `/api/v2`).
- **sarfile_analyzer_ng** (`github.com/jschaef/sarfile_analyzer_ng`): das
  Hauptprojekt mit der klassischen Streamlit-App (`code/`), REST-API `/api/v1`
  (`api/`), MCP-Server (`mcp_server/`) und Lab-Deployment
  (`deployment/lab/`).
- sar-web-api **importiert den Code von sarfile_analyzer_ng** (`code/` und
  `api/`), erwartet den Checkout unter `../sarfile_analyzer_ng` (sonst
  `SAR_BACKEND_DIR`) und läuft in dessen venv.
- Beide Oberflächen teilen **Benutzer** (`code/data.db`), **Uploads**
  (`$UPLOAD_DIR/<user>/`) und **Laufzeit-Einstellungen**
  (`$UPLOAD_DIR/config/settings.json`). Wer sich in der einen registriert oder
  eine Datei hochlädt, sieht das in der anderen.
- `$UPLOAD_DIR/config/` ist gemeinsamer Zustand (Login-Historie, Tabellen-
  Kopien als Parquet, settings.json, Revocation-Liste von sar-web-api). Der
  Benutzername `config` ist deshalb reserviert (ng: `validation.RESERVED_USERNAMES`).

## 2. Arbeitsregeln von Jochen

- Mit Jochen **Deutsch** sprechen; Code, Kommentare und Commit-Nachrichten
  **Englisch**. PR-Beschreibungen **Deutsch**. Lab-Doku (README-lab, deployment/lab/README) Deutsch.
- Commits: klein, ein Thema pro Commit, **erst wenn die Tests grün sind**.
  **Kein `Co-Authored-By`**; als letzte Zeile `Claude-Session: <url>`.
- **Nie nach `main` pushen, nie mergen.** Jochen mergt selbst (meist lokal per
  `git merge --ff-only origin/<branch>`, bei gestapelten PRs „Create a merge
  commit“, nicht Squash). PRs nur auf ausdrückliche Bitte; PRs nicht
  beobachten („ich reviewe selbst“).
- **sarfile_analyzer_ng nur auf ausdrückliche Bitte ändern.** Dann auf dem
  Session-Branch (z. B. `jschaef/<name>`) mit **Jochen als Author**:
  `--author="Jochen Schäfer <jochen.schaefer@suse.com>"`.
- **`code/data.db` im Repo bleibt der Seed**: nur `admin`/`password` plus
  Headings und Metriken. Tests arbeiten immer auf einer Kopie. Produktive
  Benutzer gibt es nur auf dem Server.
- **Keine echten sar-Dateien committen.** Nur `scripts/generate_sar.py` und
  die kleine Fixture `e2e/fixtures/sar_small.txt`.
- Jochen ist SUSE-Support-Engineer, programmiert vor allem Python; Linux-
  Hintergrund (SLES) darf vorausgesetzt werden.

## 3. Stack und Fallstricke im Frontend

- **Next.js 16.4.2** (App Router), React 19.3, Tailwind 4, shadcn/ui auf
  **Base UI** (nicht Radix), ECharts 6, Playwright. `AGENTS.md`: Next 16 weicht
  vom Trainingswissen ab – Doku unter `node_modules/next/dist/docs/` lesen.
- `next.config.ts`: `cacheComponents`, `partialPrefetching`; `/` → `/overview`;
  **Rewrite `/api/v2/*` → sar-web-api**. Die Rewrite-Ziel-URL
  (`SAR_WEB_API_URL`) wird **beim Build** festgeschrieben, die Route-Handler
  lesen sie zur Laufzeit – beides setzen.
- **`proxy.ts`** (Next-16-Name für Middleware): hängt das Bearer-Token aus dem
  httpOnly-Cookie `sar_session` an `/api/v2/*`, schützt die App-Seiten.
  Ohne Session erlaubt: `/api/v2/health`, `/api/v2/token`, `/api/v2/info`
  (Signup läuft über den Route-Handler `/api/auth/signup`).
- Auf Pfaden im proxy-Matcher **puffert Next den Request-Body und schneidet
  bei 10 MB ab** → Upload läuft über `app/api/upload/route.ts` (außerhalb des
  Matchers, streamt per `fetch(..., duplex: "half")`).
- **Node.js-Grenzen beim Upload über Next**: `http.Server.requestTimeout`
  = 300 s (Übertragung) und der fetch an sar-web-api wartet max. 300 s auf
  die Antwort. Next hat dafür keine Option. Im Lab geht `/api/upload` daher
  per nginx direkt an sar-web-api (siehe Abschnitt 7).
- Login/Signup: Route-Handler unter `app/api/auth/*`, JSON **und**
  Formular-Post (303-Redirect, ohne JavaScript). `sameOrigin()` vergleicht
  `Origin` mit `x-forwarded-host ?? host` → hinter einem Proxy muss der
  Host **mit Port** ankommen, sonst 403.
- Cookie `Secure` in Produktion (`SAR_COOKIE_SECURE=false` nur für reines HTTP).
- **Activity**: Next hält alte Routen versteckt im DOM → Playwright-Locator
  mit `.filter({ visible: true })`. `useSearchParams` braucht ein
  `<Suspense>` darum.
- Charts: `lib/echarts-option.ts` baut die Option (reine Funktion, auch von
  `perf/bench.mjs` genutzt). Palette = Bokeh Category10 wie in Streamlit.
  Restarts: eigene, nicht schaltbare Serie „LINUX RESTART“ (rot, gestrichelt);
  bei `lines` (Multiple SAR Files) hat jede Datei ihre Restarts als
  markLine in ihrer Linienfarbe, die mit der Datei aus-/eingeblendet werden.
- `components/help-note.tsx`: `useInfo()` lädt `/api/v2/info` einmal pro
  Seitenaufruf (Modul-Cache, `refreshInfo()` nach Settings-Änderung).
  Liefert Admin-Kontakt, Signup an/aus, `max_header_count`, `streamlit_url`.

## 4. sar-web-api (backend/)

- `bootstrap.py`: findet sarfile_analyzer_ng, `use_database(path)` bindet
  `sql_stuff.data_db/engine/Session/session` neu (`SAR_WEB_DB`).
- Die modulweite SQLAlchemy-Session von `sql_stuff` ist nicht threadsicher →
  alle DB-Zugriffe in `accounts.py` hinter einem RLock (`_db()`).
- `/admin/*` liest die Rolle bei **jedem** Request aus der DB; Tokens
  gelöschter Benutzer werden abgelehnt (`auth.current_user`).
- Endpunkte (Auszug): `/info`, `/signup`, `/token`, `/users/me`,
  `PUT /users/me/password`, `/files` (Upload 201, Liste, Delete),
  `/files/{name}` (Header, Restarts), `.../series`, `.../threshold`,
  `/admin/users|logins|metrics|headers|redis|redis/fields|settings`.
  Fehler: 400 ServiceError, 403 Forbidden, 409 Conflict, 501 Unsupported
  (z. B. Settings bei zu altem sarfile_analyzer_ng).
- `threshold`: erst Zeitfenster, dann Wertefilter – Zeitfenster ohne Daten
  = 400, Zeitfenster ohne Treffer = `matches: 0`.
- `delete_logins_before`: leere Historie bekommt wie in Streamlit einen
  Startdatensatz; der zählt nicht als gelöscht.
- `e2e_server.py`: startet die App auf einer **temporären Kopie** der Seed-DB.
- Env: `SAR_WEB_API_SECRET` (sonst zufällig → Sessions überleben keinen
  Neustart), `SAR_WEB_API_TOKEN_TTL` (12 h), `SAR_WEB_SIGNUP`,
  `SAR_WEB_DB`, `SAR_WEB_STATE_DIR`, `SAR_WEB_CACHE_FILES/HEADERS`,
  `UPLOAD_DIR`, `SAR_BACKEND_DIR`. Details: `backend/README.md`.

## 5. Laufzeit-Einstellungen (Admin › Settings)

- Definiert in **sarfile_analyzer_ng `code/config.py`**: `EDITABLE_SETTINGS`
  (Name → Typ, Env-Variable, min, max), `SECRET_SETTINGS`,
  `update_settings()` (validiert alles, schreibt atomar, Modus 0600).
- Werte in `$UPLOAD_DIR/config/settings.json`, Vorrang vor Env/Default.
  Ein Metaklassen-Trick (`_ConfigMeta`) lässt `Config.<name>` den gespeicherten
  Wert liefern; die Datei wird per mtime geprüft → gilt **ohne Neustart** für
  Streamlit, `/api/v1` und sar-web-api. `redis_mng` verbindet sich bei
  geänderten Redis-Daten neu.
- Settings: `admin_email`, `admin_communication`, `max_header_count` (1–12),
  `cols_per_line` (1–8), `redis_enabled/host/port/user/password`,
  `web_frontend_url` (Button „New web frontend“ in der Streamlit-Sidebar),
  `streamlit_url` („Classic app“ im Header des Web-Frontends). URLs nur
  `http(s)://`, leer = kein Link.
- Web-UI: `app/(app)/admin/settings/settings.tsx`, Gruppen Contact,
  Analysis views, Redis, Streamlit app. Gruppen, deren Settings das
  installierte sarfile_analyzer_ng nicht kennt, werden ausgeblendet.
- Ohne Web-Frontend per Kommandozeile setzen:
  `UPLOAD_DIR=$PWD/upload venv/bin/python -c 'import config; print(config.update_settings({"admin_email": "…"}))'`
  (in `code/`; `None` entfernt einen Wert).

## 6. Tests und lokale Entwicklung

- Backend: `cd backend && python -m pytest` (im venv von
  sarfile_analyzer_ng). `conftest.py` kopiert die Seed-DB und **schlägt fehl,
  wenn sich der Hash der Seed-`data.db` geändert hat**. Redis-Test startet
  einen echten `redis-server`, falls vorhanden. Stand: 54 Tests.
- Frontend: `npm run lint`, `npm run typecheck`, `npm run build`,
  `npx playwright test` (20 Tests; real-file und Screenshots nur mit Env).
- Playwright nutzt den **Production-Build** (`next start`): vorher
  `npm run build` – und zwar **mit Standard-API-URL** (8200). Ein Build mit
  `SAR_WEB_API_URL=…:8300` (Lab) lässt die E2E-Tests mit ECONNREFUSED scheitern.
- E2E-Env: `PLAYWRIGHT_CHROMIUM_EXECUTABLE`, `SAR_E2E_SKIP_API`,
  `SAR_E2E_API_CMD`, `SAR_E2E_USER/PASSWORD`, `SAR_E2E_REAL_FILE` +
  `SAR_E2E_REAL_HOST` (Hostname aus der ersten Zeile der Datei),
  `SAR_SCREENSHOTS_DIR` (+ `_WIDTH`).
- In der Claude-Cloud-Umgebung: Chromium unter `/opt/pw-browsers/chromium`
  (nicht `playwright install`), das venv von sarfile_analyzer_ng muss im
  `PATH` liegen (sonst `No module named 'sqlalchemy'` beim API-Start).
  Beispiel:
  `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium PATH=<ng>/.venv-sar/bin:$PATH npx playwright test`
- Bekannte Test-Fallen: Formular erst nach `waitForLoadState("networkidle")`
  füllen (Hydration); Toasts bleiben stehen → nicht zweimal auf denselben
  Toast-Text warten (strict mode), lieber auf einen Status im Formular;
  `/` leitet über `/login?next=%2Foverview` – ein URL-Muster `/overview/`
  passt schon vor dem Login.
- Testdaten: `scripts/generate_sar.py` (z. B. `--samples 1440 --interval 60
  --cpus 8` ≈ 3,3 MB; `--restart` fügt einen LINUX RESTART ein).

## 7. Lab-Deployment dus-lab-sar

- Server `dus-lab-sar.lab.dus.suse.com` (SLES 15, nur über VPN), User
  `jschaef`, Repos unter `~/data1/sarfile_analyzer_ng` und
  `~/data1/sarfile_analyzer_web`.
- Ports:
  - `:443` nginx → `127.0.0.1:8501` Streamlit (System-Unit
    `sarfile-analyzer.service`, root, `User=jschaef`, läuft in `screen`)
  - `:8443`/`:9443` Caddy (rootless Podman) → REST-API 8100 / MCP 8200
  - `:8444` nginx → `127.0.0.1:3100` Next.js (`sar-web.service`) →
    `127.0.0.1:8300` sar-web-api (`sar-web-api.service`; 8200 ist sar-mcp)
- Web-Frontend: `deployment/lab/` dieses Repos (Units, nginx-vHost,
  `deploy.sh`, README). Secrets in `~/.config/sar-analyzer/web.env`.
- nginx-vHost :8444 braucht `proxy_set_header Host $http_host` (mit Port),
  nicht `$host` wie der Streamlit-vHost → sonst 403 beim Login.
  `location = /api/upload` geht direkt an `127.0.0.1:8300/api/v2/files`
  (Cookie → `Authorization: Bearer $cookie_sar_session`,
  `proxy_read_timeout 3600`). Lokal geprüft: gedrosselter Upload über Next
  → 408 nach 314 s, direkt → 201 nach 327 s.
- Update-Reihenfolge: erst `~/data1/sarfile_analyzer_ng/deployment/lab/deploy.sh`
  (startet sar-api, sar-mcp und – falls vorhanden – sar-web-api neu), dann
  `~/data1/sarfile_analyzer_web/deployment/lab/deploy.sh` (npm ci + Build,
  Web-Frontend dabei 1–2 min gestoppt). Streamlit braucht einen Neustart nur
  bei Code-Änderungen in `code/`: `sudo systemctl restart sarfile-analyzer`.
  Änderungen an der nginx-Conf: als root nach `/etc/nginx/conf.d/`
  kopieren, `sudo nginx -t && sudo systemctl reload nginx`.
- **`code/data.db` ist auf dem Server skip-worktree-geschützt** (echte
  Benutzer). Nie `git checkout code/data.db` ohne Sicherung. `code/config.py`
  ist seit 21.10.2026 **nicht** mehr geschützt und wird nicht mehr gepatcht.
- Auf dus-lab-sar gesetzte Settings: `admin_email` =
  `jochen.schaefer@suse.com`, `web_frontend_url` =
  `https://dus-lab-sar.lab.dus.suse.com:8444`, `streamlit_url` =
  `https://dus-lab-sar.lab.dus.suse.com`.
- Backup zusätzlich: `~/.config/sar-analyzer/web.env` (ohne: neues Secret,
  alle müssen sich neu anmelden) und `code/upload/config/settings.json`.
- Vollständige Doku: `deployment/lab/README.md` (Web) und
  `deployment/lab/README-lab.md` (sarfile_analyzer_ng).

## 8. Verlauf

- PR #1 Phase 2: sar-web-api schließt die API-Lücken (`PHASE2-API-GAPS.md`).
- PR #2 Phase 3: Detailed Metrics, Metrics on many devices, Compare Metrics,
  Multiple SAR Files; Login als Formular-Post.
- PR #3 Phase 4: Signup, Self Service, User/DB/Redis-Management, Info,
  Admin-Settings (die TODO-Seite der Streamlit-App entfällt).
- Danach direkt auf `main` (von Jochen gemergt): Lab-Deployment,
  Streamlit-Link-Settings, Restart-Farben in Multiple SAR Files,
  Upload direkt über nginx.
- In sarfile_analyzer_ng (Author Jochen): Benutzername `config` reserviert,
  Laufzeit-Settings, Sidebar-Link, `streamlit_url`, Lab-Doku.
- Copilot-Reviews auf #2/#3 brachten drei echte Fixes (threshold-Zeitfenster,
  Login-Historie-Zählung, eindeutige Feld-IDs im Heading-Formular).

## 9. Offene Punkte und bekannte Grenzen

- **Dependabot `braces`** (GHSA-vfj7-8cjw-p6xm): nur in Dev-Abhängigkeiten
  (shadcn, `@next/eslint-plugin-next`); `npm audit --omit=dev` = 0. GitHub hat
  den Alert automatisch geschlossen. `npm audit fix --force` würde shadcn
  downgraden – nicht machen; auf eine gefixte Version warten.
- Außerhalb des Lab (ohne nginx-Location) bleibt der Upload über Next auf
  5 min Übertragung + 5 min Einlesen begrenzt.
- `deploy.sh` von sarfile_analyzer_ng gibt das MCP-Gate-Token bei jedem Lauf
  aus – es landet leicht in Logs oder Chats.
- Aufräumen auf dem Server: `~/config.py.lokal`, `~/data.db.<Datum>`.
- Den cloud-memory-MCP-Server stellt die Cloud-Umgebung bereit (die
  `.mcp.json` in sarfile_analyzer_ng wurde wieder entfernt). MCP-Server
  werden nur beim Start einer Session geladen.
- Gegenstück zu diesem Dokument: `sarfile_analyzer_ng/docs/knowledge.md`.
