import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";

export default async function DashboardPage() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (!user) redirect("/login");

  const { count, error } = await supabase
    .from("books")
    .select("*", { count: "exact", head: true });

  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <main className="min-h-screen p-6 max-w-2xl mx-auto space-y-4">
      <h1 className="text-3xl font-bold">Convi</h1>
      <p>Signed in as {user.email}</p>
      <p>
        Database check:{" "}
        {error ? `Error: ${error.message}` : `OK, ${count} books`}
      </p>

      <div className="flex gap-2">
        <Link
          href="/notes"
          className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-white"
        >
          Notes
        </Link>
        <Link
          href="/contacts"
          className="inline-block rounded-lg bg-indigo-600 px-4 py-2 text-white"
        >
          Contacts
        </Link>
      </div>

      <form action={signOut}>
        <button className="rounded-lg border border-gray-400 px-4 py-2">
          Log out
        </button>
      </form>
    </main>
  );
}