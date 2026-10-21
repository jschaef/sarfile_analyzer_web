import path from "node:path";
import { expect, test } from "@playwright/test";
import { deleteFile, login, renderedCharts, upload } from "./helpers";

// Documentation screenshots (synthetic data only):
//   SAR_SCREENSHOTS_DIR=docs/screenshots npx playwright test screenshots
const outDir = process.env.SAR_SCREENSHOTS_DIR;
const width = Number(process.env.SAR_SCREENSHOTS_WIDTH ?? 1280);

test.skip(!outDir, "SAR_SCREENSHOTS_DIR not set");

for (const scheme of ["light", "dark"] as const) {
  test(`screenshots ${scheme}`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.setViewportSize({ width, height: 900 });

    await page.goto("/login");
    await expect(page.getByLabel("Username")).toBeVisible();
    await page.screenshot({ path: path.join(outDir!, `login-${scheme}-${width}.png`) });

    await login(page);
    const name = await upload(page, path.join(__dirname, "fixtures", "sar_small.txt"), "synthetic-host");
    await page.goto(`/overview?file=${encodeURIComponent(name)}`);
    await page.getByTestId("show-diagrams").click();
    await expect(renderedCharts(page)).toHaveCount(5);
    await page.screenshot({ path: path.join(outDir!, `overview-${scheme}-${width}.png`), fullPage: true });

    const shot = async (view: string, card: string) => {
      await expect(page.locator(`[data-testid=${card}] [data-testid=echart][data-state=rendered]`)).toHaveCount(1);
      await page.screenshot({ path: path.join(outDir!, `${view}-${scheme}-${width}.png`), fullPage: true });
    };
    const file = `?file=${encodeURIComponent(name)}`;
    await page.goto(`/details${file}`);
    await shot("details", "details-card");

    await page.goto(`/devices${file}`);
    await page.getByLabel("Min").fill("40");
    await page.getByLabel("Max").fill("60");
    await page.getByTestId("find-devices").click();
    await page.getByRole("button", { name: "Select all" }).click();
    await page.getByTestId("show-device-chart").click();
    await shot("devices", "device-chart");

    await page.goto(`/compare${file}`);
    await page.getByLabel("Heading 2").selectOption("Load");
    await shot("compare", "compare-card");

    await page.goto("/admin/users");
    await expect(page.getByTestId("login-row").first()).toBeVisible();
    await page.screenshot({ path: path.join(outDir!, `admin-users-${scheme}-${width}.png`), fullPage: true });
    await page.goto("/admin/database");
    await expect(page.getByTestId("metric-row").first()).toBeVisible();
    await page.screenshot({ path: path.join(outDir!, `admin-database-${scheme}-${width}.png`) });

    await deleteFile(page, name);
  });
}
