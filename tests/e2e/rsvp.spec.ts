import { test, expect, type Page } from "@playwright/test";
import { existsSync } from "node:fs";
import { seedGuestSession, withTestDb } from "../helpers/database";
import type { Database } from "@/lib/db/server";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
const origin = "http://127.0.0.1:3200";
async function access(
  page: Page,
  db: Database,
  group: "group-1" | "group-2" = "group-1",
) {
  const guest = await seedGuestSession(group, db);
  await page
    .context()
    .addCookies([{ name: "wedding_guest", value: guest.cookie, url: origin }]);
  return guest;
}
const next = (page: Page) =>
  page.getByRole("button", { name: "Next", exact: true }).click();
async function fillContact(page: Page) {
  await page
    .getByRole("textbox", { name: "Full name", exact: true })
    .fill("Asha Jain");
  await page.getByRole("textbox", { name: /WhatsApp/ }).fill("+12025550123");
}
async function acceptance(page: Page) {
  await fillContact(page);
  await next(page);
  await page
    .getByRole("combobox", { name: "Number of guests" })
    .selectOption("3");
  await page.getByRole("button", { name: "Copy contact to Guest 1" }).click();
  await page
    .getByRole("textbox", { name: "Guest 2 full name" })
    .fill("Ravi Jain");
  await page
    .getByRole("textbox", { name: "Guest 3 full name" })
    .fill("Neha Jain");
  await next(page);
  await page.locator('input[type="checkbox"][value="haldi"]').check();
  await next(page);
  await page.getByLabel("Arrival date", { exact: true }).fill("2027-02-12");
  await page.getByLabel("Departure date", { exact: true }).fill("2027-02-14");
  await page.getByLabel("Approximate arrival time").selectOption("noon-5pm");
  await page
    .getByLabel("Approximate departure time")
    .selectOption("before-noon");
  await next(page);
}
async function declineReview(page: Page) {
  await fillContact(page);
  await page.getByRole("radio", { name: "Regretfully declines" }).check();
  await next(page);
}
async function submit(page: Page) {
  await page
    .getByRole("button", { name: "Submit response", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Your response is saved." }),
  ).toBeVisible();
}

test("three guests persist, secure link clears, edit/reload removes two guests and back avoids envelope", async ({
  page,
}) => {
  await withTestDb(async (db) => {
    await access(page, db);
    await page.goto("/invitation?opened=1");
    await page.getByRole("link", { name: "Send your response" }).click();
    await acceptance(page);
    await submit(page);
    expect(
      (
        await db`select full_name from wedding.rsvp_guests order by position`
      ).map((row) => row.full_name),
    ).toEqual(["Asha Jain", "Ravi Jain", "Neha Jain"]);
    const editPath = await page
      .getByRole("link", { name: "Open secure edit link" })
      .getAttribute("href");
    expect(editPath).toMatch(/^\/rsvp\/edit#[A-Za-z0-9_-]{43}$/);
    await page.getByRole("link", { name: "Open secure edit link" }).click();
    await expect(
      page.getByRole("textbox", { name: "Full name", exact: true }),
    ).toHaveValue("Asha Jain");
    expect(new URL(page.url()).hash).toBe("");
    await page.reload();
    await next(page);
    await expect(
      page.getByRole("textbox", { name: /Guest.*full name/ }),
    ).toHaveCount(3);
    await page
      .getByRole("combobox", { name: "Number of guests" })
      .selectOption("1");
    await next(page);
    await next(page);
    await next(page);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("heading", { name: "Your response is saved." }),
    ).toBeVisible();
    expect(
      (await db`select full_name from wedding.rsvp_guests`).map(
        (row) => row.full_name,
      ),
    ).toEqual(["Asha Jain"]);
    expect(
      (await db`select version from wedding.rsvp_submissions`)[0].version,
    ).toBe(2);
    await page.reload();
    await next(page);
    await expect(
      page.getByRole("textbox", { name: /Guest.*full name/ }),
    ).toHaveCount(1);
    await page.getByRole("link", { name: "Back to invitation" }).click();
    await expect(
      page.getByRole("button", { name: "Open invitation", exact: true }),
    ).toHaveCount(0);
  });
});
test("group two sees only six events and can save a decline without stale acceptance fields", async ({
  page,
}) => {
  await withTestDb(async (db) => {
    await access(page, db, "group-2");
    await page.goto("/rsvp");
    await fillContact(page);
    await next(page);
    await page.getByRole("button", { name: "Copy contact to Guest 1" }).click();
    await next(page);
    await expect(page.getByRole("checkbox")).toHaveCount(6);
    await expect(
      page.locator('input[type="checkbox"][value="mehendi"]'),
    ).toHaveCount(0);
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("button", { name: "Back", exact: true }).click();
    await page.getByRole("radio", { name: "Regretfully declines" }).check();
    await next(page);
    await submit(page);
    const [saved] =
      await db`select decision,arrival_date,song_name from wedding.rsvp_submissions`;
    expect(saved).toEqual({
      decision: "decline",
      arrival_date: null,
      song_name: null,
    });
    expect(await db`select id from wedding.rsvp_guests`).toHaveLength(0);
    expect(await db`select id from wedding.rsvp_event_selections`).toHaveLength(
      0,
    );
  });
});
test("delayed committed response then lost delivery retries original UUID/token/payload with one party", async ({
  page,
}) => {
  await withTestDb(async (db) => {
    await access(page, db);
    await page.goto("/rsvp");
    await declineReview(page);
    let release!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const bodies: string[] = [];
    let count = 0;
    await page.route("**/api/rsvp", async (route) => {
      bodies.push(route.request().postData()!);
      if (count++ === 0) {
        await route.fetch();
        await gate;
        await route.abort("failed");
      } else await route.continue();
    });
    await page.getByRole("button", { name: "Submit response" }).click();
    await expect
      .poll(async () =>
        Number(
          (await db`select count(*) from wedding.rsvp_submissions`)[0].count,
        ),
      )
      .toBe(1);
    await expect(page.getByRole("button", { name: "Saving…" })).toBeDisabled();
    await expect(page.getByText("Your response is saved.")).toHaveCount(0);
    release();
    await page.getByRole("button", { name: "Retry same response" }).click();
    await expect(
      page.getByRole("heading", { name: "Your response is saved." }),
    ).toBeVisible();
    expect(bodies).toHaveLength(2);
    expect(bodies[0]).toBe(bodies[1]);
    expect(await db`select id from wedding.rsvp_submissions`).toHaveLength(1);
  });
});
test("committed save with failed confirmation offers read retry and secure link without another create", async ({
  page,
}) => {
  await withTestDb(async (db) => {
    await access(page, db);
    await page.goto("/rsvp");
    await declineReview(page);
    let creates = 0;
    page.on("request", (request) => {
      if (
        request.method() === "POST" &&
        new URL(request.url()).pathname === "/api/rsvp"
      )
        creates++;
    });
    await page.route("**/api/rsvp/current", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: JSON.stringify({ code: "RSVP_UNAVAILABLE" }),
      }),
    );
    await submit(page);
    await expect(
      page.getByText(/could not load the confirmation/),
    ).toBeVisible();
    await expect(
      page.getByRole("link", { name: "Open secure edit link" }),
    ).toBeVisible();
    expect(await db`select id from wedding.rsvp_submissions`).toHaveLength(1);
    await page.unroute("**/api/rsvp/current");
    await page.getByRole("button", { name: "Try again", exact: true }).click();
    await expect(
      page.getByText(
        "Thank you. These are the details recorded for your party.",
      ),
    ).toBeVisible();
    expect(creates).toBe(1);
  });
});
test("stale edit conflicts and reloads authoritative data; failed load never becomes blank create", async ({
  page,
}) => {
  await withTestDb(async (db) => {
    await access(page, db);
    await page.goto("/rsvp");
    await declineReview(page);
    await submit(page);
    await page.getByRole("link", { name: "Open secure edit link" }).click();
    await expect(
      page.getByRole("textbox", { name: "Full name", exact: true }),
    ).toHaveValue("Asha Jain");
    const response = await page.request.patch("/api/rsvp/current", {
      headers: { origin },
      data: {
        expectedSubmissionId: (
          await db`select id from wedding.rsvp_submissions`
        )[0].id,
        expectedVersion: 1,
        response: {
          decision: "decline",
          contact: { fullName: "Ravi Jain", whatsapp: "+12025550123" },
        },
      },
    });
    expect(response.status()).toBe(200);
    await next(page);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByText("This response has changed. Reload before saving."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reload latest response" }).click();
    await expect(
      page.getByRole("textbox", { name: "Full name", exact: true }),
    ).toHaveValue("Ravi Jain");
    await page.route("**/api/rsvp/current", (route) =>
      route.fulfill({
        status: 503,
        contentType: "application/json",
        body: '{"code":"RSVP_UNAVAILABLE"}',
      }),
    );
    await page.reload();
    await expect(
      page.getByRole("heading", { name: "We could not open your response" }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Full name", exact: true }),
    ).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Submit response" }),
    ).toHaveCount(0);
  });
});
test("320px Hindi keeps field state, focuses errors and reaches actions; missing guest clears token", async ({
  page,
}) => {
  await withTestDb(async (db) => {
    await access(page, db);
    await page.setViewportSize({ width: 320, height: 740 });
    await page.goto("/rsvp");
    await page.getByRole("button", { name: "हिन्दी", exact: true }).click();
    await page.getByRole("button", { name: "आगे", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "पूरा नाम", exact: true }),
    ).toBeFocused();
    await expect(
      page.getByRole("textbox", { name: "पूरा नाम", exact: true }),
    ).toHaveAttribute("aria-invalid", "true");
    await page
      .getByRole("textbox", { name: "पूरा नाम", exact: true })
      .fill("Asha Jain");
    await page.getByRole("textbox", { name: /WhatsApp/ }).fill("+12025550123");
    await page.getByRole("button", { name: "आगे", exact: true }).click();
    await page
      .getByRole("textbox", { name: "मेहमान 1 का पूरा नाम" })
      .fill("Ravi Jain");
    await page.getByRole("button", { name: "English", exact: true }).click();
    await expect(
      page.getByRole("textbox", { name: "Guest 1 full name" }),
    ).toHaveValue("Ravi Jain");
    await page.getByRole("button", { name: "हिन्दी", exact: true }).click();
    await page.getByRole("button", { name: "आगे", exact: true }).click();
    await page.getByRole("checkbox").first().check();
    await page.getByRole("button", { name: "आगे", exact: true }).click();
    const button = page.getByRole("button", { name: "आगे", exact: true });
    await button.scrollIntoViewIfNeeded();
    await expect(button).toBeInViewport();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    page.on("dialog", (dialog) => dialog.accept());
    await page.context().clearCookies();
    await page.goto(`/rsvp/edit#${"a".repeat(43)}`);
    await expect(
      page.getByText(/Reopen your original invitation link first/),
    ).toBeVisible();
    expect(new URL(page.url()).hash).toBe("");
    await expect(page.getByRole("textbox")).toHaveCount(0);
  });
});

