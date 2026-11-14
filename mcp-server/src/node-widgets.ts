import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { WIDGETS, type WidgetKey, type WidgetSource } from "./widgets";

/** Finds dist/widgets next to the bundle (prod) or the source tree (dev/tests). */
export function resolveWidgetsDir(override?: string): string {
  const candidates = [override, fileURLToPath(new URL("./widgets", import.meta.url)), fileURLToPath(new URL("../dist/widgets", import.meta.url))];
  return candidates.find((d): d is string => !!d && existsSync(d)) ?? candidates[candidates.length - 1]!;
}

export function fileWidgetSource(dir: string): WidgetSource {
  const cache = new Map<WidgetKey, string>();
  return async (key) => {
    const hit = cache.get(key);
    if (hit) return hit;
    const html = await readFile(join(dir, WIDGETS[key].file), "utf8").catch(() => {
      throw new Error(`Widget ${WIDGETS[key].file} not found in ${dir}. Run "npm run build:widgets -w mcp-server".`);
    });
    cache.set(key, html);
    return html;
  };
}

export function widgetStatus(dir: string): Record<WidgetKey, boolean> {
  return Object.fromEntries(Object.entries(WIDGETS).map(([k, w]) => [k, existsSync(join(dir, w.file))])) as Record<WidgetKey, boolean>;
}
