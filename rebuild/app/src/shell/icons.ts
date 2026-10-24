// Lucide icons (ISC licence, see THIRD_PARTY_NOTICES.md), the set Obsidian
// itself uses. Only the icons named in the map below end up in the bundle
// (with just their path data). Each is built once and cloned after that.
//
// Size and stroke come from CSS (--icon-size / --icon-stroke, set per place
// like Obsidian's icon tokens); the size argument is only the fallback for
// places that set neither.

import * as lucide from "lucide";
import { kept } from "../memo";

type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

// Names follow Lucide's (Obsidian's DOM shows them as `lucide-<name>`).
const ICONS = {
  "a-large-small": lucide.ALargeSmall,
  archive: lucide.Archive,
  "arrow-down": lucide.ArrowDown,
  "arrow-down-to-line": lucide.ArrowDownToLine,
  "arrow-up-down": lucide.ArrowUpDown,
  "arrow-down-a-z": lucide.ArrowDownAZ,
  "arrow-down-narrow-wide": lucide.ArrowDownNarrowWide,
  "arrow-left": lucide.ArrowLeft,
  "arrow-left-right": lucide.ArrowLeftRight,
  "arrow-right": lucide.ArrowRight,
  "arrow-up": lucide.ArrowUp,
  "arrow-up-narrow-wide": lucide.ArrowUpNarrowWide,
  "arrow-up-z-a": lucide.ArrowUpZA,
  "gallery-vertical": lucide.GalleryVertical,
  binary: lucide.Binary,
  bold: lucide.Bold,
  "book-open": lucide.BookOpen,
  bookmark: lucide.Bookmark,
  "bookmark-minus": lucide.BookmarkMinus,
  "bookmark-plus": lucide.BookmarkPlus,
  bug: lucide.Bug,
  calendar: lucide.Calendar,
  "calendar-days": lucide.CalendarDays,
  "calendar-minus": lucide.CalendarMinus,
  "calendar-plus": lucide.CalendarPlus,
  "case-sensitive": lucide.CaseSensitive,
  check: lucide.Check,
  "chevron-up": lucide.ChevronUp,
  "chevron-down": lucide.ChevronDown,
  "chevron-right": lucide.ChevronRight,
  "chevrons-down-up": lucide.ChevronsDownUp,
  "chevrons-up-down": lucide.ChevronsUpDown,
  "circle-check": lucide.CircleCheck,
  "circle-help": lucide.CircleHelp,
  "circle-plus": lucide.CirclePlus,
  "circle-user": lucide.CircleUser,
  "circle-x": lucide.CircleX,
  clipboard: lucide.Clipboard,
  "clipboard-check": lucide.ClipboardCheck,
  "clipboard-list": lucide.ClipboardList,
  "clipboard-type": lucide.ClipboardType,
  clock: lucide.Clock,
  code: lucide.Code,
  "code-xml": lucide.CodeXml,
  command: lucide.Command,
  copy: lucide.Copy,
  "corner-right-down": lucide.CornerRightDown,
  "corner-right-up": lucide.CornerRightUp,
  dices: lucide.Dices,
  ellipsis: lucide.Ellipsis,
  "ellipsis-vertical": lucide.EllipsisVertical,
  eraser: lucide.Eraser,
  "external-link": lucide.ExternalLink,
  file: lucide.File,
  "file-down": lucide.FileDown,
  "file-image": lucide.FileImage,
  "file-plus": lucide.FilePlus,
  "file-question-mark": lucide.FileQuestionMark,
  "file-search": lucide.FileSearch,
  "file-signature": lucide.FileSignature,
  "file-text": lucide.FileText,
  files: lucide.Files,
  flame: lucide.Flame,
  "folder-closed": lucide.FolderClosed,
  "folder-cog": lucide.FolderCog,
  "folder-open": lucide.FolderOpen,
  "folder-plus": lucide.FolderPlus,
  "folder-search": lucide.FolderSearch,
  "folder-tree": lucide.FolderTree,
  forward: lucide.Forward,
  "git-fork": lucide.GitFork,
  "git-merge": lucide.GitMerge,
  "hard-drive": lucide.HardDrive,
  "heading-1": lucide.Heading1,
  "heading-2": lucide.Heading2,
  "heading-3": lucide.Heading3,
  "heading-4": lucide.Heading4,
  "heading-5": lucide.Heading5,
  "heading-6": lucide.Heading6,
  highlighter: lucide.Highlighter,
  image: lucide.Image,
  "image-minus": lucide.ImageMinus,
  "indent-decrease": lucide.IndentDecrease,
  "indent-increase": lucide.IndentIncrease,
  info: lucide.Info,
  italic: lucide.Italic,
  keyboard: lucide.Keyboard,
  "layout-dashboard": lucide.LayoutDashboard,
  "layout-list": lucide.LayoutList,
  link: lucide.Link,
  "link-2": lucide.Link2,
  "eye-off": lucide.EyeOff,
  "list-x": lucide.ListX,
  list: lucide.List,
  "list-filter": lucide.ListFilter,
  "list-checks": lucide.ListChecks,
  "list-ordered": lucide.ListOrdered,
  "list-plus": lucide.ListPlus,
  loader: lucide.Loader,
  lock: lucide.Lock,
  "grid-2x2": lucide.Grid2x2,
  group: lucide.Group,
  "align-start-vertical": lucide.AlignStartVertical,
  "scan-line": lucide.ScanLine,
  "scan-search": lucide.ScanSearch,
  "redo-2": lucide.Redo2,
  maximize: lucide.Maximize,
  "rotate-cw": lucide.RotateCw,
  "maximize-2": lucide.Maximize2,
  menu: lucide.Menu,
  "message-square-quote": lucide.MessageSquareQuote,
  minus: lucide.Minus,
  "move-horizontal": lucide.MoveHorizontal,
  "move-vertical": lucide.MoveVertical,
  "square-x": lucide.SquareX,
  monitor: lucide.Monitor,
  "mouse-pointer-click": lucide.MousePointerClick,
  navigation: lucide.Navigation,
  paintbrush: lucide.Paintbrush,
  palette: lucide.Palette,
  "panel-bottom-close": lucide.PanelBottomClose,
  "panel-left": lucide.PanelLeft,
  "panel-left-close": lucide.PanelLeftClose,
  "panel-right": lucide.PanelRight,
  "panel-right-close": lucide.PanelRightClose,
  "panel-top-close": lucide.PanelTopClose,
  "pen-line": lucide.PenLine,
  pencil: lucide.Pencil,
  percent: lucide.Percent,
  "picture-in-picture": lucide.PictureInPicture,
  "picture-in-picture-2": lucide.PictureInPicture2,
  pilcrow: lucide.Pilcrow,
  pin: lucide.Pin,
  "pin-off": lucide.PinOff,
  plus: lucide.Plus,
  quote: lucide.Quote,
  replace: lucide.Replace,
  regex: lucide.Regex,
  "whole-word": lucide.WholeWord,
  "wrap-text": lucide.WrapText,
  "rotate-ccw": lucide.RotateCcw,
  ruler: lucide.Ruler,
  scissors: lucide.Scissors,
  "grip-vertical": lucide.GripVertical,
  search: lucide.Search,
  "separator-horizontal": lucide.SeparatorHorizontal,
  "separator-vertical": lucide.SeparatorVertical,
  settings: lucide.Settings,
  "sliders-horizontal": lucide.SlidersHorizontal,
  sigma: lucide.Sigma,
  square: lucide.Square,
  "square-function": lucide.SquareFunction,
  "square-check-big": lucide.SquareCheckBig,
  "square-code": lucide.SquareCode,
  "square-dashed": lucide.SquareDashed,
  "square-pen": lucide.SquarePen,
  "square-sigma": lucide.SquareSigma,
  "square-terminal": lucide.SquareTerminal,
  strikethrough: lucide.Strikethrough,
  "sticky-note": lucide.StickyNote,
  "sun-moon": lucide.SunMoon,
  table: lucide.Table,
  tag: lucide.Tag,
  tags: lucide.Tags,
  terminal: lucide.Terminal,
  "text-align-center": lucide.TextAlignCenter,
  "text-align-end": lucide.TextAlignEnd,
  "text-align-start": lucide.TextAlignStart,
  "text-cursor-input": lucide.TextCursorInput,
  "toy-brick": lucide.ToyBrick,
  "trash-2": lucide.Trash2,
  "triangle-alert": lucide.TriangleAlert,
  type: lucide.Type,
  "undo-2": lucide.Undo2,
  vault: lucide.Vault,
  "wand-sparkles": lucide.WandSparkles,
  x: lucide.X,
  zap: lucide.Zap,
  "zoom-in": lucide.ZoomIn,
  "zoom-out": lucide.ZoomOut,
} satisfies Record<string, IconNode>;

