// Small per-vault layout preferences, kept in the webview's localStorage
// (on disk in the app's data folder; nothing leaves the machine). Missing
// or unreadable storage just means defaults.

import { RIGHT_VIEWS, type RightView } from "./rightSidebar";
import { SORT_ORDERS, type SortOrder } from "./sidebar";

export interface VaultLayout {
  rightOpen: boolean;
  rightWidth: number;
  rightView: RightView;
  fileSort: SortOrder;
}

const DEFAULTS: VaultLayout = { rightOpen: false, rightWidth: 260, rightView: "backlinks", fileSort: "alphabetical" };
const key = (vaultPath: string) => `grove.layout:${vaultPath}`;

export function loadLayout(vaultPath: string): VaultLayout {
  try {
    const saved = JSON.parse(localStorage.getItem(key(vaultPath)) ?? "{}") as Partial<VaultLayout>;
    return {
      rightOpen: typeof saved.rightOpen === "boolean" ? saved.rightOpen : DEFAULTS.rightOpen,
      rightWidth: typeof saved.rightWidth === "number" ? saved.rightWidth : DEFAULTS.rightWidth,
      rightView: RIGHT_VIEWS.includes(saved.rightView!) ? saved.rightView! : DEFAULTS.rightView,
      fileSort: SORT_ORDERS.some(([o]) => o === saved.fileSort) ? saved.fileSort! : DEFAULTS.fileSort,
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

/**
 * The workspace's panes (layout tree, sizes, tabs, active pane), saved per
 * vault in its own key. Whatever is stored is handed back as is; the
 * workspace checks it and drops anything that no longer exists.
 */
const workspaceKey = (vaultPath: string) => `grove.workspace:${vaultPath}`;

export function loadWorkspace(vaultPath: string): unknown {
  try {
    return JSON.parse(localStorage.getItem(workspaceKey(vaultPath)) ?? "null");
  } catch {
    return null;
  }
}

export function saveWorkspace(vaultPath: string, saved: unknown) {
  try {
    localStorage.setItem(workspaceKey(vaultPath), JSON.stringify(saved));
  } catch {
    // storage full or disabled: the panes just won't be remembered
  }
}
