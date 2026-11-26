import * as React from "react";
import { Badge, Button, Caption1, Spinner, Switch, Text, makeStyles, mergeClasses, tokens } from "@fluentui/react-components";
import { AgingDashboard, PriorityList, formatMoney } from "@collections/ui";
import type { BridgeState, CollectionsBridge } from "../bridge/bridge";

const useStyles = makeStyles({
  root: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalM, width: "100%", fontFamily: tokens.fontFamilyBase },
  bar: { display: "flex", alignItems: "center", gap: tokens.spacingHorizontalM, flexWrap: "wrap" },
  grow: { flexGrow: 1 },
  panel: { border: `1px solid ${tokens.colorNeutralStroke2}`, borderRadius: tokens.borderRadiusMedium, background: tokens.colorNeutralBackground1 },
  notice: { fontSize: tokens.fontSizeBase200 },
  error: { color: tokens.colorPaletteRedForeground1 },
  warning: { color: tokens.colorPaletteDarkOrangeForeground1 },
  success: { color: tokens.colorPaletteGreenForeground1 },
  info: { color: tokens.colorNeutralForeground2 },
  notes: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalS, padding: tokens.spacingVerticalM },
  note: { display: "flex", flexDirection: "column", gap: tokens.spacingVerticalXXS, paddingTop: tokens.spacingVerticalS, borderTop: `1px solid ${tokens.colorNeutralStroke2}` },
  noteText: { whiteSpace: "pre-wrap" },
});

function useBridgeState(bridge: CollectionsBridge): BridgeState {
  const [state, setState] = React.useState(bridge.store.get());
  React.useEffect(() => bridge.store.subscribe(setState), [bridge]);
  return state;
}

const copilotBadge = {
  checking: { color: "informative", text: "Checking Copilot…" },
  enabled: { color: "success", text: "Copilot has context" },
  disabled: { color: "warning", text: "Copilot is off" },
  unavailable: { color: "subtle", text: "Copilot unavailable" },
} as const;

/** The control's UI: Copilot status + "Analyze" + whatever the agent asked the app to show. */
export function CollectionsBridgeApp({ bridge }: { bridge: CollectionsBridge }) {
  const styles = useStyles();
  const s = useBridgeState(bridge);
  const badge = s.copilot === "enabled" && !s.shareContext ? { color: "warning" as const, text: "No context" } : copilotBadge[s.copilot];
  const canAsk = s.copilot === "enabled" && !!s.context;

  return (
    <div className={styles.root}>
      <div className={styles.bar}>
        <Badge appearance="tint" color={badge.color}>
          {badge.text}
        </Badge>
        <Text weight="semibold">{s.customerName ?? s.record?.customerNo ?? "No customer"}</Text>
        {s.context?.overdueTotal !== undefined && <Caption1>Overdue {formatMoney(s.context.overdueTotal, s.context.currency)}</Caption1>}
        {bridge.settings.showContextSwitch && (
          <Switch
            label="Share context with Copilot"
            checked={s.shareContext}
            onChange={(_, d) => void bridge.setShareContext(d.checked)}
          />
        )}
        <span className={styles.grow} />
        {s.busy && <Spinner size="tiny" />}
        <Button appearance="primary" disabled={!canAsk} onClick={() => void bridge.analyze()}>
          Analyze payment behavior
        </Button>
        <Button appearance="secondary" disabled={!canAsk} onClick={() => void bridge.buildDashboard()}>
          Build aging dashboard
        </Button>
        <Button appearance="secondary" disabled={!canAsk} onClick={() => void bridge.research()}>
          Research online
        </Button>
      </div>

      {s.notice && <Text className={mergeClasses(styles.notice, styles[s.notice.intent])}>{s.notice.text}</Text>}

      {/* With a worklist view configured the grid shows the list; otherwise the control does. */}
      {s.worklist && !bridge.settings.worklistViewId && (
        <div className={styles.panel}>
          <PriorityList items={s.worklist.items} title={s.worklist.title} onOpenInvoice={(i) => void bridge.openInvoice(i.invoiceId, i.invoiceNo)} />
          <div style={{ padding: "0 12px 12px" }}>
            <Button size="small" appearance="subtle" onClick={bridge.closeWorklist}>
              Close list
            </Button>
          </div>
        </div>
      )}

      {s.notes && s.notes.length > 0 && (
        <div className={mergeClasses(styles.panel, styles.notes)}>
          <Text weight="semibold">Notes</Text>
          {s.notes.map((n) => (
            <div key={n.id} className={styles.note}>
              <Caption1>
                {n.kind === "research" ? "Web research" : "Follow-up"} · {n.createdOn ? new Date(n.createdOn).toLocaleString() : ""}
              </Caption1>
              <Text className={styles.noteText}>{n.note}</Text>
              {n.sources.length > 0 && (
                <Caption1>
                  Sources:{" "}
                  {n.sources.map((src, i) => (
                    <React.Fragment key={src.url}>
                      {i > 0 && " · "}
                      <a href={src.url} target="_blank" rel="noreferrer">
                        {src.title}
                      </a>
                    </React.Fragment>
                  ))}
                </Caption1>
              )}
            </div>
          ))}
        </div>
      )}

      {s.dashboard && (
        <div className={styles.panel}>
          <AgingDashboard
            spec={s.dashboard.spec}
            data={s.dashboard.data}
            onFiltersChange={(f) => void bridge.changeDashboardFilters(f)}
            actions={
              <>
                {s.dashboard.spec.updatedBy === "app" && (
                  <Button size="small" appearance="primary" onClick={() => void bridge.askAboutDashboard()}>
                    Ask Copilot
                  </Button>
                )}
                <Button size="small" appearance="subtle" onClick={bridge.closeDashboard}>
                  Close
                </Button>
              </>
            }
          />
        </div>
      )}
    </div>
  );
}