export type IconName = keyof typeof ICONS;

const SVG_NS = "http://www.w3.org/2000/svg";
const built = new Map<IconName, SVGElement>();

function build(name: IconName): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  const attrs: Record<string, string> = {
    viewBox: "0 0 24 24",
    fill: "none",
    stroke: "currentColor",
    "stroke-width": "2",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    class: `svg-icon lucide-${name}`,
    "aria-hidden": "true",
  };
  for (const [k, v] of Object.entries(attrs)) svg.setAttribute(k, v);
  for (const [tag, props] of ICONS[name] as IconNode) {
    const child = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(props)) if (v !== undefined) child.setAttribute(k, String(v));
    svg.append(child);
  }
  return svg;
}

export function icon(name: IconName, size = 18): SVGElement {
  const copy = kept(built, name, () => build(name)).cloneNode(true) as SVGElement;
  copy.setAttribute("width", String(size));
  copy.setAttribute("height", String(size));
  return copy;
}

/**
 * The calendar drawn in a date value. Lucide's outline disappears at 11×12
 * (a few anti-aliased pixels). This one keeps that box and adds a solid top
 * bar, which is what stays visible there.
 */
export function dateGlyph(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 11 12");
  svg.setAttribute("class", "svg-icon lucide-calendar");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "11");
  svg.setAttribute("height", "12");
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  add("rect", { x: "0.75", y: "2.5", width: "9.5", height: "8.7", rx: "1.1", fill: "none", stroke: "currentColor", "stroke-width": "1.4" });
  add("path", { d: "M1.2 3.4h8.6v2.5H1.2z", fill: "currentColor", stroke: "none" });
  add("path", { d: "M3.2 1.1v2.2M7.8 1.1v2.2", fill: "none", stroke: "currentColor", "stroke-width": "1.4", "stroke-linecap": "round" });
  return svg;
}

