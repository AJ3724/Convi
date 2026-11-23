"use client";

import { useEffect, useRef } from "react";
import L from "leaflet";
import "leaflet/dist/leaflet.css";

export type MapPoint = { id: string; label: string; lat: number; lng: number };

type Props = {
  points: MapPoint[];
  path: [number, number][] | null; // road geometry; null = straight dashed lines
};

export default function RouteMap({ points, path }: Props) {
  const el = useRef<HTMLDivElement>(null);
  const map = useRef<L.Map | null>(null);
  const layer = useRef<L.LayerGroup | null>(null);
  const lastFit = useRef("");

  useEffect(() => {
    if (!el.current) return;
    const m = L.map(el.current).setView([33.9, 35.9], 8);
    L.tileLayer("https://tile.openstreetmap.org/{z}/{x}/{y}.png", {
      maxZoom: 19,
      attribution: "&copy; OpenStreetMap contributors",
    }).addTo(m);
    layer.current = L.layerGroup().addTo(m);
    map.current = m;
    return () => {
      m.remove();
      map.current = null;
      layer.current = null;
      lastFit.current = "";
    };
  }, []);

  useEffect(() => {
    const m = map.current;
    const g = layer.current;
    if (!m || !g) return;

    g.clearLayers();
    const latlngs = points.map((p) => L.latLng(p.lat, p.lng));
    const line = path && path.length > 1 ? path : null;

    if (latlngs.length >= 2) {
      L.polyline(line ?? latlngs, {
        color: "#4f46e5",
        weight: 5,
        opacity: 0.85,
        dashArray: line ? undefined : "8 8",
      }).addTo(g);
    }

    points.forEach((p, i) => {
      const isFirst = i === 0 && points.length > 1;
      const isLast = i === points.length - 1 && points.length > 1;
      const pin = document.createElement("div");
      pin.textContent = String(i + 1);
      pin.style.cssText = `display:flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;background:${
        isFirst ? "#16a34a" : isLast ? "#dc2626" : "#4f46e5"
      };color:#fff;font:600 13px system-ui,sans-serif;border:2px solid #fff;box-shadow:0 1px 4px rgba(0,0,0,.4)`;

      const marker = L.marker([p.lat, p.lng], {
        icon: L.divIcon({ html: pin, className: "", iconSize: [28, 28], iconAnchor: [14, 14] }),
      }).addTo(g);

      const tip = document.createElement("span");
      tip.textContent = p.label;
      marker.bindTooltip(tip, { permanent: true, direction: "right", offset: [14, 0] });
    });

    // Re-fit the view only when the coordinates or route change, not on label edits
    const key = `${latlngs.map((l) => `${l.lat},${l.lng}`).join("|")}#${line ? line.length : 0}`;
    if (latlngs.length && key !== lastFit.current) {
      lastFit.current = key;
      if (latlngs.length === 1) m.setView(latlngs[0], 15);
      else m.fitBounds(L.latLngBounds(line ?? latlngs), { padding: [40, 40], maxZoom: 16 });
    }
  }, [points, path]);

  return (
    <div
      ref={el}
      className="isolate h-80 w-full overflow-hidden rounded-2xl border border-gray-300 dark:border-gray-700 sm:h-96"
    />
  );
}