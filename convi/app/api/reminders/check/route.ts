import { NextResponse, type NextRequest } from "next/server";
import { createClient } from "@supabase/supabase-js";
import webpush from "web-push";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Maybe<T> = T | T[] | null;
const first = <T,>(x: Maybe<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x);

type DueRow = {
  bubble_id: string;
  user_id: string;
  bubbles: Maybe<{
    content: string;
    page_id: string;
    pages: Maybe<{ book_id: string }>;
  }>;
};

export async function GET(request: NextRequest) {
  const secret = process.env.CRON_SECRET;
  if (!secret) {
    return NextResponse.json({ error: "CRON_SECRET not set" }, { status: 500 });
  }
  if (request.headers.get("authorization") !== `Bearer ${secret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  webpush.setVapidDetails(
    process.env.VAPID_SUBJECT!,
    process.env.NEXT_PUBLIC_VAPID_PUBLIC_KEY!,
    process.env.VAPID_PRIVATE_KEY!
  );

  const admin = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SECRET_KEY!,
    { auth: { persistSession: false } }
  );

  const { data, error } = await admin
    .from("reminder_details")
    .select("bubble_id, user_id, bubbles(content, page_id, pages(book_id))")
    .eq("is_sent", false)
    .lte("remind_at", new Date().toISOString())
    .limit(50);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const due = (data ?? []) as unknown as DueRow[];
  let sent = 0;
  let skipped = 0;

  for (const r of due) {
    const { data: subs } = await admin
      .from("push_subscriptions")
      .select("id, endpoint, p256dh, auth")
      .eq("user_id", r.user_id);

    if (!subs || subs.length === 0) {
      skipped++; // no device subscribed yet: leave unsent
      continue;
    }

    const bubble = first(r.bubbles);
    const page = first(bubble?.pages ?? null);
    const url =
      bubble && page ? `/notes/${page.book_id}/${bubble.page_id}` : "/dashboard";
    const payload = JSON.stringify({
      title: "🔔 Reminder",
      body: bubble?.content ?? "You have a reminder",
      url,
    });

    let delivered = 0;
    await Promise.all(
      subs.map(async (s) => {
        try {
          await webpush.sendNotification(
            { endpoint: s.endpoint, keys: { p256dh: s.p256dh, auth: s.auth } },
            payload
          );
          delivered++;
        } catch (e) {
          const code = (e as { statusCode?: number }).statusCode;
          if (code === 404 || code === 410) {
            await admin.from("push_subscriptions").delete().eq("id", s.id);
          }
        }
      })
    );

    if (delivered > 0) {
      await admin
        .from("reminder_details")
        .update({ is_sent: true })
        .eq("bubble_id", r.bubble_id);
      sent++;
    }
  }

  return NextResponse.json({ checked: due.length, sent, skipped });
}