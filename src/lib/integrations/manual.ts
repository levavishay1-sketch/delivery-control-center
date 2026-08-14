import type { IntegrationAdapter } from "./types";

/**
 * Manual work items are entered directly through the UI/API rather than
 * pulled from an external system, so there's nothing to sync. This adapter
 * exists so "manual" is a first-class integration type, not a special case
 * scattered through the rest of the app.
 */
export const manualAdapter: IntegrationAdapter = {
  type: "MANUAL",
  async fetchWorkItems() {
    return [];
  },
};
