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

  public init(context: ComponentFramework.Context<IInputs>): void {
    const xrm = getXrm();
    const p = context.parameters;
    this.bridge = createCollectionsBridge({
      copilot: getCopilot(xrm), // undefined → graceful degradation
      sidePanes: xrm?.App?.sidePanes,
      navigation: xrm?.Navigation,
      data: new WebApiDataService(context.webAPI as unknown as WebApiLike),
      today: () => resolveAsOf(p.asOfDate?.raw),
      settings: {
        ...DEFAULT_SETTINGS,
        gptId: p.gptId?.raw ?? undefined,
        autoOpenPanel: p.autoOpenPanel?.raw ?? true,
        viewName: p.viewName?.raw || DEFAULT_SETTINGS.viewName,
        analyzePrompt: p.analyzePrompt?.raw || DEFAULT_SETTINGS.analyzePrompt,
        worklistViewId: p.worklistViewId?.raw ?? undefined,
      },
    });
  }

  public updateView(context: ComponentFramework.Context<IInputs>): React.ReactElement {
    void this.bridge.setRecord(readRecord(context));
    const theme = (context.fluentDesignLanguage?.tokenTheme as Theme | undefined) ?? webLightTheme;
    return React.createElement(FluentProvider, { theme }, React.createElement(CollectionsBridgeApp, { bridge: this.bridge }));
  }

  public getOutputs(): IOutputs {
    return {};
  }

  public destroy(): void {
    this.bridge.dispose(); // removes every action handler we registered
  }
}

function readRecord(context: ComponentFramework.Context<IInputs>): RecordInfo {
  // VERIFY: contextInfo is widely used but not in the public typings.
  const info = (context.mode as unknown as { contextInfo?: { entityId?: string } }).contextInfo;
  return { customerNo: context.parameters.customerNumber.raw ?? undefined, recordId: info?.entityId?.replace(/[{}]/g, "").toLowerCase() || undefined };
}
