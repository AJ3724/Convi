"use client";

import { useEffect, useMemo, useState } from "react";
import { createClient } from "@/lib/supabase/client";

type Status = "checking" | "unsupported" | "off" | "on" | "denied" | "working";

function urlBase64ToUint8Array(base64: string) {
  const padding = "=".repeat((4 - (base64.length % 4)) % 4);
  const b64 = (base64 + padding).replace(/-/g, "+").replace(/_/g, "/");
  const raw = atob(b64);
  return Uint8Array.from(raw, (c) => c.charCodeAt(0));
}

export default function EnableNotifications() {
  const supabase = useMemo(() => createClient(), []);
  const [status, setStatus] = useState<Status>("checking");
  const [error, setError] = useState("");

  useEffect(() => {
    async function check() {
      if (!("serviceWorker" in navigator) || !("PushManager" in window)) {
        return setStatus("unsupported");
      }
      if (Notification.permission === "denied") return setStatus("denied");
      const reg = await navigator.serviceWorker.register("/sw.js");
      const sub = await reg.pushManager.getSubscription();
      setStatus(sub ? "on" : "off");
    }
    check().catch(() => setStatus("unsupported"));
  }, []);

  async function enable() {
    setError("");
    setStatus("working");
    try {
      const permission = await Notification.requestPermission();
      if (permission !== "granted") return setStatus("denied");

      const reg = await navigator.serviceWorker.register("/sw.js");
      await navigator.serviceWorker.ready;

      let sub = await reg.pushManager.getSubscription();
      if (!sub) {
        sub = await reg.pushManager.subscribe({
          userVisibleOnly: true,
          applicationServerKey: urlBase64ToUint8Array(
            process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!
          ),
        });
      }

      const json = sub.toJSON();
      const { error } = await supabase.from("push_subscriptions").upsert(
        {
          endpoint: json.endpoint!,
          p256dh: json.keys!.p256dh,
          auth: json.keys!.auth,
        },
        { onConflict: "endpoint" }
      );
      if (error) throw new Error(error.message);
      setStatus("on");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
      setStatus("off");
    }
  }

  async function disable() {
    setStatus("working");
    const reg = await navigator.serviceWorker.getRegistration("/sw.js");
    const sub = await reg?.pushManager.getSubscription();
    if (sub) {
      await supabase.from("push_subscriptions").delete().eq("endpoint", sub.endpoint);
      await sub.unsubscribe();
    }
    setStatus("off");
  }

  const box = "rounded-2xl border border-gray-300 dark:border-gray-700 p-4 space-y-2";

  if (status === "checking") return null;

  return (
    <div className={box}>
      <p className="font-semibold">🔔 Reminder notifications</p>

      {status === "unsupported" && (
        <p className="text-sm text-gray-500">
          This browser can&apos;t do push notifications. On iPhone, add Convi to
          your Home Screen from Safari first, then open it from there.
        </p>
      )}
      {status === "denied" && (
        <p className="text-sm text-gray-500">
          Notifications are blocked. Allow them in your browser&apos;s site
          settings, then reload.
        </p>
      )}
      {(status === "off" || status === "working") && (
        <button
          onClick={enable}
          disabled={status === "working"}
          className="rounded-lg bg-indigo-600 px-4 py-2 text-white disabled:opacity-50"
        >
          {status === "working" ? "Working..." : "Enable on this device"}
        </button>
      )}
      {status === "on" && (
        <div className="flex items-center justify-between">
          <p className="text-sm text-emerald-600">Enabled on this device ✓</p>
          <button onClick={disable} className="rounded-lg border border-gray-400 px-3 py-2 text-sm">
            Turn off
          </button>
        </div>
      )}
      {error && <p className="text-sm text-red-500">{error}</p>}
    </div>
  );
}