import { parseCoordinates, extractPlaceName, normalizeMapUrl } from "@/lib/coords";

export async function coordsFromInput(raw: string) {
  const text = raw.trim();

  const direct = parseCoordinates(text);
  if (direct) return { coords: direct, name: extractPlaceName(text) };

  const link = normalizeMapUrl(text);
  if (!link) return { coords: null, name: null };

  let coords = parseCoordinates(link);
  let name = extractPlaceName(link);

  if (!coords) {
    try {
      const res = await fetch(`/api/resolve-map?url=${encodeURIComponent(link)}`);
      if (res.ok) {
        const data = (await res.json()) as { url: string };
        coords = parseCoordinates(data.url);
        name = name ?? extractPlaceName(data.url);
      }
    } catch {
      // ignore: the user can type coordinates instead
    }
  }
  return { coords, name };
}