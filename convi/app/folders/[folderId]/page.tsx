"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";
import { dialUrl, whatsappUrl } from "@/lib/contactActions";
import {
  parseCoordinates,
  extractPlaceName,
  normalizeMapUrl,
  type Coords,
} from "@/lib/coords";

type Place = {
  id: string;
  name: string;
  address: string | null;
  description: string | null;
  map_url: string | null;
  phone: string | null;
  latitude: number | null;
  longitude: number | null;
};

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-400 px-3 text-sm";
const input =
  "w-full min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-base";

async function inspectLink(raw: string): Promise<{ coords: Coords | null; name: string | null }> {
  const link = normalizeMapUrl(raw) || raw.trim();
  let coords = parseCoordinates(link);
  let name = extractPlaceName(link);
  if (!coords && /^https?:\/\//i.test(link)) {
    try {
      const res = await fetch(`/api/resolve-map?url=${encodeURIComponent(link)}`);
      if (res.ok) {
        const data = (await res.json()) as { url: string };
        coords = parseCoordinates(data.url);
        name = name ?? extractPlaceName(data.url);
      }
    } catch {
      // ignore: user can type coordinates manually
    }
  }
  return { coords, name };
}

function mapsLink(p: Place) {
  if (p.map_url) return p.map_url;
  if (p.latitude !== null && p.longitude !== null) {
    return `https://www.google.com/maps?q=${p.latitude},${p.longitude}`;
  }
  if (p.address) {
    return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(p.address)}`;
  }
  return null;
}

export default function FolderPage() {
  const { folderId } = useParams<{ folderId: string }>();
  const supabase = useMemo(() => createClient(), []);

  const [folderName, setFolderName] = useState("");
  const [places, setPlaces] = useState<Place[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // form state
  const [name, setName] = useState("");
  const [address, setAddress] = useState("");
  const [description, setDescription] = useState("");
  const [link, setLink] = useState("");
  const [phone, setPhone] = useState("");
  const [lat, setLat] = useState("");
  const [lng, setLng] = useState("");
  const [hint, setHint] = useState("");

  const load = useCallback(async () => {
    const [{ data: f }, { data, error }] = await Promise.all([
      supabase.from("folders").select("name").eq("id", folderId).single(),
      supabase
        .from("places")
        .select("id, name, address, description, map_url, phone, latitude, longitude")
        .eq("folder_id", folderId)
        .order("created_at", { ascending: false }),
    ]);
    setFolderName(f?.name ?? "");
    if (error) setError(error.message);
    else setPlaces((data as Place[]) ?? []);
  }, [supabase, folderId]);

  useEffect(() => {
    load();
  }, [load]);

  async function onLinkBlur() {
    if (!link.trim()) return;
    setHint("Reading link...");
    const { coords, name: found } = await inspectLink(link);
    if (coords) {
      if (!lat.trim() && !lng.trim()) {
        setLat(String(coords.lat));
        setLng(String(coords.lng));
      }
      setHint("Coordinates found ✓");
    } else {
      setHint("Couldn't read coordinates from this link. You can type them below.");
    }
    if (found && !name.trim()) setName(found);
  }

  async function addPlace(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const cleanPhone = phone.replace(/[\s()-]/g, "");
    if (cleanPhone && !/^\+[1-9]\d{6,14}$/.test(cleanPhone)) {
      return setError("Phone must start with + and country code, e.g. +96171123456");
    }

    const latNum = lat.trim() === "" ? null : Number(lat);
    const lngNum = lng.trim() === "" ? null : Number(lng);
    if ((latNum === null) !== (lngNum === null)) {
      return setError("Enter both latitude and longitude, or leave both empty.");
    }

    let coords: Coords | null = null;
    if (latNum !== null && lngNum !== null) {
      if (
        !Number.isFinite(latNum) ||
        !Number.isFinite(lngNum) ||
        Math.abs(latNum) > 90 ||
        Math.abs(lngNum) > 180
      ) {
        return setError("Coordinates are not valid.");
      }
      coords = { lat: latNum, lng: lngNum };
    } else if (link.trim()) {
      coords = (await inspectLink(link)).coords;
    }

    const { error } = await supabase.from("places").insert({
      folder_id: folderId,
      name: name.trim(),
      address: address.trim() || null,
      description: description.trim() || null,
      map_url: normalizeMapUrl(link) || null,
      phone: cleanPhone || null,
      latitude: coords?.lat ?? null,
      longitude: coords?.lng ?? null,
    });
    if (error) return setError(error.message);

    setName(""); setAddress(""); setDescription(""); setLink(""); setPhone("");
    setLat(""); setLng(""); setHint("");
    setShowForm(false);
    load();
  }

  async function saveDescription(p: Place, value: string) {
    const v = value.trim() || null;
    if (v === (p.description ?? null)) return;
    const { error } = await supabase
      .from("places")
      .update({ description: v })
      .eq("id", p.id);
    if (error) return setError(error.message);
    setPlaces((list) => list.map((x) => (x.id === p.id ? { ...x, description: v } : x)));
  }

  async function removePlace(p: Place) {
    if (!confirm(`Delete "${p.name}"?`)) return;
    await supabase.from("places").delete().eq("id", p.id);
    load();
  }

  async function copyCoords(p: Place) {
    if (p.latitude === null || p.longitude === null) return;
    const text = `${p.latitude.toFixed(6)}, ${p.longitude.toFixed(6)}`;
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy the coordinates:", text);
    }
    setCopied(p.id);
    setTimeout(() => setCopied(null), 1500);
  }

  const q = search.toLowerCase();
  const shown = places.filter(
    (p) =>
      p.name.toLowerCase().includes(q) ||
      (p.address ?? "").toLowerCase().includes(q) ||
      (p.description ?? "").toLowerCase().includes(q) ||
      (p.phone ?? "").includes(q)
  );

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="min-w-0 truncate text-2xl font-bold sm:text-3xl">📁 {folderName}</h1>
        <Link href="/folders" className={btn}>Back</Link>
      </div>

      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="Search name, address, description or phone"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className={`${btn} shrink-0`} onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {showForm && (
        <form
          onSubmit={addPlace}
          className="space-y-3 rounded-2xl border border-gray-300 p-4 dark:border-gray-700"
        >
          <input
            className={input}
            placeholder="Map link (Google Maps, etc.)"
            value={link}
            onChange={(e) => setLink(e.target.value)}
            onBlur={onLinkBlur}
            inputMode="url"
          />
          {hint && <p className="text-xs text-gray-500">{hint}</p>}
          <input
            className={input}
            required
            placeholder="Name, e.g. Mom's house"
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
          <input
            className={input}
            placeholder="Address"
            value={address}
            onChange={(e) => setAddress(e.target.value)}
          />
          <input
            className={input}
            type="tel"
            inputMode="tel"
            placeholder="Phone, e.g. +96171123456"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />
          <div className="grid grid-cols-2 gap-2">
            <input
              className={input}
              inputMode="decimal"
              placeholder="Latitude"
              value={lat}
              onChange={(e) => setLat(e.target.value)}
            />
            <input
              className={input}
              inputMode="decimal"
              placeholder="Longitude"
              value={lng}
              onChange={(e) => setLng(e.target.value)}
            />
          </div>
          <button className="min-h-12 w-full rounded-lg bg-indigo-600 font-medium text-white">
            Save place
          </button>
        </form>
      )}

      <ul className="space-y-3">
        {shown.map((p) => {
          const open = mapsLink(p);
          const hasCoords = p.latitude !== null && p.longitude !== null;
          return (
            <li
              key={p.id}
              className="space-y-3 rounded-2xl border border-gray-300 p-4 dark:border-gray-700"
            >
              <div className="min-w-0">
                <p className="break-words font-semibold">📍 {p.name}</p>
                {p.address && <p className="break-words text-sm text-gray-500">{p.address}</p>}
                {p.phone && <p className="text-sm text-gray-500">{p.phone}</p>}
                {hasCoords && (
                  <p className="font-mono text-sm text-gray-500">
                    {p.latitude!.toFixed(6)}, {p.longitude!.toFixed(6)}
                  </p>
                )}
                <textarea
                  key={`${p.id}-${p.description ?? ""}`}
                  defaultValue={p.description ?? ""}
                  onBlur={(e) => saveDescription(p, e.target.value)}
                  placeholder="Add a description"
                  rows={Math.max(1, (p.description ?? "").split("\n").length)}
                  className="mt-2 w-full resize-none bg-transparent text-sm outline-none placeholder:text-gray-500"
                />
              </div>

              <div className="flex flex-wrap gap-2">
                {open && (
                  <a href={open} target="_blank" rel="noopener noreferrer" className={btn}>
                    🗺 Open map
                  </a>
                )}
                {hasCoords && (
                  <button className={btn} onClick={() => copyCoords(p)}>
                    {copied === p.id ? "Copied ✓" : "📋 Copy coords"}
                  </button>
                )}
                {p.phone && (
                  <>
                    <a href={dialUrl(p.phone)} className={btn}>📞 Dial</a>
                    <a
                      href={whatsappUrl(p.phone)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={btn}
                    >
                      💬 WhatsApp
                    </a>
                  </>
                )}
                <button className={`${btn} ml-auto text-red-500`} onClick={() => removePlace(p)}>
                  Delete
                </button>
              </div>
            </li>
          );
        })}
        {shown.length === 0 && <p className="text-gray-500">No places yet.</p>}
      </ul>
    </main>
  );
}