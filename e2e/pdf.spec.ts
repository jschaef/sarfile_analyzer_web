import path from "node:path";
import { expect, test } from "@playwright/test";
import { deleteFile, login, pdfPages, renderedCharts, savePdf, upload } from "./helpers";

const SMALL_FIXTURE = path.join(__dirname, "fixtures", "sar_small.txt");

test("the toolbox icon downloads a PDF of a single chart", async ({ page }) => {
  await login(page);
  const name = await upload(page, SMALL_FIXTURE, "synthetic-host");

  await page.goto(`/overview?file=${encodeURIComponent(name)}`);
  await page.getByTestId("show-diagrams").click();
  await expect(renderedCharts(page)).toHaveCount(5);

  const cpu = page.locator("[data-testid=chart-card][data-alias=CPU]");
  const download = await savePdf(page, cpu.getByTestId("echart"));
  // <file>_<alias>_<device>.pdf, like the Streamlit overview
  expect(download.suggestedFilename()).toBe(`${name}_CPU_all.pdf`);
  expect(await pdfPages(download)).toBe(1);

  await deleteFile(page, name);
});
