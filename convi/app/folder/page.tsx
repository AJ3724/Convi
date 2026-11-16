"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";

type Folder = { id: string; name: string; color: string; places: { count: number }[] };

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-400 px-4 text-sm";
const input =
  "w-full min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-base";

export default function FoldersPage() {
  const supabase = useMemo(() => createClient(), []);
  const [folders, setFolders] = useState<Folder[]>([]);
  const [name, setName] = useState("");
  const [color, setColor] = useState("#0ea5e9");
  const [error, setError] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("folders")
      .select("id, name, color, places(count)")
      .order("position")
      .order("created_at");
    if (error) setError(error.message);
    else setFolders((data as Folder[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addFolder(e: React.FormEvent) {
    e.preventDefault();
    if (!name.trim()) return;
    const { error } = await supabase
      .from("folders")
      .insert({ name: name.trim(), color, position: folders.length });
    if (error) return setError(error.message);
    setName("");
    load();
  }

  async function removeFolder(f: Folder) {
    if (!confirm(`Delete folder "${f.name}" and all its places?`)) return;
    await supabase.from("folders").delete().eq("id", f.id);
    load();
  }

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Folders</h1>
        <Link href="/dashboard" className={btn}>Back</Link>
      </div>

      <form onSubmit={addFolder} className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="New folder name"
          value={name}
          onChange={(e) => setName(e.target.value)}
        />
        <input
          type="color"
          value={color}
          onChange={(e) => setColor(e.target.value)}
          className="h-11 w-12 shrink-0 rounded-lg border border-gray-300 bg-transparent p-1"
          aria-label="Folder color"
        />
        <button className="min-h-11 shrink-0 rounded-lg bg-indigo-600 px-4 font-medium text-white">
          + Add
        </button>
      </form>

      {error && <p className="text-sm text-red-500">{error}</p>}

      <ul className="space-y-3">
        {folders.map((f) => (
          <li
            key={f.id}
            className="flex items-center gap-2 rounded-2xl border border-gray-300 p-2 pl-4 dark:border-gray-700"
            style={{ borderLeft: `8px solid ${f.color}` }}
          >
            <Link
              href={`/folders/${f.id}`}
              className="flex min-h-11 min-w-0 flex-1 items-center gap-2 font-semibold"
            >
              <span className="truncate">📁 {f.name}</span>
              <span className="shrink-0 text-sm font-normal text-gray-500">
                {f.places?.[0]?.count ?? 0}
              </span>
            </Link>
            <button className={`${btn} text-red-500`} onClick={() => removeFolder(f)}>
              Delete
            </button>
          </li>
        ))}
        {folders.length === 0 && (
          <p className="text-gray-500">No folders yet. Create your first one above.</p>
        )}
      </ul>
    </main>
  );
}