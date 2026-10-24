// Small per-vault layout preferences, kept in the webview's localStorage
// (storage.ts). Missing or unreadable storage just means defaults.

import { SORT_ORDERS, type SortOrder } from "../paths";
import { readStored, store } from "../storage";
import { RIGHT_VIEWS, type RightView } from "./rightSidebar";

export interface VaultLayout {
  rightOpen: boolean;
  rightWidth: number;
  rightView: RightView;
  fileSort: SortOrder;
}

const DEFAULTS: VaultLayout = { rightOpen: false, rightWidth: 300, rightView: "backlinks", fileSort: "alphabetical" };
const key = (vaultPath: string) => `grove.layout:${vaultPath}`;

export function loadLayout(vaultPath: string): VaultLayout {
  const saved = readStored(key(vaultPath), {}) as Partial<VaultLayout>;
  return {
    rightOpen: typeof saved.rightOpen === "boolean" ? saved.rightOpen : DEFAULTS.rightOpen,
    rightWidth: typeof saved.rightWidth === "number" ? saved.rightWidth : DEFAULTS.rightWidth,
    rightView: RIGHT_VIEWS.includes(saved.rightView!) ? saved.rightView! : DEFAULTS.rightView,
    fileSort: SORT_ORDERS.some(([o]) => o === saved.fileSort) ? saved.fileSort! : DEFAULTS.fileSort,
  };
}

export const saveLayout = (vaultPath: string, layout: VaultLayout) => store(key(vaultPath), layout);

/**
 * The workspace's panes (layout tree, sizes, tabs, active pane), saved per
 * vault in its own key. Whatever is stored is handed back as is; the
 * workspace checks it and drops anything that no longer exists.
 */
const workspaceKey = (vaultPath: string) => `grove.workspace:${vaultPath}`;
export const loadWorkspace = (vaultPath: string) => readStored(workspaceKey(vaultPath));
export const saveWorkspace = (vaultPath: string, saved: unknown) => store(workspaceKey(vaultPath), saved);
