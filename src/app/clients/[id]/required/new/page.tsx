import { notFound } from "next/navigation";
import Link from "next/link";
import { getClientById } from "@/domain/client/queries";
import { requireAuthContext } from "@/domain/shared/session";

export const dynamic = "force-dynamic";

type PageProps = { params: Promise<{ id: string }> };

export default async function NewRequiredPage({ params }: PageProps) {
  const { id } = await params;
  const ctx = await requireAuthContext();
  const client = await getClientById(ctx, id);

  if (!client) {
    notFound();
  }

  return (
    <div className="flex flex-col gap-4">
      <Link href={`/clients/${client.id}`} className="text-sm opacity-60 hover:opacity-100 w-fit">
        &larr; Back to {client.name}
      </Link>
      <h1 className="text-2xl font-bold">New Required</h1>
      <p className="text-sm opacity-60">
        A new Requirement for {client.name} will be created here. This screen is a placeholder —
        the creation form is not implemented yet.
      </p>
    </div>
  );
}
