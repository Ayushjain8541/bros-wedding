"use client";
import { useState } from "react";
import { useRouter } from "next/navigation";
export function LoginForm() {
  const [error, setError] = useState(""),
    [busy, setBusy] = useState(false);
  const router = useRouter();
  return (
    <form
      onSubmit={async (event) => {
        event.preventDefault();
        const data = new FormData(event.currentTarget);
        setBusy(true);
        setError("");
        try {
          const result = await fetch("/api/admin/session", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              email: data.get("email"),
              password: data.get("password"),
            }),
          });
          if (!result.ok) {
            setError(
              result.status === 429
                ? "Too many attempts. Please wait 15 minutes."
                : result.status === 403
                  ? "This account has no organizer access."
                  : "Unable to sign in. Check your email and password.",
            );
            return;
          }
          router.replace("/admin");
          router.refresh();
        } catch {
          setError("Sign in is unavailable. Please try again.");
        } finally {
          setBusy(false);
        }
      }}
    >
      <label htmlFor="email">Email</label>
      <input
        id="email"
        name="email"
        type="email"
        autoComplete="username"
        required
      />
      <label htmlFor="password">Password</label>
      <input
        id="password"
        name="password"
        type="password"
        autoComplete="current-password"
        required
      />
      {error && <p role="alert">{error}</p>}
      <button disabled={busy}>{busy ? "Signing in…" : "Sign in"}</button>
    </form>
  );
}
export function LogoutButton() {
  const [error, setError] = useState("");
  return (
    <>
      <button
        type="button"
        onClick={async () => {
          try {
            const result = await fetch("/api/admin/session", {
              method: "DELETE",
            });
            if (!result.ok) throw Error();
            location.replace("/admin/login");
          } catch {
            setError("Unable to sign out. Please try again.");
          }
        }}
      >
        Sign out
      </button>
      {error && <p role="alert">{error}</p>}
    </>
  );
}
