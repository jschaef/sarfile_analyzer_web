import fs from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import { deleteFile, login, upload } from "./helpers";

const SMALL_FIXTURE = path.join(__dirname, "fixtures", "sar_small.txt");

// Several files at once: filter, select the shown ones, delete the selection.
// The search keeps "select all" to the test's own files - the account may
// hold other uploads.
test("select and delete several files", async ({ page }, testInfo) => {
  await login(page);
  const names: Record<string, string> = {};
  for (const host of ["bulk-keep", "bulk-drop-1", "bulk-drop-2"]) {
    const copy = testInfo.outputPath(`${host}.txt`);
    fs.writeFileSync(copy, fs.readFileSync(SMALL_FIXTURE, "utf8").replace("(synthetic-host)", `(${host})`));
    names[host] = await upload(page, copy, host);
  }
  const row = (host: string) => page.locator(`[data-testid=file-row][data-file="${names[host]}"]`);
  const deleteSelected = page.getByTestId("delete-selected");
  const selectAll = page.getByTestId("select-all-files");
  await expect(deleteSelected).toBeDisabled();

  // the search narrows the table; "all" selects only what it shows
  await page.getByLabel("Search files").fill("bulk-drop");
  await expect(page.getByTestId("file-row")).toHaveCount(2);
  await selectAll.check();
  await expect(deleteSelected).toHaveText(/Delete selected \(2\)/);

  // unchecking one leaves the header box half set
  await row("bulk-drop-2").getByRole("checkbox").uncheck();
  await expect(selectAll).not.toBeChecked();
  expect(await selectAll.evaluate((el) => (el as HTMLInputElement).indeterminate)).toBe(true);
  await row("bulk-drop-2").getByRole("checkbox").check();
  await expect(selectAll).toBeChecked();

  // ask first, then delete both
  await deleteSelected.click();
  await page.getByRole("button", { name: "Cancel" }).click();
  await expect(row("bulk-drop-1")).toBeVisible();
  await deleteSelected.click();
  await page.getByTestId("confirm-delete-selected").click();
  await expect(page.getByText("2 file(s) deleted")).toBeVisible();
  await expect(page.getByText('No file matches "bulk-drop".')).toBeVisible();

  await page.getByLabel("Search files").fill("");
  await expect(row("bulk-keep")).toBeVisible();
  await expect(row("bulk-drop-1")).toHaveCount(0);
  await expect(row("bulk-drop-2")).toHaveCount(0);
  await expect(deleteSelected).toHaveText(/Delete selected \(0\)/);
  await deleteFile(page, names["bulk-keep"]);
});
