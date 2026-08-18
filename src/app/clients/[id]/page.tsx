import { notFound } from "next/navigation";
import Link from "next/link";
import { getClientById } from "@/domain/client/queries";
import { requireAuthContext } from "@/domain/shared/session";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function ClientDetailPage({ params }: PageProps) {
  const { id } = await params;
  const ctx = await requireAuthContext();
  const client = await getClientById(ctx, id);

  if (!client) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-8">
      <section className="flex items-center justify-between gap-4">
        <h1 className="text-2xl font-bold">{client.name}</h1>
        <Link
          href={`/clients/${client.id}/required/new`}
          className="rounded bg-black text-white dark:bg-white dark:text-black px-4 py-2 text-sm font-medium hover:opacity-85"
        >
          Add Required
        </Link>
      </section>
    </div>
  );
}
