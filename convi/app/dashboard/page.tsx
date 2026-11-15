import Link from "next/link";
import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import EnableNotifications from "@/components/EnableNotifications";

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

  const bigBtn =
    "flex min-h-14 items-center justify-center rounded-xl bg-indigo-600 px-4 text-lg font-medium text-white";

  return (
    <main className="mx-auto min-h-dvh w-full max-w-2xl space-y-4 px-4 py-6 sm:px-6">
      <h1 className="text-2xl font-bold sm:text-3xl">Convi</h1>
      <p className="break-all text-sm sm:text-base">Signed in as {user.email}</p>
      <p className="text-sm text-gray-500">
        Database check:{" "}
        {error ? `Error: ${error.message}` : `OK, ${count} books`}
      </p>

      <div className="grid grid-cols-2 gap-3">
        <Link href="/notes" className={bigBtn}>
          📖 Notes
        </Link>
        <Link href="/contacts" className={bigBtn}>
          👤 Contacts
        </Link>
      </div>

      <EnableNotifications />

      <form action={signOut}>
        <button className="min-h-11 w-full rounded-lg border border-gray-400 px-4 sm:w-auto">
          Log out
        </button>
      </form>
    </main>
  );
}