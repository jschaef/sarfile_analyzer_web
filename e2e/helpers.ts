import { readFile } from "node:fs/promises";
import { expect, type Download, type Locator, type Page } from "@playwright/test";

export const USER = process.env.SAR_E2E_USER ?? "admin";
export const PASSWORD = process.env.SAR_E2E_PASSWORD ?? "password";

export async function login(page: Page) {
  await page.goto("/overview");
  await expect(page).toHaveURL(/\/login\?next=%2Foverview/);
  await page.getByLabel("Username").fill(USER);
  await page.getByLabel("Password").fill(PASSWORD);
  await page.getByRole("button", { name: "Sign in" }).click();
  await expect(page).toHaveURL(/\/overview/);
  await expect(page.getByTestId("current-user")).toHaveText(USER);
}

// Uploads one file on the Files page and returns the name the API gave it.
export async function upload(page: Page, path: string, hostPart: string): Promise<string> {
  // the main navigation - an empty overview shows a second link with that name
  await page.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Manage SAR Files" }).click();
  await expect(page).toHaveURL(/\/files/);
  await page.getByTestId("upload-input").setInputFiles(path);
  await expect(page.getByText(/^Uploaded as /).first()).toBeVisible({ timeout: 90_000 });
  const row = page.getByTestId("file-row").filter({ hasText: hostPart }).first();
  await expect(row).toBeVisible();
  return (await row.getAttribute("data-file")) ?? "";
}

export async function deleteFile(page: Page, name: string) {
  await page.goto("/files");
  const row = page.locator(`[data-testid=file-row][data-file="${name}"]`);
  await row.getByTestId("delete-file").click();
  await row.getByTestId("confirm-delete").click();
  await expect(row).toHaveCount(0);
}

export function renderedCharts(page: Page) {
  return page.locator("[data-testid=echart][data-state=rendered]");
}

// The ECharts toolbox is painted on the canvas, so the "Save PDF" icon can
// only be reached by position: it is the right-most of the five icons of
// lib/echarts-option.ts (toolbox right: 8, top: 28). The offsets are measured
// against ECharts 6 - if it ever lays the toolbox out differently, this click
// misses and the test says so.
export async function savePdf(page: Page, chart: Locator): Promise<Download> {
  const box = await chart.boundingBox();
  if (!box) throw new Error("chart not visible");
  const [download] = await Promise.all([
    page.waitForEvent("download"),
    page.mouse.click(box.x + box.width - 32, box.y + 50),
  ]);
  return download;
}

// Reads a downloaded PDF and checks that it is one at all.
async function pdfBytes(download: Download): Promise<string> {
  const bytes = await readFile(await download.path());
  expect(bytes.subarray(0, 4).toString("latin1")).toBe("%PDF");
  return bytes.toString("latin1");
}

export async function pdfPages(download: Download): Promise<number> {
  return ((await pdfBytes(download)).match(/\/Type\s*\/Page(?!s)/g) ?? []).length;
}

// The text of a PDF in page order. jsPDF writes it as plain "(text) Tj"
// operators, so no PDF library is needed to check titles and their order.
export async function pdfText(download: Download): Promise<string[]> {
  const matches = (await pdfBytes(download)).matchAll(/\((?:\\.|[^()\\])*\)\s*Tj/g);
  return [...matches].map((match) =>
    match[0].slice(1, match[0].lastIndexOf(")")).replace(/\\([()\\])/g, "$1"),
  );
}
