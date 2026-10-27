import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { RsvpForm } from "@/features/rsvp/RsvpForm";
import { EVENTS, SETTINGS, acceptedInput } from "../fixtures/wedding";
import type { PartySnapshot } from "@/features/wedding/types";
const initial: PartySnapshot = {
  id: "synthetic-party",
  groupId: "group-1",
  version: 1,
  response: acceptedInput(),
  source: "website",
};
const renderForm = (edit = false) =>
  render(
    <RsvpForm
      events={EVENTS}
      settings={SETTINGS}
      locale="en"
      initial={edit ? initial : undefined}
    />,
  );
async function contact(user: ReturnType<typeof userEvent.setup>) {
  await user.type(
    screen.getByRole("textbox", { name: "Full name" }),
    "Asha Jain",
  );
  await user.type(
    screen.getByRole("textbox", { name: /WhatsApp/ }),
    "+12025550123",
  );
  await user.click(screen.getByRole("radio", { name: "Joyfully accepts" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
}
beforeEach(() => {
  vi.restoreAllMocks();
  Element.prototype.scrollIntoView = vi.fn();
});
describe("RSVP form", () => {
  it("shows exactly three then one required guest name, with contact copy only on request", async () => {
    const user = userEvent.setup();
    renderForm();
    await contact(user);
    expect(
      screen.getByRole("textbox", { name: /Guest 1 full name/ }),
    ).toHaveValue("");
    await user.click(
      screen.getByRole("button", { name: "Copy contact to Guest 1" }),
    );
    expect(
      screen.getByRole("textbox", { name: /Guest 1 full name/ }),
    ).toHaveValue("Asha Jain");
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Number of guests" }),
      "3",
    );
    expect(
      screen.getAllByRole("textbox", { name: /Guest.*full name/ }),
    ).toHaveLength(3);
    for (const field of screen.getAllByRole("textbox", {
      name: /Guest.*full name/,
    }))
      expect(field).toBeRequired();
    await user.type(
      screen.getByRole("textbox", { name: /Guest 3 full name/ }),
      "Neha Jain",
    );
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Number of guests" }),
      "1",
    );
    expect(
      screen.getAllByRole("textbox", { name: /Guest.*full name/ }),
    ).toHaveLength(1);
    await user.selectOptions(
      screen.getByRole("combobox", { name: "Number of guests" }),
      "3",
    );
    expect(
      screen.getByRole("textbox", { name: /Guest 3 full name/ }),
    ).toHaveValue("");
  });
  it("keeps draft values and the same input node across language changes", async () => {
    const user = userEvent.setup();
    renderForm();
    await contact(user);
    const field = screen.getByRole("textbox", { name: /Guest 1 full name/ });
    await user.type(field, "Ravi Jain");
    await user.click(screen.getByRole("button", { name: "हिन्दी" }));
    expect(screen.getByRole("textbox")).toBe(field);
    expect(field).toHaveValue("Ravi Jain");
    await user.click(screen.getByRole("button", { name: "English" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(screen.getByRole("textbox", { name: "Full name" })).toHaveValue(
      "Asha Jain",
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("textbox")).toHaveValue("Ravi Jain");
  });
  it("serializes decline without stale guests/events/travel and preserves review/back inputs", async () => {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("offline"));
    vi.stubGlobal("fetch", fetchMock);
    renderForm(true);
    await user.click(
      screen.getByRole("radio", { name: "Regretfully declines" }),
    );
    await user.type(
      screen.getByRole("textbox", { name: "Note (optional)" }),
      "With love",
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Back" }));
    expect(
      screen.getByRole("textbox", { name: "Note (optional)" }),
    ).toHaveValue("With love");
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Save changes" }));
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(1));
    expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
      expectedSubmissionId: initial.id,
      expectedVersion: 1,
      response: {
        decision: "decline",
        contact: acceptedInput().contact,
        note: "With love",
      },
    });
    expect(
      screen.queryByText("Your response is saved."),
    ).not.toBeInTheDocument();
  });
  it("focuses the first invalid field and localizes domain errors", async () => {
    const user = userEvent.setup();
    renderForm();
    await user.click(screen.getByRole("button", { name: "Next" }));
    expect(screen.getByRole("textbox", { name: "Full name" })).toHaveFocus();
    expect(screen.getByText(/at least two name parts/)).toBeVisible();
    await user.click(screen.getByRole("button", { name: "हिन्दी" }));
    expect(
      screen.queryByText(/at least two name parts/),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("textbox", { name: "पूरा नाम" })).toHaveAttribute(
      "aria-invalid",
      "true",
    );
  });
  it("freezes uncertain create attempts, retries identical command and loads authoritative confirmation", async () => {
    const user = userEvent.setup();
    let finish!: (response: Response) => void;
    const fetchMock = vi
      .fn()
      .mockImplementationOnce(
        () =>
          new Promise<Response>((resolve) => {
            finish = resolve;
          }),
      )
      .mockRejectedValueOnce(new TypeError("lost"))
      .mockResolvedValueOnce(
        Response.json({
          id: initial.id,
          version: 1,
          duplicateWarning: false,
          editPath: "/rsvp/edit#token",
        }),
      )
      .mockResolvedValueOnce(Response.json({}))
      .mockResolvedValueOnce(
        Response.json({
          ...initial,
          response: { decision: "decline", contact: acceptedInput().contact },
        }),
      );
    vi.stubGlobal("fetch", fetchMock);
    renderForm();
    await user.type(
      screen.getByRole("textbox", { name: "Full name" }),
      "Asha Jain",
    );
    await user.type(
      screen.getByRole("textbox", { name: /WhatsApp/ }),
      "+12025550123",
    );
    await user.click(
      screen.getByRole("radio", { name: "Regretfully declines" }),
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Submit response" }));
    expect(
      screen.queryByText("Your response is saved."),
    ).not.toBeInTheDocument();
    expect(screen.getByRole("button", { name: "Saving…" })).toBeDisabled();
    finish(Response.json({ code: "RSVP_UNAVAILABLE" }, { status: 503 }));
    await user.click(
      await screen.findByRole("button", { name: "Retry same response" }),
    );
    await user.click(
      await screen.findByRole("button", { name: "Retry same response" }),
    );
    await screen.findByText("Your response is saved.");
    expect(fetchMock.mock.calls[0][1].body).toBe(
      fetchMock.mock.calls[1][1].body,
    );
    expect(fetchMock.mock.calls[1][1].body).toBe(
      fetchMock.mock.calls[2][1].body,
    );
    const command = JSON.parse(fetchMock.mock.calls[0][1].body);
    expect(command.editToken).toMatch(/^[A-Za-z0-9_-]{43}$/);
    expect(command.requestId).toMatch(/^[a-f0-9-]{36}$/);
    expect(fetchMock.mock.calls[3][0]).toBe("/api/rsvp/edit-session");
    expect(fetchMock.mock.calls[4][0]).toBe("/api/rsvp/current");
  });
});

it("retains an uncertain create identity even when a later retry is rate limited", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockRejectedValueOnce(new TypeError("lost"))
    .mockResolvedValueOnce(
      Response.json({ code: "RATE_LIMITED" }, { status: 429 }),
    )
    .mockRejectedValueOnce(new TypeError("offline"));
  vi.stubGlobal("fetch", fetchMock);
  renderForm();
  await user.type(
    screen.getByRole("textbox", { name: "Full name" }),
    "Asha Jain",
  );
  await user.type(
    screen.getByRole("textbox", { name: /WhatsApp/ }),
    "+12025550123",
  );
  await user.click(screen.getByRole("radio", { name: "Regretfully declines" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));
  await user.click(
    await screen.findByRole("button", { name: "Retry same response" }),
  );
  expect(await screen.findByText(/wait 15 minutes/)).toBeVisible();
  await user.click(screen.getByRole("button", { name: "Retry same response" }));
  await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(3));
  expect(new Set(fetchMock.mock.calls.map((call) => call[1].body)).size).toBe(
    1,
  );
  expect(
    screen.queryByRole("button", { name: "Back" }),
  ).not.toBeInTheDocument();
});

it("exchanges and clears a fragment once under StrictMode, and never shows a blank form on load failure", async () => {
  const { StrictMode } = await import("react");
  const { EditExchange } = await import("@/features/rsvp/EditExchange");
  window.history.replaceState(null, "", "/rsvp/edit#synthetic-token");
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(
      Response.json({ code: "RSVP_UNAVAILABLE" }, { status: 503 }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <StrictMode>
      <EditExchange events={EVENTS} settings={SETTINGS} locale="en" />
    </StrictMode>,
  );
  expect(window.location.hash).toBe("");
  await screen.findByText("We could not open your response");
  expect(fetchMock).toHaveBeenCalledTimes(2);
  expect(screen.queryByRole("textbox")).not.toBeInTheDocument();
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    token: "synthetic-token",
  });
});

