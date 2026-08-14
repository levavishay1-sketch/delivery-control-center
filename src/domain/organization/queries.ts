import { db } from "@/lib/db";

export async function listOrganizations() {
  return db.organization.findMany({ orderBy: { createdAt: "desc" }, include: { clients: true } });
}

export async function getOrganizationBySlug(slug: string) {
  return db.organization.findUnique({ where: { slug } });
}