/** Outline auto-scroll: a bar, a rounded card, and a bar, the bars outside the card and as wide as it. */
export function autoScrollGlyph(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 16 16");
  svg.setAttribute("class", "svg-icon grove-auto-scroll");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "16");
  svg.setAttribute("height", "16");
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  add("rect", { x: "2", y: "1", width: "12", height: "1.6", rx: "0.4", fill: "currentColor" });
  add("rect", { x: "2", y: "4.2", width: "12", height: "7.6", rx: "1.5", fill: "none", stroke: "currentColor", "stroke-width": "1.4" });
  add("rect", { x: "2", y: "13.4", width: "12", height: "1.6", rx: "0.4", fill: "currentColor" });
  return svg;
}

/** Search "more options": an 11px filled circle with three light dots. */
export function moreOptionsGlyph(): SVGElement {
  const svg = document.createElementNS(SVG_NS, "svg");
  svg.setAttribute("viewBox", "0 0 11 11");
  svg.setAttribute("class", "svg-icon search-more-options");
  svg.setAttribute("aria-hidden", "true");
  svg.setAttribute("width", "11");
  svg.setAttribute("height", "11");
  const add = (tag: string, attrs: Record<string, string>) => {
    const el = document.createElementNS(SVG_NS, tag);
    for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v);
    svg.append(el);
  };
  add("circle", { cx: "5.5", cy: "5.5", r: "5.5", fill: "currentColor" });
  const dot = "var(--background-secondary)";
  add("circle", { cx: "3.15", cy: "5.5", r: "0.7", fill: dot });
  add("circle", { cx: "5.5", cy: "5.5", r: "0.7", fill: dot });
  add("circle", { cx: "7.85", cy: "5.5", r: "0.7", fill: dot });
  return svg;
}
