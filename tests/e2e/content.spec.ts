import { randomUUID, randomBytes } from "node:crypto";
import { existsSync, mkdirSync } from "node:fs";
import { expect, test } from "@playwright/test";
import {
  seedOrganizer,
  seedGuestSession,
  withTestDb,
} from "../helpers/database";
if (existsSync(".env.local")) process.loadEnvFile(".env.local");
test("editor publishes bilingual fields and private photo; guest itinerary and RSVP reload match; cancellation preserves history", async ({
  page,
  context,
}, testInfo) =>
  withTestDb(async (db) => {
    const organizer = await seedOrganizer(db),
      guest = await seedGuestSession("group-2", db);
    const saved = await page.request.post("/api/rsvp", {
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
    expect(saved.status()).toBe(200);
    const savedId = (await saved.json()).id;
    await page.goto("/admin/login");
    await page.getByLabel("Email", { exact: true }).fill(organizer.email);
    await page.getByLabel("Password", { exact: true }).fill(organizer.password);
    await page.getByRole("button", { name: "Sign in", exact: true }).click();
    await page
      .getByRole("link", { name: "Edit invitation content", exact: true })
      .click();
    await expect(
      page.getByRole("heading", { name: "Invitation content", exact: true }),
    ).toBeVisible();
    await page.getByText("Celebrations & times", { exact: true }).click();
    await page
      .locator("summary")
      .filter({ hasText: /^Sample celebration 3$/ })
      .click();
    await page
      .getByLabel("haldi title · English", { exact: true })
      .fill("Edited Haldi");
    await page
      .getByLabel("haldi title · Hindi", { exact: true })
      .fill("नई हल्दी");
    await page
      .getByLabel("haldi start (IST)", { exact: true })
      .fill("2030-02-13T13:30");
    await page
      .getByLabel("haldi dress code · English", { exact: true })
      .fill("Pastels");
    await page
      .getByLabel("haldi dress code · Hindi", { exact: true })
      .fill("हल्के रंग");
    await page.getByText("Invitation labels", { exact: true }).click();
    await page.getByLabel("story · Hindi", { exact: true }).fill("हमारी कहानी");
    await expect(page.getByRole("note")).toContainText(
      "recorded selections will stay in history",
    );
    await page
      .getByRole("button", { name: "Publish invitation", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Published revision 2",
    );
    await page.getByText("Invitation labels", { exact: true }).click();
    await page.getByText("Celebrations & times", { exact: true }).click();
    mkdirSync("test-results/content-visual", { recursive: true });
    await page.screenshot({
      path: `test-results/content-visual/editor-${testInfo.project.name}.png`,
      fullPage: true,
    });
    await page
      .getByLabel("Photo file", { exact: true })
      .setInputFiles({
        name: "sample.png",
        mimeType: "image/png",
        buffer: Buffer.from(
          "iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=",
          "base64",
        ),
      });
    await page
      .getByLabel("New photo description · English", { exact: true })
      .fill("Synthetic sample photo");
    await page
      .getByLabel("New photo description · Hindi", { exact: true })
      .fill("उदाहरण फोटो");
    await page
      .getByLabel("New photo source / permission", { exact: true })
      .fill("Synthetic test fixture");
    await page
      .getByRole("button", { name: "Publish photo", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Photo published in revision 3",
    );
    const guestPage = await context.newPage();
    await context.addCookies([
      {
        name: "wedding_guest",
        value: guest.cookie,
        url: "http://127.0.0.1:3200",
      },
    ]);
    await guestPage.goto("/invitation?opened=1");
    const event = guestPage.locator('[data-event-id="haldi"]');
    await expect(event).toContainText("Edited Haldi");
    await expect(event).toContainText("1:30 PM");
    await expect(event).toContainText("Pastels");
    const photo = guestPage.getByRole("img", {
      name: "Synthetic sample photo",
      exact: true,
    });
    await photo.scrollIntoViewIfNeeded();
    await expect(photo).toBeVisible();
    await expect
      .poll(() =>
        photo.evaluate(
          (img: HTMLImageElement) => img.complete && img.naturalWidth > 0,
        ),
      )
      .toBe(true);
    await guestPage
      .getByRole("button", { name: "हिन्दी", exact: true })
      .click();
    await expect(event).toContainText("नई हल्दी");
    await expect(event).toContainText("हल्के रंग");
    await expect(
      guestPage.getByRole("heading", { name: "हमारी कहानी", exact: true }),
    ).toBeVisible();
    await guestPage.goto("/rsvp");
    await guestPage.getByLabel("पूरा नाम", { exact: true }).fill("Asha Jain");
    await guestPage
      .getByLabel("देश कोड सहित WhatsApp नंबर", { exact: true })
      .fill("+12025550123");
    await guestPage.getByRole("button", { name: "आगे", exact: true }).click();
    await guestPage
      .getByRole("button", {
        name: "संपर्क नाम को अतिथि 1 में भरें",
        exact: true,
      })
      .click();
    await guestPage.getByRole("button", { name: "आगे", exact: true }).click();
    await expect(
      guestPage.getByText("नई हल्दी", { exact: false }),
    ).toBeVisible();
    await expect(
      guestPage.getByText("हल्के रंग", { exact: true }),
    ).toBeVisible();
    await expect(guestPage.getByText(/1:30.*IST/)).toBeVisible();
    await page.getByText("Celebrations & times", { exact: true }).click();
    await page
      .getByLabel("Mark Edited Haldi cancelled", { exact: true })
      .check();
    await page
      .getByRole("button", { name: "Publish invitation", exact: true })
      .click();
    await expect(page.getByRole("status")).toContainText(
      "Published revision 4",
    );
    await guestPage.goto("/invitation?opened=1");
    await expect(guestPage.locator('[data-event-id="haldi"]')).toContainText(
      "रद्द",
    );
    expect(
      await db`select event_id from wedding.rsvp_event_selections where submission_id=${savedId}`,
    ).toEqual([{ event_id: "haldi" }]);
  }));
