"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type One<T> = T | T[] | null;
type BubbleType = "text" | "link" | "task" | "reminder";

type Bubble = {
  id: string;
  type: BubbleType;
  content: string;
  position: number;
  task_details: One<{ is_done: boolean; due_at: string | null }>;
  reminder_details: One<{ remind_at: string; is_sent: boolean }>;
  link_details: One<{ url: string; title: string | null; favicon_url: string | null }>;
};

// PostgREST may return a 1-to-1 relation as an object or an array
const one = <T,>(x: One<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x);

const btn = "rounded-lg border border-gray-400 px-3 py-2 text-sm";
const input =
  "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-3";

const typeStyle: Record<BubbleType, string> = {
  text: "bg-indigo-100 dark:bg-indigo-950",
  link: "bg-sky-100 dark:bg-sky-950",
  task: "bg-emerald-100 dark:bg-emerald-950",
  reminder: "bg-amber-100 dark:bg-amber-950",
};

export default function EditorPage() {
  const { bookId, pageId } = useParams<{ bookId: string; pageId: string }>();
  const supabase = useMemo(() => createClient(), []);

  const [pageTitle, setPageTitle] = useState("");
  const [bubbles, setBubbles] = useState<Bubble[]>([]);
  const [error, setError] = useState("");

  // composer state
  const [type, setType] = useState<BubbleType>("text");
  const [content, setContent] = useState("");
  const [when, setWhen] = useState("");

  const load = useCallback(async () => {
    const [{ data: p }, { data: b, error }] = await Promise.all([
      supabase.from("pages").select("title").eq("id", pageId).single(),
      supabase
        .from("bubbles")
        .select("*, task_details(*), reminder_details(*), link_details(*)")
        .eq("page_id", pageId)
        .order("position"),
    ]);
    setPageTitle(p?.title ?? "");
    if (error) setError(error.message);
    else setBubbles((b as Bubble[]) ?? []);
  }, [supabase, pageId]);

  useEffect(() => {
    load();
  }, [load]);

  async function renamePage(value: string) {
    const t = value.trim() || "Untitled";
    setPageTitle(t);
    await supabase.from("pages").update({ title: t }).eq("id", pageId);
  }

  async function addBubble(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    const text = content.trim();
    if (!text) return;
    if (type === "reminder" && !when) {
      return setError("Pick a date and time for the reminder.");
    }

    let linkInfo: { url: string; host: string } | null = null;
    if (type === "link") {
      try {
        const url = /^https?:\/\//i.test(text) ? text : `https://${text}`;
        linkInfo = { url, host: new URL(url).hostname };
      } catch {
        return setError("That doesn't look like a valid link.");
      }
    }

    const position = bubbles.length
      ? Math.max(...bubbles.map((b) => b.position)) + 1
      : 0;

    const { data: b, error: bErr } = await supabase
      .from("bubbles")
      .insert({ page_id: pageId, type, content: text, position })
      .select("id")
      .single();
    if (bErr || !b) return setError(bErr?.message ?? "Could not save bubble");

    let detailsError: string | undefined;

    if (type === "task") {
      const { error } = await supabase.from("task_details").insert({
        bubble_id: b.id,
        due_at: when ? new Date(when).toISOString() : null,
      });
      detailsError = error?.message;
    }
    if (type === "reminder") {
      const { error } = await supabase.from("reminder_details").insert({
        bubble_id: b.id,
        remind_at: new Date(when).toISOString(),
      });
      detailsError = error?.message;
    }
    if (type === "link" && linkInfo) {
      const { error } = await supabase.from("link_details").insert({
        bubble_id: b.id,
        url: linkInfo.url,
        title: linkInfo.host,
        favicon_url: `https://www.google.com/s2/favicons?domain=${linkInfo.host}&sz=64`,
      });
      detailsError = error?.message;
    }

    if (detailsError) setError(detailsError);
    setContent("");
    setWhen("");
    load();
  }

  async function saveText(b: Bubble, value: string) {
    if (value === b.content) return;
    await supabase.from("bubbles").update({ content: value }).eq("id", b.id);
    setBubbles((list) => list.map((x) => (x.id === b.id ? { ...x, content: value } : x)));
  }

  async function toggleTask(b: Bubble, done: boolean) {
    await supabase.from("task_details").update({ is_done: done }).eq("bubble_id", b.id);
    load();
  }

  async function removeBubble(b: Bubble) {
    await supabase.from("bubbles").delete().eq("id", b.id);
    load();
  }

  const needsDate = type === "task" || type === "reminder";

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto space-y-4 pb-48">
      <div className="flex items-center gap-2">
        <input
          key={pageTitle}
          defaultValue={pageTitle}
          onBlur={(e) => renamePage(e.target.value)}
          className="flex-1 bg-transparent text-3xl font-bold outline-none"
          aria-label="Page title"
        />
        <Link href={`/notes/${bookId}`} className={btn}>Back</Link>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <ul className="space-y-3">
        {bubbles.map((b) => {
          const task = one(b.task_details);
          const reminder = one(b.reminder_details);
          const link = one(b.link_details);

          return (
            <li key={b.id} className={`group rounded-2xl p-4 ${typeStyle[b.type]}`}>
              <div className="flex items-start gap-3">
                {b.type === "task" && (
                  <input
                    type="checkbox"
                    className="mt-1 h-5 w-5"
                    checked={task?.is_done ?? false}
                    onChange={(e) => toggleTask(b, e.target.checked)}
                  />
                )}
                {b.type === "reminder" && <span>🔔</span>}
                {b.type === "link" && link?.favicon_url && (
                  // eslint-disable-next-line @next/next/no-img-element
                  <img src={link.favicon_url} alt="" className="mt-1 h-5 w-5" />
                )}

                <div className="flex-1 min-w-0">
                  {b.type === "link" && link ? (
                    <a
                      href={link.url}
                      target="_blank"
                      rel="noopener noreferrer"
                      className="block truncate font-medium underline"
                    >
                      {link.title ?? link.url}
                      <span className="block truncate text-xs font-normal text-gray-500 no-underline">
                        {link.url}
                      </span>
                    </a>
                  ) : (
                    <textarea
                      defaultValue={b.content}
                      onBlur={(e) => saveText(b, e.target.value)}
                      rows={Math.max(1, b.content.split("\n").length)}
                      className={`w-full resize-none bg-transparent outline-none ${
                        task?.is_done ? "line-through opacity-60" : ""
                      }`}
                    />
                  )}

                  {task?.due_at && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      Due {new Date(task.due_at).toLocaleString()}
                    </p>
                  )}
                  {reminder && (
                    <p className="text-xs text-gray-600 dark:text-gray-400">
                      {new Date(reminder.remind_at).toLocaleString()}
                      {reminder.is_sent ? " · sent" : ""}
                    </p>
                  )}
                </div>

                <button
                  onClick={() => removeBubble(b)}
                  className="text-gray-500 hover:text-red-500"
                  aria-label="Delete bubble"
                >
                  ✕
                </button>
              </div>
            </li>
          );
        })}
        {bubbles.length === 0 && (
          <p className="text-gray-500">Empty page. Add your first bubble below.</p>
        )}
      </ul>

      {/* Composer pinned to the bottom */}
      <form
        onSubmit={addBubble}
        className="fixed bottom-0 left-0 right-0 border-t border-gray-300 dark:border-gray-700 bg-white dark:bg-zinc-900 p-4"
      >
        <div className="mx-auto max-w-2xl space-y-2">
          <div className="flex gap-2">
            {(["text", "link", "task", "reminder"] as BubbleType[]).map((t) => (
              <button
                type="button"
                key={t}
                onClick={() => setType(t)}
                className={`${btn} capitalize ${
                  type === t ? "bg-indigo-600 text-white border-indigo-600" : ""
                }`}
              >
                {t}
              </button>
            ))}
          </div>

          {needsDate && (
            <input
              type="datetime-local"
              className={input}
              value={when}
              onChange={(e) => setWhen(e.target.value)}
              aria-label={type === "task" ? "Due date (optional)" : "Remind at"}
            />
          )}

          <div className="flex gap-2">
            <input
              className={input}
              placeholder={
                type === "link"
                  ? "Paste a link"
                  : type === "task"
                  ? "What needs doing?"
                  : type === "reminder"
                  ? "Remind me to..."
                  : "Write a note"
              }
              value={content}
              onChange={(e) => setContent(e.target.value)}
            />
            <button className="rounded-lg bg-indigo-600 px-5 text-white">Add</button>
          </div>
        </div>
      </form>
    </main>
  );
}