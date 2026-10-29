import { createFileRoute, Link, useNavigate } from "@tanstack/react-router";
import { useEffect, useState } from "react";
import { Btn } from "@/components/kit";
import { HostLedger } from "@/components/HostLedger";
import { CODE_ALPHABET } from "@/lib/mock";
import { getRecent, type Recent } from "@/lib/store";

export const Route = createFileRoute("/")({
  head: () => ({
    meta: [
      { title: "Settld — split the restaurant bill" },
      { name: "description", content: "Start a table, everyone taps what they had, and pay the host back in seconds." },
      { property: "og:title", content: "Settld — split the restaurant bill" },
      { property: "og:description", content: "Start a table, everyone taps what they had, and pay the host back in seconds." },
      { property: "og:type", content: "website" },
      { name: "twitter:card", content: "summary_large_image" },
    ],
  }),
  component: Home,
});

function Home() {
  const navigate = useNavigate();
  const [code, setCode] = useState("");
  const [recent, setRecent] = useState<Recent[]>([]);
  useEffect(() => {
    setRecent(getRecent());
  }, []);
  const clean = (v: string) => v.toUpperCase().split("").filter((c) => CODE_ALPHABET.includes(c)).join("").slice(0, 4);

  return (
    <main className="phone-page flex flex-col gap-6">
      <header className="pt-6">
        <p className="font-mono text-xs uppercase tracking-[0.3em] text-muted-foreground">— receipt no. 0001 —</p>
        <h1 className="mt-2 text-5xl leading-none">Sett<span className="text-primary">ld</span></h1>
        <p className="mt-3 text-muted-foreground">Everyone taps what they had. Nobody does maths.</p>
      </header>

      <HostLedger />

      <Link to="/new" className="receipt flex min-h-24 items-center justify-between gap-4 bg-primary p-5 text-primary-foreground">
        <span>
          <span className="block font-display text-2xl">Start a table</span>
          <span className="text-sm opacity-90">You paid? Get everyone to pay you back.</span>
        </span>
        <span className="text-3xl">→</span>
      </Link>

      <form
        className="receipt p-5"
        onSubmit={(e) => { e.preventDefault(); if (code.length === 4) void navigate({ to: "/t/$code", params: { code } }); }}
      >
        <h2 className="text-xl">Join</h2>
        <p className="text-sm text-muted-foreground">Got a 4-character code?</p>
        <div className="mt-3 flex gap-2">
          <input
            value={code}
            onChange={(e) => setCode(clean(e.target.value))}
            placeholder="K7Q2"
            aria-label="Table code"
            className="min-h-14 w-full min-w-0 rounded-xl border-2 border-foreground bg-background px-4 text-center font-mono text-3xl tracking-[0.4em] uppercase outline-none focus:border-primary"
          />
          <Btn variant="ink" type="submit" disabled={code.length !== 4} className="min-h-14 px-6">Join</Btn>
        </div>
      </form>

      <section>
        <h2 className="mb-2 text-lg">Your recent tables</h2>
        <div className="receipt divide-y divide-dashed">
          {recent.length === 0 && <p className="p-4 text-sm text-muted-foreground">Tables you start on this phone show up here.</p>}
          {recent.map((r) => (
            <Link key={r.code} to="/t/$code" params={{ code: r.code }} className="flex min-h-16 items-center justify-between gap-3 px-4">
              <span className="min-w-0">
                <span className="block truncate font-semibold">{r.restaurant_name}</span>
                <span className="text-xs text-muted-foreground">{new Date(r.created_at).toLocaleDateString("en-GB")}</span>
              </span>
              <span className="shrink-0 font-mono text-lg font-bold tracking-widest">{r.code}</span>
            </Link>
          ))}
        </div>
      </section>
    </main>
  );
}
