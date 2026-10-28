import fs from "node:fs";
import path from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { deleteFile, login, upload } from "./helpers";

const SMALL_FIXTURE = path.join(__dirname, "fixtures", "sar_small.txt");

// One login and two uploads for all analysis views: the small fixture and a
// copy shifted to the next day (for "Multiple SAR Files").
test.describe.serial("analysis views", () => {
  let page: Page;
  let day1 = "";
  let day2 = "";

  test.beforeAll(async ({ browser }, testInfo) => {
    page = await browser.newPage();
    await login(page);
    day1 = await upload(page, SMALL_FIXTURE, "synthetic-host_2026-10-01");
    const nextDay = testInfo.outputPath("sar_small_day2.txt");
    fs.writeFileSync(nextDay, fs.readFileSync(SMALL_FIXTURE, "utf8").replace("\t2026-10-01 \t", "\t2026-10-02 \t"));
    day2 = await upload(page, nextDay, "synthetic-host_2026-10-02");
  });

  test.afterAll(async () => {
    for (const name of [day1, day2]) if (name) await deleteFile(page, name);
    await page.close();
  });

  function rendered(scope: string) {
    return page.locator(`${scope} [data-testid=echart][data-state=rendered]`);
  }

  test("analyze navigation keeps the chosen file", async () => {
    await page.goto(`/overview?file=${encodeURIComponent(day1)}`);
    const nav = page.getByTestId("analyze-nav");
    await nav.getByRole("link", { name: "Detailed Metrics" }).click();
    await expect(page).toHaveURL(new RegExp(`/details\\?file=${day1}`));
    // the previous route stays mounted but hidden (Activity): check the visible picker
    await expect(page.getByTestId("file-select").filter({ visible: true })).toHaveValue(day1);
    await expect(nav.getByRole("link", { name: "Detailed Metrics" })).toHaveAttribute("aria-current", "page");
  });

  test("detailed metrics: one metric, summary, data tab", async () => {
    await page.goto(`/details?file=${encodeURIComponent(day1)}`);
    await expect(page.getByTestId("details-title")).toHaveText("CPU · all of 4 · %usr");
    await expect(rendered("[data-testid=details-card]")).toHaveCount(1);

    await page.getByLabel("Device").selectOption("2");
    await page.getByLabel("Metric").selectOption("%sys");
    await expect(page.getByTestId("details-title")).toHaveText("CPU · 2 · %sys");
    await expect(rendered("[data-testid=details-card]")).toHaveCount(1);

    await page.getByRole("button", { name: "Summary (all metrics)" }).click();
    await expect(page.getByTestId("details-title")).toHaveText("CPU · 2");
    await page.getByRole("tab", { name: "Data" }).click();
    const table = page.getByTestId("data-table");
    await expect(table).toContainText("96 samples · 1 restart(s)");
    await expect(table).toContainText("%idle");

    // a heading without devices has no device picker
    await page.getByLabel("Sar heading").selectOption("Load");
    await expect(page.getByTestId("details-title")).toHaveText("Load");
    await expect(page.getByLabel("Device")).toHaveCount(0);
  });

  test("metrics on many devices: threshold, matches, chart", async () => {
    await page.goto(`/devices?file=${encodeURIComponent(day1)}`);
    await expect(page.getByLabel("Sar heading")).toHaveValue("CPU");
    await page.getByLabel("Min").fill("40");
    await page.getByLabel("Max").fill("60");
    await page.getByTestId("find-devices").click();
    const matches = page.getByTestId("device-matches");
    await expect(matches).toContainText(/matches on \d+ device\(s\)/);
    await expect(page.getByTestId("device-row").first()).toHaveAttribute("data-device", "all");

    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByTestId("show-device-chart").click();
    await expect(rendered("[data-testid=device-chart]")).toHaveCount(1);
  });

  test("compare metrics: several headings in one chart", async () => {
    await page.goto(`/compare?file=${encodeURIComponent(day1)}`);
    await expect(page.getByTestId("compare-slot")).toHaveCount(3);
    await page.getByLabel("Heading 2").selectOption("Load");
    await page.getByLabel("Heading 3").selectOption("Memory utilization");
    await page.locator("#slot-2-metric").selectOption("%memused");
    await page.getByTestId("add-slot").click();
    await expect(page.getByTestId("compare-slot")).toHaveCount(4);
    const card = page.getByTestId("compare-card");
    await expect(card).toContainText("Load runq-sz");
    await expect(card).toContainText("Memory utilization %memused");
    await expect(rendered("[data-testid=compare-card]")).toHaveCount(1);
  });

  test("multiple files: overlay, consecutive days, summary", async () => {
    await page.goto("/multi");
    await page.getByLabel(day1).check();
    await page.getByLabel(day2).check();
    await page.getByTestId("compare-files").click();
    const diagram = page.getByTestId("multi-diagram");
    await expect(diagram).toContainText("2 file(s) laid over one 24-hour axis");
    await expect(rendered("[data-testid=multi-diagram]")).toHaveCount(1);
    // the overlay's day is a placeholder (1970-01-01): the tooltip shows the clock time only
    const chart = diagram.locator("[data-testid=echart]");
    const box = (await chart.boundingBox())!;
    await chart.hover({ position: { x: box.width / 2, y: box.height / 2 } });
    const tooltip = chart.getByText(/^\d{2}:\d{2}:\d{2}$/);
    await expect(tooltip.first()).toBeVisible();
    await expect(chart).not.toContainText("1970");

    await page.getByRole("tab", { name: "Statistics" }).click();
    await expect(page.getByTestId("combined-statistics")).toContainText("All 2 files together");
    await page.getByRole("tab", { name: "Chart" }).click();

    await page.getByTestId("consecutive").check();
    await expect(diagram).toContainText("2 file(s) on the real time axis");
    await expect(rendered("[data-testid=multi-diagram]")).toHaveCount(1);

    await page.getByRole("button", { name: "Summary" }).click();
    await expect(page.getByTestId("multi-summary")).toHaveCount(2);
    await expect(rendered("[data-testid=multi-summary]")).toHaveCount(2);
  });
});

// Without JavaScript the browser posts the login form natively. Next.js keeps
// Suspense content hidden until its script runs, so the post is sent directly.
test.describe("login form post", () => {
  test("the form posts to the route handler", async ({ page }) => {
    await page.goto("/login?next=%2Fdetails");
    const form = page.getByTestId("login-form");
    await expect(form).toHaveAttribute("method", "post");
    await expect(form).toHaveAttribute("action", "/api/auth/login");
    await expect(form.locator("input[name=next]")).toHaveValue("/details");
  });

  test("redirects with a session cookie, never puts the password in the URL", async ({ page, baseURL }) => {
    const post = (password: string, origin = baseURL!) =>
      page.request.post("/api/auth/login", {
        form: { username: "admin", password, next: "/details" },
        headers: { origin },
        maxRedirects: 0,
      });

    const wrong = await post("definitely-wrong");
    expect(wrong.status()).toBe(303);
    expect(wrong.headers().location).toBe("/login?error=invalid&next=%2Fdetails");
    expect(wrong.headers()["set-cookie"]).toBeUndefined();

    const crossSite = await post("password", "https://evil.example");
    expect(crossSite.status()).toBe(403);

    const ok = await post("password");
    expect(ok.status()).toBe(303);
    expect(ok.headers().location).toBe("/details");
    expect(ok.headers()["set-cookie"]).toMatch(/^sar_session=.+; .*HttpOnly/i);

    await page.goto("/login?error=invalid&next=%2Fdetails");
    await expect(page.getByText("Invalid username or password")).toBeVisible();
  });
});
