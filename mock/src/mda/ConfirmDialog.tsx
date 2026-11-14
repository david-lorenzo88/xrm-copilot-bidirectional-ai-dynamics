import * as React from "react";
import { Button, Dialog, DialogActions, DialogBody, DialogContent, DialogSurface, DialogTitle } from "@fluentui/react-components";
import { mda } from "../fake/mda-store";
import { useStore } from "./useStore";

/** Xrm.Navigation.openConfirmDialog, rendered. */
export function ConfirmDialog() {
  const { dialog } = useStore(mda);
  return (
    <Dialog open={!!dialog} onOpenChange={(_, d) => !d.open && dialog?.resolve(false)}>
      <DialogSurface>
        <DialogBody>
          <DialogTitle>{dialog?.title}</DialogTitle>
          <DialogContent style={{ whiteSpace: "pre-wrap" }}>{dialog?.text}</DialogContent>
          <DialogActions>
            <Button appearance="secondary" onClick={() => dialog?.resolve(false)}>{dialog?.cancelLabel}</Button>
            <Button appearance="primary" onClick={() => dialog?.resolve(true)}>{dialog?.confirmLabel}</Button>
          </DialogActions>
        </DialogBody>
      </DialogSurface>
    </Dialog>
  );
}
