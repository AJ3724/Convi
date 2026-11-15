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

const btn =
  "inline-flex min-h-11 items-center justify-center rounded-lg border border-gray-400 px-4 text-sm";
const input =
  "w-full min-h-11 rounded-lg border border-gray-300 dark:border-gray-700 bg-transparent px-3 py-2 text-base";
const sheetBtn = "flex min-h-12 items-center justify-center rounded-lg px-2 text-center text-white";

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
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <div className="flex items-center justify-between gap-3">
        <h1 className="text-2xl font-bold sm:text-3xl">Contacts</h1>
        <Link href="/dashboard" className={btn}>Back</Link>
      </div>

      <div className="flex gap-2">
        <input
          className={`${input} min-w-0 flex-1`}
          placeholder="Search name, phone or email"
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
          onSubmit={addContact}
          className="space-y-3 rounded-2xl border border-gray-300 p-4 dark:border-gray-700"
        >
          <input className={input} required placeholder="Name" value={name} onChange={(e) => setName(e.target.value)} />
          <input className={input} type="tel" inputMode="tel" placeholder="Phone, e.g. +96171123456" value={phone} onChange={(e) => setPhone(e.target.value)} />
          <input className={input} type="email" placeholder="Email" value={email} onChange={(e) => setEmail(e.target.value)} />
          <input className={input} placeholder="Notes (optional)" value={notes} onChange={(e) => setNotes(e.target.value)} />
          <button className="min-h-12 w-full rounded-lg bg-indigo-600 font-medium text-white">
            Save contact
          </button>
        </form>
      )}

      <ul className="space-y-3">
        {shown.map((c) => (
          <li key={c.id} className="space-y-3 rounded-2xl border border-gray-300 p-4 dark:border-gray-700">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                <p className="break-words font-semibold">{c.name}</p>
                {c.contact_phones.map((p) => (
                  <p key={p.id} className="text-sm text-gray-500">{p.number_e164}</p>
                ))}
                {c.contact_emails.map((m) => (
                  <p key={m.id} className="break-all text-sm text-gray-500">{m.email}</p>
                ))}
                {c.notes && <p className="text-sm italic text-gray-500">{c.notes}</p>}
              </div>
              <button
                onClick={() => toggleFavorite(c)}
                aria-label="Favorite"
                className="-m-2 shrink-0 p-2 text-2xl leading-none"
              >
                {c.is_favorite ? "★" : "☆"}
              </button>
            </div>
            <div className="flex flex-wrap gap-2">
              {c.contact_phones.length > 0 && (
                <button className={btn} onClick={() => setModal({ kind: "call", contact: c })}>
                  📞 Call
                </button>
              )}
              {c.contact_emails.length > 0 && (
                <button className={btn} onClick={() => setModal({ kind: "email", contact: c })}>
                  ✉️ Email
                </button>
              )}
              <button className={`${btn} ml-auto text-red-500`} onClick={() => remove(c)}>
                Delete
              </button>
            </div>
          </li>
        ))}
        {shown.length === 0 && <p className="text-gray-500">No contacts yet.</p>}
      </ul>

      {modal && (
        <div
          className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 sm:items-center sm:p-4"
          onClick={() => setModal(null)}
        >
          <div
            className="max-h-[90dvh] w-full max-w-md space-y-4 overflow-y-auto rounded-t-2xl bg-white p-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] dark:bg-zinc-900 sm:rounded-2xl"
            onClick={(e) => e.stopPropagation()}
          >
            <h2 className="break-words text-lg font-semibold">
              {modal.kind === "call" ? "Call" : "Email"} {modal.contact.name}
            </h2>

            {modal.kind === "call" &&
              modal.contact.contact_phones.map((p) => (
                <div key={p.id} className="space-y-2">
                  <p className="text-sm text-gray-500">{p.number_e164}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <a href={dialUrl(p.number_e164)} className={`${sheetBtn} bg-indigo-600`}>
                      Dial
                    </a>
                    <a
                      href={whatsappUrl(p.number_e164)}
                      target="_blank"
                      rel="noopener noreferrer"
                      className={`${sheetBtn} bg-green-600`}
                    >
                      WhatsApp
                    </a>
                  </div>
                </div>
              ))}

            {modal.kind === "email" &&
              modal.contact.contact_emails.map((m) => (
                <div key={m.id} className="space-y-2">
                  <p className="break-all text-sm text-gray-500">{m.email}</p>
                  <div className="grid grid-cols-2 gap-2">
                    <a href={gmailUrl(m.email)} target="_blank" rel="noopener noreferrer" className={`${sheetBtn} bg-red-600`}>
                      Gmail
                    </a>
                    <a href={outlookUrl(m.email)} target="_blank" rel="noopener noreferrer" className={`${sheetBtn} bg-blue-600`}>
                      Outlook
                    </a>
                    <a href={outlookWorkUrl(m.email)} target="_blank" rel="noopener noreferrer" className={`${sheetBtn} bg-blue-800`}>
                      Outlook (work)
                    </a>
                    <a href={mailtoUrl(m.email)} className={`${sheetBtn} bg-gray-600`}>
                      Default app
                    </a>
                  </div>
                </div>
              ))}

            <button className={`${btn} w-full`} onClick={() => setModal(null)}>
              Close
            </button>
          </div>
        </div>
      )}
    </main>
  );
}