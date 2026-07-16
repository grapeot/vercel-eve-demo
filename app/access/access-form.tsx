"use client";

import { FormEvent, useState } from "react";

export function AccessForm() {
  const [error, setError] = useState(false);
  const [pending, setPending] = useState(false);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setError(false);
    setPending(true);
    const data = new FormData(event.currentTarget);
    const response = await fetch("/api/access/challenge", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ challenge: data.get("challenge") }),
    }).catch(() => null);
    if (response?.ok) {
      window.location.assign("/");
      return;
    }
    setPending(false);
    setError(true);
  }

  return (
    <form className="access-form" onSubmit={submit}>
      <label htmlFor="challenge">Private challenge</label>
      <input
        id="challenge"
        name="challenge"
        type="password"
        autoComplete="current-password"
        required
        autoFocus
      />
      <button type="submit" disabled={pending}>
        {pending ? "Checking..." : "Enter workbench"}
      </button>
      {error ? <p className="access-error">Access denied.</p> : null}
    </form>
  );
}
