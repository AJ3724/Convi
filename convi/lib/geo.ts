export type LatLng = { lat: number; lng: number };

export function haversineKm(a: LatLng, b: LatLng) {
  const R = 6371;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

export function formatKm(km: number) {
  return `${km < 10 ? km.toFixed(1) : Math.round(km)} km`;
}

export function formatDuration(sec: number) {
  const mins = Math.max(1, Math.round(sec / 60));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${h} h ${String(m).padStart(2, "0")} min`;
}

// Finds the village / town / area name for a point using OpenStreetMap Nominatim.
export async function reverseCity(lat: number, lng: number): Promise<string | null> {
  try {
    const res = await fetch(
      `https://nominatim.openstreetmap.org/reverse?format=jsonv2&zoom=14&addressdetails=1&accept-language=en&lat=${lat}&lon=${lng}`
    );
    if (!res.ok) return null;
    const data = (await res.json()) as { address?: Record<string, string> };
    const a = data.address ?? {};
    return (
      a.village ||
      a.town ||
      a.suburb ||
      a.city_district ||
      a.city ||
      a.municipality ||
      a.county ||
      null
    );
  } catch {
    return null;
  }
}

// Google Maps directions link (it accepts up to 11 points: start, 9 waypoints, end).
export function googleDirectionsUrl(pts: LatLng[]) {
  if (pts.length < 2) return null;
  const use = pts.slice(0, 11);
  const f = (p: LatLng) => `${p.lat},${p.lng}`;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  url.searchParams.set("origin", f(use[0]));
  url.searchParams.set("destination", f(use[use.length - 1]));
  if (use.length > 2) {
    url.searchParams.set("waypoints", use.slice(1, -1).map(f).join("|"));
  }
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}