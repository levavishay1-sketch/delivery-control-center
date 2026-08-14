import { db } from "@/lib/db";

export interface CreateClientInput {
  organizationId: string;
  name: string;
  slug: string;
}

export async function createClient(input: CreateClientInput) {
  return db.client.create({
    data: { organizationId: input.organizationId, name: input.name, slug: input.slug },
  });
}
