import { existsSync } from "node:fs";
import { randomBytes, randomUUID } from "node:crypto";
import { expect, test } from "@playwright/test";
import {
  seedOrganizer,
  seedGuestSession,
  withTestDb,
} from "../helpers/database";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
test("real organizer login, literal search, edit, manual deadline reply and logout; guest denied", async ({
  page,
}) =>
  withTestDb(async (db) => {
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
    expect((await page.request.get("/api/admin/responses")).status()).toBe(401);
    const organizer = await seedOrganizer(db);
    const guest = await seedGuestSession("group-1", db);
    const seeded = await page.request.post("/api/rsvp", {
      headers: {
        Origin: "http://127.0.0.1:3200",
        Cookie: `wedding_guest=${guest.cookie}`,
      },
      data: {
        requestId: randomUUID(),
        editToken: randomBytes(32).toString("base64url"),
        response: {
          decision: "accept",
          contact: { fullName: "Asha Jain", whatsapp: "+12025550123" },
          guestNames: ["Asha Jain"],
          eventIds: ["haldi"],
          travel: {
            arrivalDate: "2027-02-12",
            arrivalWindow: "noon-5pm",
            departureDate: "2027-02-14",
            departureWindow: "before-noon",
          },
        },
      },
    });
    expect(seeded.status()).toBe(200);
    const party = await seeded.json();
    expect(
      (
        await page.request.get("/api/admin/responses", {
          headers: { Cookie: `wedding_guest=${guest.cookie}` },
        })
      ).status(),
    ).toBe(401);
    await page.getByLabel("Email", { exact: true }).fill(organizer.email);
    await page.getByLabel("Password", { exact: true }).fill(organizer.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Wedding responses", exact: true }),
    ).toBeVisible();
    await page.getByLabel("Search names or phone").fill("%_' ; --");
    await page.getByRole("button", { name: "Search responses" }).click();
    await expect(
      page.getByText("No matching replies. Adjust the search or filters."),
    ).toBeVisible();
    await page.getByLabel("Search names or phone").fill("Asha");
    await page.getByRole("button", { name: "Search responses" }).click();
    await page
      .getByRole("link", { name: "Edit response for Asha Jain" })
      .click();
    await expect(
      page.getByRole("textbox", { name: "Full name", exact: true }),
    ).toHaveValue("Asha Jain");
    await page.getByRole("radio", { name: "Regretfully declines" }).check();
    await page
      .getByRole("textbox", { name: "Note (optional)" })
      .fill("Confirmed by family");
    await page.getByRole("button", { name: "Save changes" }).click();
    await expect(page.getByRole("status")).toHaveText("Response saved.");
    expect(
      (
        await db`select version,decision from wedding.rsvp_submissions where id=${party.id}`
      )[0],
    ).toEqual({ version: 2, decision: "decline" });
    await db`update wedding.site_settings set new_rsvp_closes_at=clock_timestamp()-interval '1 day'`;
    await page
      .getByRole("link", { name: "Add phone or WhatsApp reply" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Record a received reply",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Full name", exact: true })
      .fill("Ravi Jain");
    await page
      .getByRole("textbox", { name: "WhatsApp number with country code" })
      .fill("+12025550123");
    await page.getByRole("radio", { name: "Regretfully declines" }).check();
    await page
      .getByLabel("Deadline override reason (required after the deadline)")
      .fill("Late family phone confirmation");
    const manualRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/responses") &&
        response.request().method() === "POST",
    );
    await page.getByRole("button", { name: "Save received reply" }).click();
    const manualResponse = await manualRequest;
    expect(manualResponse.status()).toBe(201);
    const manual = await manualResponse.json();
    await expect(page).toHaveURL(new RegExp(`/admin/responses/${manual.id}$`));
    await expect(
      page.getByRole("heading", { name: "Edit reply", exact: true }),
    ).toBeVisible();
    expect(
      (
        await db`select source from wedding.rsvp_submissions where contact_full_name='Ravi Jain'`
      )[0].source,
    ).toBe("phone");
    expect(
      (
        await db`select organizer_user_id,reason,details from wedding.audit_log where action='rsvp.create'`
      )[0],
    ).toMatchObject({
      organizer_user_id: organizer.actor.userId,
      reason: "Late family phone confirmation",
      details: { source: "phone", deadlineOverride: true },
    });
    await page.getByRole("button", { name: "Sign out", exact: true }).click();
    await expect(page).toHaveURL(/\/admin\/login$/);
    expect((await page.request.get("/api/admin/responses")).status()).toBe(401);
    await page.goto("/admin");
    await expect(page).toHaveURL(/\/admin\/login$/);
  }));

