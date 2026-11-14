import * as React from "react";
import { Badge, Button, Caption1, makeStyles, tokens } from "@fluentui/react-components";
import { mda } from "../fake/mda-store";
import { useStore } from "./useStore";

const useStyles = makeStyles({
  root: { borderTop: `1px solid ${tokens.colorNeutralStroke2}`, background: tokens.colorNeutralBackground1, maxHeight: "200px", display: "flex", flexDirection: "column" },
  list: { overflowY: "auto", padding: "4px 12px", fontFamily: tokens.fontFamilyMonospace, fontSize: "11px" },
  row: { display: "flex", gap: "8px", alignItems: "baseline", padding: "1px 0" },
});

/** What crossed the bridge, newest first. Handy for narrating the demo. */
export function EventLog() {
  const styles = useStyles();
  const { log } = useStore(mda);
  const [open, setOpen] = React.useState(true);
  return (
    <section className={styles.root} aria-label="Bridge events">
      <div style={{ display: "flex", alignItems: "center", gap: 8, padding: "4px 12px" }}>
        <Caption1><strong>Bridge events</strong> ({log.length})</Caption1>
        <Button size="small" appearance="transparent" onClick={() => setOpen((o) => !o)}>{open ? "hide" : "show"}</Button>
      </div>
      {open && (
        <div className={styles.list}>
          {log.map((e, i) => (
            <div key={i} className={styles.row} title={e.data ? JSON.stringify(e.data, null, 2) : undefined}>
              <span style={{ color: "#605e5c" }}>{e.at}</span>
              <Badge size="small" appearance="tint" color={e.kind === "error" ? "danger" : e.kind === "action" ? "important" : "informative"}>{e.kind}</Badge>
              <span>{e.text}</span>
            </div>
          ))}
        </div>
      )}
    </section>
  );
}
