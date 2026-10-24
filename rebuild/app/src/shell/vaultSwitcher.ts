// The vault name at the bottom of the left sidebar. A click opens the recent
// vaults and "Manage vaults...". That item opens the same open/create choices.
// There is no native folder dialog: the path is typed into the same instant
// prompt the rest of the app uses, then the existing open_vault command (or
// create_vault for a new folder). The window reloads so every view follows
// the new vault.

import { api } from "../api";
import type { Workspace } from "../workspace";
import { h } from "./dom";
import { icon } from "./icons";
import { type MenuItems, SEPARATOR, showMenu } from "./menu";
import { hints, openPrompt, suggestionText } from "./prompt";
import { addRecent, readRecents, rememberVault, type VaultRef } from "./recentVaults";

export function mountVaultSwitcher(ws: Workspace) {
  const name = h("div", { class: "workspace-drawer-vault-name" });
  const button = h(
    "div",
    {
      class: "vault-switcher",
      role: "button",
      "aria-label": "Manage vaults",
      onclick: (e: MouseEvent) => openMenu(ws, button, e),
    },
    icon("chevrons-up-down", 16),
    name,
  );

  function sync() {
    name.textContent = ws.vault.name;
  }

  sync();
  return { el: button, sync };
}

function current(ws: Workspace): VaultRef {
  return { path: ws.vault.path, name: ws.vault.name };
}

function openMenu(ws: Workspace, anchor: HTMLElement, event: MouseEvent) {
  const here = current(ws);
  const recents = here.path ? addRecent(readRecents(), here) : readRecents();
  const items: MenuItems = [
    ...recents.map((vault) => ({
      title: vault.name,
      checked: vault.path === here.path,
      action: () => {
        if (vault.path !== here.path) void useVault(vault.path, false);
      },
    })),
    SEPARATOR,
    { title: "Manage vaults...", icon: "vault", action: () => showManage(anchor) },
  ];
  showMenu(items, anchor, { point: { x: event.clientX, y: event.clientY } });
}

/** Open and create, the same path prompt the rest of the app uses. */
function showManage(anchor: HTMLElement) {
  showMenu(
    [
      { title: "Open another vault...", action: () => askPath("Folder to open", "to open", (path) => void useVault(path, false)) },
      { title: "Create new vault...", action: () => askPath("Folder for the new vault", "to create", (path) => void useVault(path, true)) },
    ],
    anchor,
  );
}

/** A path prompt. Enter on the typed path runs `go`. Nothing animates. */
function askPath(placeholder: string, enter: string, go: (path: string) => void) {
  openPrompt<string>({
    placeholder,
    instructions: hints(enter),
    emptyText: "Type a folder path",
    items: (query) => {
      const path = query.trim();
      return path ? [path] : [];
    },
    render: (path, row) => suggestionText(row, path, []),
    choose: (path) => go(path),
  });
}

async function useVault(path: string, create: boolean) {
  try {
    const info = create ? await api.createVault(path) : await api.openVault(path);
    rememberVault(info);
    location.reload();
  } catch (err) {
    console.warn(create ? "Could not create vault" : "Could not open vault", err);
  }
}