test("group two accepts eligible events and new deadline closure still permits secure edits", async ({
  page,
}) => {
  await withTestDb(async (db) => {
    await access(page, db, "group-2");
    await page.goto("/rsvp");
    await acceptance(page);
    await submit(page);
    const [saved] = await db`select id,group_id from wedding.rsvp_submissions`;
    expect(saved.group_id).toBe("group-2");
    expect(
      (
        await db`select event_id from wedding.rsvp_event_selections where submission_id=${saved.id}`
      ).map((row) => row.event_id),
    ).toEqual(["haldi"]);
    const path = await page
      .getByRole("link", { name: "Open secure edit link" })
      .getAttribute("href");
    await db`update wedding.site_settings set new_rsvp_closes_at=clock_timestamp()-interval '1 minute'`;
    await page.goto("/rsvp");
    await expect(
      page.getByText(
        "New responses are now closed. Existing responses can still be edited.",
      ),
    ).toBeVisible();
    await page.goto(path!);
    await expect(
      page.getByRole("textbox", { name: "Full name", exact: true }),
    ).toHaveValue("Asha Jain");
    await page.getByRole("radio", { name: "Regretfully declines" }).check();
    await next(page);
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(
      page.getByRole("heading", { name: "Your response is saved." }),
    ).toBeVisible();
    expect(
      (
        await db`select decision,version from wedding.rsvp_submissions where id=${saved.id}`
      )[0],
    ).toEqual({ decision: "decline", version: 2 });
  });
});

