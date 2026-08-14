import { db } from "@/lib/db";

export async function createOrganization(name: string, slug: string) {
  return db.organization.create({ data: { name, slug } });
}
