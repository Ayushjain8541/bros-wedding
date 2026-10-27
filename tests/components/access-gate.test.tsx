import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { NextIntlClientProvider } from "next-intl";
import { expect, it } from "vitest";
import GatePage from "@/app/page";
import InvitePage from "@/app/invite/page";
import hi from "@/i18n/messages/hi.json";
it("honors Hindi on the unauthenticated gate and lets guests choose English", async () => {
  const user = userEvent.setup();
  render(<NextIntlClientProvider locale="hi" messages={hi} timeZone="Asia/Kolkata"><GatePage/></NextIntlClientProvider>);
  expect(screen.getByRole("heading", { name: "निजी निमंत्रण" })).toBeVisible();
  await user.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByRole("heading", { name: "Private invitation" })).toBeVisible();
  expect(document.cookie).toContain("locale=en");
});
it("localizes opening and failed-link recovery without losing the failure on language change", async () => {
  const user = userEvent.setup();
  window.history.replaceState(null, "", "/invite#invalid");
  render(<NextIntlClientProvider locale="hi" messages={hi} timeZone="Asia/Kolkata"><InvitePage/></NextIntlClientProvider>);
  expect(screen.getByRole("status")).toHaveTextContent("आपका निमंत्रण खुल रहा है…");
  expect(await screen.findByRole("alert")).toHaveTextContent("परिवार से नया लिंक माँगें");
  expect(window.location.hash).toBe("");
  await user.click(screen.getByRole("button", { name: "English" }));
  expect(screen.getByRole("alert")).toHaveTextContent("Please ask the family for a current link");
});
