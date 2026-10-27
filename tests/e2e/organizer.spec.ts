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
    await page.getByRole("button", { name: "Save received reply" }).click();
    await expect(page.getByRole("status")).toHaveText("Response saved.");
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
