"use client";

import dynamic from "next/dynamic";
import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import { coordsFromInput } from "@/lib/mapLinks";
import { formatDuration, formatKm, googleDirectionsUrl, reverseCity } from "@/lib/geo";
import { planTrip, type Leg } from "@/lib/routing";
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
type Stop = { id: string; lat: number; lng: number; itemKey?: string };
type SavedStop = Stop & { label: string };
type Pos = { lat: number; lng: number; acc: number; at: number };
type Mode = "off" | "origin" | "free";
type PlanState = {
  key: string;
  orderIds: string[];
  path: [number, number][] | null;
  km: number;
  sec: number | null;
  legs: Record<string, Leg | null>;
};
type SavedMap = {
  id: string;
  name: string;
  mode: Mode;
  origin: Pos | null;
  stops: SavedStop[];
  updated_at: string;
};
type Draft = {
  stops: Stop[];
  labels: Record<string, string>;
  mode: Mode;
  origin: Pos | null;
  mapId: string | null;
  name: string;
};
type SaveState = "idle" | "saving" | "saved" | "error";

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

const DRAFT_KEY = "convi:map-draft:v1";

const first = <T,>(x: Maybe<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x);
const norm = (c: string | null) => (c ?? "").trim().toLowerCase().replace(/\s+/g, " ");
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const uid = () => Math.random().toString(36).slice(2) + Date.now().toString(36);
const NONE = "__none__";

const cleanOrigin = (o: Pos | null | undefined): Pos | null =>
  o && Number.isFinite(o.lat) && Number.isFinite(o.lng)
    ? { lat: o.lat, lng: o.lng, acc: o.acc ?? 0, at: o.at ?? 0 }
    : null;

const cleanStop = (x: SavedStop): SavedStop => ({
  id: x.id,
  lat: x.lat,
  lng: x.lng,
  label: x.label ?? "",
  ...(x.itemKey ? { itemKey: x.itemKey } : {}),
});

function planKey(mode: Mode, origin: Pos | null, stops: Stop[]) {
  const o = mode === "origin" && origin ? `${origin.lat},${origin.lng}` : "";
  const s = stops
    .map((x) => `${x.id}:${x.lat},${x.lng}`)
    .sort()
    .join(";");
  return `${mode}|${o}|${s}`;
}

