// Lucide icons (ISC licence, see THIRD_PARTY_NOTICES.md), the set Obsidian
// itself uses. Only the icons named here are imported, so the bundle carries
// just their path data. Each icon is built once and cloned after that.
//
// Size and stroke come from CSS (--icon-size / --icon-stroke, set per place
// like Obsidian's icon tokens); the size argument is only the fallback for
// places that set neither.

import {
  ArrowLeft,
  ArrowLeftRight,
  ArrowRight,
  ArrowRightToLine,
  ArrowUpNarrowWide,
  Bold,
  BookOpen,
  Bookmark,
  BookmarkMinus,
  CalendarDays,
  Check,
  ChevronDown,
  ChevronRight,
  ChevronsDownUp,
  CircleX,
  ClipboardPaste,
  ClipboardType,
  Code,
  Copy,
  EllipsisVertical,
  Eraser,
  ExternalLink,
  File,
  FilePlus,
  FileText,
  Files,
  FolderClosed,
  FolderInput,
  FolderOpen,
  FolderPlus,
  Heading1,
  Heading2,
  Heading3,
  Heading4,
  Heading5,
  Heading6,
  Highlighter,
  Italic,
  Link,
  Link2,
  List,
  ListChecks,
  ListOrdered,
  MessageSquareQuote,
  Minus,
  PanelLeft,
  PanelRight,
  PenLine,
  Pencil,
  Percent,
  Pilcrow,
  Pin,
  PinOff,
  Plus,
  Quote,
  Replace,
  Scissors,
  Search,
  SeparatorHorizontal,
  Sigma,
  Square,
  SquareCheckBig,
  SquareCode,
  SquareDashedText,
  SquarePen,
  SquareSigma,
  SquareTerminal,
  SquareX,
  Strikethrough,
  Table,
  Tags,
  Trash,
  Type,
  X,
} from "lucide";

type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

// Names follow Lucide's (Obsidian's DOM shows them as `lucide-<name>`).
const ICONS = {
  "arrow-left": ArrowLeft,
  "arrow-left-right": ArrowLeftRight,
  "arrow-right": ArrowRight,
  "arrow-right-to-line": ArrowRightToLine,
  "arrow-up-narrow-wide": ArrowUpNarrowWide,
  bold: Bold,
  "book-open": BookOpen,
  bookmark: Bookmark,
  "bookmark-minus": BookmarkMinus,
  "calendar-days": CalendarDays,
  check: Check,
  "chevron-down": ChevronDown,
  "chevron-right": ChevronRight,
  "chevrons-down-up": ChevronsDownUp,
  "circle-x": CircleX,
  "clipboard-paste": ClipboardPaste,
  "clipboard-type": ClipboardType,
  code: Code,
  copy: Copy,
  "ellipsis-vertical": EllipsisVertical,
  eraser: Eraser,
  "external-link": ExternalLink,
  file: File,
  "file-plus": FilePlus,
  "file-text": FileText,
  files: Files,
  "folder-closed": FolderClosed,
  "folder-input": FolderInput,
  "folder-open": FolderOpen,
  "folder-plus": FolderPlus,
  "heading-1": Heading1,
  "heading-2": Heading2,
  "heading-3": Heading3,
  "heading-4": Heading4,
  "heading-5": Heading5,
  "heading-6": Heading6,
  highlighter: Highlighter,
  italic: Italic,
  link: Link,
  "link-2": Link2,
  list: List,
  "list-checks": ListChecks,
  "list-ordered": ListOrdered,
  "message-square-quote": MessageSquareQuote,
  minus: Minus,
  "panel-left": PanelLeft,
  "panel-right": PanelRight,
  "pen-line": PenLine,
  pencil: Pencil,
  percent: Percent,
  pilcrow: Pilcrow,
  pin: Pin,
  "pin-off": PinOff,
  plus: Plus,
  quote: Quote,
  replace: Replace,
  scissors: Scissors,
  search: Search,
  "separator-horizontal": SeparatorHorizontal,
  sigma: Sigma,
  square: Square,
  "square-check-big": SquareCheckBig,
  "square-code": SquareCode,
  "square-dashed-text": SquareDashedText,
  "square-pen": SquarePen,
  "square-sigma": SquareSigma,
  "square-terminal": SquareTerminal,
  "square-x": SquareX,
  strikethrough: Strikethrough,
  table: Table,
  tags: Tags,
  trash: Trash,
  type: Type,
  x: X,
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
  let svg = built.get(name);
  if (!svg) built.set(name, (svg = build(name)));
  const copy = svg.cloneNode(true) as SVGElement;
  copy.setAttribute("width", String(size));
  copy.setAttribute("height", String(size));
  return copy;
}
