import * as React from "react";
import { Badge, Button, Caption1, Card, Input, Spinner, Text, makeStyles, tokens } from "@fluentui/react-components";
import type { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { summarizeContext, type CollectionsContext, type PowerAppsContent } from "@collections/contract";
import type { FakeCopilot } from "../fake/copilot";
import { logEvent } from "../fake/mda-store";
import { ScriptedAgent, msgId, type PaneMessage } from "./agent";
import { connectMcp, type McpMode } from "./mcp";
import { WidgetFrame } from "./WidgetFrame";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", height: "100%", background: tokens.colorNeutralBackground2, borderLeft: `1px solid ${tokens.colorNeutralStroke2}` },
  header: { padding: "12px 16px", display: "flex", alignItems: "center", gap: "8px", background: "linear-gradient(90deg,#0f6cbd,#8a5cf6)", color: "white" },
  context: { margin: "8px 12px 0", padding: "8px 10px", background: tokens.colorNeutralBackground1, borderRadius: tokens.borderRadiusMedium, fontSize: tokens.fontSizeBase200 },
  stream: { flexGrow: 1, overflowY: "auto", padding: "12px", display: "flex", flexDirection: "column", gap: "10px" },
  user: { alignSelf: "flex-end", maxWidth: "85%", background: "#e8ebfa", padding: "8px 12px", borderRadius: "12px 12px 2px 12px", whiteSpace: "pre-wrap" },
  agent: { alignSelf: "flex-start", maxWidth: "95%", background: tokens.colorNeutralBackground1, padding: "8px 12px", borderRadius: "12px 12px 12px 2px", whiteSpace: "pre-wrap" },
  tool: { alignSelf: "flex-start", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, fontFamily: tokens.fontFamilyMonospace },
  system: { alignSelf: "center", fontSize: tokens.fontSizeBase200, color: tokens.colorNeutralForeground3, textAlign: "center" },
  prompts: { display: "flex", flexWrap: "wrap", gap: "6px", padding: "0 12px 8px" },
  input: { display: "flex", gap: "6px", padding: "8px 12px 12px" },
  closed: { display: "flex", alignItems: "center", justifyContent: "center", height: "100%", color: tokens.colorNeutralForeground3, padding: "24px", textAlign: "center" },
});

export const DEMO_PROMPTS = [
  "Analyze payment behavior and tell me what to chase today",
  "Build me a dashboard of overdue by customer and aging bucket",
  "What does the dashboard show now?",
  "Log a follow-up: promised to pay SI-104008 by 2026-12-04",
];

function renderMarkdownBold(text: string) {
  return text.split(/(\*\*[^*]+\*\*)/g).map((part, i) => (part.startsWith("**") ? <strong key={i}>{part.slice(2, -2)}</strong> : <React.Fragment key={i}>{part}</React.Fragment>));
}

