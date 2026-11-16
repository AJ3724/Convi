export type Coords = { lat: number; lng: number };

const NUM = "(-?\\d{1,3}(?:\\.\\d+)?)";

function safeDecode(s: string) {
  let out = s;
  for (let i = 0; i < 2; i++) {
    try {
      const d = decodeURIComponent(out);
      if (d === out) break;
      out = d;
    } catch {
      break;
    }
  }
  return out;
}

function valid(lat: number, lng: number): Coords | null {
  return Number.isFinite(lat) &&
    Number.isFinite(lng) &&
    Math.abs(lat) <= 90 &&
    Math.abs(lng) <= 180
    ? { lat, lng }
    : null;
}

export function parseCoordinates(input: string): Coords | null {
  const text = safeDecode(input.trim());
  const patterns: RegExp[] = [
    new RegExp(`!3d${NUM}!4d${NUM}`), // exact pin in Google Maps links
    new RegExp(`@${NUM},${NUM}`), // map center in Google Maps links
    new RegExp(`[?&](?:q|query|ll|sll|destination|daddr|center)=${NUM},\\s*${NUM}`, "i"),
    new RegExp(`mlat=${NUM}&mlon=${NUM}`, "i"), // OpenStreetMap
    new RegExp(`#map=\\d+/${NUM}/${NUM}`), // OpenStreetMap
    new RegExp(`^${NUM}\\s*,\\s*${NUM}$`), // plain "33.89, 35.50"
  ];
  for (const re of patterns) {
    const m = text.match(re);
    if (m) {
      const c = valid(parseFloat(m[1]), parseFloat(m[2]));
      if (c) return c;
    }
  }
  return null;
}

export function extractPlaceName(url: string): string | null {
  const m = safeDecode(url).match(/\/maps\/place\/([^/@?]+)/);
  if (!m) return null;
  const name = m[1].replace(/\+/g, " ").trim();
  return name || null;
}

// Returns a safe http(s) URL, or "" if the text is empty or just coordinates.
export function normalizeMapUrl(raw: string): string {
  const t = raw.trim();
  if (!t) return "";
  if (/^https?:\/\//i.test(t)) return t;
  if (parseCoordinates(t)) return "";
  return `https://${t}`;
}