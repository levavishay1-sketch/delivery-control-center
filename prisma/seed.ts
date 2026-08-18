import { db } from "../src/lib/db";
import { startPipeline } from "../src/domain/pipeline/commands";
import { hashPassword } from "../src/domain/shared/password";
import type { AuthContext } from "../src/domain/shared/context";

async function main() {
  const adminEmail = "admin@example.com";
  const adminPassword = process.env.SEED_ADMIN_PASSWORD;
  if (!adminPassword) {
    throw new Error("Set SEED_ADMIN_PASSWORD in .env before seeding.");
  }
  const adminPasswordHash = await hashPassword(adminPassword);
  await db.user.upsert({
    where: { email: adminEmail },
    update: { passwordHash: adminPasswordHash },
    create: { email: adminEmail, name: "Org Admin", isOrgAdmin: true, passwordHash: adminPasswordHash },
  });
  console.log(`Seeded org-admin user ${adminEmail}.`);

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

  // A second client and a client-scoped Viewer user, so tenancy isolation and role
  // enforcement have deterministic fixtures to run against (see e2e/isolation.spec.ts).
  const clientB = await db.client.upsert({
    where: { organizationId_slug: { organizationId: org.id, slug: "client-b" } },
    update: {},
    create: { organizationId: org.id, name: "Client B (isolation fixture)", slug: "client-b" },
  });

  const viewerEmail = "viewer@example.com";
  const viewer = await db.user.upsert({
    where: { email: viewerEmail },
    update: { passwordHash: adminPasswordHash },
    create: { email: viewerEmail, name: "Viewer User", passwordHash: adminPasswordHash },
  });
  await db.clientMembership.upsert({
    where: { userId_clientId: { userId: viewer.id, clientId: client.id } },
    update: { role: "VIEWER" },
    create: { userId: viewer.id, clientId: client.id, role: "VIEWER" },
  });
  console.log(`Seeded "${clientB.name}" and gave ${viewerEmail} a VIEWER membership on "${client.name}" only.`);

  const project = await db.project.upsert({
    where: { clientId_key: { clientId: client.id, key: "DCC" } },
    update: {},
    create: {
      clientId: client.id,
      name: "Delivery Control Center Demo",
      key: "DCC",
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
        status: "OPEN",
      },
    }));

  // startPipeline requires an APPROVED Constitution to exist first. Seeding creates one
  // directly (already APPROVED) rather than going through the job-backed draftConstitution
  // flow, which needs a running worker to complete — not available in a one-shot script.
  const existingConstitution = await db.constitution.findFirst({
    where: { projectId: project.id },
    orderBy: { version: "desc" },
  });
  if (!existingConstitution) {
    await db.constitution.create({
      data: {
        projectId: project.id,
        version: 1,
        status: "APPROVED",
        content:
          "# Constitution — Delivery Control Center Demo\n\n" +
          "## Principles\n" +
          "- Ship the smallest change that fully satisfies each work item's intent.\n" +
          "- Every decision that affects scope, cost, or timeline is recorded in the audit trail.\n" +
          "- No stage advances past a gate without an explicit human approval.\n",
        approvedAt: new Date(),
      },
    });
    console.log(`Seeded an APPROVED Constitution v1 for project "${project.name}".`);
  }

  const adminUser = await db.user.findUniqueOrThrow({ where: { email: adminEmail } });
  const adminCtx: AuthContext = { userId: adminUser.id, displayName: "Org Admin", isOrgAdmin: true, memberships: [] };

  const hasPipeline = await db.pipeline.findUnique({ where: { workItemId: workItem.id } });
  if (!hasPipeline) {
    await startPipeline(adminCtx, workItem.id);
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
