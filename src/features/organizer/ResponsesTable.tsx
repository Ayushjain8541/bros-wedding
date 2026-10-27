import Link from "next/link";
import type { PartySnapshot, WeddingEvent } from "@/features/wedding/types";
import type { AdminFilters } from "./responses";
import styles from "./Admin.module.css";
export function ResponsesTable({
  items,
  nextCursor,
  filters,
  events,
}: {
  items: PartySnapshot[];
  nextCursor: string | null;
  filters: AdminFilters;
  events: WeddingEvent[];
}) {
  const next = new URLSearchParams();
  for (const [key, value] of Object.entries(filters))
    if (value !== undefined && key !== "cursor") next.set(key, String(value));
  if (nextCursor) next.set("cursor", nextCursor);
  return (
    <>
      <form method="GET" className={styles.filters}>
        <label>
          Search names or phone
          <input name="query" defaultValue={filters.query} maxLength={200} />
        </label>
        <label>
          Decision
          <select name="decision" defaultValue={filters.decision ?? ""}>
            <option value="">Any decision</option>
            <option value="accept">Accept</option>
            <option value="decline">Decline</option>
          </select>
        </label>
        <label>
          Invitation group
          <select name="groupId" defaultValue={filters.groupId ?? ""}>
            <option value="">All groups</option>
            <option value="group-1">Group 1</option>
            <option value="group-2">Group 2</option>
          </select>
        </label>
        <label>
          Event
          <select name="eventId" defaultValue={filters.eventId ?? ""}>
            <option value="">All events</option>
            {events.map((event) => (
              <option key={event.id} value={event.id}>
                {event.title.en}
              </option>
            ))}
          </select>
        </label>
        <label>
          Arrival date
          <input
            name="arrivalDate"
            type="date"
            defaultValue={filters.arrivalDate}
          />
        </label>
        <label>
          Departure date
          <input
            name="departureDate"
            type="date"
            defaultValue={filters.departureDate}
          />
        </label>
        <label>
          <span>Duplicates</span>
          <select
            name="duplicateOnly"
            defaultValue={String(filters.duplicateOnly ?? false)}
          >
            <option value="false">All responses</option>
            <option value="true">Possible duplicates only</option>
          </select>
        </label>
        <button>Search responses</button>
      </form>
      <p>
        {items.length} responses on this page
        {nextCursor ? " · more available" : ""}
      </p>
      <div className={styles.scroll}>
        <table className={styles.table}>
          <caption>Received wedding replies</caption>
          <thead>
            <tr>
              <th scope="col">Contact</th>
              <th scope="col">Group</th>
              <th scope="col">Reply</th>
              <th scope="col">Guests</th>
              <th scope="col">Source</th>
              <th scope="col">Action</th>
            </tr>
          </thead>
          <tbody>
            {items.map((party) => (
              <tr key={party.id}>
                <td>
                  {party.response.contact.fullName}
                  <br />
                  {party.response.contact.whatsapp}
                </td>
                <td>{party.groupId}</td>
                <td>{party.response.decision}</td>
                <td>
                  {party.response.decision === "accept"
                    ? party.response.guestNames.length
                    : 0}
                </td>
                <td>
                  <span className={styles.badge}>{party.source}</span>
                </td>
                <td>
                  <Link href={`/admin/responses/${party.id}`}>
                    Edit response
                    <span className="sr-only">
                      {" "}
                      for {party.response.contact.fullName}
                    </span>
                  </Link>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {items.length === 0 && (
        <p>No matching replies. Adjust the search or filters.</p>
      )}
      <div className={styles.actions}>
        {nextCursor && <Link href={`/admin?${next}`}>Next 50 responses</Link>}
        <Link href="/admin">Clear filters</Link>
      </div>
    </>
  );
}
