"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { useParams, useRouter } from "next/navigation";
import { createClient } from "@/lib/supabase/client";

type PageRow = { id: string; title: string; updated_at: string };

const btn = "rounded-lg border border-gray-400 px-3 py-2 text-sm";
const input =
  "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-3";

export default function BookPage() {
  const { bookId } = useParams<{ bookId: string }>();
  const router = useRouter();
  const supabase = useMemo(() => createClient(), []);
  const [bookTitle, setBookTitle] = useState("");
  const [pages, setPages] = useState<PageRow[]>([]);
  const [title, setTitle] = useState("");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data: book } = await supabase
      .from("books")
      .select("title")
      .eq("id", bookId)
      .single();
    setBookTitle(book?.title ?? "");

    const { data, error } = await supabase
      .from("pages")
      .select("id, title, updated_at")
      .eq("book_id", bookId)
      .order("position")
      .order("created_at");
    if (error) setError(error.message);
    else setPages(data ?? []);
  }, [supabase, bookId]);

  useEffect(() => {
    load();
  }, [load]);

  async function addPage(e: React.FormEvent) {
    e.preventDefault();
    const { data, error } = await supabase
      .from("pages")
      .insert({
        book_id: bookId,
        title: title.trim() || "Untitled",
        position: pages.length,
      })
      .select("id")
      .single();
    if (error || !data) return setError(error?.message ?? "Could not create page");
    router.push(`/notes/${bookId}/${data.id}`);
  }

  async function removePage(p: PageRow) {
    if (!confirm(`Delete page "${p.title}"?`)) return;
    await supabase.from("pages").delete().eq("id", p.id);
    load();
  }

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">📖 {bookTitle}</h1>
        <Link href="/notes" className={btn}>Back</Link>
      </div>

      <form onSubmit={addPage} className="flex gap-2">
        <input
          className={input}
          placeholder="New page title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <button className="rounded-lg bg-indigo-600 px-4 text-white whitespace-nowrap">
          + Add
        </button>
      </form>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <ul className="space-y-3">
        {pages.map((p) => (
          <li
            key={p.id}
            className="flex items-center justify-between rounded-2xl border border-gray-300 dark:border-gray-700 p-4"
          >
            <Link href={`/notes/${bookId}/${p.id}`} className="flex-1">
              <p className="font-semibold">📄 {p.title}</p>
              <p className="text-xs text-gray-500">
                Updated {new Date(p.updated_at).toLocaleString()}
              </p>
            </Link>
            <button className={btn + " text-red-500"} onClick={() => removePage(p)}>
              Delete
            </button>
          </li>
        ))}
        {pages.length === 0 && <p className="text-gray-500">No pages yet.</p>}
      </ul>
    </main>
  );
}