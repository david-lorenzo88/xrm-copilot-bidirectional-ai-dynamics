import { buildGroundedPrompt, toPowerAppsContent, type CollectionsContext } from "@collections/contract";
import type { CopilotApi } from "./xrm";

/**
 * App → agent. Guarded by isM365CopilotEnabled (all methods are no-ops when
 * Copilot is off, but the guard lets the UI say why nothing happens).
 */
export async function publishContext(copilot: CopilotApi, context: CollectionsContext, openPanel = false): Promise<boolean> {
  if (!(await copilot.isM365CopilotEnabled())) return false;
  // VERIFY (risk #1): does updateContext reach a *declarative* agent? See buildGroundedPrompt fallback.
  await copilot.updateContext(toPowerAppsContent(context));
  if (openPanel) await copilot.openM365CopilotPanel();
  return true;
}

/** App → agent prompt, targeted at our agent, with the context embedded as a fallback. */
export async function askCopilot(copilot: CopilotApi, prompt: string, context: CollectionsContext | undefined, gptId?: string): Promise<void> {
  await copilot.sendPromptToM365Copilot(buildGroundedPrompt(prompt, context), gptId ? { gptId } : undefined);
}

/** Skips identical consecutive publishes (updateView runs often). */
export function createContextPublisher(copilot: CopilotApi) {
  let last = "";
  return async (context: CollectionsContext, openPanel = false): Promise<"published" | "unchanged" | "disabled"> => {
    const key = JSON.stringify(context);
    if (key === last && !openPanel) return "unchanged";
    const ok = await publishContext(copilot, context, openPanel);
    if (ok) last = key;
    return ok ? "published" : "disabled";
  };
}
