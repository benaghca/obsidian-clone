// Lucide icons (ISC licence, see THIRD_PARTY_NOTICES.md), the set Obsidian
// itself uses. Only the icons named in the map below end up in the bundle
// (with just their path data). Each is built once and cloned after that.
//
// Size and stroke come from CSS (--icon-size / --icon-stroke, set per place
// like Obsidian's icon tokens); the size argument is only the fallback for
// places that set neither.

import * as lucide from "lucide";

type IconNode = [tag: string, attrs: Record<string, string | number | undefined>][];

// Names follow Lucide's (Obsidian's DOM shows them as `lucide-<name>`).
const ICONS = {
  "a-large-small": lucide.ALargeSmall,
  archive: lucide.Archive,
  "arrow-down": lucide.ArrowDown,
  "arrow-down-a-z": lucide.ArrowDownAZ,
  "arrow-left": lucide.ArrowLeft,
  "arrow-left-right": lucide.ArrowLeftRight,
  "arrow-right": lucide.ArrowRight,
  "arrow-up": lucide.ArrowUp,
  "arrow-up-narrow-wide": lucide.ArrowUpNarrowWide,
  "arrow-up-z-a": lucide.ArrowUpZA,
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
  check: lucide.Check,
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
  "ellipsis-vertical": lucide.EllipsisVertical,
  eraser: lucide.Eraser,
  "external-link": lucide.ExternalLink,
  file: lucide.File,
  "file-down": lucide.FileDown,
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
  link: lucide.Link,
  "link-2": lucide.Link2,
  list: lucide.List,
  "list-checks": lucide.ListChecks,
  "list-ordered": lucide.ListOrdered,
  "list-plus": lucide.ListPlus,
  loader: lucide.Loader,
  "maximize-2": lucide.Maximize2,
  menu: lucide.Menu,
  "message-square-quote": lucide.MessageSquareQuote,
  minus: lucide.Minus,
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
  "rotate-ccw": lucide.RotateCcw,
  ruler: lucide.Ruler,
  scissors: lucide.Scissors,
  search: lucide.Search,
  "separator-horizontal": lucide.SeparatorHorizontal,
  "separator-vertical": lucide.SeparatorVertical,
  settings: lucide.Settings,
  sigma: lucide.Sigma,
  square: lucide.Square,
  "square-check-big": lucide.SquareCheckBig,
  "square-code": lucide.SquareCode,
  "square-dashed": lucide.SquareDashed,
  "square-pen": lucide.SquarePen,
  "square-sigma": lucide.SquareSigma,
  "square-terminal": lucide.SquareTerminal,
  strikethrough: lucide.Strikethrough,
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
  let svg = built.get(name);
  if (!svg) built.set(name, (svg = build(name)));
  const copy = svg.cloneNode(true) as SVGElement;
  copy.setAttribute("width", String(size));
  copy.setAttribute("height", String(size));
  return copy;
}
