@AGENTS.md

# sarfile_analyzer_web

Next.js frontend plus sar-web-api (`backend/`, FastAPI `/api/v2`) for
jschaef/sarfile_analyzer_ng, whose code sar-web-api imports (checkout at
`../sarfile_analyzer_ng`, its venv). Full background, history and the lab
setup: [`docs/knowledge.md`](docs/knowledge.md) – read it before larger changes.

## Working rules (Jochen)

- Talk to Jochen in German; code, comments and commit messages in English;
  PR descriptions and lab docs in German.
- Small topic commits, only after the tests pass. No `Co-Authored-By`
  trailer; end with the `Claude-Session:` line.
- Never push to `main`, never merge, open PRs only when asked, don't watch
  them. Jochen merges himself.
- Change sarfile_analyzer_ng only when asked, on the session branch, with
  `--author="Jochen Schäfer <jochen.schaefer@suse.com>"`.
- `code/data.db` in git stays the seed (admin/password + headings/metrics);
  tests use a copy. No real sar files in git – use `scripts/generate_sar.py`.

## Checks before a commit

```bash
(cd backend && python -m pytest)          # in the venv of sarfile_analyzer_ng
npm run lint && npm run typecheck
npm run build                             # default API URL, not the lab's :8300
npx playwright test                       # uses the production build
```

Cloud sessions: `PLAYWRIGHT_CHROMIUM_EXECUTABLE=/opt/pw-browsers/chromium` and
the sarfile_analyzer_ng venv on `PATH`.

## Pitfalls

- Next.js 16: `proxy.ts` is the middleware; it buffers and cuts bodies at
  10 MB, so uploads use `app/api/upload/route.ts` outside its matcher.
- `SAR_WEB_API_URL` is baked into the `/api/v2` rewrite at build time.
- Login/signup compare `Origin` with the Host header: a reverse proxy must
  pass the host with its port (`$http_host` in nginx).
- Old routes stay hidden in the DOM (Activity): Playwright locators need
  `.filter({ visible: true })`.
- Runtime settings live in sarfile_analyzer_ng's `config.EDITABLE_SETTINGS`;
  the Settings page shows only groups the installed version knows.
