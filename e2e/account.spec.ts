import { expect, test, type Browser, type Page } from "@playwright/test";
import path from "node:path";
import { deleteFile, PASSWORD, upload, USER } from "./helpers";

// Signup, Self Service, the admin pages and Info. Writes to data.db: run it
// against the API started by playwright.config.ts (python -m
// sar_web_api.e2e_server, a temporary copy of the seed DB), never against a
// production API.
test.describe.serial("accounts and admin", () => {
  const name = `e2e-${Date.now().toString(36)}`;
  let user: Page;
  let admin: Page;

  async function signIn(browser: Browser, username: string, password: string) {
    const page = await browser.newPage();
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Username").fill(username);
    await page.getByLabel("Password").fill(password);
    await page.getByRole("button", { name: "Sign in" }).click();
    await expect(page).toHaveURL(/\/overview/);
    await expect(page.getByTestId("current-user")).toHaveText(username);
    return page;
  }

  test.afterAll(async () => {
    await user?.close();
    await admin?.close();
  });

  test("sign up from the login page", async ({ browser }) => {
    user = await browser.newPage();
    await user.goto("/login");
    await expect(user.getByTestId("help-note")).toContainText("Forgot your password? Ask");
    await user.getByRole("link", { name: "Create one" }).click();
    await expect(user).toHaveURL(/\/signup$/);
    await user.waitForLoadState("networkidle");

    await user.getByLabel("Username").fill(name);
    await user.getByLabel("Password", { exact: true }).fill("first-pw");
    await user.getByLabel("Repeat password").fill("other-pw");
    await user.getByRole("button", { name: "Create account" }).click();
    await expect(user.getByText("The passwords do not match")).toBeVisible();

    await user.getByLabel("Repeat password").fill("first-pw");
    await user.getByRole("button", { name: "Create account" }).click();
    await expect(user).toHaveURL(/\/overview/);
    await expect(user.getByTestId("current-user")).toHaveText(name);
    // a normal user has no admin menu, and the admin pages refuse
    const nav = user.getByRole("navigation", { name: "Main" });
    await expect(nav.getByRole("link", { name: "Info" })).toBeVisible();
    await expect(nav.getByRole("link", { name: "Admin" })).toHaveCount(0);
    await user.goto("/admin/users");
    await expect(user.getByTestId("admin-error")).toContainText("Admins only");
  });

  test("the same name cannot sign up twice", async ({ page }) => {
    const response = await page.request.post("/api/auth/signup", {
      data: { username: name, password: "x" },
    });
    expect(response.status()).toBe(409);
    expect((await response.json()).detail).toBe(`User ${name} already exists`);

    // the form posted without JavaScript: redirects back with the error
    const form = (repeat: string) =>
      page.request.post("/api/auth/signup", {
        form: { username: name, password: "x", repeat },
        maxRedirects: 0,
      });
    const mismatch = await form("y");
    expect(mismatch.status()).toBe(303);
    expect(mismatch.headers().location).toBe("/signup?error=The+passwords+do+not+match");
    const duplicate = await form("x");
    expect(duplicate.headers().location).toBe(`/signup?error=User+${name}+already+exists`);
    expect(duplicate.headers()["set-cookie"]).toBeUndefined();
  });

  test("self service: change your own password", async ({ browser }) => {
    await user.getByTestId("current-user").click();
    await expect(user).toHaveURL(/\/account$/);
    await user.getByLabel("Current password").fill("wrong");
    await user.getByLabel("New password", { exact: true }).fill("second-pw");
    await user.getByLabel("Repeat new password").fill("second-pw");
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.getByText("The current password is wrong")).toBeVisible();

    await user.getByLabel("Current password").fill("first-pw");
    await user.getByRole("button", { name: "Change password" }).click();
    await expect(user.getByText("Your password has been changed")).toBeVisible();

    const again = await signIn(browser, name, "second-pw");
    await again.close();
  });

  test("user management: role, password, login history", async ({ browser }) => {
    admin = await signIn(browser, USER, PASSWORD);
    await admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" }).click();
    await expect(admin).toHaveURL(/\/admin\/users$/);
    const row = admin.locator(`[data-testid=user-row][data-user="${name}"]`);
    await expect(row).toBeVisible();
    // your own row: no role change, no delete
    const own = admin.locator(`[data-testid=user-row][data-user="${USER}"]`);
    await expect(own.getByRole("combobox")).toBeDisabled();
    await expect(own.getByTestId("delete-user")).toHaveCount(0);

    await row.getByRole("combobox").selectOption("admin");
    await expect(admin.getByText(`Role admin set for ${name}`)).toBeVisible();
    // the user's open session gets the admin menu without a new login
    await user.goto("/overview");
    await expect(user.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Admin" })).toBeVisible();

    await row.getByTestId("set-password").click();
    await admin.getByLabel(`New password for ${name}`).fill("third-pw");
    await admin.getByLabel("Repeat").fill("third-pw");
    await admin.getByRole("button", { name: "Save password" }).click();
    await expect(admin.getByText(`Password of ${name} has been changed`)).toBeVisible();

    const history = admin.getByTestId("login-history");
    await history.getByLabel("User").selectOption(name);
    await expect(history.getByTestId("login-row").first()).toContainText(name);
  });

  test("user management: delete the user", async () => {
    await admin.goto("/admin/users");
    const row = admin.locator(`[data-testid=user-row][data-user="${name}"]`);
    await row.getByTestId("delete-user").click();
    await row.getByTestId("confirm-delete-user").click();
    await expect(row).toHaveCount(0);
    // the deleted user's session ends with the next request
    await user.goto("/files");
    await expect(user).toHaveURL(/\/login/);
  });

  test("db management: add, find and delete a metric", async () => {
    const metric = `e2e_${Date.now().toString(36)}/s`;
    await admin.goto("/admin/database");
    const form = admin.getByTestId("add-metric-form");
    await form.getByLabel("Metric").fill(metric);
    await form.getByLabel("Description").fill("written by the e2e test");
    await form.getByRole("button", { name: "Add metric" }).click();
    const row = admin.locator(`[data-testid=metric-row][data-metric="${metric}"]`);
    await expect(row).toContainText("written by the e2e test");
    await expect(admin.getByTestId("metric-row")).toHaveCount(1); // the search is set to the new metric

    await row.getByRole("checkbox").check();
    await admin.getByTestId("delete-metrics").click();
    await admin.getByTestId("confirm-delete-metrics").click();
    await expect(row).toHaveCount(0);
  });

  test("db management: add, edit and delete a heading", async () => {
    await admin.goto("/admin/database");
    await admin.getByRole("tab", { name: "Headings" }).click();
    await admin.getByTestId("add-heading").click();
    const form = admin.getByTestId("heading-form");
    await form.getByLabel(/^Header/).fill("e2efoo/s e2ebar/s");
    await form.getByLabel("Alias").fill("E2E heading");
    await form.getByLabel("Description").fill("test");
    await form.getByRole("button", { name: "Add heading" }).click();
    const row = admin.locator('[data-testid=heading-row][data-alias="E2E heading"]');
    await expect(row).toContainText("e2efoo/s e2ebar/s");

    await row.getByTestId("edit-heading").click();
    await admin.getByTestId("heading-form").getByLabel("Alias").fill("E2E heading 2");
    await admin.getByTestId("heading-form").getByRole("button", { name: "Save" }).click();
    await admin.getByLabel("Search headings").fill("e2efoo");
    const renamed = admin.locator('[data-testid=heading-row][data-alias="E2E heading 2"]');
    await expect(renamed).toBeVisible();

    await renamed.getByTestId("delete-heading").click();
    await renamed.getByTestId("confirm-delete-heading").click();
    await expect(admin.getByTestId("heading-row")).toHaveCount(0);
  });

  test("settings: contact and limits apply at once", async () => {
    // start from the environment values, also after an aborted earlier run
    const reset = await admin.request.put("/api/v2/admin/settings", {
      data: { values: { admin_email: null, max_header_count: null, web_frontend_url: null } },
    });
    expect(reset.ok()).toBe(true);
    await admin.goto("/admin/settings");
    const contact = admin.locator("[data-testid=settings-group][data-group=Contact]");
    await contact.getByLabel("Admin e-mail").fill("sar-team@example.org");
    await contact.getByRole("button", { name: "Save", exact: true }).click();
    await expect(admin.getByText("Contact saved")).toBeVisible();
    const email = admin.locator("[data-testid=setting][data-setting=admin_email]");
    await expect(email.getByText("set here")).toBeVisible();

    const views = admin.locator('[data-testid=settings-group][data-group="Analysis views"]');
    await views.getByLabel("Metrics in Compare Metrics").fill("4");
    await views.getByRole("button", { name: "Save", exact: true }).click();
    await expect(admin.getByText("Analysis views saved")).toBeVisible();

    // the login page of a fresh visitor and Compare Metrics follow
    const visitor = await admin.context().browser()!.newPage();
    await visitor.goto("/login");
    await expect(visitor.getByTestId("help-note")).toContainText("sar-team@example.org");
    await visitor.close();
    const file = await upload(admin, path.join(__dirname, "fixtures", "sar_small.txt"), "synthetic-host");
    await admin.goto(`/compare?file=${encodeURIComponent(file)}`);
    await expect(admin.getByText("Up to 4 combinations")).toBeVisible();
    await deleteFile(admin, file);

    // Reset: back to the environment / default
    await admin.goto("/admin/settings");
    await email.getByRole("button", { name: "Reset" }).click();
    await expect(email.getByText("set here")).toHaveCount(0);
    await admin
      .locator("[data-testid=setting][data-setting=max_header_count]")
      .getByRole("button", { name: "Reset" })
      .click();
    await expect(admin.getByRole("button", { name: "Reset" })).toHaveCount(0);

    // the link the Streamlit app shows in its sidebar
    const streamlit = admin.locator('[data-testid=settings-group][data-group="Streamlit app"]');
    await streamlit.getByLabel("Link to this web frontend").fill("https://sar.example.org:8444");
    await streamlit.getByRole("button", { name: "Save", exact: true }).click();
    await expect(admin.getByText("Streamlit app saved")).toBeVisible();
    const link = admin.locator("[data-testid=setting][data-setting=web_frontend_url]");
    await expect(link.getByText("set here")).toBeVisible();
    await link.getByRole("button", { name: "Reset" }).click();
    await expect(link.getByText("set here")).toHaveCount(0);
  });

  test("redis management and info", async () => {
    await admin.goto("/admin/redis");
    await expect(admin.getByTestId("redis-unavailable").or(admin.getByTestId("redis-keys"))).toBeVisible();
    await admin.getByRole("navigation", { name: "Main" }).getByRole("link", { name: "Info" }).click();
    await expect(admin.getByTestId("faq")).toContainText("I forgot my password");
    await expect(admin.getByTestId("admin-contact").first()).toContainText("@");
  });
});
