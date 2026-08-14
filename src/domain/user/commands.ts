import { db } from "@/lib/db";
import { hashPassword } from "@/domain/shared/password";

export interface CreateUserInput {
  email: string;
  name?: string;
  password: string;
  isOrgAdmin?: boolean;
}

export async function createUser(input: CreateUserInput) {
  const passwordHash = await hashPassword(input.password);
  return db.user.create({
    data: {
      email: input.email,
      name: input.name,
      passwordHash,
      isOrgAdmin: input.isOrgAdmin ?? false,
    },
  });
}
