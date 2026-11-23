import { haversineKm, orderByProximity, type LatLng } from "@/lib/geo";

export type Leg = { km: number; sec: number | null };

export type Planned<T> = {
  ordered: T[];
  path: [number, number][] | null; // road geometry as [lat, lng]; null = none
  km: number;
  sec: number | null;
  legs: (Leg | null)[]; // one per ordered stop: distance/time from the previous point
};

const OSRM = "https://router.project-osrm.org";

type OsrmRoute = {
  distance: number;
  duration: number;
  geometry: { coordinates: number[][] };
  legs: { distance: number; duration: number }[];
};

const coordString = (pts: LatLng[]) => pts.map((p) => `${p.lng},${p.lat}`).join(";");
const flip = (c: number[][]) => c.map(([ln, la]) => [la, ln] as [number, number]);

async function getJson(url: string, outer?: AbortSignal) {
  const ctrl = new AbortController();
  const onAbort = () => ctrl.abort();
  outer?.addEventListener("abort", onAbort);
  const timer = setTimeout(() => ctrl.abort(), 12000);
  try {
    const res = await fetch(url, { signal: ctrl.signal });
    return await res.json();
  } finally {
    clearTimeout(timer);
    outer?.removeEventListener("abort", onAbort);
  }
}

function alignLegs(count: number, hasOrigin: boolean, legs: Leg[]): (Leg | null)[] {
  return Array.from({ length: count }, (_, j) =>
    hasOrigin ? legs[j] ?? null : j === 0 ? null : legs[j - 1] ?? null
  );
}

export async function planTrip<T extends LatLng>(
  origin: LatLng | null,
  stops: T[],
  signal?: AbortSignal
): Promise<Planned<T>> {
  const hasOrigin = origin !== null;
  const startIdx = hasOrigin ? 1 : 0;
  const pts: LatLng[] = origin ? [origin, ...stops] : stops;

  if (stops.length === 0) return { ordered: [], path: null, km: 0, sec: null, legs: [] };
  if (pts.length < 2) return { ordered: stops, path: null, km: 0, sec: null, legs: [null] };

  // 1) Let OSRM choose the best order and draw the road route in one request
  try {
    const data = await getJson(
      `${OSRM}/trip/v1/driving/${coordString(pts)}?roundtrip=false&source=${
        hasOrigin ? "first" : "any"
      }&destination=any&overview=full&geometries=geojson`,
      signal
    );
    const trip = data?.trips?.[0] as OsrmRoute | undefined;
    const wps = data?.waypoints as { waypoint_index: number }[] | undefined;

    if (data?.code === "Ok" && trip && data.trips.length === 1 && wps && wps.length === pts.length) {
      const byPos: number[] = [];
      wps.forEach((w, i) => {
        byPos[w.waypoint_index] = i;
      });
      const complete =
        Array.from({ length: pts.length }).every((_, k) => byPos[k] !== undefined) &&
        (!hasOrigin || byPos[0] === 0);

      if (complete) {
        const ordered = byPos.slice(startIdx).map((i) => stops[i - startIdx]);
        const legs = trip.legs.map((l) => ({ km: l.distance / 1000, sec: l.duration }));
        return {
          ordered,
          path: flip(trip.geometry.coordinates),
          km: trip.distance / 1000,
          sec: trip.duration,
          legs: alignLegs(ordered.length, hasOrigin, legs),
        };
      }
    }
  } catch {
    if (signal?.aborted) throw new Error("aborted");
  }

  if (signal?.aborted) throw new Error("aborted");

  // 2) Fallback: order locally, then ask OSRM only for the road route
  const ordered = orderByProximity(origin, stops);
  const seq: LatLng[] = origin ? [origin, ...ordered] : ordered;

  if (seq.length >= 2) {
    try {
      const data = await getJson(
        `${OSRM}/route/v1/driving/${coordString(seq)}?overview=full&geometries=geojson`,
        signal
      );
      const r = data?.routes?.[0] as OsrmRoute | undefined;
      if (data?.code === "Ok" && r) {
        const legs = r.legs.map((l) => ({ km: l.distance / 1000, sec: l.duration }));
        return {
          ordered,
          path: flip(r.geometry.coordinates),
          km: r.distance / 1000,
          sec: r.duration,
          legs: alignLegs(ordered.length, hasOrigin, legs),
        };
      }
    } catch {
      if (signal?.aborted) throw new Error("aborted");
    }
  }

  // 3) Last resort: straight-line estimate
  const legKm = seq.slice(1).map((p, i) => haversineKm(seq[i], p));
  return {
    ordered,
    path: null,
    km: legKm.reduce((a, b) => a + b, 0),
    sec: null,
    legs: alignLegs(
      ordered.length,
      hasOrigin,
      legKm.map((km) => ({ km, sec: null }))
    ),
  };
}