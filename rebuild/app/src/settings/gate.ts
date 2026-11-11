// Opens the settings modal. The modal's chunk loads on the first open, and
// again after startup goes idle, so a later open paints in the same turn.
import type { IconName } from "../shell/icons";
import type { Workspace } from "../workspace";

export interface SettingsGateContext {
  ws: Workspace;
  ribbon: { actions: { id: string; label: string; icon: IconName }[]; isShown(id: string): boolean; setShown(id: string, shown: boolean): void };
}

type Opener = (section: string | undefined, context: SettingsGateContext, onClose: () => void) => void;

let opener: Opener | null = null;
let isOpen = () => false;
let context: (() => SettingsGateContext) | null = null;
let onClose = () => {};
let loading: Promise<void> | null = null;

/** `context` is read when settings opens, so the ribbon list is current. */
export function bindSettings(get: () => SettingsGateContext, close: () => void) {
  context = get;
  onClose = close;
}

/** False until the modal's chunk is loaded, and then whether it is open. */
export function isSettingsOpen() {
  return isOpen();
}

function load(): Promise<void> {
  return (loading ??= import("./ui").then((ui) => {
    isOpen = ui.isSettingsOpen;
    opener = (section, ctx, close) => ui.openSettings(ui.settingsSections(ctx), section, close);
  }));
}

/** Fetch the settings chunk without opening it. */
export function preloadSettings(): Promise<void> {
  return load();
}

/** Open settings at `section` (the last one shown, when omitted). */
export function openSettings(section?: string) {
  const get = context;
  if (!get) return;
  if (opener) {
    opener(section, get(), onClose);
    return;
  }
  void load().then(() => opener?.(section, get(), onClose));
}
