"use client";

import { useRouter, useSearchParams } from "next/navigation";
import { Suspense, useState, type FormEvent } from "react";
import Link from "next/link";
import { Lock } from "lucide-react";
import { Button } from "@/components/ui/button";

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  async function onSubmit(e: FormEvent<HTMLFormElement>) {
    // Belt-and-suspenders: preventDefault stops the browser's native submit
    // (which would otherwise GET this form's fields into the address bar as
    // a query string — the form has no `action`/`method` so the browser
    // default is GET-to-current-URL). We always submit via fetch() POST
    // below instead.
    e.preventDefault();
    setSubmitting(true);
    setError(null);
    try {
      const res = await fetch("/tools/login/submit", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password }),
      });
      if (!res.ok) {
        setError("Wrong ID or password. Try again.");
        setPassword("");
        setSubmitting(false);
        return;
      }
      const next = searchParams.get("next");
      const safe = next && next.startsWith("/tools") ? next : "/tools";
      router.push(safe);
      router.refresh();
    } catch {
      setError("Something went wrong. Try again.");
      setSubmitting(false);
    }
  }

  return (
    <form
      onSubmit={onSubmit}
      method="post"
      action="/tools/login/submit"
      autoComplete="off"
      className="space-y-5"
    >
      <div className="space-y-2">
        <label htmlFor="username" className="text-label uppercase text-ink-secondary">
          ID
        </label>
        <input
          id="username"
          name="username"
          type="text"
          autoComplete="username"
          required
          value={username}
          onChange={(e) => setUsername(e.target.value)}
          className="w-full bg-elevated border border-line rounded-sm px-3 py-3 text-body-md text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand-red"
        />
      </div>
      <div className="space-y-2">
        <label htmlFor="password" className="text-label uppercase text-ink-secondary">
          Password
        </label>
        <input
          id="password"
          name="password"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
          className="w-full bg-elevated border border-line rounded-sm px-3 py-3 text-body-md text-ink placeholder:text-ink-muted focus:outline-none focus:border-brand-red"
        />
      </div>

      {error && (
        <p role="alert" className="text-body-sm text-danger border border-danger/40 bg-danger/10 px-4 py-2.5 rounded-sm">
          {error}
        </p>
      )}

      <Button type="submit" variant="primary" size="lg" className="w-full" disabled={submitting}>
        <Lock strokeWidth={1.5} className="h-5 w-5" />
        {submitting ? "Checking…" : "Sign in"}
      </Button>
    </form>
  );
}

export default function ToolsLoginPage() {
  return (
    <section className="container-wide py-24 md:py-32">
      <div className="mx-auto max-w-md">
        <div className="border border-line bg-surface p-8 md:p-10">
          <div className="mb-8 space-y-2">
            <p className="text-label uppercase text-ink-muted">Admin tools</p>
            <h1 className="font-display text-display-sm text-ink leading-none">
              Admin sign in
            </h1>
            <p className="text-body-sm text-ink-secondary">
              Everything past this door is for LoLMK admins. Shared base ID and
              password. Ask an admin if you need access.
            </p>
          </div>
          <Suspense fallback={null}>
            <LoginForm />
          </Suspense>
          <p className="mt-6 text-body-sm text-ink-muted">
            <Link href="/tools" className="text-brand-blue-bright hover:text-ink underline underline-offset-4">
              Back to /tools
            </Link>
          </p>
        </div>
      </div>
    </section>
  );
}
