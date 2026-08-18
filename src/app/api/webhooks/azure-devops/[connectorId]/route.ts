import { NextResponse } from "next/server";
import { decryptIntegrationConfig } from "@/lib/integrations";
import { verifyAzureDevOpsAuth } from "@/lib/integrations/azureDevOps";
import { getConnectorById } from "@/domain/connector/queries";
import { receiveWebhook } from "@/domain/connector/webhooks";
import { DomainError } from "@/domain/shared/errors";

/**
 * Azure DevOps service hook intake. Verified by Basic-Auth-on-URL against the connector's
 * configured webhookSecret before any sync effect — an unverified or unmatched-connector request
 * is rejected with no WebhookDelivery row created. The delivery id is the notification payload's
 * own `id` field (Azure DevOps sends no dedicated delivery-id header).
 */
export async function POST(request: Request, routeCtx: RouteContext<"/api/webhooks/azure-devops/[connectorId]">) {
  const { connectorId } = await routeCtx.params;

  try {
    const connector = await getConnectorById(connectorId);
    if (!connector || connector.type !== "AZURE_DEVOPS") {
      return NextResponse.json({ error: "Unknown connector" }, { status: 404 });
    }

    const config = decryptIntegrationConfig("AZURE_DEVOPS", connector.config as Record<string, unknown> | null) as {
      webhookSecret?: string;
    } | null;
    const authHeader = request.headers.get("authorization");
    if (!config?.webhookSecret || !verifyAzureDevOpsAuth(authHeader, config.webhookSecret)) {
      return NextResponse.json({ error: "Invalid credentials" }, { status: 401 });
    }

    const body = await request.json();
    const deliveryId = body?.id;
    if (!deliveryId) {
      return NextResponse.json({ error: "Missing delivery id" }, { status: 400 });
    }

    const result = await receiveWebhook(connectorId, String(deliveryId));
    return NextResponse.json(result);
  } catch (err) {
    if (err instanceof DomainError) {
      return NextResponse.json({ error: err.message }, { status: err.status });
    }
    throw err;
  }
}
