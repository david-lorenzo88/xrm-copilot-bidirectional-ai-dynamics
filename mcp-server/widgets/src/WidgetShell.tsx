import * as React from "react";
import { createRoot } from "react-dom/client";
import { FluentProvider, Spinner, Text, makeStyles, tokens, webDarkTheme, webLightTheme } from "@fluentui/react-components";
import { app, connected } from "./host";

const useStyles = makeStyles({
  pad: { padding: tokens.spacingVerticalM },
  error: { padding: tokens.spacingVerticalM, color: tokens.colorPaletteRedForeground1 },
});

export function Waiting({ label }: { label: string }) {
  return <Spinner className={useStyles().pad} size="small" label={label} />;
}

export function ToolError({ message }: { message: string }) {
  return <Text className={useStyles().error}>{message}</Text>;
}

/** Mounts a widget once the host handshake completes. Theme is read once: Copilot doesn't send host-context changes. */
export function mount(Widget: React.ComponentType<{ dark: boolean }>): void {
  const root = createRoot(document.getElementById("root")!);
  const render = () => {
    const dark = app.getHostContext()?.theme === "dark";
    root.render(
      <FluentProvider theme={dark ? webDarkTheme : webLightTheme} style={{ background: "transparent" }}>
        <Widget dark={dark} />
      </FluentProvider>,
    );
  };
  connected.then(render, (err: Error) => {
    root.render(<ToolError message={`Could not connect to the host: ${err.message}`} />);
  });
}
