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
  link_details: One<{
    url: string;
    title: string | null;
    favicon_url: string | null;
    description: string | null;
  }>;
};

// PostgREST may return a 1-to-1 relation as an object or an array
const one = <T,>(x: One<T>): T | null => (Array.isArray(x) ? x[0] ?? null : x);

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-400 px-4 text-sm";
const input =
  "w-full min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-base";

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
  const [desc, setDesc] = useState("");
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
        description: desc.trim() || null,
      });
      detailsError = error?.message;
    }

    if (detailsError) setError(detailsError);
    setContent("");
    setDesc("");
    setWhen("");
    load();
  }

  async function saveText(b: Bubble, value: string) {
    if (value === b.content) return;
    await supabase.from("bubbles").update({ content: value }).eq("id", b.id);
    setBubbles((list) => list.map((x) => (x.id === b.id ? { ...x, content: value } : x)));
  }

  async function saveDescription(b: Bubble, value: string) {
    const v = value.trim() || null;
    await supabase.from("link_details").update({ description: v }).eq("bubble_id", b.id);
    load();
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
    <main className="mx-auto flex min-h-dvh w-full max-w-2xl flex-col">
      <div className="flex-1 space-y-4 px-4 py-6 sm:px-6">
        <div className="flex items-center gap-2">
          <input
            key={pageTitle}
            defaultValue={pageTitle}
            onBlur={(e) => renamePage(e.target.value)}
            className="min-w-0 flex-1 bg-transparent text-2xl font-bold outline-none sm:text-3xl"
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
              <li key={b.id} className={`rounded-2xl p-4 ${typeStyle[b.type]}`}>
                <div className="flex items-start gap-3">
                  {b.type === "task" && (
                    <input
                      type="checkbox"
                      className="mt-0.5 h-6 w-6 shrink-0"
                      checked={task?.is_done ?? false}
                      onChange={(e) => toggleTask(b, e.target.checked)}
                    />
                  )}
                  {b.type === "reminder" && <span className="shrink-0">🔔</span>}
                  {b.type === "link" && link?.favicon_url && (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={link.favicon_url} alt="" className="mt-1 h-5 w-5 shrink-0" />
                  )}

                  <div className="min-w-0 flex-1">
                    {b.type === "link" && link ? (
                      <>
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
                        <textarea
                          defaultValue={link.description ?? ""}
                          onBlur={(e) => saveDescription(b, e.target.value)}
                          placeholder="Add a description"
                          rows={Math.max(1, (link.description ?? "").split("\n").length)}
                          className="mt-1 w-full resize-none bg-transparent text-sm outline-none placeholder:text-gray-500"
                        />
                      </>
                    ) : (
                      <textarea
                        defaultValue={b.content}
                        onBlur={(e) => saveText(b, e.target.value)}
                        rows={Math.max(1, b.content.split("\n").length)}
                        className={`w-full resize-none bg-transparent text-base outline-none ${
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
                    className="-m-2 shrink-0 p-2 text-gray-500 hover:text-red-500"
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
      </div>

      {/* Composer: sticks to the bottom of the screen */}
      <form
        onSubmit={addBubble}
        className="sticky bottom-0 space-y-2 border-t border-gray-300 bg-white px-4 pt-3 pb-[max(0.75rem,env(safe-area-inset-bottom))] dark:border-gray-700 dark:bg-zinc-900 sm:px-6"
      >
        <div className="grid grid-cols-4 gap-2">
          {(["text", "link", "task", "reminder"] as BubbleType[]).map((t) => (
            <button
              type="button"
              key={t}
              onClick={() => setType(t)}
              className={`${btn} w-full px-1 capitalize ${
                type === t ? "border-indigo-600 bg-indigo-600 text-white" : ""
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

        {type === "link" && (
          <input
            className={input}
            placeholder="Description (optional)"
            value={desc}
            onChange={(e) => setDesc(e.target.value)}
          />
        )}

        <div className="flex gap-2">
          <input
            className={`${input} min-w-0 flex-1`}
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
          <button className="min-h-11 shrink-0 rounded-lg bg-indigo-600 px-5 font-medium text-white">
            Add
          </button>
        </div>
      </form>
    </main>
  );
}