test("two consecutive manual creates keep distinct replies and reopen a fresh form", async ({
  page,
}) =>
  withTestDb(async (db) => {
    const organizer = await seedOrganizer(db);
    await seedGuestSession("group-1", db);
    await seedGuestSession("group-2", db);
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(organizer.email);
    await page.getByLabel("Password", { exact: true }).fill(organizer.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await expect(
      page.getByRole("heading", { name: "Wedding responses", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("link", { name: "Add phone or WhatsApp reply" })
      .click();
    await expect(
      page.getByRole("heading", {
        name: "Record a received reply",
        exact: true,
      }),
    ).toBeVisible();
    await page
      .getByRole("textbox", { name: "Full name", exact: true })
      .fill("Asha Jain");
    await page
      .getByRole("textbox", { name: "WhatsApp number with country code" })
      .fill("+12025550123");
    await page.getByRole("radio", { name: "Regretfully declines" }).check();
    await page
      .getByRole("textbox", { name: "Note (optional)" })
      .fill("First phone reply");
    const firstRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/responses") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save received reply", exact: true })
      .click();
    const firstResponse = await firstRequest;
    expect(firstResponse.status()).toBe(201);
    const first = await firstResponse.json();
    await expect(page).toHaveURL(new RegExp(`/admin/responses/${first.id}$`));
    const firstBefore =
      await db`select * from wedding.rsvp_submissions where id=${first.id}`;

    await page
      .getByRole("link", { name: "Add phone or WhatsApp reply" })
      .click();
    await expect(page).toHaveURL(/\/admin\/responses\/new$/);
    await expect(
      page.getByRole("heading", {
        name: "Record a received reply",
        exact: true,
      }),
    ).toBeVisible();
    await expect(
      page.getByRole("textbox", { name: "Full name", exact: true }),
    ).toHaveValue("");
    await expect(
      page.getByRole("textbox", { name: "WhatsApp number with country code" }),
    ).toHaveValue("");
    await expect(
      page.getByLabel("Deadline override reason (required after the deadline)"),
    ).toHaveValue("");
    await expect(
      page.getByLabel("Invitation group", { exact: true }),
    ).toHaveValue("group-1");
    await expect(
      page.getByLabel("Received through", { exact: true }),
    ).toHaveValue("phone");
    await expect(
      page.getByRole("radio", { name: "Joyfully accepts" }),
    ).toBeChecked();
    await page
      .getByRole("textbox", { name: "Full name", exact: true })
      .fill("Ravi Jain");
    await page
      .getByRole("textbox", { name: "WhatsApp number with country code" })
      .fill("+12025550124");
    await page.getByRole("radio", { name: "Regretfully declines" }).check();
    await page
      .getByRole("textbox", { name: "Note (optional)" })
      .fill("Second WhatsApp reply");
    await page
      .getByLabel("Invitation group", { exact: true })
      .selectOption("group-2");
    await page
      .getByLabel("Received through", { exact: true })
      .selectOption("whatsapp");
    const secondRequest = page.waitForResponse(
      (response) =>
        response.url().endsWith("/api/admin/responses") &&
        response.request().method() === "POST",
    );
    await page
      .getByRole("button", { name: "Save received reply", exact: true })
      .click();
    const secondResponse = await secondRequest;
    expect(secondResponse.status()).toBe(201);
    const second = await secondResponse.json();
    expect(second.id).not.toBe(first.id);
    await expect(page).toHaveURL(new RegExp(`/admin/responses/${second.id}$`));
    expect(
      await db`select * from wedding.rsvp_submissions where id=${first.id}`,
    ).toEqual(firstBefore);
    expect(
      await db`select contact_full_name,version,group_id,source,note from wedding.rsvp_submissions order by contact_full_name`,
    ).toEqual([
      {
        contact_full_name: "Asha Jain",
        version: 1,
        group_id: "group-1",
        source: "phone",
        note: "First phone reply",
      },
      {
        contact_full_name: "Ravi Jain",
        version: 1,
        group_id: "group-2",
        source: "whatsapp",
        note: "Second WhatsApp reply",
      },
    ]);
    expect(await db`select action from wedding.audit_log`).toEqual([
      { action: "rsvp.create" },
      { action: "rsvp.create" },
    ]);
  }));
