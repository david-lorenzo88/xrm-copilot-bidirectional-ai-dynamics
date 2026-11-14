import { loadConfig } from "./config";
import { createApp } from "./http";
import { fileWidgetSource, resolveWidgetsDir, widgetStatus } from "./node-widgets";

const config = loadConfig();
const dir = resolveWidgetsDir(config.WIDGETS_DIR);
const app = createApp({ config, widgets: fileWidgetSource(dir), widgetStatus: () => widgetStatus(dir) });

app.listen(config.PORT, () => {
  console.log(`[collections-mcp] listening on :${config.PORT}  data=${config.DATA_MODE} auth=${config.AUTH_MODE}  widgets=${dir}`);
  if (config.AUTH_MODE === "none") console.warn("[collections-mcp] AUTH_MODE=none: anonymous access, for local development only.");
});
