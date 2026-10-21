# Lab-Deployment dus-lab-sar — Web-Frontend (rootless)

Das Web-Frontend läuft neben der Streamlit-App und API/MCP von
sarfile_analyzer_ng (deren Deployment: `deployment/lab/README-lab.md` dort):
Next.js auf `127.0.0.1:3100` und sar-web-api auf `127.0.0.1:8300`, beide als
User-Units von `jschaef`. Von außen erreichbar ist es über den System-nginx
auf **`https://dus-lab-sar.lab.dus.suse.com:8444`**, mit demselben
Zertifikat wie die Streamlit-UI auf `:443`.

## Architektur

```
Client (VPN) ── https://dus-lab-sar.lab.dus.suse.com
   :443  nginx (root)  → 127.0.0.1:8501  Streamlit-UI
   :8444 nginx (root)  → 127.0.0.1:3100  Next.js (sar-web)
                                           └→ 127.0.0.1:8300  sar-web-api
   :8443/:9443 caddy (rootless)          → REST-API 8100 / MCP 8200
```

- Der Browser spricht nur mit Next.js. `/api/v2/*` leitet Next.js an
  sar-web-api weiter; das Session-Token steckt in einem httpOnly-Cookie.
- sar-web-api importiert den Code von sarfile_analyzer_ng und läuft in dessen
  venv (`~/data1/sarfile_analyzer_ng/code/venv`). Benutzer (`code/data.db`),
  hochgeladene Dateien (`code/upload`) und die Laufzeit-Einstellungen
  (`code/upload/config/settings.json`) teilt es mit Streamlit und sar-api:
  wer sich in der einen Oberfläche registriert oder eine Datei hochlädt,
  sieht das in der anderen.
- Port 8200 ist von `sar-mcp` belegt, deshalb läuft sar-web-api auf 8300.

## Einmalige Root-Schritte

1. **Node.js ≥ 20.9** (Next.js 16). Unter SLES 15 aus dem Modul „Web and
   Scripting":

   ```bash
   node --version                                  # schon vorhanden?
   sudo SUSEConnect -p sle-module-web-scripting/15.6/x86_64   # falls das Modul fehlt
   zypper se -s nodejs                             # verfügbare Versionen
   sudo zypper in nodejs22 npm22
   ```

   `npm` braucht beim Deploy Zugriff auf die npm-Registry: `npm ping`.

2. **nginx-vHost** auf `:8444` (Referenz:
   [`nginx-sarfile-analyzer-web.conf`](nginx-sarfile-analyzer-web.conf)):

   ```bash
   sudo cp ~/data1/sarfile_analyzer_web/deployment/lab/nginx-sarfile-analyzer-web.conf \
       /etc/nginx/conf.d/sarfile-analyzer-web.conf
   sudo nginx -t && sudo systemctl reload nginx
   ```

   Wichtig darin ist `proxy_set_header Host $http_host` (mit Port), nicht
   `$host` wie im Streamlit-vHost: Login und Signup vergleichen den Host mit
   dem `Origin` des Browsers (`https://…:8444`) und lehnen sonst jeden Login
   mit 403 ab. Uploads gehen ungepuffert (`proxy_request_buffering off`) bis
   2 GB an Next.js.

3. **Firewall**, falls aktiv:

   ```bash
   sudo firewall-cmd --state
   sudo firewall-cmd --permanent --add-port=8444/tcp && sudo firewall-cmd --reload
   ```

## Erstinstallation

```bash
ssh jschaef@dus-lab-sar.lab.dus.suse.com
git clone git@github.com:jschaef/sarfile_analyzer_web.git ~/data1/sarfile_analyzer_web
~/data1/sarfile_analyzer_web/deployment/lab/deploy.sh
```

Danach als Admin anmelden und unter *Admin › Settings › Streamlit app* den
„Link to this web frontend" auf `https://dus-lab-sar.lab.dus.suse.com:8444`
setzen: die Streamlit-App zeigt dann in der Sidebar den Button „New web
frontend". Leer lassen = kein Link.

## Update (idempotent)

```bash
~/data1/sarfile_analyzer_web/deployment/lab/deploy.sh
```

Das Skript: `git pull` → Node-Version prüfen → `web.env` (nur falls fehlend)
→ Python-Pakete von sar-web-api ins venv von sarfile_analyzer_ng →
`npm ci` + `npm run build` → User-Units `sar-web-api`/`sar-web` installieren
und neu starten → Linger → Health-Check. Während des Builds (1–2 Minuten) ist
das Web-Frontend gestoppt; Streamlit, API und MCP laufen weiter.

Ein Update von sarfile_analyzer_ng (dessen `deploy.sh`) startet sar-web-api
mit neu, damit es den neuen Code lädt.

## Secrets (`~/.config/sar-analyzer/web.env`, chmod 600)

| Variable | Inhalt |
|---|---|
| `SAR_WEB_API_SECRET` | HMAC für die Session-Tokens; neu erzeugt = alle Benutzer müssen sich neu anmelden |
| `SAR_BACKEND_DIR` | `~/data1/sarfile_analyzer_ng` |
| `UPLOAD_DIR` | `~/data1/sarfile_analyzer_ng/code/upload` — dasselbe Verzeichnis wie Streamlit und sar-api |
| `SAR_WEB_API_URL` | `http://127.0.0.1:8300`; wird auch beim Build gebraucht, `deploy.sh` setzt es dort |

Weitere Schalter (z. B. `SAR_WEB_SIGNUP=false`, Session-Dauer): siehe
`backend/README.md`. Nach einer Änderung: `systemctl --user restart
sar-web-api sar-web`.

## Reboot-Persistenz

| Unit | Autostart über |
|---|---|
| `sar-web-api.service` | `WantedBy=default.target`, Linger |
| `sar-web.service` | `WantedBy=default.target`, Linger |
| `nginx.service` (root) | schon für die Streamlit-UI aktiv |

```bash
systemctl --user is-active sar-web-api sar-web
```

## Backup

Nur `~/.config/sar-analyzer/web.env` (ohne Sicherung: neues Secret, alle
müssen sich neu anmelden). Alle Daten liegen bei sarfile_analyzer_ng und sind
dort im Backup.

## Troubleshooting

```bash
systemctl --user status sar-web-api sar-web
journalctl --user -u sar-web -n 50
journalctl --user -u sar-web-api -n 50
curl -s http://127.0.0.1:8300/api/v2/health
curl -s -o /dev/null -w '%{http_code}\n' http://127.0.0.1:3100/login
```

- **403 beim Login** → nginx reicht den Host ohne Port weiter
  (`$host` statt `$http_host`).
- **502 von nginx** → `sar-web` läuft nicht.
- **„SAR API is not reachable"** → `sar-web-api` läuft nicht.
- **Settings-Seite meldet 501** → sarfile_analyzer_ng ist zu alt
  (`git -C ~/data1/sarfile_analyzer_ng log -1`).
