import { defineConfig, devices } from "@playwright/test";

// The e2e test needs both servers: sar-web-api from backend/ (port 8200) and
// this Next.js app (port 3100, production build: run `npm run build` first).
// Already running servers are reused. sar-web-api needs the sarfile_analyzer_ng
// checkout (SAR_BACKEND_DIR, default ../sarfile_analyzer_ng), its venv on the
// PATH and UPLOAD_DIR / SAR_WEB_API_SECRET in the environment. Set
// SAR_E2E_SKIP_API=1 to never start the API from here, or SAR_E2E_API_CMD to
// change how it is started. The default command runs the API on a temporary
// copy of the seed data.db: the account tests sign up users and edit tables.
// A reused, already running API must therefore never be a production one.
const apiCommand = process.env.SAR_E2E_API_CMD ?? "python -m sar_web_api.e2e_server --port 8200";
const port = Number(process.env.PORT ?? 3100);

export default defineConfig({
  testDir: "./e2e",
  timeout: 120_000,
  expect: { timeout: 30_000 },
  fullyParallel: false,
  workers: 1,
  reporter: [["list"]],
  use: {
    baseURL: `http://127.0.0.1:${port}`,
    trace: "retain-on-failure",
    viewport: { width: 1280, height: 900 },
    launchOptions: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE
      ? { executablePath: process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE }
      : {},
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 900 } } }],
  webServer: [
    ...(process.env.SAR_E2E_SKIP_API
      ? []
      : [
          {
            command: apiCommand,
            cwd: "backend",
            url: "http://127.0.0.1:8200/api/v2/health",
            reuseExistingServer: true,
            timeout: 120_000,
          },
        ]),
    {
      command: `npx next start -p ${port}`,
      url: `http://127.0.0.1:${port}/login`,
      reuseExistingServer: true,
      timeout: 120_000,
      // plain HTTP in tests: the session cookie must not be Secure
      env: { SAR_COOKIE_SECURE: "false" },
    },
  ],
});
