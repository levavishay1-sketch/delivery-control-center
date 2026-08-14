import { db } from "../src/lib/db";
import { createPipeline } from "../src/lib/pipeline";

async function main() {
  const project = await db.project.upsert({
    where: { key: "DCC" },
    update: {},
    create: {
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
