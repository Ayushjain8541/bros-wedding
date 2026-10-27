import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, expect, it, vi } from "vitest";
import { NextIntlClientProvider } from "next-intl";
import { ResponseEditor } from "@/features/organizer/ResponseEditor";
import en from "@/i18n/messages/en.json";
import { EVENTS, SETTINGS, declinedInput } from "../fixtures/wedding";
const replace = vi.fn();
vi.mock("next/navigation", () => ({ useRouter: () => ({ replace }) }));
afterEach(() => { vi.unstubAllGlobals(); vi.clearAllMocks(); });
const party = { id: "13f1ebd7-c26d-4355-b54c-3e2d8dfd5b32", groupId: "group-2", version: 1, source: "whatsapp", response: declinedInput() };
async function enterReply() {
  const user = userEvent.setup();
  render(<NextIntlClientProvider locale="en" messages={en} timeZone="Asia/Kolkata"><ResponseEditor events={EVENTS} settings={SETTINGS}/></NextIntlClientProvider>);
  await user.type(screen.getByRole("textbox", { name: "Full name" }), "Asha Jain");
  await user.type(screen.getByRole("textbox", { name: /WhatsApp number/ }), "+12025550123");
  await user.click(screen.getByRole("radio", { name: "Regretfully declines" }));
  await user.selectOptions(screen.getByLabelText("Invitation group"), "group-2");
  await user.selectOptions(screen.getByLabelText("Received through"), "whatsapp");
  await user.type(screen.getByLabelText(/Deadline override/), "Family phoned");
  return user;
}
it.each([429, 401])("retains the complete uncertain create envelope after a later %i and resolves the original party", async (status) => {
  const transport = vi.fn()
    .mockRejectedValueOnce(new TypeError("lost acknowledgement"))
    .mockResolvedValueOnce(Response.json({ code: status === 429 ? "RATE_LIMITED" : "ACCESS_DENIED" }, { status }))
    .mockResolvedValueOnce(Response.json({ id: party.id, version: 1, duplicateWarning: false }, { status: 201 }))
    .mockResolvedValueOnce(Response.json(party));
  vi.stubGlobal("fetch", transport);
  const user = await enterReply();
  await user.click(screen.getByRole("button", { name: "Save received reply" }));
  await user.click(await screen.findByRole("button", { name: "Retry received reply" }));
  await waitFor(() => expect(transport).toHaveBeenCalledTimes(2));
  await waitFor(() => expect(screen.getByLabelText("Invitation group")).toBeDisabled());
  await user.click(await screen.findByRole("button", { name: "Retry received reply" }));
  await screen.findByText("Response saved.");
  const envelopes = transport.mock.calls.slice(0, 3).map((call) => call[1].body);
  expect(new Set(envelopes).size).toBe(1);
  expect(JSON.parse(envelopes[0])).toMatchObject({ groupId: "group-2", source: "whatsapp", overrideReason: "Family phoned", command: { response: { decision: "decline" } } });
  expect(transport.mock.calls[3][0]).toBe(`/api/admin/responses/${party.id}`);
  expect(replace).toHaveBeenCalledWith(`/admin/responses/${party.id}`);
});
it.each([401, 503])("keeps a confirmed create target after a %i summary failure and recovers with GET only", async (status) => {
  const transport = vi.fn()
    .mockResolvedValueOnce(Response.json({ id: party.id, version: 1, duplicateWarning: false }, { status: 201 }))
    .mockResolvedValueOnce(Response.json({ code: "ACCESS_DENIED" }, { status }))
    .mockResolvedValueOnce(Response.json(party));
  vi.stubGlobal("fetch", transport);
  const user = await enterReply();
  await user.click(screen.getByRole("button", { name: "Save received reply" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "Full name" })).toBeDisabled();
  expect(screen.queryByText("Response saved.")).not.toBeInTheDocument();
  await user.click(screen.getByRole("button", { name: "Reload saved reply" }));
  await screen.findByText("Response saved.");
  expect(transport.mock.calls.map((call) => [call[0], call[1]?.method ?? "GET"])).toEqual([
    ["/api/admin/responses", "POST"],
    [`/api/admin/responses/${party.id}`, "GET"],
    [`/api/admin/responses/${party.id}`, "GET"],
  ]);
});
it("permits correcting a definitely rejected initial create", async () => {
  vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({ code: "INVALID_REQUEST" }, { status: 400 })));
  const user = await enterReply();
  await user.click(screen.getByRole("button", { name: "Save received reply" }));
  await screen.findByRole("alert");
  expect(screen.getByRole("textbox", { name: "Full name" })).toBeEnabled();
  expect(screen.getByRole("button", { name: "Save received reply" })).toBeEnabled();
});
