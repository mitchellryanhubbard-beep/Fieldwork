"use client";

import { Suspense, useState } from "react";
import { useSearchParams } from "next/navigation";
import { toast } from "sonner";

import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { getBrowserSupabase } from "@/lib/supabase/browser";

// Magic-link login. Submit your email, get a sign-in link from
// Supabase, click it, land back on the app already authenticated.

function LoginForm() {
  const params = useSearchParams();
  const next = params.get("next") ?? "/app";
  const [email, setEmail] = useState("");
  const [sent, setSent] = useState(false);
  const [busy, setBusy] = useState(false);

  async function handleSubmit(e: React.FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!email.trim()) {
      toast.error("Enter an email address");
      return;
    }
    setBusy(true);
    try {
      const sb = getBrowserSupabase();
      const redirectTo =
        typeof window !== "undefined"
          ? `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`
          : undefined;
      const { error } = await sb.auth.signInWithOtp({
        email: email.trim(),
        options: { emailRedirectTo: redirectTo, shouldCreateUser: true },
      });
      if (error) {
        toast.error("Couldn't send link", { description: error.message });
      } else {
        setSent(true);
      }
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mx-auto flex min-h-[60vh] max-w-md flex-col justify-center px-4 py-12">
      <h1 className="text-3xl font-semibold tracking-tight">
        Sign in to First-Pass
      </h1>
      <p className="mt-2 text-sm text-foreground/65">
        We&apos;ll email you a one-tap sign-in link — no password to remember.
      </p>

      {sent ? (
        <div className="mt-8 rounded-xl border border-primary/10 bg-card p-5">
          <p className="text-sm font-medium">Check your inbox</p>
          <p className="mt-1 text-sm text-foreground/70">
            We sent a sign-in link to{" "}
            <span className="font-medium text-foreground">{email}</span>.
            Tap it to come back signed in.
          </p>
          <Button
            type="button"
            variant="goldOutline"
            size="sm"
            className="mt-3"
            onClick={() => {
              setSent(false);
              setEmail("");
            }}
          >
            Use a different email
          </Button>
        </div>
      ) : (
        <form onSubmit={handleSubmit} className="mt-8 flex flex-col gap-3">
          <label className="text-sm font-medium text-foreground/80">
            Email address
            <Input
              type="email"
              autoComplete="email"
              required
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              placeholder="you@firm.com"
              className="mt-1"
            />
          </label>
          <Button type="submit" variant="gold" disabled={busy}>
            {busy ? "Sending link…" : "Send sign-in link"}
          </Button>
        </form>
      )}
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={<div className="mx-auto max-w-md p-12">Loading…</div>}>
      <LoginForm />
    </Suspense>
  );
}