test("two tabs cannot overwrite another party after its edit cookie replaces the first", async ({
  page,
}) => {
  await withTestDb(async (db) => {
    await access(page, db);
    await page.goto("/rsvp");
    await declineReview(page);
    await submit(page);
    await page.getByRole("link", { name: "Open secure edit link" }).click();
    await expect(
      page.getByRole("textbox", { name: "Full name", exact: true }),
    ).toHaveValue("Asha Jain");
    await page
      .getByRole("textbox", { name: "Note (optional)" })
      .fill("Only for party A");
    await next(page);
    const other = await page.context().newPage();
    await other.goto("/rsvp");
    await fillContact(other);
    await other
      .getByRole("textbox", { name: "Full name", exact: true })
      .fill("Ravi Jain");
    await other.getByRole("radio", { name: "Regretfully declines" }).check();
    await next(other);
    await submit(other);
    await other.getByRole("link", { name: "Open secure edit link" }).click();
    await expect(
      other.getByRole("textbox", { name: "Full name", exact: true }),
    ).toHaveValue("Ravi Jain");
    const response = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/rsvp/current") &&
        response.request().method() === "PATCH",
    );
    await page.getByRole("button", { name: "Save changes" }).click();
    expect((await response).status()).toBe(409);
    await expect(
      page.getByText("This response has changed. Reload before saving."),
    ).toBeVisible();
    await page.getByRole("button", { name: "Reload latest response" }).click();
    await expect(
      page.getByText("Please open your invitation link again."),
    ).toBeVisible();
    expect(
      await db`select contact_full_name,version,note from wedding.rsvp_submissions order by contact_full_name`,
    ).toEqual([
      { contact_full_name: "Asha Jain", version: 1, note: null },
      { contact_full_name: "Ravi Jain", version: 1, note: null },
    ]);
    await other.close();
  });
});