/** The fake Microsoft 365 Copilot side panel, wired to the FakeCopilot event bus. */
export function CopilotPane({ copilot, mode }: { copilot: FakeCopilot; mode: McpMode }) {
  const styles = useStyles();
  const [open, setOpen] = React.useState(false);
  const [enabled, setEnabled] = React.useState(copilot.isEnabled());
  const [client, setClient] = React.useState<Client>();
  const [status, setStatus] = React.useState<string>("connecting");
  const [messages, setMessages] = React.useState<PaneMessage[]>([]);
  const [context, setContext] = React.useState<PowerAppsContent>();
  const [showJson, setShowJson] = React.useState(false);
  const [draft, setDraft] = React.useState("");
  const contextRef = React.useRef<PowerAppsContent | undefined>(undefined);
  const agentRef = React.useRef<ScriptedAgent | undefined>(undefined);
  const greeted = React.useRef<string | undefined>(undefined);
  const endRef = React.useRef<HTMLDivElement>(null);

  const post = React.useCallback((m: PaneMessage) => setMessages((ms) => [...ms, m]), []);
  const patch = React.useCallback((id: string, p: Partial<PaneMessage>) => setMessages((ms) => ms.map((m) => (m.id === id ? ({ ...m, ...p } as PaneMessage) : m))), []);

  React.useEffect(() => {
    connectMcp(mode)
      .then(async (c) => {
        const agent = new ScriptedAgent(c, post, patch, () => contextRef.current);
        await agent.init();
        agentRef.current = agent;
        setClient(c);
        setStatus(mode === "http" ? "MCP: http server" : "MCP: in-page server");
      })
      .catch((err: Error) => setStatus(`MCP connection failed: ${err.message}`));
  }, [mode, post, patch]);

  const send = React.useCallback(
    (text: string, via: "app" | "typed" | "widget") => {
      setOpen(true);
      post({ id: msgId(), role: "user", text, via });
      void agentRef.current?.handle(text);
    },
    [post],
  );

  React.useEffect(
    () =>
      copilot.on((e) => {
        if (e.type === "enabled") setEnabled(e.enabled);
        if (e.type === "panel-opened") setOpen(true);
        if (e.type === "prompt") send(e.text, "app");
        if (e.type === "context") {
          contextRef.current = e.content;
          setContext(e.content);
          logEvent("updateContext", summarizeContext(e.content as unknown as CollectionsContext), e.content);
          const key = String(e.content.customerNo ?? "");
          if (key && greeted.current !== key && agentRef.current) {
            greeted.current = key;
            agentRef.current.greet(e.content);
          }
        }
        if (e.type === "prompt") logEvent("sendPrompt", e.text.split("\n")[0]!, e.options);
        if (e.type === "action") logEvent("action", `${e.action} from ${e.source} → ${e.handlers} handler(s)`, e.data);
        if (e.type === "action-error") logEvent("error", `${e.action}: ${e.error}`);
      }),
    [copilot, send],
  );

  React.useEffect(() => endRef.current?.scrollIntoView({ behavior: "smooth" }), [messages]);

  if (!enabled) return <div className={styles.root}><div className={styles.closed}>Microsoft 365 Copilot is turned off for this user / app.</div></div>;
  if (!open) {
    return (
      <div className={styles.root}>
        <div className={styles.closed}>
          <div>
            <Text block>Copilot panel closed</Text>
            <Button style={{ marginTop: 8 }} onClick={() => setOpen(true)}>Open Copilot</Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className={styles.root}>
      <div className={styles.header}>
        <Text weight="semibold" style={{ color: "white" }}>Microsoft 365 Copilot</Text>
        <Badge appearance="filled" color="brand">Collections agent</Badge>
        <span style={{ flexGrow: 1 }} />
        <Caption1 style={{ color: "white", opacity: 0.85 }}>{status}</Caption1>
      </div>

      {context && (
        <div className={styles.context}>
          <Caption1>
            <strong>App context</strong> · {summarizeContext(context as unknown as CollectionsContext)}{" "}
            <Button size="small" appearance="transparent" onClick={() => setShowJson((v) => !v)}>{showJson ? "hide" : "json"}</Button>
          </Caption1>
          {showJson && <pre style={{ fontSize: 10, maxHeight: 160, overflow: "auto", margin: "4px 0 0" }}>{JSON.stringify(context, null, 2)}</pre>}
        </div>
      )}

      <div className={styles.stream}>
        {!client && <Spinner size="tiny" label="Connecting to the MCP server…" />}
        {messages.map((m) => {
          switch (m.role) {
            case "user":
              return <div key={m.id} className={styles.user}>{m.via === "app" && <Caption1 block>sent by the app</Caption1>}{m.text}</div>;
            case "agent":
              return <div key={m.id} className={styles.agent}>{renderMarkdownBold(m.text)}</div>;
            case "tool":
              return <div key={m.id} className={styles.tool}>{m.status === "running" ? "⏳" : m.status === "done" ? "✓" : "✗"} {m.name}({JSON.stringify(m.args)})</div>;
            case "system":
              return <div key={m.id} className={styles.system}>{m.text}</div>;
            case "widget":
              return client ? (
                <WidgetFrame
                  key={m.id}
                  client={client}
                  resourceUri={m.resourceUri}
                  args={m.args}
                  result={m.result}
                  onUserMessage={(t) => send(t, "widget")}
                  onModelContext={(t) => {
                    agentRef.current?.modelContext.push(t);
                    post({ id: msgId(), role: "system", text: `Widget updated the model context: ${t}` });
                  }}
                />
              ) : null;
            case "card":
              return (
                <Card key={m.id} size="small" style={{ alignSelf: "flex-start", maxWidth: "95%" }}>
                  <Text weight="semibold">{m.title}</Text>
                  {m.body.map((line, i) => <Caption1 key={i} block>{line}</Caption1>)}
                  <div>
                    <Button
                      appearance="primary"
                      size="small"
                      onClick={() => {
                        // Adaptive Card Action.Submit with data { type: "PowerApps", action, actionData }.
                        void copilot.deliverAction(m.submit.action, m.submit.actionData, "card");
                        post({ id: msgId(), role: "system", text: `Submitted ${m.submit.action} to the app` });
                      }}
                    >
                      {m.actionLabel}
                    </Button>
                  </div>
                </Card>
              );
          }
        })}
        <div ref={endRef} />
      </div>

      <div className={styles.prompts}>
        {DEMO_PROMPTS.map((p) => (
          <Button key={p} size="small" shape="circular" disabled={!client} onClick={() => send(p, "typed")}>{p}</Button>
        ))}
      </div>
      <form
        className={styles.input}
        onSubmit={(e) => {
          e.preventDefault();
          if (draft.trim()) send(draft.trim(), "typed");
          setDraft("");
        }}
      >
        <Input style={{ flexGrow: 1 }} value={draft} placeholder="Message Copilot" onChange={(_, d) => setDraft(d.value)} disabled={!client} />
        <Button type="submit" appearance="primary" disabled={!client}>Send</Button>
      </form>
    </div>
  );
}
