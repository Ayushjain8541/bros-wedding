import type {
  CreateCommand,
  EditCommand,
  PartySnapshot,
  RsvpInput,
  SaveResult,
} from "@/features/wedding/types";
import { DomainError } from "@/lib/errors";
import en from "@/i18n/messages/en.json";

/** All unrecognized server and transport errors receive safe, localized copy. */
export function errorMessageKey(code: string): keyof typeof en.Errors {
  const aliases: Record<string, keyof typeof en.Errors> = {
    ACCESS_DENIED: "UNAUTHORIZED",
    forbidden: "UNAUTHORIZED",
    closed: "DEADLINE_PASSED",
    conflict: "CONFLICT",
    idempotency_conflict: "IDEMPOTENCY_CONFLICT",
    forbidden_event: "unauthorized_event",
    INVALID_REQUEST: "INVALID_REQUEST",
    JSON_REQUIRED: "INVALID_REQUEST",
    REQUEST_TOO_LARGE: "REQUEST_TOO_LARGE",
    FORBIDDEN_ORIGIN: "UNAUTHORIZED",
    RSVP_UNAVAILABLE: "UNCERTAIN",
    NETWORK_ERROR: "UNCERTAIN",
  };
  return (
    aliases[code] ??
    (Object.hasOwn(en.Errors, code)
      ? (code as keyof typeof en.Errors)
      : "UNAVAILABLE")
  );
}
async function request<T>(
  path: string,
  method = "GET",
  body?: unknown,
): Promise<T> {
  try {
    const response = await fetch(path, {
      method,
      credentials: "same-origin",
      cache: "no-store",
      headers: body ? { "Content-Type": "application/json" } : undefined,
      body: body ? JSON.stringify(body) : undefined,
    });
    const data = await response.json();
    if (!response.ok)
      throw new DomainError(
        typeof data?.code === "string" ? data.code : "UNAVAILABLE",
        response.status,
        data?.fieldErrors,
      );
    return data as T;
  } catch (error) {
    if (error instanceof DomainError) throw error;
    throw new DomainError("NETWORK_ERROR", 0);
  }
}
export function newCreateCommand(response: RsvpInput): CreateCommand {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  const editToken = btoa(String.fromCharCode(...bytes))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
  return {
    requestId: crypto.randomUUID(),
    editToken,
    response: structuredClone(response),
  };
}
export const createResponse = (command: CreateCommand) =>
  request<SaveResult>("/api/rsvp", "POST", command);
export const editResponse = (command: EditCommand) =>
  request<SaveResult>("/api/rsvp/current", "PATCH", command);
export const exchangeEditToken = (token: string) =>
  request<Record<string, never>>("/api/rsvp/edit-session", "POST", { token });
export const readCurrentResponse = () =>
  request<PartySnapshot>("/api/rsvp/current");
