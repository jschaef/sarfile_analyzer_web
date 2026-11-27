import path from "node:path";
import { expect, test } from "@playwright/test";
import { deleteFile, login, pdfPages, pdfText, renderedCharts, savePdf, upload } from "./helpers";

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

test("the overview button downloads one PDF with a page per diagram", async ({ page }) => {
  await login(page);
  const name = await upload(page, SMALL_FIXTURE, "synthetic-host");

  await page.goto(`/overview?file=${encodeURIComponent(name)}`);
  // two aliases: Block Devices has one chart per device, CPU one -> 3 pages
  await page.getByRole("button", { name: "Deselect all" }).click();
  await page.getByRole("button", { name: "CPU", exact: true }).click();
  await page.getByRole("button", { name: "Block Devices", exact: true }).click();
  await page.getByTestId("show-diagrams").click();
  await expect(renderedCharts(page)).toHaveCount(3);

  const button = page.getByTestId("multi-pdf");
  await expect(button).toHaveAttribute("data-charts", "3");

  const [download] = await Promise.all([page.waitForEvent("download"), button.click()]);
  expect(download.suggestedFilename()).toBe(`${name}_diagrams.pdf`);
  expect(await pdfPages(download)).toBe(3);
  // the pages follow the option order of the aliases, not the click order
  const titles = (await pdfText(download)).filter((line) => line !== name);
  expect(titles).toEqual(["Block Devices nvme0n1", "Block Devices sda", "CPU (all of 4)"]);

  await deleteFile(page, name);
});

test("the go-to-bottom link jumps to the PDF button", async ({ page }) => {
  await login(page);
  const name = await upload(page, SMALL_FIXTURE, "synthetic-host");

  await page.goto(`/overview?file=${encodeURIComponent(name)}`);
  // without diagrams there is nothing below, so the link stays away
  await expect(page.getByTestId("go-to-bottom")).toHaveCount(0);

  await page.getByTestId("show-diagrams").click();
  await expect(renderedCharts(page)).toHaveCount(5);
  await expect(page.getByTestId("multi-pdf")).not.toBeInViewport();

  await page.getByTestId("go-to-bottom").click();
  await expect(page).toHaveURL(/#bottom$/);
  // what the jump is for: the collective PDF button at the end of the page
  await expect(page.getByTestId("multi-pdf")).toBeInViewport();

  await deleteFile(page, name);
});
