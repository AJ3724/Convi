"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Book = { id: string; title: string; color: string };

const btn = "rounded-lg border border-gray-400 px-3 py-2 text-sm";
const input =
  "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-3";

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
    <main className="min-h-screen p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Notes</h1>
        <Link href="/dashboard" className={btn}>Back</Link>
      </div>

      <form onSubmit={addBook} className="flex gap-2">
        <input
          className={input}
          placeholder="New book title"
          value={title}
          onChange={(e) => setTitle(e.target.value)}
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-12 w-14 rounded-lg border border-gray-300 bg-transparent p-1"
          aria-label="Book color"
        />
        <button className="rounded-lg bg-indigo-600 px-4 text-white whitespace-nowrap">
          + Add
        </button>
      </form>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <ul className="space-y-3">
        {books.map((b) => (
          <li
            key={b.id}
            className="flex items-center justify-between rounded-2xl border border-gray-300 dark:border-gray-700 p-4"
            style={{ borderLeft: `8px solid ${b.color}` }}
          >
            <Link href={`/notes/${b.id}`} className="flex-1 font-semibold">
              📖 {b.title}
            </Link>
            <button className={btn + " text-red-500"} onClick={() => removeBook(b)}>
              Delete
            </button>
          </li>
        ))}
        {books.length === 0 && <p className="text-gray-500">No books yet. Create your first one above.</p>}
      </ul>
    </main>
  );
}