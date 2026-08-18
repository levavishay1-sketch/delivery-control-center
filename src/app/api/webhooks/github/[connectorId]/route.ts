import { NextResponse } from "next/server";
import { decryptIntegrationConfig } from "@/lib/integrations";
import { verifyGithubSignature } from "@/lib/integrations/github";
import { getConnectorById } from "@/domain/connector/queries";
import { receiveWebhook } from "@/domain/connector/webhooks";
import { getRepositoryByConnectorId } from "@/domain/evidence/queries";
import {
  recordCheckRunEvent,
  recordDeploymentStatusEvent,
  recordPullRequestEvent,
  recordPushEvent,
} from "@/domain/evidence/commands";
import { DomainError } from "@/domain/shared/errors";

/**
 * Engineering-evidence event types (design.md decision 2) — handled alongside the existing
 * sync-trigger path, after the same signature verification and WebhookDelivery dedup insert.
 * A delivery for a connector with no linked Repository yet is accepted (dedup still applies) but
 * produces no evidence effect.
 */
async function recordEvidenceEvent(connectorId: string, eventType: string, payload: unknown) {
  const repository = await getRepositoryByConnectorId(connectorId);
  if (!repository) return;

  switch (eventType) {
    case "push":
      await recordPushEvent(repository.id, payload as Parameters<typeof recordPushEvent>[1]);
      return;
    case "pull_request":
      await recordPullRequestEvent(repository.id, payload as Parameters<typeof recordPullRequestEvent>[1]);
      return;
    case "check_run":
      await recordCheckRunEvent(repository.id, payload as Parameters<typeof recordCheckRunEvent>[1]);
      return;
    case "deployment_status":
      await recordDeploymentStatusEvent(repository.id, payload as Parameters<typeof recordDeploymentStatusEvent>[1]);
      return;
  }
}

/**
 * GitHub webhook intake. Verified by HMAC-SHA256 signature (X-Hub-Signature-256) against the
 * connector's configured webhookSecret before any sync effect — an unverified or
 * unmatched-connector request is rejected with no WebhookDelivery row created.
 */
export async function POST(request: Request, routeCtx: RouteContext<"/api/webhooks/github/[connectorId]">) {
  const { connectorId } = await routeCtx.params;

  try {
    const connector = await getConnectorById(connectorId);
    if (!connector || connector.type !== "GITHUB") {
      return NextResponse.json({ error: "Unknown connector" }, { status: 404 });
    }

    const rawBody = await request.text();
    const config = decryptIntegrationConfig("GITHUB", connector.config as Record<string, unknown> | null) as {
      webhookSecret?: string;
    } | null;
    const signature = request.headers.get("x-hub-signature-256");
    if (!config?.webhookSecret || !verifyGithubSignature(rawBody, signature, config.webhookSecret)) {
      return NextResponse.json({ error: "Invalid signature" }, { status: 401 });
    }

    const deliveryId = request.headers.get("x-github-delivery");
    if (!deliveryId) {
      return NextResponse.json({ error: "Missing delivery id" }, { status: 400 });
    }

    const eventType = request.headers.get("x-github-event") ?? "";
    const evidenceEventTypes = new Set(["push", "pull_request", "check_run", "deployment_status"]);
    const isEvidenceEvent = evidenceEventTypes.has(eventType);

    const result = await receiveWebhook(connectorId, deliveryId, !isEvidenceEvent);

    if (isEvidenceEvent && result.status !== "duplicate") {
      const payload = JSON.parse(rawBody);
      await recordEvidenceEvent(connectorId, eventType, payload);
    }

    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
