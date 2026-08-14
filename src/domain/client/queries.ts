import { db } from "@/lib/db";

export async function listClients() {
  return db.client.findMany({ orderBy: { createdAt: "desc" }, include: { organization: true } });
}

export async function getClientById(id: string) {
  return db.client.findUnique({ where: { id } });
}