function getPosition(): Promise<Omit<Pos, "at">> {
  return new Promise((resolve, reject) => {
    if (!("geolocation" in navigator)) return reject({ code: 0 });
    navigator.geolocation.getCurrentPosition(
      (p) => resolve({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy }),
      (e) => reject(e),
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  });
}

const legText = (l: Leg | null | undefined) =>
  l ? `${formatKm(l.km)}${l.sec !== null ? ` · ${formatDuration(l.sec)}` : ""}` : "";

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
  const [labels, setLabels] = useState<Record<string, string>>({});
  const [customInput, setCustomInput] = useState("");
  const [customLabel, setCustomLabel] = useState("");
  const [adding, setAdding] = useState(false);

  const [mode, setMode] = useState<Mode>("off");
  const [origin, setOrigin] = useState<Pos | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [plan, setPlan] = useState<PlanState | null>(null);

  const [detecting, setDetecting] = useState(false);
  const [detectMsg, setDetectMsg] = useState("");
  const cancelDetect = useRef(false);

  // saved maps
  const [maps, setMaps] = useState<SavedMap[]>([]);
  const [mapsError, setMapsError] = useState("");
  const [mapId, setMapId] = useState<string | null>(null);
  const [mapName, setMapName] = useState("");
  const [saveState, setSaveState] = useState<SaveState>("idle");
  const [hydrated, setHydrated] = useState(false);
  const [restored, setRestored] = useState(false);
  const lastSaved = useRef<string | null>(null);
  const tripRef = useRef<HTMLElement>(null);

  /* ---------- loading data ---------- */

  const load = useCallback(async () => {
    const [pl, hl] = await Promise.all([
      supabase
        .from("places")
        .select("id, name, address, description, city, latitude, longitude, folders(name)"),
      supabase.from("hot_locations").select("id, name, description, city, latitude, longitude"),
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

  const loadMaps = useCallback(async () => {
    const { data, error } = await supabase
      .from("saved_maps")
      .select("id, name, mode, origin, stops, updated_at")
      .order("updated_at", { ascending: false });
    if (error) {
      setMapsError(
        error.message.includes("saved_maps")
          ? "Saved maps table not found. Run the saved_maps SQL in Supabase first."
          : error.message
      );
      return;
    }
    setMapsError("");
    setMaps((data ?? []) as unknown as SavedMap[]);
  }, [supabase]);

  useEffect(() => {
    load();
    loadMaps();
  }, [load, loadMaps]);

  /* ---------- restore the unsaved draft on this device ---------- */

  useEffect(() => {
    try {
      const raw = localStorage.getItem(DRAFT_KEY);
      if (raw) {
        const d = JSON.parse(raw) as Draft;
        if (Array.isArray(d.stops) && d.stops.length > 0) {
          const o = cleanOrigin(d.origin);
          setStops(d.stops);
          setLabels(d.labels ?? {});
          setMode(d.mode === "origin" && !o ? "off" : d.mode ?? "off");
          setOrigin(o);
          setMapId(d.mapId ?? null);
          setMapName(d.name ?? "");
          setRestored(true);
        }
      }
    } catch {
      // ignore a broken draft
    }
    setHydrated(true);
  }, []);

  useEffect(() => {
    if (!hydrated) return;
    try {
      if (stops.length === 0 && !mapId) localStorage.removeItem(DRAFT_KEY);
      else {
        const d: Draft = { stops, labels, mode, origin, mapId, name: mapName };
        localStorage.setItem(DRAFT_KEY, JSON.stringify(d));
      }
    } catch {
      // storage can be unavailable (private mode); saving to the database still works
    }
  }, [hydrated, stops, labels, mode, origin, mapId, mapName]);

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

  /* ---------- choosing stops ---------- */

  const selectedKeys = useMemo(
    () => new Set(stops.map((s) => s.itemKey).filter(Boolean) as string[]),
    [stops]
  );

  function toggleItem(i: Item) {
    const existing = stops.find((s) => s.itemKey === i.key);
    if (existing) {
      setStops((list) => list.filter((s) => s.id !== existing.id));
      return;
    }
    const id = uid();
    setStops((list) => [...list, { id, lat: i.lat, lng: i.lng, itemKey: i.key }]);
    setLabels((m) => ({ ...m, [id]: i.name }));
  }

  function selectAllShown() {
    const have = new Set(stops.map((s) => s.itemKey));
    const add = shown.filter((i) => !have.has(i.key));
    if (add.length === 0) return;
    const newStops = add.map((i) => ({ id: uid(), lat: i.lat, lng: i.lng, itemKey: i.key }));
    setStops((list) => [...list, ...newStops]);
    setLabels((m) => {
      const next = { ...m };
      newStops.forEach((s, k) => {
        next[s.id] = add[k].name;
      });
      return next;
    });
  }

  function rename(id: string, label: string) {
    setLabels((m) => ({ ...m, [id]: label }));
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
    const id = uid();
    setStops((list) => [...list, { id, lat: coords.lat, lng: coords.lng }]);
    setLabels((m) => ({
      ...m,
      [id]: customLabel.trim() || name || `Stop ${stops.length + 1}`,
    }));
    setCustomInput("");
    setCustomLabel("");
  }

  /* ---------- my location + automatic route ---------- */

  async function locate() {
    setGeoError("");
    setLocating(true);
    try {
      const p = await getPosition();
      setOrigin({ ...p, at: Date.now() });
      setMode("origin");
    } catch (e) {
      const code = (e as { code?: number }).code;
      setGeoError(
        code === 1
          ? "Location permission was denied. Allow it in your browser's site settings, then try again."
          : code === 2
          ? "Your location is unavailable. Turn on GPS / location services and try again."
          : code === 3
          ? "Timed out getting your location. Try again, ideally outdoors or near a window."
          : "This browser can't read your location."
      );
    } finally {
      setLocating(false);
    }
  }

  useEffect(() => {
    if (mode === "off" || stops.length === 0) return;
    if (mode === "origin" && !origin) return;

    const eo = mode === "origin" ? origin : null;
    const key = planKey(mode, origin, stops);
    const ctrl = new AbortController();

    const timer = setTimeout(async () => {
      try {
        const r = await planTrip(eo, stops, ctrl.signal);
        if (ctrl.signal.aborted) return;
        const legs: Record<string, Leg | null> = {};
        r.ordered.forEach((s, i) => {
          legs[s.id] = r.legs[i] ?? null;
        });
        setPlan({
          key,
          orderIds: r.ordered.map((s) => s.id),
          path: r.path,
          km: r.km,
          sec: r.sec,
          legs,
        });
      } catch {
        // cancelled because something changed
      }
    }, 400);

    return () => {
      clearTimeout(timer);
      ctrl.abort();
    };
  }, [mode, origin, stops]);

  const eo = mode === "origin" ? origin : null;
  const ready = mode !== "off" && stops.length > 0 && (mode === "free" || origin !== null);
  const fresh = plan !== null && plan.key === planKey(mode, origin, stops);
  const planning = ready && !fresh;

  const orderedStops = useMemo(() => {
    if (!plan) return stops;
    const byId = new Map(stops.map((s) => [s.id, s]));
    const seen = new Set<string>();
    const out: Stop[] = [];
    for (const id of plan.orderIds) {
      const s = byId.get(id);
      if (s) {
        out.push(s);
        seen.add(id);
      }
    }
    for (const s of stops) if (!seen.has(s.id)) out.push(s);
    return out;
  }, [plan, stops]);

  const points: MapPoint[] = useMemo(() => {
    const pts: MapPoint[] = [];
    const o = mode === "origin" ? origin : null;
    if (o) {
      pts.push({
        id: "origin",
        label: "You are here",
        lat: o.lat,
        lng: o.lng,
        color: "#2563eb",
        text: "★",
      });
    }
    orderedStops.forEach((s, i) => {
      const isLast = i === orderedStops.length - 1 && (orderedStops.length > 1 || !!o);
      const isFirst = i === 0 && !o && orderedStops.length > 1;
      pts.push({
        id: s.id,
        label: labels[s.id] ?? "",
        lat: s.lat,
        lng: s.lng,
        color: isLast ? "#dc2626" : isFirst ? "#16a34a" : "#4f46e5",
        text: String(i + 1),
      });
    });
    return pts;
  }, [orderedStops, labels, mode, origin]);

  /* ---------- saving ---------- */

  const payload = useMemo(
    () => ({
      mode,
      origin: mode === "origin" ? origin : null,
      stops: orderedStops.map((s) => cleanStop({ ...s, label: labels[s.id] ?? "" })),
    }),
    [mode, origin, orderedStops, labels]
  );

  async function saveMap(asCopy = false) {
    setError("");
    if (stops.length === 0) return setError("Add at least one stop before saving.");
    const base = mapName.trim() || `Map ${new Date().toLocaleDateString()}`;
    const name = asCopy ? `${base} (copy)` : base;
    setSaveState("saving");

    if (mapId && !asCopy) {
      const { data, error } = await supabase
        .from("saved_maps")
        .update({ name, ...payload })
        .eq("id", mapId)
        .select("id");
      if (error) {
        setSaveState("error");
        return setError(error.message);
      }
      if (data && data.length > 0) {
        setMapName(name);
        lastSaved.current = JSON.stringify({ n: name, p: payload });
        setSaveState("saved");
        loadMaps();
        return;
      }
      // the saved copy was deleted elsewhere: fall through and create it again
    }

    const { data, error } = await supabase
      .from("saved_maps")
      .insert({ name, ...payload })
      .select("id")
      .single();
    if (error || !data) {
      setSaveState("error");
      return setError(error?.message ?? "Could not save.");
    }
    setMapId(data.id);
    setMapName(name);
    lastSaved.current = JSON.stringify({ n: name, p: payload });
    setSaveState("saved");
    loadMaps();
  }

  // Once a map is saved, every change is saved automatically
  useEffect(() => {
    if (!hydrated || !mapId || stops.length === 0) return;
    const sig = JSON.stringify({ n: mapName.trim(), p: payload });
    if (sig === lastSaved.current) return;

    const timer = setTimeout(async () => {
      setSaveState("saving");
      const { data, error } = await supabase
        .from("saved_maps")
        .update({ name: mapName.trim() || "Untitled map", ...payload })
        .eq("id", mapId)
        .select("id");
      if (error) return setSaveState("error");
      if (!data || data.length === 0) {
        setMapId(null);
        return setSaveState("idle");
      }
      lastSaved.current = sig;
      setSaveState("saved");
      loadMaps();
    }, 1500);

    return () => clearTimeout(timer);
  }, [hydrated, mapId, mapName, payload, stops.length, supabase, loadMaps]);

  function confirmReplace() {
    const unsaved = stops.length > 0 && !mapId;
    return (
      !unsaved ||
      window.confirm("Your current map isn't saved. Replace it? (Tap Cancel, then Save map, to keep it.)")
    );
  }

  function startNew() {
    if (!confirmReplace()) return;
    setStops([]);
    setLabels({});
    setMode("off");
    setOrigin(null);
    setPlan(null);
    setMapId(null);
    setMapName("");
    setGeoError("");
    setSaveState("idle");
    setRestored(false);
    lastSaved.current = null;
  }

  function openMap(m: SavedMap) {
    if (m.id !== mapId && !confirmReplace()) return;
    const o = cleanOrigin(m.origin);
    const md: Mode = m.mode === "origin" && !o ? "off" : m.mode;
    const cleaned = (m.stops ?? []).map(cleanStop);

    lastSaved.current = JSON.stringify({
      n: m.name.trim(),
      p: { mode: md, origin: md === "origin" ? o : null, stops: cleaned },
    });
    setStops(cleaned.map(({ id, lat, lng, itemKey }) => ({ id, lat, lng, itemKey })));
    setLabels(Object.fromEntries(cleaned.map((s) => [s.id, s.label])));
    setMode(md);
    setOrigin(o);
    setPlan(null);
    setMapId(m.id);
    setMapName(m.name);
    setGeoError("");
    setError("");
    setSaveState("saved");
    setRestored(false);
    setTimeout(() => tripRef.current?.scrollIntoView({ behavior: "smooth", block: "start" }), 80);
  }

  async function renameSaved(m: SavedMap) {
    const v = window.prompt("Rename map:", m.name);
    if (v === null || !v.trim()) return;
    if (m.id === mapId) return setMapName(v.trim()); // auto-save writes it
    const { error } = await supabase.from("saved_maps").update({ name: v.trim() }).eq("id", m.id);
    if (error) return setMapsError(error.message);
    loadMaps();
  }

  async function deleteSaved(m: SavedMap) {
    if (!window.confirm(`Delete the saved map "${m.name}"?`)) return;
    const { error } = await supabase.from("saved_maps").delete().eq("id", m.id);
    if (error) return setMapsError(error.message);
    if (m.id === mapId) {
      setMapId(null);
      setSaveState("idle");
    }
    loadMaps();
  }

  /* ---------- derived display values ---------- */

  const showSummary = fresh && plan && (eo ? stops.length >= 1 : stops.length >= 2);
  const gmaps = fresh ? googleDirectionsUrl(orderedStops, mode === "origin") : null;
  const gmapsLimit = mode === "origin" ? 10 : 11;
  const shareText =
    `${mapName.trim() || "Trip"}${mode === "origin" ? " (from my location)" : ""} (${orderedStops.length} stops)\n` +
    orderedStops.map((s, i) => `${i + 1}. ${labels[s.id] ?? ""}`).join("\n") +
    (gmaps ? `\n${gmaps}` : "");

  const saveLine =
    saveState === "saving"
      ? "Saving..."
      : saveState === "error"
      ? "Couldn't save. Check your connection, then tap Save again."
      : mapId
      ? "Saved ✓ Changes save automatically."
      : "Not saved yet. It's kept on this device, but save it to open it anywhere.";

  const chipOn = "border-indigo-600 bg-indigo-600 text-white";
  const chipOff = "border-gray-400";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-6 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">🗺 Map builder</h1>
        <Link href="/dashboard" className={btn}>Back</Link>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {/* ===== Saved maps ===== */}
      <section className="space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">Saved maps ({maps.length})</h2>
          <button className={btn} onClick={startNew}>+ New map</button>
        </div>
        {restored && stops.length > 0 && (
          <p className="text-xs text-gray-500">↩ Restored your map from where you left off.</p>
        )}
        {mapsError && <p className="text-sm text-red-500">{mapsError}</p>}
        <ul className="space-y-2">
          {maps.map((m) => (
            <li
              key={m.id}
              className="flex items-center gap-2 rounded-xl border border-gray-300 p-3 dark:border-gray-700"
            >
              <div className="min-w-0 flex-1">
                <p className="break-words font-medium">
                  {m.name}
                  {m.id === mapId && <span className="text-xs text-indigo-600"> · open</span>}
                </p>
                <p className="text-xs text-gray-500">
                  {m.stops?.length ?? 0} stops · {new Date(m.updated_at).toLocaleString()}
                </p>
              </div>
              <button className={btn} onClick={() => openMap(m)}>Open</button>
              <button className={smallBtn} onClick={() => renameSaved(m)} aria-label="Rename map">
                ✏️
              </button>
              <button
                className={`${smallBtn} text-red-500`}
                onClick={() => deleteSaved(m)}
                aria-label="Delete map"
              >
                🗑
              </button>
            </li>
          ))}
          {maps.length === 0 && !mapsError && (
            <p className="text-gray-500">No saved maps yet. Build one below and save it.</p>
          )}
        </ul>
      </section>

      {/* ===== 1. Pick locations ===== */}
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
      <section ref={tripRef} className="scroll-mt-4 space-y-3">
        <div className="flex items-center justify-between gap-3">
          <h2 className="text-lg font-semibold">2. Your trip ({stops.length})</h2>
          {stops.length > 0 && (
            <button className={btn} onClick={startNew}>
              Clear trip
            </button>
          )}
        </div>

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
          <button
            disabled={adding || !customInput.trim()}
            className="min-h-11 w-full rounded-lg bg-indigo-600 font-medium text-white disabled:opacity-50"
          >
            {adding ? "Reading..." : "+ Add stop"}
          </button>
        </form>

        {stops.length === 0 ? (
          <p className="text-gray-500">
            Tick locations above, or add stops by link or coordinates. You can add them in any
            order, since the best order is worked out for you.
          </p>
        ) : (
          <>
            {/* Save this map */}
            <div className="space-y-2 rounded-2xl border border-gray-300 p-3 dark:border-gray-700">
              <input
                className={input}
                placeholder="Map name, e.g. Zgharta run"
                value={mapName}
                onChange={(e) => setMapName(e.target.value)}
              />
              <div className="flex gap-2">
                <button
                  onClick={() => saveMap(false)}
                  disabled={saveState === "saving"}
                  className="min-h-11 flex-1 rounded-lg bg-indigo-600 font-medium text-white disabled:opacity-50"
                >
                  💾 {mapId ? "Save now" : "Save map"}
                </button>
                {mapId && (
                  <button className={btn} onClick={() => saveMap(true)}>
                    Save a copy
                  </button>
                )}
              </div>
              <p
                className={`text-xs ${
                  saveState === "error" ? "text-red-500" : "text-gray-500"
                }`}
              >
                {saveLine}
              </p>
            </div>

            {/* Create / refresh */}
            {mode === "off" ? (
              <div className="space-y-2">
                <button
                  onClick={locate}
                  disabled={locating}
                  className="flex min-h-14 w-full items-center justify-center rounded-xl bg-indigo-600 text-lg font-medium text-white disabled:opacity-60"
                >
                  {locating ? "Getting your location..." : "🗺 Create map from my location"}
                </button>
                {geoError && (
                  <div className="space-y-2">
                    <p className="text-sm text-red-500">{geoError}</p>
                    <button
                      className={btn}
                      onClick={() => {
                        setGeoError("");
                        setMode("free");
                      }}
                    >
                      Continue without my location
                    </button>
                  </div>
                )}
                <p className="text-xs text-gray-500">
                  The stops will be ordered automatically, starting from where you are now.
                </p>
              </div>
            ) : (
              <div className="space-y-2 rounded-xl bg-gray-100 p-3 text-sm dark:bg-zinc-900">
                {mode === "origin" && origin ? (
                  <p>
                    📍 Starting from your location (±{Math.round(origin.acc)} m, updated{" "}
                    {new Date(origin.at).toLocaleString()})
                  </p>
                ) : (
                  <p>Planned without your location. The best starting stop was chosen.</p>
                )}
                <button className={btn} onClick={locate} disabled={locating}>
                  {locating
                    ? "Locating..."
                    : mode === "origin"
                    ? "🔄 Refresh my location"
                    : "📍 Start from my location"}
                </button>
                {geoError && <p className="text-red-500">{geoError}</p>}
              </div>
            )}

            {/* Stops in visiting order */}
            <ol className="space-y-2">
              {orderedStops.map((s, i) => {
                const leg = fresh && plan ? plan.legs[s.id] : null;
                const last = i === orderedStops.length - 1 && (orderedStops.length > 1 || !!eo);
                const lt = legText(leg);
                return (
                  <li
                    key={s.id}
                    className="flex items-center gap-2 rounded-xl border border-gray-300 p-2 dark:border-gray-700"
                  >
                    <span
                      className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full text-sm font-semibold text-white"
                      style={{
                        background:
                          mode === "off"
                            ? "#6b7280"
                            : last
                            ? "#dc2626"
                            : i === 0 && !eo && orderedStops.length > 1
                            ? "#16a34a"
                            : "#4f46e5",
                      }}
                    >
                      {mode === "off" ? "•" : i + 1}
                    </span>
                    <div className="min-w-0 flex-1">
                      <input
                        className="w-full min-h-10 bg-transparent text-base font-medium outline-none"
                        value={labels[s.id] ?? ""}
                        onChange={(e) => rename(s.id, e.target.value)}
                        aria-label={`Label for stop ${i + 1}`}
                      />
                      <p className="font-mono text-xs text-gray-500">
                        {s.lat.toFixed(5)}, {s.lng.toFixed(5)}
                      </p>
                      {lt && (
                        <p className="text-xs text-gray-500">
                          ↳ {lt} {i === 0 && eo ? "from you" : "from the previous stop"}
                        </p>
                      )}
                    </div>
                    <button
                      className={`${smallBtn} text-red-500`}
                      onClick={() => removeStop(s.id)}
                      aria-label="Remove stop"
                    >
                      ✕
                    </button>
                  </li>
                );
              })}
            </ol>

            {mode !== "off" && (
              <>
                <RouteMap points={points} path={fresh && plan ? plan.path : null} />

                <div className="space-y-1 text-sm">
                  {planning && <p className="text-gray-500">Finding the best route...</p>}
                  {showSummary && plan && (
                    <>
                      <p className="font-medium">
                        {plan.sec !== null
                          ? `🚗 ${formatKm(plan.km)} · ${formatDuration(plan.sec)} by car`
                          : `≈ ${formatKm(plan.km)} in a straight line`}
                      </p>
                      {!plan.path && (
                        <p className="text-amber-600">
                          Couldn&apos;t load road routes right now, so the order is based on
                          straight-line distance and dashed lines are shown. Try refreshing in a
                          moment.
                        </p>
                      )}
                    </>
                  )}
                </div>

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
                {orderedStops.length > gmapsLimit && (
                  <p className="text-xs text-amber-600">
                    Google Maps links support {gmapsLimit} stops
                    {mode === "origin" ? " from your location" : ""}, so only the first{" "}
                    {gmapsLimit} are included there. The map above shows all of them.
                  </p>
                )}
              </>
            )}
          </>
        )}
      </section>
    </main>
  );
}