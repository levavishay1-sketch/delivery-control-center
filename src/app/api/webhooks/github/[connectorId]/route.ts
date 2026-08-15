import { NextResponse } from "next/server";
import { decryptIntegrationConfig } from "@/lib/integrations";
import { verifyGithubSignature } from "@/lib/integrations/github";
import { getConnectorById } from "@/domain/connector/queries";
import { receiveWebhook } from "@/domain/connector/webhooks";
import { DomainError } from "@/domain/shared/errors";

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

    const result = await receiveWebhook(connectorId, deliveryId);
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
