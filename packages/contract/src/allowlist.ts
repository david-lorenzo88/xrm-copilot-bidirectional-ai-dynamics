import { ActionIds, ActionPayloadSchemas, isKnownActionId, type ActionId, type ActionPayload } from "./actions";
import { fetchXmlEntityName } from "./primitives";

export interface ActionPolicy {
  /** Action IDs this receiver accepts. Anything else is rejected. */
  allowed: readonly ActionId[];
  /** Entities that FetchXML / record targets may point at (optional extra guard). */
  allowedEntities?: readonly string[];
}

export type ParsedAction = { [A in ActionId]: { ok: true; action: A; data: ActionPayload<A> } }[ActionId];
export type RejectedAction = { ok: false; action: string; error: string };

/** Validates an incoming agent → app action against the allow-list and its schema. */
export function parseIncomingAction(action: unknown, data: unknown, policy: ActionPolicy): ParsedAction | RejectedAction {
  const name = typeof action === "string" ? action : String(action);
  if (!isKnownActionId(action) || !policy.allowed.includes(action)) {
    return { ok: false, action: name, error: "action not allowed" };
  }
  const result = ActionPayloadSchemas[action].safeParse(data);
  if (!result.success) {
    return { ok: false, action: name, error: result.error.issues.map((i) => `${i.path.join(".") || "payload"}: ${i.message}`).join("; ") };
  }
  const entityError = checkEntities(action, result.data, policy.allowedEntities);
  if (entityError) return { ok: false, action: name, error: entityError };
  return { ok: true, action, data: result.data } as ParsedAction;
}

function checkEntities(action: ActionId, data: unknown, allowed: readonly string[] | undefined): string | undefined {
  if (!allowed) return undefined;
  const d = data as { entity?: string; fetchXml?: string };
  const targets: (string | undefined)[] = [];
  if (action === ActionIds.OpenRecord || action === ActionIds.NavigateToView) targets.push(d.entity);
  if (d.fetchXml !== undefined) targets.push(fetchXmlEntityName(d.fetchXml) ?? "(none)");
  const bad = targets.find((t) => t !== undefined && !allowed.includes(t));
  return bad ? `entity not allowed: ${bad}` : undefined;
}

/** Convenience wrapper: `const guard = createActionGuard({ allowed: [...] }); guard.parse(id, data)`. */
export function createActionGuard(policy: ActionPolicy) {
  return {
    policy,
    isAllowed: (action: unknown): action is ActionId => isKnownActionId(action) && policy.allowed.includes(action),
    parse: (action: unknown, data: unknown) => parseIncomingAction(action, data, policy),
  };
}
export type ActionGuard = ReturnType<typeof createActionGuard>;
