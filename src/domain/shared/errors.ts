export class DomainError extends Error {
  constructor(
    message: string,
    public readonly status: number
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class NotFoundError extends DomainError {
  constructor(message: string) {
    super(message, 404);
  }
}

export class ForbiddenError extends DomainError {
  constructor(message: string) {
    super(message, 403);
  }
}

export class UnauthorizedError extends DomainError {
  constructor(message: string) {
    super(message, 401);
  }
}

export class ValidationError extends DomainError {
  constructor(message: string) {
    super(message, 400);
  }
}

export class ConflictError extends DomainError {
  constructor(message: string) {
    super(message, 409);
  }
}

/**
 * Thrown by draftStage/draftConstitution when checkBudget refuses a draft. Carries the scope and
 * ids a caller needs to offer an "Approve to continue" action (POST the matching
 * budget-override route) without having to re-derive them from the message text.
 */
export class BudgetExceededError extends ConflictError {
  constructor(
    message: string,
    public readonly scope: "client" | "project" | "organization",
    public readonly clientId: string,
    /** Unset for a repository-scoped action (Slice 14's Discovery), which has no Project. */
    public readonly projectId: string | undefined,
    /** Set only when scope is "organization" — the organization's own id, needed to approve an override at that scope (Slice 6). */
    public readonly organizationId: string | null = null
  ) {
    super(message);
    this.name = "BudgetExceededError";
  }
}
