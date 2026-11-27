import * as React from "react";
import { FluentProvider, webLightTheme, type Theme } from "@fluentui/react-components";
import { CollectionsBridgeApp } from "./components/CollectionsBridgeApp";
import { resolveAsOf } from "@collections/domain";
import { DEFAULT_SETTINGS, WebApiDataService, createCollectionsBridge, getCopilot, getXrm, type CollectionsBridge as Bridge, type RecordInfo, type WebApiLike } from "./bridge";
import type { IInputs, IOutputs } from "./generated/ManifestTypes";

/**
 * CollectionsBridge: a React virtual control placed on the BC Customer form.
 * Supported APIs (context.webAPI, context.navigation) where they exist; window.Xrm
 * only for Xrm.Copilot and Xrm.App.sidePanes (see bridge/xrm.ts).
 */
export class CollectionsBridge implements ComponentFramework.ReactControl<IInputs, IOutputs> {
  private bridge!: Bridge;
  /** Values Copilot proposed and the user applied; handed to the form on the next getOutputs (unsaved). */
  private pending: IOutputs = {};

  public init(context: ComponentFramework.Context<IInputs>, notifyOutputChanged: () => void): void {
    const xrm = getXrm();
    const p = context.parameters;
    const fmt = (n: number) => n.toLocaleString(undefined, { maximumFractionDigits: 2 });
    this.bridge = createCollectionsBridge({
      copilot: getCopilot(xrm), // undefined → graceful degradation
      sidePanes: xrm?.App?.sidePanes,
      navigation: xrm?.Navigation,
      data: new WebApiDataService(context.webAPI as unknown as WebApiLike, { customerNumberPrefix: p.customerNumberPrefix?.raw || undefined }),
      today: () => resolveAsOf(p.asOfDate?.raw),
      // Supported route for a control to change other fields: bound properties + getOutputs. The form
      // shows the values as unsaved; saving it writes through the virtual table to Business Central.
      form: {
        apply: (changes) => {
          const done: string[] = [];
          if (changes.creditLimit !== undefined) {
            done.push(`credit limit ${fmt(p.creditLimit?.raw ?? 0)} → ${fmt(changes.creditLimit)}`);
            this.pending.creditLimit = changes.creditLimit;
          }
          if (changes.blocked !== undefined) {
            const options = (p.blocked?.attributes as { Options?: { Label: string; Value: number }[] } | undefined)?.Options ?? [];
            const wanted = changes.blocked.trim().toLowerCase();
            const value = options.find((o) => o.Label.trim().toLowerCase() === wanted)?.Value ?? BLOCKED_OPTION_VALUES[changes.blocked];
            done.push(`Blocked → ${changes.blocked || "not blocked"}`);
            this.pending.blocked = value;
          }
          notifyOutputChanged();
          return done;
        },
      },
      settings: {
        ...DEFAULT_SETTINGS,
        gptId: p.gptId?.raw ?? undefined,
        autoOpenPanel: p.autoOpenPanel?.raw ?? true,
        viewName: p.viewName?.raw || DEFAULT_SETTINGS.viewName,
        analyzePrompt: p.analyzePrompt?.raw || DEFAULT_SETTINGS.analyzePrompt,
        worklistViewId: p.worklistViewId?.raw ?? undefined,
        showContextSwitch: p.showContextSwitch?.raw ?? false,
        newCustomerFormId: p.newCustomerFormId?.raw || undefined,
      },
    });
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    void this.bridge.setRecord(readRecord(context));
    const theme = (context.fluentDesignLanguage?.tokenTheme as Theme | undefined) ?? webLightTheme;
    return React.createElement(FluentProvider, { theme }, React.createElement(CollectionsBridgeApp, { bridge: this.bridge }));
  }

  public getOutputs(): IOutputs {
    const out = this.pending;
    this.pending = {};
    return out;
  }

  public destroy(): void {
    this.bridge.dispose(); // removes every action handler we registered
  }
}

/** BC "Blocked" choice values on the virtual table (fallback when the bound column's options aren't available). */
const BLOCKED_OPTION_VALUES: Record<string, number> = { "": 200000000, Ship: 200000001, Invoice: 200000002, All: 200000003 };

function readRecord(context: ComponentFramework.Context<IInputs>): RecordInfo {
  // VERIFY: contextInfo is widely used but not in the public typings.
  const info = (context.mode as unknown as { contextInfo?: { entityId?: string } }).contextInfo;
  return { customerNo: context.parameters.customerNumber.raw ?? undefined, recordId: info?.entityId?.replace(/[{}]/g, "").toLowerCase() || undefined };
}
