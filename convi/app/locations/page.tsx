"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Loc = {
  id: string;
  name: string;
  description: string | null;
  latitude: number;
  longitude: number;
  accuracy_m: number | null;
  created_at: string;
};
type Pos = { lat: number; lng: number; acc: number };

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-400 px-3 text-sm";
const input =
  "w-full min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-base";

const coordText = (l: { latitude: number; longitude: number }) =>
  `${l.latitude.toFixed(6)}, ${l.longitude.toFixed(6)}`;
const mapUrl = (l: { latitude: number; longitude: number }) =>
  `https://www.google.com/maps?q=${l.latitude},${l.longitude}`;
const whatsappShare = (l: Loc) =>
  `https://wa.me/?text=${encodeURIComponent(`${l.name}\n${mapUrl(l)}`)}`;

export default function LocationsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [items, setItems] = useState<Loc[]>([]);
  const [search, setSearch] = useState("");
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // capture state
  const [pos, setPos] = useState<Pos | null>(null);
  const [locating, setLocating] = useState(false);
  const [geoError, setGeoError] = useState("");
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [saving, setSaving] = useState(false);

  // edit state
  const [eName, setEName] = useState("");
  const [eDesc, setEDesc] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("hot_locations")
      .select("id, name, description, latitude, longitude, accuracy_m, created_at")
      .order("created_at", { ascending: false });
    if (error) setError(error.message);
    else setItems((data as Loc[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function locate() {
    setGeoError("");
    setError("");
    if (!("geolocation" in navigator)) {
      return setGeoError("This browser can't read your location.");
    }
    setLocating(true);
    navigator.geolocation.getCurrentPosition(
      (p) => {
        setPos({ lat: p.coords.latitude, lng: p.coords.longitude, acc: p.coords.accuracy });
        setLocating(false);
      },
      (err) => {
        setLocating(false);
        setGeoError(
          err.code === 1
            ? "Location permission was denied. Allow it in your browser's site settings, then try again."
            : err.code === 2
            ? "Your location is unavailable. Turn on GPS / location services and try again."
            : "Timed out. Try again, ideally outdoors or near a window."
        );
      },
      { enableHighAccuracy: true, timeout: 20000, maximumAge: 0 }
    );
  }

  function cancelCapture() {
    setPos(null);
    setName("");
    setDescription("");
    setGeoError("");
  }

  async function save(e: React.FormEvent) {
    e.preventDefault();
    if (!pos) return;
    setError("");
    setSaving(true);
    const { error } = await supabase.from("hot_locations").insert({
      name: name.trim(),
      description: description.trim() || null,
      latitude: pos.lat,
      longitude: pos.lng,
      accuracy_m: Math.round(pos.acc),
    });
    setSaving(false);
    if (error) return setError(error.message);
    cancelCapture();
    load();
  }

  function toggleOpen(id: string) {
    setOpenId(openId === id ? null : id);
    setEditId(null);
    setError("");
  }

  function startEdit(l: Loc) {
    setEditId(l.id);
    setEName(l.name);
    setEDesc(l.description ?? "");
  }

  async function saveEdit(l: Loc) {
    if (!eName.trim()) return setError("Name can't be empty.");
    const { error } = await supabase
      .from("hot_locations")
      .update({ name: eName.trim(), description: eDesc.trim() || null })
      .eq("id", l.id);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  }

  async function remove(l: Loc) {
    if (!confirm(`Delete "${l.name}"?`)) return;
    await supabase.from("hot_locations").delete().eq("id", l.id);
    setOpenId(null);
    load();
  }

  async function copyCoords(l: Loc) {
    const text = coordText(l);
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy the coordinates:", text);
    }
    setCopied(l.id);
    setTimeout(() => setCopied(null), 1500);
  }

  const q = search.trim().toLowerCase();
  const shown = items.filter(
    (l) =>
      !q ||
      l.name.toLowerCase().includes(q) ||
      (l.description ?? "").toLowerCase().includes(q)
  );

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">🔥 Hot locations</h1>
        <Link href="/dashboard" className={btn}>Back</Link>
      </div>

      {/* Capture */}
      {!pos ? (
        <div className="space-y-2">
          <button
            onClick={locate}
            disabled={locating}
            className="flex min-h-14 w-full items-center justify-center rounded-xl bg-indigo-600 text-lg font-medium text-white disabled:opacity-60"
          >
            {locating ? "Getting your location..." : "📍 Save my current location"}
          </button>
          {geoError && <p className="text-sm text-red-500">{geoError}</p>}
        </div>
      ) : (
        <form
          onSubmit={save}
          className="space-y-3 rounded-2xl border border-gray-300 p-4 dark:border-gray-700"
        >
          <div>
            <p className="text-sm font-medium">📍 Location found</p>
            <p className="font-mono text-sm text-gray-500">
              {pos.lat.toFixed(6)}, {pos.lng.toFixed(6)}
            </p>
            <p className="text-xs text-gray-500">Accuracy: about ±{Math.round(pos.acc)} m</p>
            {pos.acc > 100 && (
              <p className="mt-1 text-xs text-amber-600">
                Low accuracy. Tap “Refresh location”, ideally outdoors, before saving.
              </p>
            )}
          </div>

          <input
            className={input}
            required
            autoFocus
            placeholder="Address name, e.g. Parking spot"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className={`${input} resize-none`}
            rows={2}
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />

          <div className="flex gap-2">
            <button
              disabled={saving}
              className="min-h-12 flex-1 rounded-lg bg-indigo-600 font-medium text-white disabled:opacity-50"
            >
              {saving ? "Saving..." : "Save"}
            </button>
            <button type="button" className={btn} onClick={locate} disabled={locating}>
              {locating ? "..." : "Refresh location"}
            </button>
            <button type="button" className={btn} onClick={cancelCapture}>
              Cancel
            </button>
          </div>
          {geoError && <p className="text-sm text-red-500">{geoError}</p>}
        </form>
      )}

      {error && <p className="text-sm text-red-500">{error}</p>}

      {items.length > 0 && (
        <input
          className={input}
          placeholder="Search name or description"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
      )}

      <ul className="space-y-3">
        {shown.map((l) => {
          const open = openId === l.id;
          const editing = editId === l.id;
          return (
            <li
              key={l.id}
              className="overflow-hidden rounded-2xl border border-gray-300 dark:border-gray-700"
            >
              <button
                type="button"
                onClick={() => toggleOpen(l.id)}
                aria-expanded={open}
                className="flex w-full items-start gap-3 p-4 text-left"
              >
                <span className="block min-w-0 flex-1 space-y-1">
                  <span className="block break-words font-semibold">📍 {l.name}</span>
                  {l.description && (
                    <span className="block break-words text-sm">{l.description}</span>
                  )}
                  <span className="block text-xs text-gray-500">
                    {new Date(l.created_at).toLocaleString()}
                  </span>
                </span>
                <span
                  className={`shrink-0 text-gray-500 transition-transform ${
                    open ? "rotate-180" : ""
                  }`}
                  aria-hidden
                >
                  ▾
                </span>
              </button>

              {open && (
                <div className="space-y-3 border-t border-gray-300 p-4 dark:border-gray-700">
                  {editing ? (
                    <div className="space-y-3">
                      <input
                        className={input}
                        placeholder="Address name"
                        value={eName}
                        onChange={(e) => setEName(e.target.value)}
                      />
                      <textarea
                        className={`${input} resize-none`}
                        rows={2}
                        placeholder="Description"
                        value={eDesc}
                        onChange={(e) => setEDesc(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="min-h-11 flex-1 rounded-lg bg-indigo-600 font-medium text-white"
                          onClick={() => saveEdit(l)}
                        >
                          Save
                        </button>
                        <button className={`${btn} flex-1`} onClick={() => setEditId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    <>
                      <div className="text-sm text-gray-500">
                        <p className="font-mono">{coordText(l)}</p>
                        {l.accuracy_m !== null && (
                          <p className="text-xs">Accuracy ±{Math.round(l.accuracy_m)} m</p>
                        )}
                      </div>
                      <div className="flex flex-wrap gap-2">
                        <a href={mapUrl(l)} target="_blank" rel="noopener noreferrer" className={btn}>
                          🗺 Open map
                        </a>
                        <button className={btn} onClick={() => copyCoords(l)}>
                          {copied === l.id ? "Copied ✓" : "📋 Copy coords"}
                        </button>
                        <a
                          href={whatsappShare(l)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={btn}
                        >
                          💬 Send via WhatsApp
                        </a>
                      </div>
                      <div className="flex gap-2">
                        <button className={btn} onClick={() => startEdit(l)}>
                          ✏️ Edit
                        </button>
                        <button className={`${btn} ml-auto text-red-500`} onClick={() => remove(l)}>
                          Delete
                        </button>
                      </div>
                    </>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && (
          <p className="text-gray-500">
            {items.length === 0
              ? "No saved locations yet. Tap the button above while you're at a spot you want to remember."
              : "Nothing matches your search."}
          </p>
        )}
      </ul>
    </main>
  );
}