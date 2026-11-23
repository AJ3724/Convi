"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { coordsFromInput } from "@/lib/mapLinks";
import {
  formatDuration,
  formatKm,
  googleDirectionsUrl,
  haversineKm,
  reverseCity,
} from "@/lib/geo";
import type { MapPoint } from "@/components/RouteMap";

const RouteMap = dynamic(() => import("@/components/RouteMap"), {
  ssr: false,
  loading: () => (
    <div className="h-80 w-full animate-pulse rounded-2xl bg-gray-200 dark:bg-zinc-800 sm:h-96" />
  ),
});

type Item = {
  key: string;
  table: "places" | "hot_locations";
  id: string;
  name: string;
  description: string | null;
  address: string | null;
  city: string | null;
  lat: number;
  lng: number;
  source: string;
};
type Stop = { id: string; label: string; lat: number; lng: number; itemKey?: string };

type Maybe<T> = T | T[] | null;
type PlaceRow = {
  id: string;
  name: string;
  address: string | null;
  description: string | null;
  city: string | null;
  latitude: number | null;
  longitude: number | null;
  folders: Maybe<{ name: string }>;
};
type HotRow = {
  id: string;
  name: string;
  description: string | null;
  city: string | null;
  latitude: number;
  longitude: number;
};

const first = <T,>(x: Maybe<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x);
const norm = (c: string | null) => (c ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const NONE = "__none__";

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-400 px-3 text-sm";
const smallBtn =
  "inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-gray-400 px-2 text-sm disabled:opacity-40";
const input =
  "w-full min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-base";
const chip =
  "inline-flex min-h-9 items-center rounded-full border px-3 text-sm whitespace-nowrap";

export default function MapBuilderPage() {
  const supabase = useMemo(() => createClient(), []);

  const [items, setItems] = useState<Item[]>([]);
  const [hidden, setHidden] = useState(0);
  const [error, setError] = useState("");
  const [cityFilter, setCityFilter] = useState<string>("all");
  const [search, setSearch] = useState("");

  const [stops, setStops] = useState<Stop[]>([]);
  const [customInput, setCustomInput] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [adding, setAdding] = useState(false);
  const [locating, setLocating] = useState(false);

  const [followRoads, setFollowRoads] = useState(true);
  const [route, setRoute] = useState<{
    key: string;
    path: [number, number][];
    km: number;
    sec: number;
  } | null>(null);
  const [failedKey, setFailedKey] = useState("");

  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState("");
  const cancelDetect = useRef(false);

  const load = useCallback(async () => {
    const [pl, hl] = await Promise.all([
      supabase
        .from("places")
        .select("id, name, address, description, city, latitude, longitude, folders(name)"),
      supabase
        .from("hot_locations")
        .select("id, name, description, city, latitude, longitude"),
    ]);
    if (pl.error) return setError(pl.error.message);
    if (hl.error) return setError(hl.error.message);

    const out: Item[] = [];
    let skipped = 0;
    for (const p of (pl.data ?? []) as unknown as PlaceRow[]) {
      if (p.latitude === null || p.longitude === null) {
        skipped++;
        continue;
      }
      out.push({
        key: `places:${p.id}`,
        table: "places",
        id: p.id,
        name: p.name,
        description: p.description,
        address: p.address,
        city: p.city,
        lat: p.latitude,
        lng: p.longitude,
        source: `📁 ${first(p.folders)?.name ?? "Folder"}`,
      });
    }
    for (const h of (hl.data ?? []) as unknown as HotRow[]) {
      out.push({
        key: `hot_locations:${h.id}`,
        table: "hot_locations",
        id: h.id,
        name: h.name,
        description: h.description,
        address: null,
        city: h.city,
        lat: h.latitude,
        lng: h.longitude,
        source: "🔥 Hot location",
      });
    }
    setItems(out);
    setHidden(skipped);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  /* ---------- city filter ---------- */

  const cities = useMemo(() => {
    const m = new Map<string, { label: string; count: number }>();
    let none = 0;
    for (const i of items) {
      const k = norm(i.city);
      if (!k) {
        none++;
        continue;
      }
      const cur = m.get(k);
      if (cur) cur.count++;
      else m.set(k, { label: (i.city ?? "").trim(), count: 1 });
    }
    const list = [...m.entries()]
      .map(([key, v]) => ({ key, ...v }))
      .sort((a, b) => collator.compare(a.label, b.label));
    return { list, none };
  }, [items]);

  const q = search.trim().toLowerCase();
  const shown = useMemo(
    () =>
      items
        .filter((i) => {
          if (cityFilter === NONE) {
            if (norm(i.city)) return false;
          } else if (cityFilter !== "all" && norm(i.city) !== cityFilter) {
            return false;
          }
          if (!q) return true;
          return [i.name, i.description, i.address, i.city, i.source].some((v) =>
            (v ?? "").toLowerCase().includes(q)
          );
        })
        .sort((a, b) => collator.compare(a.name, b.name)),
    [items, cityFilter, q]
  );

  async function editCity(it: Item) {
    const v = window.prompt(`City for "${it.name}" (leave empty to clear):`, it.city ?? "");
    if (v === null) return;
    const city = v.trim() || null;
    const { error } = await supabase.from(it.table).update({ city }).eq("id", it.id);
    if (error) return setError(error.message);
    setItems((list) => list.map((x) => (x.key === it.key ? { ...x, city } : x)));
  }

  async function detectCities() {
    const missing = items.filter((i) => !norm(i.city));
    if (missing.length === 0) return;
    setError("");
    setDetecting(true);
    cancelDetect.current = false;
    let found = 0;
    let notFound = 0;

    for (let n = 0; n < missing.length; n++) {
      if (cancelDetect.current) break;
      const it = missing[n];
      setDetectMsg(`Detecting ${n + 1} of ${missing.length}...`);
      const city = await reverseCity(it.lat, it.lng);
      if (city) {
        const { error } = await supabase.from(it.table).update({ city }).eq("id", it.id);
        if (error) {
          setError(error.message);
          break;
        }
        setItems((list) => list.map((x) => (x.key === it.key ? { ...x, city } : x)));
        found++;
      } else {
        notFound++;
      }
      await sleep(1100); // Nominatim allows about 1 request per second
    }

    setDetecting(false);
    setDetectMsg(`Done: ${found} found${notFound ? `, ${notFound} not found` : ""}.`);
  }

  /* ---------- trip stops ---------- */

  const selectedKeys = useMemo(
    () => new Set(stops.map((s) => s.itemKey).filter(Boolean) as string[]),
    [stops]
  );

  function toggleItem(i: Item) {
    setStops((list) =>
      list.some((s) => s.itemKey === i.key)
        ? list.filter((s) => s.itemKey !== i.key)
        : [
            ...list,
            { id: crypto.randomUUID(), label: i.name, lat: i.lat, lng: i.lng, itemKey: i.key },
          ]
    );
  }

  function selectAllShown() {
    setStops((list) => {
      const have = new Set(list.map((s) => s.itemKey));
      const add = shown
        .filter((i) => !have.has(i.key))
        .map((i) => ({
          id: crypto.randomUUID(),
          label: i.name,
          lat: i.lat,
          lng: i.lng,
          itemKey: i.key,
        }));
      return [...list, ...add];
    });
  }

  function move(index: number, dir: -1 | 1) {
    setStops((list) => {
      const j = index + dir;
      if (j < 0 || j >= list.length) return list;
      const next = [...list];
      [next[index], next[j]] = [next[j], next[index]];
      return next;
    });
  }

  function rename(id: string, label: string) {
    setStops((list) => list.map((s) => (s.id === id ? { ...s, label } : s)));
  }

  function removeStop(id: string) {
    setStops((list) => list.filter((s) => s.id !== id));
  }

  async function addCustom(e: React.FormEvent) {
    e.preventDefault();
    if (!customInput.trim()) return;
    setError("");
    setAdding(true);
    const { coords, name } = await coordsFromInput(customInput);
    setAdding(false);
    if (!coords) {
      return setError(
        "Couldn't read a location from that. Paste a Google Maps link or type coordinates like 34.4367, 35.8497."
      );
    }
    setStops((list) => [
      ...list,
      {
        id: crypto.randomUUID(),
        label: customLabel.trim() || name || `Stop ${list.length + 1}`,
        lat: coords.lat,
        lng: coords.lng,
      },
    ]);
    setCustomInput("");
    setCustomLabel("");
  }

  function addMyLocation() {
    setError("");
    if (!("geolocation" in navigator)) return setError("This browser can't read your location.");
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setLocating(false);
        setStops((list) => [
          ...list,
          {
            id: crypto.randomUUID(),
            label: customLabel.trim() || "My location",
            lat: p.coords.latitude,
            lng: p.coords.longitude,
          },
        ]);
        setCustomLabel("");
      },
      () => {
        setLocating(false);
        setError("Couldn't get your location. Allow location access and try again.");
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  /* ---------- route ---------- */

  const coordsKey = stops.map((s) => `${s.lat},${s.lng}`).join("|");

  useEffect(() => {
    if (!followRoads || !coordsKey) return;
    const pts = coordsKey.split("|").map((s) => s.split(",").map(Number));
    if (pts.length < 2) return;

    const ctrl = new AbortController();
    const timer = setTimeout(async () => {
      try {
        const coords = pts.map(([la, ln]) => `${ln},${la}`).join(";");
        const res = await fetch(
          `https://router.project-osrm.org/route/v1/driving/${coords}?overview=full&geometries=geojson`,
          { signal: ctrl.signal }
        );
        const data = await res.json();
        const r = data?.routes?.[0];
        if (data?.code !== "Ok" || !r) throw new Error("no route");
        setRoute({
          key: coordsKey,
          path: r.geometry.coordinates.map(
            ([ln, la]: [number, number]) => [la, ln] as [number, number]
          ),
          km: r.distance / 1000,
          sec: r.duration,
        });
      } catch {
        if (!ctrl.signal.aborted) setFailedKey(coordsKey);
      }
    }, 500);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [coordsKey, followRoads]);

  const road = followRoads && route && route.key === coordsKey ? route : null;
  const routing = followRoads && stops.length >= 2 && !road && failedKey !== coordsKey;
  const roadFailed = followRoads && stops.length >= 2 && failedKey === coordsKey && !road;

  const straightKm = useMemo(() => {
    let sum = 0;
    for (let i = 1; i < stops.length; i++) sum += haversineKm(stops[i - 1], stops[i]);
    return sum;
  }, [stops]);

  const points: MapPoint[] = useMemo(
    () => stops.map((s) => ({ id: s.id, label: `${s.label}`, lat: s.lat, lng: s.lng })),
    [stops]
  );

  const gmaps = googleDirectionsUrl(stops);
  const shareText =
    `Trip (${stops.length} stops)\n` +
    stops.map((s, i) => `${i + 1}. ${s.label}`).join("\n") +
    (gmaps ? `\n${gmaps}` : "");

  const chipOn = "border-indigo-600 bg-indigo-600 text-white";
  const chipOff = "border-gray-400";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">🗺 Map builder</h1>
        <Link href="/dashboard" className={btn}>Back</Link>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* ===== 1. Find locations ===== */}
      <section className="space-y-3">
        <h2 className="text-lg font-semibold">1. Pick locations</h2>

        <div className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-1 sm:mx-0 sm:flex-wrap sm:overflow-visible sm:px-0">
          <button
            className={`${chip} ${cityFilter === "all" ? chipOn : chipOff}`}
            onClick={() => setCityFilter("all")}
          >
            All ({items.length})
          </button>
          {cities.list.map((c) => (
            <button
              key={c.key}
              className={`${chip} ${cityFilter === c.key ? chipOn : chipOff}`}
              onClick={() => setCityFilter(c.key)}
            >
              {c.label} ({c.count})
            </button>
          ))}
          {cities.none > 0 && (
            <button
              className={`${chip} ${cityFilter === NONE ? chipOn : chipOff}`}
              onClick={() => setCityFilter(NONE)}
            >
              No city ({cities.none})
            </button>
          )}
        </div>

        <input
          className={input}
          placeholder="Search name, description, address or city"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />

        <div className="flex flex-wrap items-center gap-2">
          <button className={btn} onClick={selectAllShown} disabled={shown.length === 0}>
            ☑ Select all shown ({shown.length})
          </button>
          {cities.none > 0 && !detecting && (
            <button className={btn} onClick={detectCities}>
              🏙 Detect missing cities ({cities.none})
            </button>
          )}
          {detecting && (
            <button className={btn} onClick={() => (cancelDetect.current = true)}>
              Stop
            </button>
          )}
        </div>
        {detectMsg && <p className="text-xs text-gray-500">{detectMsg}</p>}
        {hidden > 0 && (
          <p className="text-xs text-gray-500">
            {hidden} saved place{hidden > 1 ? "s have" : " has"} no coordinates and can&apos;t be
            mapped.
          </p>
        )}

        <ul className="max-h-[60dvh] space-y-2 overflow-y-auto">
          {shown.map((i) => (
            <li
              key={i.key}
              className="flex items-start gap-2 rounded-xl border border-gray-300 p-3 dark:border-gray-700"
            >
              <label className="flex min-w-0 flex-1 cursor-pointer items-start gap-3">
                <input
                  type="checkbox"
                  className="mt-1 h-6 w-6 shrink-0"
                  checked={selectedKeys.has(i.key)}
                  onChange={() => toggleItem(i)}
                />
                <span className="block min-w-0 space-y-0.5">
                  <span className="block break-words font-medium">{i.name}</span>
                  {(i.description || i.address) && (
                    <span className="block break-words text-sm text-gray-500">
                      {i.description || i.address}
                    </span>
                  )}
                  <span className="block text-xs text-gray-500">
                    {i.source} · 🏙 {i.city?.trim() || "no city"}
                  </span>
                </span>
              </label>
              <button
                className={smallBtn}
                onClick={() => editCity(i)}
                aria-label={`Edit city for ${i.name}`}
                title="Edit city"
              >
                ✏️
              </button>
            </li>
          ))}
          {shown.length === 0 && (
            <p className="text-gray-500">
              {items.length === 0
                ? "No saved locations with coordinates yet."
                : "Nothing matches this filter."}
            </p>
          )}
        </ul>
      </section>

      {/* ===== 2. Trip ===== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">2. Your trip ({stops.length})</h2>
          {stops.length > 0 && (
            <button className={btn} onClick={() => setStops([])}>
              Clear trip
            </button>
          )}
        </div>

        {/* Add a stop */}
        <form
          onSubmit={addCustom}
          className="space-y-2 rounded-2xl border border-gray-300 p-3 dark:border-gray-700"
        >
          <p className="text-sm font-medium">Add a stop</p>
          <input
            className={input}
            placeholder="Google Maps link or coordinates"
            value={customInput}
            onChange={(e) => setCustomInput(e.target.value)}
            inputMode="url"
          />
          <input
            className={input}
            placeholder="Label for this stop (optional)"
            value={customLabel}
            onChange={(e) => setCustomLabel(e.target.value)}
          />
          <div className="flex gap-2">
            <button
              disabled={adding || !customInput.trim()}
              className="min-h-11 flex-1 rounded-lg bg-indigo-600 font-medium text-white disabled:opacity-50"
            >
              {adding ? "Reading..." : "+ Add stop"}
            </button>
            <button type="button" className={btn} onClick={addMyLocation} disabled={locating}>
              {locating ? "..." : "📍 My location"}
            </button>
          </div>
        </form>

        {stops.length === 0 ? (
          <p className="text-gray-500">
            Tick locations above, or add stops by link, coordinates or your current position.
          </p>
        ) : (
          <>
            <ol className="space-y-2">
              {stops.map((s, i) => (
                <li
                  key={s.id}
                  className="flex items-center gap-2 rounded-xl border border-gray-300 p-2 dark:border-gray-700"
                >
                  <span
                    className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                    style={{
                      background:
                        i === 0 && stops.length > 1
                          ? "#16a34a"
                          : i === stops.length - 1 && stops.length > 1
                          ? "#dc2626"
                          : "#4f46e5",
                    }}
                  >
                    {i + 1}
                  </span>
                  <div className="min-w-0 flex-1">
                    <input
                      className="w-full min-h-10 bg-transparent text-base font-medium outline-none"
                      value={s.label}
                      onChange={(e) => rename(s.id, e.target.value)}
                      aria-label={`Label for stop ${i + 1}`}
                    />
                    <p className="font-mono text-xs text-gray-500">
                      {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                    </p>
                  </div>
                  <button className={smallBtn} onClick={() => move(i, -1)} disabled={i === 0} aria-label="Move up">
                    ▲
                  </button>
                  <button
                    className={smallBtn}
                    onClick={() => move(i, 1)}
                    disabled={i === stops.length - 1}
                    aria-label="Move down"
                  >
                    ▼
                  </button>
                  <button
                    className={`${smallBtn} text-red-500`}
                    onClick={() => removeStop(s.id)}
                    aria-label="Remove stop"
                  >
                    ✕
                  </button>
                </li>
              ))}
            </ol>

            <label className="flex min-h-11 items-center gap-3 text-sm">
              <input
                type="checkbox"
                className="h-5 w-5"
                checked={followRoads}
                onChange={(e) => setFollowRoads(e.target.checked)}
              />
              Follow roads (driving route)
            </label>

            <RouteMap points={points} path={road ? road.path : null} />

            {stops.length >= 2 && (
              <div className="space-y-1 text-sm">
                {routing && <p className="text-gray-500">Calculating route...</p>}
                {road && (
                  <p className="font-medium">
                    🚗 {formatKm(road.km)} · {formatDuration(road.sec)} by car
                  </p>
                )}
                {!road && !routing && (
                  <p className="font-medium">≈ {formatKm(straightKm)} in a straight line</p>
                )}
                {roadFailed && (
                  <p className="text-amber-600">
                    Couldn&apos;t load the road route, so straight dashed lines are shown.
                  </p>
                )}
              </div>
            )}

            <div className="flex flex-wrap gap-2">
              {gmaps && (
                <a href={gmaps} target="_blank" rel="noopener noreferrer" className={btn}>
                  🧭 Open in Google Maps
                </a>
              )}
              {gmaps && (
                <a
                  href={`https://wa.me/?text=${encodeURIComponent(shareText)}`}
                  target="_blank"
                  rel="noopener noreferrer"
                  className={btn}
                >
                  💬 Share
                </a>
              )}
            </div>
            {stops.length > 11 && (
              <p className="text-xs text-amber-600">
                Google Maps links support 11 stops, so only the first 11 are included there. The map
                above shows all of them.
              </p>
            )}
          </>
        )}
      </section>
    </main>
  );
}