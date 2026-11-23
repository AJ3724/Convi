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

// Google Maps directions link.
// fromMyLocation = true: no origin is set, so Google starts from wherever you are when you open it.
export function googleDirectionsUrl(pts: LatLng[], fromMyLocation = false) {
  if (pts.length < (fromMyLocation ? 1 : 2)) return null;
  const use = pts.slice(0, fromMyLocation ? 10 : 11);
  const f = (p: LatLng) => `${p.lat},${p.lng}`;
  const url = new URL("https://www.google.com/maps/dir/");
  url.searchParams.set("api", "1");
  if (!fromMyLocation) url.searchParams.set("origin", f(use[0]));
  url.searchParams.set("destination", f(use[use.length - 1]));
  const via = fromMyLocation ? use.slice(0, -1) : use.slice(1, -1);
  if (via.length) url.searchParams.set("waypoints", via.map(f).join("|"));
  url.searchParams.set("travelmode", "driving");
  return url.toString();
}

// Offline fallback ordering: nearest-neighbour, then 2-opt improvement (open path).
// If origin is given it stays first; otherwise the best starting stop is chosen.
export function orderByProximity<T extends LatLng>(origin: LatLng | null, items: T[]): T[] {
  if (items.length < 2) return [...items];

  const nodes: LatLng[] = origin ? [origin, ...items] : [...items];
  const n = nodes.length;
  const D = nodes.map((a) => nodes.map((b) => haversineKm(a, b)));
  const lo = origin ? 1 : 0;
  const starts = origin ? [0] : nodes.map((_, i) => i);

  let best: number[] = [];
  let bestCost = Infinity;

  for (const s of starts) {
    const left = new Set(nodes.map((_, i) => i));
    left.delete(s);
    const p = [s];
    while (left.size) {
      const cur = p[p.length - 1];
      let nb = -1;
      let nd = Infinity;
      for (const j of left) {
        if (D[cur][j] < nd) {
          nd = D[cur][j];
          nb = j;
        }
      }
      p.push(nb);
      left.delete(nb);
    }

    let improved = true;
    while (improved) {
      improved = false;
      for (let i = lo; i < n - 1; i++) {
        for (let j = i + 1; j < n; j++) {
          const before = i > 0 ? D[p[i - 1]][p[i]] : 0;
          const after = j < n - 1 ? D[p[j]][p[j + 1]] : 0;
          const nBefore = i > 0 ? D[p[i - 1]][p[j]] : 0;
          const nAfter = j < n - 1 ? D[p[i]][p[j + 1]] : 0;
          if (nBefore + nAfter < before + after - 1e-9) {
            const seg = p.slice(i, j + 1).reverse();
            p.splice(i, j - i + 1, ...seg);
            improved = true;
          }
        }
      }
    }

    let cost = 0;
    for (let k = 1; k < p.length; k++) cost += D[p[k - 1]][p[k]];
    if (cost < bestCost) {
      bestCost = cost;
      best = [...p];
    }
  }

  return best.slice(lo).map((idx) => items[origin ? idx - 1 : idx]);
}