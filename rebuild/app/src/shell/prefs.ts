// Small per-vault layout preferences, kept in the webview's localStorage
// (on disk in the app's data folder; nothing leaves the machine). Missing
// or unreadable storage just means defaults.

export interface VaultLayout {
  rightOpen: boolean;
  rightWidth: number;
  rightView: "backlinks" | "outline";
}

const DEFAULTS: VaultLayout = { rightOpen: false, rightWidth: 260, rightView: "backlinks" };
const key = (vaultPath: string) => `grove.layout:${vaultPath}`;

export function loadLayout(vaultPath: string): VaultLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(key(vaultPath)) ?? "{}") as Partial<VaultLayout>;
    return {
      rightOpen: typeof saved.rightOpen === "boolean" ? saved.rightOpen : DEFAULTS.rightOpen,
      rightWidth: typeof saved.rightWidth === "number" ? saved.rightWidth : DEFAULTS.rightWidth,
      rightView: saved.rightView === "outline" ? "outline" : DEFAULTS.rightView,
    };
  } catch {
    return { ...DEFAULTS };
  }
}

export function saveLayout(vaultPath: string, layout: VaultLayout) {
  try {
    localStorage.setItem(key(vaultPath), JSON.stringify(layout));
  } catch {
    // storage full or disabled: the layout just won't be remembered
  }
}