it("maps unknown server codes to safe copy present in both languages", async () => {
  const { errorMessageKey } = await import("@/features/rsvp/client");
  const en = (await import("@/i18n/messages/en.json")).default;
  const hi = (await import("@/i18n/messages/hi.json")).default;
  for (const code of [
    "ACCESS_DENIED",
    "forbidden",
    "closed",
    "conflict",
    "idempotency_conflict",
    "forbidden_event",
    "INVALID_REQUEST",
    "JSON_REQUIRED",
    "REQUEST_TOO_LARGE",
    "FORBIDDEN_ORIGIN",
    "RSVP_UNAVAILABLE",
    "RATE_LIMITED",
    "unrecognized-private-detail",
  ]) {
    const key = errorMessageKey(code);
    expect(en.Errors[key]).toBeTruthy();
    expect(hi.Errors[key]).toBeTruthy();
    expect(key).not.toBe("unrecognized-private-detail");
  }
});

it("retries the frozen create after the new-response deadline passes", async () => {
  vi.useFakeTimers({ toFake: ["Date", "setInterval", "clearInterval"] });
  try {
    const user = userEvent.setup();
    const fetchMock = vi.fn().mockRejectedValue(new TypeError("lost"));
    vi.stubGlobal("fetch", fetchMock);
    render(
      <RsvpForm
        events={EVENTS}
        settings={{
          ...SETTINGS,
          newRsvpClosesAt: new Date(Date.now() + 1000).toISOString(),
        }}
        locale="en"
      />,
    );
    await user.type(
      screen.getByRole("textbox", { name: "Full name" }),
      "Asha Jain",
    );
    await user.type(
      screen.getByRole("textbox", { name: /WhatsApp/ }),
      "+12025550123",
    );
    await user.click(
      screen.getByRole("radio", { name: "Regretfully declines" }),
    );
    await user.click(screen.getByRole("button", { name: "Next" }));
    await user.click(screen.getByRole("button", { name: "Submit response" }));
    await screen.findByRole("button", { name: "Retry same response" });
    const { act } = await import("@testing-library/react");
    await act(async () => {
      await vi.advanceTimersByTimeAsync(31_000);
    });
    expect(
      screen.queryByText(
        "New responses are now closed. Existing responses can still be edited.",
      ),
    ).not.toBeInTheDocument();
    await user.click(
      screen.getByRole("button", { name: "Retry same response" }),
    );
    await waitFor(() => expect(fetchMock).toHaveBeenCalledTimes(2));
    expect(fetchMock.mock.calls[0][1].body).toBe(
      fetchMock.mock.calls[1][1].body,
    );
  } finally {
    vi.useRealTimers();
  }
});

