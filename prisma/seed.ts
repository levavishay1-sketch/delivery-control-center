import { db } from "../src/lib/db";
import { createPipeline } from "../src/domain/pipeline/commands";
import { hashPassword } from "../src/domain/shared/password";

async function main() {
  const adminEmail = "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error("Set SEED_ADMIN_PASSWORD in .env before seeding.");
  }
  const existingAdmin = await db.user.findUnique({ where: { email: adminEmail } });
  if (!existingAdmin) {
    await db.user.create({
      data: { email: adminEmail, name: "Org Admin", isOrgAdmin: true, passwordHash: await hashPassword(adminPassword) },
    });
    console.log(`Seeded org-admin user ${adminEmail}.`);
  }

  const org = await db.organization.upsert({
    where: { slug: "default" },
    update: {},
    create: { name: "Default Organization", slug: "default" },
  });

  const client = await db.client.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: "default" } },
    update: {},
    create: { organizationId: org.id, name: "Default Client", slug: "default" },
  });

  const project = await db.project.upsert({
    where: { clientId_key: { clientId: client.id, key: "DCC" } },
    update: {},
    create: {
      clientId: client.id,
      name: "Delivery Control Center Demo",
      key: "DCC",
      integrationType: "MANUAL",
    },
  });

  const existing = await db.workItem.findFirst({
    where: { projectId: project.id, externalId: "DCC-1" },
  });

  const workItem =
    existing ??
    (await db.workItem.create({
      data: {
        projectId: project.id,
        source: "MANUAL",
        externalId: "DCC-1",
        title: "Add password-reset self-service flow",
        description:
          "Users currently have to email support to reset their password. Add a self-service " +
          "'forgot password' flow that emails a reset link and lets the user set a new password.",
        status: "open",
      },
    }));

  const hasPipeline = await db.pipeline.findUnique({ where: { workItemId: workItem.id } });
  if (!hasPipeline) {
    await createPipeline(workItem.id);
    console.log(`Seeded project "${project.name}" with work item "${workItem.title}" and a fresh pipeline.`);
  } else {
    console.log("Seed data already present — nothing to do.");
  }
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await db.$disconnect();
  });
