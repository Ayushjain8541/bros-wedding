import "@testing-library/jest-dom/vitest";
import { afterEach, vi } from "vitest";
import { cleanup } from "@testing-library/react";
// Next enforces server-only boundaries in builds; unit tests execute these modules in Node.
vi.mock("server-only", () => ({}));
afterEach(cleanup);
