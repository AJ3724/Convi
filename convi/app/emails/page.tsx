"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  dialUrl,
  whatsappUrl,
  gmailUrl,
  outlookUrl,
  outlookWorkUrl,
  mailtoUrl,
} from "@/lib/contactActions";

type Addr = { id: string; email: string; label: string | null; created_at: string };
type Person = {
  id: string;
  name: string;
  description: string | null;
  phone: string | null;
  email_addresses: Addr[];
};
type Row = { email: string; label: string };

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const PHONE_RE = /^\+[1-9]\d{6,14}$/;
const collator = new Intl.Collator(undefined, { sensitivity: "base", numeric: true });

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-400 px-3 text-sm";
const smallBtn =
  "inline-flex min-h-10 items-center justify-center rounded-lg border border-gray-400 px-3 text-sm";
const input =
  "w-full min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-base";

export default function EmailsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [people, setPeople] = useState<Person[]>([]);
  const [search, setSearch] = useState("");
  const [showForm, setShowForm] = useState(false);
  const [openId, setOpenId] = useState<string | null>(null);
  const [editId, setEditId] = useState<string | null>(null);
  const [error, setError] = useState("");
  const [copied, setCopied] = useState<string | null>(null);

  // add-person form
  const [name, setName] = useState("");
  const [description, setDescription] = useState("");
  const [phone, setPhone] = useState("");
  const [rows, setRows] = useState<Row[]>([{ email: "", label: "" }]);

  // edit form
  const [eName, setEName] = useState("");
  const [eDesc, setEDesc] = useState("");
  const [ePhone, setEPhone] = useState("");

  // add one more email to an existing person
  const [newEmail, setNewEmail] = useState("");
  const [newLabel, setNewLabel] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("email_people")
      .select("id, name, description, phone, email_addresses(id, email, label, created_at)");
    if (error) setError(error.message);
    else setPeople((data as Person[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  function toggleOpen(id: string) {
    setOpenId(openId === id ? null : id);
    setEditId(null);
    setNewEmail("");
    setNewLabel("");
    setError("");
  }

  function updateRow(i: number, patch: Partial<Row>) {
    setRows((list) => list.map((r, idx) => (idx === i ? { ...r, ...patch } : r)));
  }

  async function addPerson(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const cleanPhone = phone.replace(/[\s()-]/g, "");
    if (cleanPhone && !PHONE_RE.test(cleanPhone)) {
      return setError("Phone must start with + and country code, e.g. +96171123456");
    }

    const filled = rows
      .map((r) => ({ email: r.email.trim(), label: r.label.trim() }))
      .filter((r) => r.email);
    if (filled.length === 0) return setError("Add at least one email address.");
    for (const r of filled) {
      if (!EMAIL_RE.test(r.email)) return setError(`"${r.email}" is not a valid email.`);
    }
    const lower = filled.map((r) => r.email.toLowerCase());
    if (new Set(lower).size !== lower.length) {
      return setError("The same email is listed twice.");
    }

    const { data: p, error: pErr } = await supabase
      .from("email_people")
      .insert({
        name: name.trim(),
        description: description.trim() || null,
        phone: cleanPhone || null,
      })
      .select("id")
      .single();
    if (pErr || !p) return setError(pErr?.message ?? "Could not save.");

    const { error: aErr } = await supabase.from("email_addresses").insert(
      filled.map((r) => ({
        person_id: p.id,
        email: r.email,
        label: r.label || null,
      }))
    );
    if (aErr) {
      await supabase.from("email_people").delete().eq("id", p.id);
      return setError(aErr.message);
    }

    setName(""); setDescription(""); setPhone("");
    setRows([{ email: "", label: "" }]);
    setShowForm(false);
    load();
  }

  async function addEmailTo(p: Person) {
    setError("");
    const email = newEmail.trim();
    if (!EMAIL_RE.test(email)) return setError("That doesn't look like a valid email.");
    if (p.email_addresses.some((a) => a.email.toLowerCase() === email.toLowerCase())) {
      return setError("This person already has that email.");
    }
    const { error } = await supabase.from("email_addresses").insert({
      person_id: p.id,
      email,
      label: newLabel.trim() || null,
    });
    if (error) return setError(error.message);
    setNewEmail("");
    setNewLabel("");
    load();
  }

  async function removeEmail(p: Person, a: Addr) {
    const last = p.email_addresses.length === 1;
    if (!confirm(last ? `Remove ${a.email}? ${p.name} will have no emails left.` : `Remove ${a.email}?`)) {
      return;
    }
    await supabase.from("email_addresses").delete().eq("id", a.id);
    load();
  }

  function startEdit(p: Person) {
    setEditId(p.id);
    setEName(p.name);
    setEDesc(p.description ?? "");
    setEPhone(p.phone ?? "");
    setError("");
  }

  async function saveEdit(p: Person) {
    setError("");
    const cleanPhone = ePhone.replace(/[\s()-]/g, "");
    if (!eName.trim()) return setError("Name can't be empty.");
    if (cleanPhone && !PHONE_RE.test(cleanPhone)) {
      return setError("Phone must start with + and country code, e.g. +96171123456");
    }
    const { error } = await supabase
      .from("email_people")
      .update({
        name: eName.trim(),
        description: eDesc.trim() || null,
        phone: cleanPhone || null,
      })
      .eq("id", p.id);
    if (error) return setError(error.message);
    setEditId(null);
    load();
  }

  async function removePerson(p: Person) {
    if (!confirm(`Delete ${p.name} and all their emails?`)) return;
    await supabase.from("email_people").delete().eq("id", p.id);
    setOpenId(null);
    load();
  }

  async function copyText(key: string, text: string) {
    try {
      await navigator.clipboard.writeText(text);
    } catch {
      window.prompt("Copy:", text);
    }
    setCopied(key);
    setTimeout(() => setCopied(null), 1500);
  }

  const q = search.trim().toLowerCase();
  const qDigits = q.replace(/\D/g, "");
  const shown = people
    .filter((p) => {
      if (!q) return true;
      const phoneDigits = (p.phone ?? "").replace(/\D/g, "");
      return (
        p.name.toLowerCase().includes(q) ||
        (p.description ?? "").toLowerCase().includes(q) ||
        (p.phone ?? "").includes(q) ||
        (qDigits.length > 0 && phoneDigits.includes(qDigits)) ||
        p.email_addresses.some(
          (a) =>
            a.email.toLowerCase().includes(q) || (a.label ?? "").toLowerCase().includes(q)
        )
      );
    })
    .sort((a, b) => collator.compare(a.name, b.name));

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Emails</h1>
        <Link href="/dashboard" className={btn}>Back</Link>
      </div>

      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="Search name, description, phone or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className={`${btn} shrink-0`} onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {showForm && (
        <form
          onSubmit={addPerson}
          className="space-y-3 rounded-2xl border border-gray-300 p-4 dark:border-gray-700"
        >
          <input
            className={input}
            required
            placeholder="Name, e.g. Tony"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <textarea
            className={`${input} resize-none`}
            rows={2}
            placeholder="Description (optional)"
            value={description}
            onChange={(e) => setDescription(e.target.value)}
          />
          <input
            className={input}
            type="tel"
            inputMode="tel"
            placeholder="Phone, e.g. +96171123456"
            value={phone}
            onChange={(e) => setPhone(e.target.value)}
          />

          <div className="space-y-2">
            <p className="text-sm font-medium">Email addresses</p>
            {rows.map((r, i) => (
              <div key={i} className="flex gap-2">
                <input
                  className={`${input} min-w-0 flex-[2]`}
                  type="email"
                  inputMode="email"
                  placeholder="name@example.com"
                  value={r.email}
                  onChange={(e) => updateRow(i, { email: e.target.value })}
                />
                <input
                  className={`${input} min-w-0 flex-1`}
                  placeholder="Label"
                  value={r.label}
                  onChange={(e) => updateRow(i, { label: e.target.value })}
                />
                {rows.length > 1 && (
                  <button
                    type="button"
                    className={`${btn} shrink-0 px-3 text-red-500`}
                    onClick={() => setRows((list) => list.filter((_, idx) => idx !== i))}
                    aria-label="Remove this email row"
                  >
                    ✕
                  </button>
                )}
              </div>
            ))}
            <button
              type="button"
              className={btn}
              onClick={() => setRows((list) => [...list, { email: "", label: "" }])}
            >
              + Add another email
            </button>
          </div>

          <button className="min-h-12 w-full rounded-lg bg-indigo-600 font-medium text-white">
            Save
          </button>
        </form>
      )}

      <ul className="space-y-3">
        {shown.map((p) => {
          const open = openId === p.id;
          const editing = editId === p.id;
          const addrs = [...p.email_addresses].sort((a, b) =>
            a.created_at.localeCompare(b.created_at)
          );

          return (
            <li
              key={p.id}
              className="overflow-hidden rounded-2xl border border-gray-300 dark:border-gray-700"
            >
              {/* Collapsed view */}
              <button
                type="button"
                onClick={() => toggleOpen(p.id)}
                aria-expanded={open}
                className="flex w-full items-start gap-3 p-4 text-left"
              >
                <span className="block min-w-0 flex-1 space-y-1">
                  <span className="block break-words font-semibold">{p.name}</span>
                  {p.description && (
                    <span className="block break-words text-sm">{p.description}</span>
                  )}
                  {p.phone && (
                    <span className="block text-sm text-gray-500">📞 {p.phone}</span>
                  )}
                  {addrs.slice(0, 2).map((a) => (
                    <span key={a.id} className="block break-all text-sm text-gray-500">
                      ✉️ {a.email}
                    </span>
                  ))}
                  {addrs.length > 2 && (
                    <span className="block text-xs text-gray-500">
                      +{addrs.length - 2} more
                    </span>
                  )}
                </span>
                <span
                  className={`shrink-0 text-gray-500 transition-transform ${
                    open ? "rotate-180" : ""
                  }`}
                  aria-hidden
                >
                  ▾
                </span>
              </button>

              {/* Expanded view */}
              {open && (
                <div className="space-y-4 border-t border-gray-300 p-4 dark:border-gray-700">
                  {editing ? (
                    <div className="space-y-3">
                      <input
                        className={input}
                        placeholder="Name"
                        value={eName}
                        onChange={(e) => setEName(e.target.value)}
                      />
                      <textarea
                        className={`${input} resize-none`}
                        rows={2}
                        placeholder="Description"
                        value={eDesc}
                        onChange={(e) => setEDesc(e.target.value)}
                      />
                      <input
                        className={input}
                        type="tel"
                        inputMode="tel"
                        placeholder="Phone, e.g. +96171123456"
                        value={ePhone}
                        onChange={(e) => setEPhone(e.target.value)}
                      />
                      <div className="flex gap-2">
                        <button
                          className="min-h-11 flex-1 rounded-lg bg-indigo-600 font-medium text-white"
                          onClick={() => saveEdit(p)}
                        >
                          Save
                        </button>
                        <button className={`${btn} flex-1`} onClick={() => setEditId(null)}>
                          Cancel
                        </button>
                      </div>
                    </div>
                  ) : (
                    p.phone && (
                      <div className="flex flex-wrap gap-2">
                        <a href={dialUrl(p.phone)} className={btn}>📞 Dial</a>
                        <a
                          href={whatsappUrl(p.phone)}
                          target="_blank"
                          rel="noopener noreferrer"
                          className={btn}
                        >
                          💬 WhatsApp
                        </a>
                      </div>
                    )
                  )}

                  {/* One block per email address */}
                  <div className="space-y-3">
                    {addrs.map((a) => (
                      <div
                        key={a.id}
                        className="space-y-2 rounded-xl bg-gray-100 p-3 dark:bg-zinc-900"
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="min-w-0">
                            <p className="break-all text-sm font-medium">{a.email}</p>
                            {a.label && <p className="text-xs text-gray-500">{a.label}</p>}
                          </div>
                          <button
                            className="-m-2 shrink-0 p-2 text-gray-500 hover:text-red-500"
                            onClick={() => removeEmail(p, a)}
                            aria-label={`Remove ${a.email}`}
                          >
                            ✕
                          </button>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            className={smallBtn}
                            onClick={() => copyText(a.id, a.email)}
                          >
                            {copied === a.id ? "Copied ✓" : "📋 Copy"}
                          </button>
                          <a
                            href={gmailUrl(a.email)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={smallBtn}
                          >
                            Gmail
                          </a>
                          <a
                            href={outlookUrl(a.email)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={smallBtn}
                          >
                            Outlook
                          </a>
                          <a
                            href={outlookWorkUrl(a.email)}
                            target="_blank"
                            rel="noopener noreferrer"
                            className={smallBtn}
                          >
                            Outlook (work)
                          </a>
                          <a href={mailtoUrl(a.email)} className={smallBtn}>
                            Mail app
                          </a>
                        </div>
                      </div>
                    ))}
                  </div>

                  {/* Add another email to this person */}
                  <div className="space-y-2">
                    <p className="text-sm font-medium">Add another email to {p.name}</p>
                    <div className="flex gap-2">
                      <input
                        className={`${input} min-w-0 flex-[2]`}
                        type="email"
                        inputMode="email"
                        placeholder="name@example.com"
                        value={newEmail}
                        onChange={(e) => setNewEmail(e.target.value)}
                      />
                      <input
                        className={`${input} min-w-0 flex-1`}
                        placeholder="Label"
                        value={newLabel}
                        onChange={(e) => setNewLabel(e.target.value)}
                      />
                    </div>
                    <button
                      className="min-h-11 w-full rounded-lg bg-indigo-600 font-medium text-white disabled:opacity-50"
                      disabled={!newEmail.trim()}
                      onClick={() => addEmailTo(p)}
                    >
                      + Add email
                    </button>
                  </div>

                  {!editing && (
                    <div className="flex gap-2">
                      <button className={btn} onClick={() => startEdit(p)}>
                        ✏️ Edit details
                      </button>
                      <button
                        className={`${btn} ml-auto text-red-500`}
                        onClick={() => removePerson(p)}
                      >
                        Delete
                      </button>
                    </div>
                  )}
                </div>
              )}
            </li>
          );
        })}
        {shown.length === 0 && (
          <p className="text-gray-500">
            {people.length === 0 ? "No entries yet." : "Nothing matches your search."}
          </p>
        )}
      </ul>
    </main>
  );
}