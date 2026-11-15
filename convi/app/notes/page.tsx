"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Book = { id: string; title: string; color: string };

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-400 px-4 text-sm";
const input =
  "w-full min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-base";

export default function NotesPage() {
  const supabase = useMemo(() => createClient(), []);
  const [books, setBooks] = useState<Book[]>([]);
  const [title, setTitle] = useState("");
  const [color, setColor] = useState("#6366f1");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("books")
      .select("id, title, color")
      .order("position")
      .order("created_at");
    if (error) setError(error.message);
    else setBooks(data ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addBook(e: React.FormEvent) {
    e.preventDefault();
    if (!title.trim()) return;
    const { error } = await supabase
      .from("books")
      .insert({ title: title.trim(), color, position: books.length });
    if (error) return setError(error.message);
    setTitle("");
    load();
  }

  async function removeBook(b: Book) {
    if (!confirm(`Delete "${b.title}" and all its pages?`)) return;
    await supabase.from("books").delete().eq("id", b.id);
    load();
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Notes</h1>
        <Link href="/dashboard" className={btn}>Back</Link>
      </div>

      <form onSubmit={addBook} className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="New book title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-11 w-12 shrink-0 rounded-lg border border-gray-300 bg-transparent p-1"
          aria-label="Book color"
        />
        <button className="min-h-11 shrink-0 rounded-lg bg-indigo-600 px-4 font-medium text-white">
          + Add
        </button>
      </form>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <ul className="space-y-3">
        {books.map((b) => (
          <li
            key={b.id}
            className="flex items-center gap-2 rounded-2xl border border-gray-300 dark:border-gray-700 p-2 pl-4"
            style={{ borderLeft: `8px solid ${b.color}` }}
          >
            <Link
              href={`/notes/${b.id}`}
              className="flex min-h-11 min-w-0 flex-1 items-center truncate font-semibold"
            >
              📖 {b.title}
            </Link>
            <button className={`${btn} text-red-500`} onClick={() => removeBook(b)}>
              Delete
            </button>
          </li>
        ))}
        {books.length === 0 && (
          <p className="text-gray-500">No books yet. Create your first one above.</p>
        )}
      </ul>
    </main>
  );
}