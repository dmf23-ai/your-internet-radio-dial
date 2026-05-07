"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { getSupabase } from "@/lib/supabase/client";
import type { MetricsResponse } from "@/app/api/admin/metrics/route";

const ADMIN_EMAIL = "dmf23@dawgranch.org";

type LoadState =
  | { kind: "checking" }
  | { kind: "unauthorized" }
  | { kind: "loading" }
  | { kind: "loaded"; data: MetricsResponse }
  | { kind: "error"; message: string };

/**
 * Dashboard — client component. Two stages:
 *   1. Wait for the supabase auth session. If email !== ADMIN_EMAIL, render
 *      a deliberately uninformative "nothing here" page so a curious
 *      logged-in stranger doesn't even learn this route's purpose.
 *   2. With a valid admin session, fetch /api/admin/metrics and render the
 *      walnut-cabinet tile grid.
 *
 * The API route re-validates the bearer token server-side, so spoofing the
 * client gate gets you nothing.
 */
export default function Dashboard() {
  const [state, setState] = useState<LoadState>({ kind: "checking" });

  const fetchMetrics = useCallback(async () => {
    setState({ kind: "loading" });
    try {
      const sb = getSupabase();
      if (!sb) {
        setState({ kind: "error", message: "Supabase not configured" });
        return;
      }
      const {
        data: { session },
      } = await sb.auth.getSession();
      const token = session?.access_token;
      if (!token) {
        setState({ kind: "unauthorized" });
        return;
      }
      const res = await fetch("/api/admin/metrics", {
        headers: { Authorization: `Bearer ${token}` },
        cache: "no-store",
      });
      if (res.status === 403) {
        setState({ kind: "unauthorized" });
        return;
      }
      if (!res.ok) {
        setState({ kind: "error", message: `error ${res.status}` });
        return;
      }
      const data = (await res.json()) as MetricsResponse;
      setState({ kind: "loaded", data });
    } catch (e) {
      setState({ kind: "error", message: (e as Error).message });
    }
  }, []);

  // First-load gate: check the session, then fire the metrics fetch.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      const sb = getSupabase();
      if (!sb) {
        if (!cancelled) setState({ kind: "unauthorized" });
        return;
      }
      const {
        data: { session },
      } = await sb.auth.getSession();
      const email = session?.user?.email?.toLowerCase();
      if (!email || email !== ADMIN_EMAIL.toLowerCase()) {
        if (!cancelled) setState({ kind: "unauthorized" });
        return;
      }
      if (!cancelled) await fetchMetrics();
    })();
    return () => {
      cancelled = true;
    };
  }, [fetchMetrics]);

  if (state.kind === "checking" || state.kind === "loading") {
    return <Centered>Tuning in…</Centered>;
  }
  if (state.kind === "unauthorized") {
    return (
      <Centered>
        <p className="font-display text-2xl text-ivory-soft">
          Nothing to see here.
        </p>
        <Link
          href="/"
          className="mt-4 text-sm uppercase tracking-[0.2em] text-brass-300 hover:text-brass-100"
        >
          ← Back to the dial
        </Link>
      </Centered>
    );
  }
  if (state.kind === "error") {
    return (
      <Centered>
        <p className="font-display text-2xl text-amber-warm">Static.</p>
        <p className="mt-2 text-sm text-ivory-soft/60">{state.message}</p>
        <button
          onClick={fetchMetrics}
          className="mt-4 px-4 py-2 text-xs uppercase tracking-[0.2em] surface-brass text-walnut-900 rounded shadow-brass-ring"
        >
          Retry
        </button>
      </Centered>
    );
  }

  return <Loaded data={state.data} onRefresh={fetchMetrics} />;
}

// ---------- chrome ----------

function Centered({ children }: { children: React.ReactNode }) {
  return (
    <main className="min-h-screen w-full flex items-center justify-center p-8">
      <div className="flex flex-col items-center text-center">{children}</div>
    </main>
  );
}

// ---------- loaded view ----------

