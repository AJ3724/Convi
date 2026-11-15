"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import Link from "next/link";
import { createClient } from "@/lib/supabase/client";
import {
  dialUrl, whatsappUrl, gmailUrl, outlookUrl, outlookWorkUrl, mailtoUrl,
} from "@/lib/contactActions";

type Phone = { id: string; label: string; number_e164: string };
type Email = { id: string; label: string; email: string };
type Contact = {
  id: string;
  name: string;
  notes: string | null;
  is_favorite: boolean;
  contact_phones: Phone[];
  contact_emails: Email[];
};

type Modal =
  | { kind: "call"; contact: Contact }
  | { kind: "email"; contact: Contact }
  | null;

const btn = "rounded-lg border border-gray-400 px-3 py-2 text-sm";
const input =
  "w-full rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent p-3";

export default function ContactsPage() {
  const supabase = useMemo(() => createClient(), []);
  const [contacts, setContacts] = useState<Contact[]>([]);
  const [search, setSearch] = useState("");
  const [modal, setModal] = useState<Modal>(null);
  const [showForm, setShowForm] = useState(false);
  const [error, setError] = useState("");

  // form state
  const [name, setName] = useState("");
  const [phone, setPhone] = useState("");
  const [email, setEmail] = useState("");
  const [notes, setNotes] = useState("");

  const load = useCallback(async () => {
    const { data, error } = await supabase
      .from("contacts")
      .select("*, contact_phones(*), contact_emails(*)")
      .order("name");
    if (error) setError(error.message);
    else setContacts((data as Contact[]) ?? []);
  }, [supabase]);

  useEffect(() => {
    load();
  }, [load]);

  async function addContact(e: React.FormEvent) {
    e.preventDefault();
    setError("");

    const cleanPhone = phone.replace(/[\s()-]/g, "");
    if (cleanPhone && !/^\+[1-9]\d{6,14}$/.test(cleanPhone)) {
      setError("Phone must start with + and country code, e.g. +96171123456");
      return;
    }

    const { data: c, error: cErr } = await supabase
      .from("contacts")
      .insert({ name: name.trim(), notes: notes.trim() || null })
      .select("id")
      .single();
    if (cErr || !c) return setError(cErr?.message ?? "Could not save contact");

    if (cleanPhone) {
      const { error: pErr } = await supabase
        .from("contact_phones")
        .insert({ contact_id: c.id, number_e164: cleanPhone });
      if (pErr) return setError(pErr.message);
    }
    if (email.trim()) {
      const { error: eErr } = await supabase
        .from("contact_emails")
        .insert({ contact_id: c.id, email: email.trim() });
      if (eErr) return setError(eErr.message);
    }

    setName(""); setPhone(""); setEmail(""); setNotes("");
    setShowForm(false);
    load();
  }

  async function toggleFavorite(c: Contact) {
    await supabase.from("contacts").update({ is_favorite: !c.is_favorite }).eq("id", c.id);
    load();
  }

  async function remove(c: Contact) {
    if (!confirm(`Delete ${c.name}?`)) return;
    await supabase.from("contacts").delete().eq("id", c.id);
    load();
  }

  const q = search.toLowerCase();
  const shown = contacts
    .filter(
      (c) =>
        c.name.toLowerCase().includes(q) ||
        c.contact_phones.some((p) => p.number_e164.includes(q)) ||
        c.contact_emails.some((m) => m.email.toLowerCase().includes(q))
    )
    .sort((a, b) => Number(b.is_favorite) - Number(a.is_favorite));

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto space-y-4">
      <div className="flex items-center justify-between">
        <h1 className="text-3xl font-bold">Contacts</h1>
        <Link href="/dashboard" className={btn}>Back</Link>
      </div>

      <div className="flex gap-2">
        <input
          className={input}
          placeholder="Search name, phone or email"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <button className={btn + " whitespace-nowrap"} onClick={() => setShowForm(!showForm)}>
          {showForm ? "Cancel" : "+ Add"}
        </button>
      </div>

      {error && <p className="text-sm text-red-500">{error}</p>}

      {showForm && (
        <form onSubmit={addContact} className="space-y-3 rounded-2xl border border-gray-300 dark:border-gray-700 p-4">
          <input className={input} required placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={input} placeholder="Phone, e.g. +96171123456" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="w-full rounded-lg bg-indigo-600 p-3 font-medium text-white">Save contact</button>
        </form>
      )}

      <ul className="space-y-3">
        {shown.map((c) => (
          <li key={c.id} className="rounded-2xl border border-gray-300 dark:border-gray-700 p-4 space-y-2">
            <div className="flex items-start justify-between">
              <div>
                <p className="font-semibold">{c.name}</p>
                {c.contact_phones.map((p) => (
                  <p key={p.id} className="text-sm text-gray-500">{p.number_e164}</p>
                ))}
                {c.contact_emails.map((m) => (
                  <p key={m.id} className="text-sm text-gray-500">{m.email}</p>
                ))}
                {c.notes && <p className="text-sm italic text-gray-500">{c.notes}</p>}
              </div>
              <button onClick={() => toggleFavorite(c)} aria-label="Favorite">
                {c.is_favorite ? "★" : "☆"}
              </button>
            </div>
            <div className="flex gap-2">
              {c.contact_phones.length > 0 && (
                <button className={btn} onClick={() => setModal({ kind: "call", contact: c })}>Call</button>
              )}
              {c.contact_emails.length > 0 && (
                <button className={btn} onClick={() => setModal({ kind: "email", contact: c })}>Email</button>
              )}
              <button className={btn + " ml-auto text-red-500"} onClick={() => remove(c)}>Delete</button>
            </div>
          </li>
        ))}
        {shown.length === 0 && <p className="text-gray-500">No contacts yet.</p>}
      </ul>

      {modal && (
        <div className="fixed inset-0 z-50 flex items-end sm:items-center justify-center bg-black/50 p-4" onClick={() => setModal(null)}>
          <div className="w-full max-w-sm space-y-3 rounded-2xl bg-white dark:bg-zinc-900 p-5" onClick={(e) => e.stopPropagation()}>
            <h2 className="text-lg font-semibold">
              {modal.kind === "call" ? "Call" : "Email"} {modal.contact.name}
            </h2>

            {modal.kind === "call" &&
              modal.contact.contact_phones.map((p) => (
                <div key={p.id} className="space-y-2">
                  <p className="text-sm text-gray-500">{p.number_e164}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <a href={dialUrl(p.number_e164)} className="rounded-lg bg-indigo-600 p-3 text-center text-white">Dial</a>
                    <a href={whatsappUrl(p.number_e164)} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-green-600 p-3 text-center text-white">WhatsApp</a>
                  </div>
                </div>
              ))}

            {modal.kind === "email" &&
              modal.contact.contact_emails.map((m) => (
                <div key={m.id} className="space-y-2">
                  <p className="text-sm text-gray-500">{m.email}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <a href={gmailUrl(m.email)} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-red-600 p-3 text-center text-white">Gmail</a>
                    <a href={outlookUrl(m.email)} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-blue-600 p-3 text-center text-white">Outlook</a>
                    <a href={outlookWorkUrl(m.email)} target="_blank" rel="noopener noreferrer" className="rounded-lg bg-blue-800 p-3 text-center text-white">Outlook (work)</a>
                    <a href={mailtoUrl(m.email)} className="rounded-lg bg-gray-600 p-3 text-center text-white">Default app</a>
                  </div>
                </div>
              ))}

            <button className={btn + " w-full"} onClick={() => setModal(null)}>Close</button>
          </div>
        </div>
      )}
    </main>
  );
}