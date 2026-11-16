import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@/lib/supabase/server";

export const dynamic = "force-dynamic";

function allowed(u: URL) {
  const h = u.hostname;
  return (
    u.protocol === "https:" &&
    (h === "maps.app.goo.gl" ||
      h === "goo.gl" ||
      h === "g.co" ||
      h === "google.com" ||
      h.endsWith(".google.com"))
  );
}

export async function GET(request: NextRequest) {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  if (!user) return NextResponse.json({ error: "Unauthorized" }, { status: 401 });

  let current: URL;
  try {
    current = new URL(request.nextUrl.searchParams.get("url") ?? "");
  } catch {
    return NextResponse.json({ error: "Invalid URL" }, { status: 400 });
  }
  if (!allowed(current)) {
    return NextResponse.json({ error: "Only Google Maps links can be resolved" }, { status: 400 });
  }

  try {
    for (let i = 0; i < 5; i++) {
      const res = await fetch(current.toString(), {
        redirect: "manual",
        headers: { "user-agent": "Mozilla/5.0" },
        signal: AbortSignal.timeout(8000),
      });
      const loc = res.headers.get("location");
      if (res.status >= 300 && res.status < 400 && loc) {
        const next = new URL(loc, current);
        current = next;
        if (!allowed(next)) break; // report it, but never fetch other sites
        continue;
      }
      break;
    }
    return NextResponse.json({ url: current.toString() });
  } catch {
    return NextResponse.json({ error: "Could not resolve link" }, { status: 502 });
  }
}