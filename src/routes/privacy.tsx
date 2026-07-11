import { createFileRoute, Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

type PersonalizationSummary = {
  active: boolean;
  clickCount: number;
  topRetailer: string | null;
  topTier: string | null;
  averagePrice: number | null;
};

export const Route = createFileRoute("/privacy")({ component: PrivacyPage });

function PrivacyPage() {
  const [summary, setSummary] = useState<PersonalizationSummary | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "resetting" | "reset">(
    "loading",
  );

  useEffect(() => {
    void fetch("/api/personalization")
      .then((response) => response.json() as Promise<PersonalizationSummary>)
      .then((result) => {
        setSummary(result);
        setStatus("ready");
      })
      .catch(() => setStatus("ready"));
  }, []);

  async function resetPersonalization() {
    setStatus("resetting");
    try {
      await fetch("/api/personalization", { method: "DELETE" });
      setSummary({
        active: false,
        clickCount: 0,
        topRetailer: null,
        topTier: null,
        averagePrice: null,
      });
      setStatus("reset");
    } catch {
      setStatus("ready");
    }
  }

  return (
    <main className="min-h-screen bg-navy px-6 py-20 text-foreground lg:px-10">
      <div className="mx-auto max-w-2xl">
        <Link
          to="/"
          className="text-[10px] uppercase tracking-luxe text-gold hover:text-gold/80"
        >
          ← Back to Veylor
        </Link>

        <div className="mt-10 border border-[rgba(201,169,106,0.18)] p-8">
          <div className="text-[10px] uppercase tracking-luxe text-gold/80">
            Privacy controls
          </div>
          <h1 className="mt-4 font-serif text-4xl">Personalization</h1>
          <p className="mt-5 leading-relaxed text-foreground/65">
            Veylor can learn small shopping preferences from products you explicitly
            click. It does not store your name, email, raw images, IP address, or an
            advertising identifier in this profile.
          </p>

          {status === "loading" ? (
            <p className="mt-8 text-sm text-foreground/50">Loading preference summary…</p>
          ) : (
            <div className="mt-8 grid gap-px bg-[rgba(201,169,106,0.12)] sm:grid-cols-2">
              <SummaryItem label="Personalization" value={summary?.active ? "Active" : "Not active"} />
              <SummaryItem label="Recorded clicks" value={String(summary?.clickCount ?? 0)} />
              <SummaryItem label="Top retailer" value={summary?.topRetailer ?? "Not enough data"} />
              <SummaryItem label="Top tier" value={summary?.topTier ?? "Not enough data"} />
            </div>
          )}

          <button
            type="button"
            onClick={() => void resetPersonalization()}
            disabled={status === "loading" || status === "resetting"}
            className="mt-8 border border-gold px-5 py-3 text-[10px] uppercase tracking-luxe text-gold transition-colors hover:bg-gold hover:text-navy disabled:cursor-not-allowed disabled:opacity-50"
          >
            {status === "resetting"
              ? "Resetting…"
              : status === "reset"
                ? "Personalization reset"
                : "Reset personalization"}
          </button>

          <p className="mt-4 text-xs leading-relaxed text-foreground/45">
            Resetting deletes the anonymous preference row and removes the first-party
            shopper cookie from this browser. Future clicks may start a new profile.
          </p>
        </div>
      </div>
    </main>
  );
}

function SummaryItem({ label, value }: { label: string; value: string }) {
  return (
    <div className="bg-navy p-4">
      <div className="text-[9px] uppercase tracking-luxe text-foreground/40">{label}</div>
      <div className="mt-2 text-sm text-foreground/85">{value}</div>
    </div>
  );
}