function Loaded({
  data,
  onRefresh,
}: {
  data: MetricsResponse;
  onRefresh: () => void;
}) {
  const generated = useMemo(() => {
    try {
      return new Date(data.generatedAt).toLocaleString();
    } catch {
      return data.generatedAt;
    }
  }, [data.generatedAt]);

  return (
    <main className="min-h-screen w-full p-4 sm:p-8">
      <div className="mx-auto max-w-7xl space-y-6">
        {/* Cabinet header — engraved brass plate */}
        <header className="surface-wood rounded-2xl p-6 sm:p-8 shadow-2xl border border-walnut-900/60">
          <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
            <div>
              <p className="text-xs uppercase tracking-[0.3em] text-brass-300/80">
                Your Internet Radio Dial
              </p>
              <h1 className="font-display text-3xl sm:text-4xl text-ivory-dial mt-1">
                Station Log
              </h1>
              <p className="text-xs text-ivory-soft/50 mt-2">
                Last refreshed {generated} · Window: {data.windowDays} days
              </p>
            </div>
            <div className="flex items-center gap-3">
              <Link
                href="/"
                className="text-xs uppercase tracking-[0.2em] text-brass-300/80 hover:text-brass-100"
              >
                ← Dial
              </Link>
              <button
                onClick={onRefresh}
                className="px-4 py-2 text-xs uppercase tracking-[0.2em] surface-brass text-walnut-900 rounded shadow-brass-ring active:translate-y-px"
              >
                Refresh
              </button>
            </div>
          </div>
        </header>

        {/* Big counter row — four brass-bezeled tiles */}
        <section className="grid grid-cols-2 lg:grid-cols-4 gap-4">
          <CounterTile
            label="Total Visitors"
            value={data.users.total.toLocaleString()}
            sub={`${data.users.permanent} signed in · ${data.users.anonymous} guest`}
          />
          <CounterTile
            label="Page Views"
            value={data.pageViews.total.toLocaleString()}
          />
          <CounterTile
            label="Listening (all-time)"
            value={formatMinutes(data.listening.allTimeMinutes)}
            sub={
              data.listening.avgSessionMinutes !== null
                ? `Avg session ${data.listening.avgSessionMinutes} min`
                : "No sessions yet"
            }
          />
          <CounterTile
            label="Song IDs"
            value={data.songIds.allTime.toLocaleString()}
            sub={
              data.songIds.hitRatePct !== null
                ? `${data.songIds.hitRatePct}% hit rate`
                : "—"
            }
          />
        </section>

        {/* Period breakdown row */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <PeriodTile
            title="Listening minutes"
            cols={[
              { label: "24 h", value: formatMinutes(data.listening.last24hMinutes) },
              { label: "7 d", value: formatMinutes(data.listening.last7dMinutes) },
              { label: "30 d", value: formatMinutes(data.listening.last30dMinutes) },
            ]}
          />
          <PeriodTile
            title="Song-ID requests"
            cols={[
              { label: "24 h", value: data.songIds.last24h.toLocaleString() },
              { label: "7 d", value: data.songIds.last7d.toLocaleString() },
              { label: "30 d", value: data.songIds.last30d.toLocaleString() },
            ]}
          />
        </section>

        {/* Daily activity bar charts */}
        <section className="grid grid-cols-1 gap-4">
          <BarChartTile
            title="Daily page views"
            sub="Distinct visitors shown in lighter bar"
            primary={data.pageViews.dailyViews}
            secondary={data.pageViews.dailyUniqueVisitors}
          />
          <BarChartTile
            title="New visitors per day"
            primary={data.users.dailyNew}
          />
        </section>

        {/* Two-column rankings */}
        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LeaderboardTile
            title="Top stations · by tunes"
            sub="Last 30 days, scan/reconnect filtered out"
            unit="tunes"
            rows={data.topStations.byTunes}
          />
          <LeaderboardTile
            title="Top stations · by listen time"
            sub="Last 30 days, in minutes"
            unit="min"
            rows={data.topStations.byMinutes}
          />
        </section>

        <section className="grid grid-cols-1 lg:grid-cols-2 gap-4">
          <LeaderboardTile
            title="Tuned in now"
            sub="Last station per active user"
            unit="users"
            rows={data.tunedNow}
          />
          <SuggestionsTile suggestions={data.suggestions} />
        </section>

        <footer className="text-center text-xs text-ivory-soft/40 py-6">
          M23 · {ADMIN_EMAIL}
        </footer>
      </div>
    </main>
  );
}

// ---------- tile primitives ----------

/** Wraps a tile in a brass-rim, walnut-bezel container. */
function TileFrame({
  children,
  className = "",
}: {
  children: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={
        "surface-wood rounded-xl p-5 border border-walnut-900/60 shadow-xl " +
        className
      }
    >
      {children}
    </div>
  );
}

function TileHeader({
  title,
  sub,
}: {
  title: string;
  sub?: string;
}) {
  return (
    <div className="mb-3">
      <h3 className="text-[0.7rem] uppercase tracking-[0.25em] text-brass-300/80">
        {title}
      </h3>
      {sub && <p className="text-[0.65rem] text-ivory-soft/40 mt-0.5">{sub}</p>}
    </div>
  );
}

function CounterTile({
  label,
  value,
  sub,
}: {
  label: string;
  value: string;
  sub?: string;
}) {
  return (
    <TileFrame>
      <p className="text-[0.65rem] uppercase tracking-[0.25em] text-brass-300/80">
        {label}
      </p>
      <p
        className="font-numerals text-3xl sm:text-4xl text-ivory-dial mt-2"
        style={{ textShadow: "0 0 12px rgba(255,179,71,0.25)" }}
      >
        {value}
      </p>
      {sub && (
        <p className="text-[0.65rem] text-ivory-soft/50 mt-2 truncate">{sub}</p>
      )}
    </TileFrame>
  );
}

function PeriodTile({
  title,
  cols,
}: {
  title: string;
  cols: { label: string; value: string }[];
}) {
  return (
    <TileFrame>
      <TileHeader title={title} />
      <div className="grid grid-cols-3 gap-3">
        {cols.map((c) => (
          <div key={c.label} className="text-center">
            <p className="text-[0.65rem] uppercase tracking-[0.2em] text-ivory-soft/50">
              {c.label}
            </p>
            <p className="font-numerals text-2xl text-ivory-dial mt-1">
              {c.value}
            </p>
          </div>
        ))}
      </div>
    </TileFrame>
  );
}

function BarChartTile({
  title,
  sub,
  primary,
  secondary,
}: {
  title: string;
  sub?: string;
  primary: { day: string; count: number }[];
  secondary?: { day: string; count: number }[];
}) {
  // Max across both series so they share a y-axis.
  const max = Math.max(
    1,
    ...primary.map((d) => d.count),
    ...(secondary?.map((d) => d.count) ?? []),
  );
  // Build a quick lookup for secondary values by day.
  const secMap = new Map<string, number>();
  if (secondary) for (const d of secondary) secMap.set(d.day, d.count);

  return (
    <TileFrame>
      <TileHeader title={title} sub={sub} />
      <div className="flex items-end gap-[2px] h-32 mt-2">
        {primary.map((d) => {
          const primaryPct = (d.count / max) * 100;
          const secVal = secMap.get(d.day) ?? 0;
          const secPct = (secVal / max) * 100;
          return (
            <div
              key={d.day}
              className="flex-1 flex flex-col-reverse min-w-0 group relative"
              title={`${d.day}: ${d.count}${secondary ? ` views, ${secVal} unique` : ""}`}
            >
              {/* primary bar (deep amber) */}
              <div
                className="w-full"
                style={{
                  height: `${primaryPct}%`,
                  background:
                    "linear-gradient(180deg, #ffb347 0%, #c47a1e 100%)",
                  boxShadow: "0 0 4px rgba(255,179,71,0.4)",
                }}
              />
              {/* secondary overlay (lighter, partial) */}
              {secondary && secVal > 0 && (
                <div
                  className="absolute bottom-0 left-0 right-0 pointer-events-none"
                  style={{
                    height: `${secPct}%`,
                    background:
                      "linear-gradient(180deg, rgba(243,229,196,0.55) 0%, rgba(243,229,196,0.15) 100%)",
                  }}
                />
              )}
            </div>
          );
        })}
      </div>
      {/* x-axis labels — show ~5 evenly-spaced days */}
      <div className="flex justify-between mt-2 text-[0.55rem] text-ivory-soft/40 uppercase tracking-wider">
        {pickAxisDays(primary, 5).map((d) => (
          <span key={d}>{shortDay(d)}</span>
        ))}
      </div>
    </TileFrame>
  );
}

function LeaderboardTile({
  title,
  sub,
  unit,
  rows,
}: {
  title: string;
  sub?: string;
  unit: string;
  rows: { stationId: string; stationName: string | null; count: number }[];
}) {
  if (rows.length === 0) {
    return (
      <TileFrame>
        <TileHeader title={title} sub={sub} />
        <p className="text-sm text-ivory-soft/40 italic mt-2">
          No data yet — events will appear as users tune in.
        </p>
      </TileFrame>
    );
  }
  const max = Math.max(...rows.map((r) => r.count));
  return (
    <TileFrame>
      <TileHeader title={title} sub={sub} />
      <ol className="space-y-2">
        {rows.map((r, i) => (
          <li key={r.stationId} className="relative">
            <div className="flex items-baseline gap-2 text-sm">
              <span className="text-ivory-soft/40 text-xs w-5 text-right tabular-nums">
                {i + 1}.
              </span>
              <span
                className="text-ivory-dial truncate flex-1"
                title={r.stationId}
              >
                {r.stationName ?? r.stationId}
              </span>
              <span className="font-numerals text-ivory-dial tabular-nums">
                {r.count.toLocaleString()}
              </span>
              <span className="text-[0.6rem] uppercase tracking-wider text-ivory-soft/40">
                {unit}
              </span>
            </div>
            {/* under-bar */}
            <div
              className="mt-1 h-[2px] rounded-full"
              style={{
                width: `${(r.count / max) * 100}%`,
                background:
                  "linear-gradient(90deg, #c47a1e 0%, #ffb347 100%)",
                boxShadow: "0 0 3px rgba(255,179,71,0.4)",
              }}
            />
          </li>
        ))}
      </ol>
    </TileFrame>
  );
}

function SuggestionsTile({
  suggestions,
}: {
  suggestions: MetricsResponse["suggestions"];
}) {
  if (suggestions.length === 0) {
    return (
      <TileFrame>
        <TileHeader title="Suggestion box" />
        <p className="text-sm text-ivory-soft/40 italic mt-2">No mail yet.</p>
      </TileFrame>
    );
  }
  return (
    <TileFrame>
      <TileHeader
        title="Suggestion box"
        sub={`${suggestions.length} most recent`}
      />
      <ul className="space-y-3 max-h-72 overflow-y-auto pr-2">
        {suggestions.map((s) => (
          <li
            key={s.id}
            className="text-sm text-ivory-dial border-b border-walnut-900/40 pb-2 last:border-0"
          >
            <p className="text-[0.6rem] uppercase tracking-wider text-brass-300/70 mb-1">
              {s.kind === "station" ? "Station nomination" : "Note"} ·{" "}
              {shortDate(s.created_at)}
            </p>
            {s.kind === "station" ? (
              <>
                <p className="font-display text-base text-ivory-dial">
                  {s.station_name ?? "(unnamed)"}
                </p>
                {s.station_url && (
                  <p className="text-[0.65rem] text-ivory-soft/40 truncate">
                    {s.station_url}
                  </p>
                )}
                {s.station_notes && (
                  <p className="text-xs text-ivory-soft/70 mt-1 italic">
                    {s.station_notes}
                  </p>
                )}
              </>
            ) : (
              <p className="text-xs text-ivory-soft/80">{s.message}</p>
            )}
            {s.contact_email && (
              <p className="text-[0.6rem] text-ivory-soft/40 mt-1">
                ↳ {s.contact_email}
              </p>
            )}
          </li>
        ))}
      </ul>
    </TileFrame>
  );
}

// ---------- formatting helpers ----------

function formatMinutes(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = minutes / 60;
  if (hours < 100) return `${hours.toFixed(1)} hr`;
  return `${Math.round(hours).toLocaleString()} hr`;
}

function shortDay(iso: string): string {
  // "2026-05-07" → "May 7"
  const d = new Date(iso + "T00:00:00Z");
  return d.toLocaleDateString(undefined, {
    month: "short",
    day: "numeric",
    timeZone: "UTC",
  });
}

function shortDate(iso: string): string {
  try {
    const d = new Date(iso);
    return d.toLocaleDateString(undefined, {
      month: "short",
      day: "numeric",
    });
  } catch {
    return iso.slice(0, 10);
  }
}

function pickAxisDays(rows: { day: string }[], count: number): string[] {
  if (rows.length <= count) return rows.map((r) => r.day);
  const out: string[] = [];
  const step = (rows.length - 1) / (count - 1);
  for (let i = 0; i < count; i++) {
    out.push(rows[Math.round(i * step)].day);
  }
  return out;
}