it("does not confirm another party if the shared edit session changes before confirmation", async () => {
  const user = userEvent.setup();
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({
        id: initial.id,
        version: 1,
        duplicateWarning: false,
        editPath: "/rsvp/edit#token",
      }),
    )
    .mockResolvedValueOnce(Response.json({}))
    .mockResolvedValueOnce(
      Response.json({
        ...initial,
        id: "different-party",
        response: {
          decision: "decline",
          contact: { fullName: "Other Person", whatsapp: "+12025550123" },
        },
      }),
    );
  vi.stubGlobal("fetch", fetchMock);
  renderForm();
  await user.type(
    screen.getByRole("textbox", { name: "Full name" }),
    "Asha Jain",
  );
  await user.type(
    screen.getByRole("textbox", { name: /WhatsApp/ }),
    "+12025550123",
  );
  await user.click(screen.getByRole("radio", { name: "Regretfully declines" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Submit response" }));
  await screen.findByText(/could not load the confirmation/);
  expect(screen.queryByText("Other Person")).not.toBeInTheDocument();
  expect(
    screen.getByRole("link", { name: "Open secure edit link" }),
  ).toBeVisible();
});

it("directly removes a saved cancelled event while retaining active selections and edited contact/travel", async () => {
  const user = userEvent.setup();
  const events = EVENTS.map((event) =>
    event.id === "haldi" ? { ...event, cancelled: true } : event,
  );
  const response = acceptedInput({ eventIds: ["haldi", "reception"] });
  const edited = {
    ...response,
    contact: { ...response.contact, fullName: "Asha Sharma" },
    eventIds: ["reception"],
    travel: { ...response.travel, arrivalDate: "2027-02-11" },
  };
  const fetchMock = vi
    .fn()
    .mockResolvedValueOnce(
      Response.json({ id: initial.id, version: 2, duplicateWarning: false }),
    )
    .mockResolvedValueOnce(
      Response.json({ ...initial, version: 2, response: edited }),
    );
  vi.stubGlobal("fetch", fetchMock);
  render(
    <RsvpForm
      events={events}
      settings={SETTINGS}
      locale="en"
      initial={{ ...initial, response }}
    />,
  );
  await user.clear(screen.getByRole("textbox", { name: "Full name" }));
  await user.type(
    screen.getByRole("textbox", { name: "Full name" }),
    "Asha Sharma",
  );
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Next" }));
  const cancelled = screen.getByRole("checkbox", {
    name: new RegExp(events.find((event) => event.id === "haldi")!.title.en),
  });
  const active = screen.getByRole("checkbox", {
    name: new RegExp(
      events.find((event) => event.id === "reception")!.title.en,
    ),
  });
  expect(cancelled).toBeChecked();
  expect(active).toBeChecked();
  expect(cancelled).toBeEnabled();
  await user.click(cancelled);
  expect(cancelled).not.toBeChecked();
  expect(cancelled).toBeDisabled();
  await user.click(cancelled);
  expect(cancelled).not.toBeChecked();
  expect(active).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Next" }));
  fireEvent.change(screen.getByLabelText("Arrival date"), {
    target: { value: "2027-02-11" },
  });
  await user.click(screen.getByRole("button", { name: "Back" }));
  expect(
    screen.getByRole("checkbox", {
      name: new RegExp(events.find((event) => event.id === "haldi")!.title.en),
    }),
  ).toBeDisabled();
  expect(
    screen.getByRole("checkbox", {
      name: new RegExp(
        events.find((event) => event.id === "reception")!.title.en,
      ),
    }),
  ).toBeChecked();
  await user.click(screen.getByRole("button", { name: "Next" }));
  expect(screen.getByLabelText("Arrival date")).toHaveValue("2027-02-11");
  await user.click(screen.getByRole("button", { name: "Next" }));
  await user.click(screen.getByRole("button", { name: "Save changes" }));
  await screen.findByText("Your response is saved.");
  expect(JSON.parse(fetchMock.mock.calls[0][1].body)).toEqual({
    expectedSubmissionId: initial.id,
    expectedVersion: 1,
    response: edited,
  });
  expect(fetchMock.mock.calls[0][0]).toBe("/api/rsvp/current");
  expect(fetchMock.mock.calls[0][1].method).toBe("PATCH");
});
