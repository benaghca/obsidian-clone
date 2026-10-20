// Reading and writing one graph's settings in the vault's .grove/graph.json:
// the global graph's are the file's top-level keys (Obsidian's graph.json);
// the local graph's sit under "local", with only the values that differ from
// the defaults.

import { defaults, type GraphSettings, LOCAL_GRAPH, sanitize, type SettingsOf } from "../settings/schema";
import { settings } from "../settings/store";

const LOCAL_DEFAULTS = defaults(LOCAL_GRAPH);
const same = (a: unknown, b: unknown) => JSON.stringify(a) === JSON.stringify(b);

export function graphSettings(local: boolean): GraphSettings {
  const file = settings.get("graph.json");
  if (local) return sanitize(LOCAL_GRAPH, file.local).values;
  const { local: _local, ...global } = file;
  return { ...LOCAL_DEFAULTS, ...global };
}

export function setGraphSetting<K extends keyof GraphSettings & string>(local: boolean, key: K, value: GraphSettings[K]) {
  if (!local) {
    if (key in LOCAL_DEFAULTS && !(key in settings.get("graph.json"))) return; // a local-only key
    settings.set("graph.json", key as keyof SettingsOf<"graph.json"> & string, value as never);
    return;
  }
  const next: Record<string, unknown> = { ...settings.get("graph.json").local };
  if (same(value, LOCAL_DEFAULTS[key])) delete next[key];
  else next[key] = value;
  settings.set("graph.json", "local", next);
}

/** Put one graph's settings back to their defaults (the panel's "Restore default settings"). The open sections and the zoom stay. */
export function resetGraphSettings(local: boolean) {
  const now = graphSettings(local);
  for (const [key, value] of Object.entries(LOCAL_DEFAULTS)) {
    if (key.startsWith("collapse-") || key === "close" || key === "scale") continue;
    if (!same(now[key as keyof GraphSettings], value)) setGraphSetting(local, key as keyof GraphSettings & string, value as never);
  }
}
