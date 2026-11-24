// A small modal asking yes or no, like Obsidian's "Delete file" dialog: a
// title, a message, an optional "Don't ask again" checkbox and two buttons.
// Enter confirms, Escape or a click outside cancels. Resolves with the
// answer (and whether the checkbox was ticked).

import { animateOut } from "../motion";
import { h, keyButton } from "./dom";
import { icon } from "./icons";

interface ConfirmOptions {
  title: string;
  message: string | Node;
  confirm: string;
  cancel?: string | false;
  /** Red confirm button (deleting). */
  warning?: boolean;
  /** Show a "Don't ask again" checkbox. */
  dontAskAgain?: boolean;
  /** A field in `message` that has focus first and joins the Tab cycle (a save dialog's path). */
  field?: HTMLElement;
  /** Checked before confirming. False keeps the dialog open (the field said what is wrong). */
  accept?: () => boolean | Promise<boolean>;
}

let openCount = 0;

/** Whether a confirm dialog is open (hotkeys stand aside meanwhile). */
export const isConfirmOpen = () => openCount > 0;

export function confirmDialog(o: ConfirmOptions): Promise<{ ok: boolean; dontAskAgain: boolean }> {
  return new Promise((resolve) => {
    const restoreFocus = document.activeElement as HTMLElement | null;
    const box = h("input", { type: "checkbox" });
    const yes = h("button", { class: o.warning ? "mod-warning" : "mod-cta" }, o.confirm);
    const no = h("button", null, o.cancel ?? "Cancel");
    const close = keyButton(icon("x", 16), "Close", () => done(false), "modal-close-button");
    const modal = h(
      "div",
      { class: "modal mod-confirm", role: "alertdialog", "aria-modal": "true", "aria-label": o.title },
      h("div", { class: "modal-title" }, o.title),
      close,
      h("div", { class: "modal-content" }, o.message),
      h(
        "div",
        { class: "modal-button-row" },
        o.dontAskAgain ? h("label", { class: "modal-checkbox" }, box, "Don't ask again") : null,
        h("div", { class: "modal-button-container" }, o.cancel === false ? null : no, yes),
      ),
    );
    const overlay = h("div", { class: "modal-container mod-dim mod-settings-container" }, h("div", { class: "modal-bg", onclick: () => done(false) }), modal);
    let finished = false, checking = false;
    async function confirm() {
      if (finished || checking) return;
      if (o.accept) {
        checking = true;
        let ok = false;
        try { ok = await o.accept(); } catch { ok = false; } finally { checking = false; }
        if (!ok) { o.field?.focus(); return; }
      }
      done(true);
    }
    function done(ok: boolean) {
      if (finished) return;
      finished = true;
      openCount--;
      void animateOut(overlay);
      restoreFocus?.focus({ preventScroll: true });
      resolve({ ok, dontAskAgain: ok && box.checked });
    }
    yes.addEventListener("click", () => void confirm());
    no.addEventListener("click", () => done(false));
    overlay.addEventListener("keydown", (e) => {
      if (e.key === "Escape") done(false);
      else if (e.key === "Enter" && e.target !== no && e.target !== box) void confirm();
      else if (e.key === "Tab") {
        // Keep focus in the dialog.
        const stops = [o.field, box, yes, no].filter((el): el is HTMLElement => !!el?.isConnected);
        const i = stops.indexOf(document.activeElement as HTMLElement);
        e.preventDefault();
        stops[(i + (e.shiftKey ? -1 : 1) + stops.length) % stops.length].focus();
      } else return;
      e.preventDefault();
      e.stopPropagation();
    });
    openCount++;
    document.body.append(overlay);
    (o.field ?? yes).focus();
  });
}
