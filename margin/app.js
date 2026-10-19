import { answeredIds, echoes, gatherings, isQuestion, openQuestions } from "./engine.js";
import { createSample } from "./sample.js";

const STORAGE_KEY = "margin.notebook.v1";
const THEME_KEY = "margin.theme";
const DISMISS_KEY = "margin.resurface.dismissed";

const state = {
  fragments: [],
  view: "page",
  gathering: null,
  find: "",
  findOpen: false,
  followingId: null,
  draftTies: [],
  selectedId: null,
  editingId: null,
  undo: [],
  confirmRestore: false,
  dirtyEdit: false,
};

const $ = (id) => document.getElementById(id);
const draftEl = () => $("draft");

function loadFragments() {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return createSample();
    const data = JSON.parse(raw);
    if (!Array.isArray(data.fragments)) return createSample();
    return data.fragments
      .filter((fragment) => fragment && typeof fragment.text === "string" && fragment.id)
      .map((fragment) => ({
        id: String(fragment.id),
        text: fragment.text,
        created: Number(fragment.created) || Date.now(),
        updated: Number(fragment.updated) || Number(fragment.created) || Date.now(),
        ties: Array.isArray(fragment.ties) ? fragment.ties.filter((id) => typeof id === "string") : [],
      }));
  } catch {
    return createSample();
  }
}

function save() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ fragments: state.fragments }));
}

function snapshot() {
  state.undo.push(JSON.stringify(state.fragments));
  if (state.undo.length > 50) state.undo.shift();
}

function undo() {
  const previous = state.undo.pop();
  if (!previous) return;
  state.fragments = JSON.parse(previous);
  state.editingId = null;
  state.selectedId = null;
  hideToast();
  save();
  renderAll();
}

function findFragment(id) {
  return state.fragments.find((fragment) => fragment.id === id) || null;
}

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, (ch) => ({
    "&": "&amp;",
    "<": "&lt;",
    ">": "&gt;",
    '"': "&quot;",
    "'": "&#39;",
  }[ch]));
}

function renderText(text) {
  return escapeHtml(text)
    .split(/\n{2,}/)
    .map((paragraph) => `<p>${inline(paragraph).replace(/\n/g, "<br>")}</p>`)
    .join("");
}

function inline(escaped) {
  return escaped
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/(^|[^*])\*([^*]+)\*/g, "$1<em>$2</em>");
}

function truncate(text, limit) {
  const flat = text.replace(/\s+/g, " ").trim();
  if (flat.length <= limit) return flat;
  const cut = flat.slice(0, limit - 1).replace(/\s+\S*$/, "");
  return `${cut || flat.slice(0, limit - 1)}…`;
}

function dayStart(value) {
  const date = new Date(value);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate()).getTime();
}

function calendarDaysAgo(ts) {
  return Math.round((dayStart(Date.now()) - dayStart(ts)) / 86400000);
}

function dayLabel(ts) {
  const days = calendarDaysAgo(ts);
  if (days === 0) return "Today";
  if (days === 1) return "Yesterday";
  const date = new Date(ts);
  if (days < 7) return date.toLocaleDateString(undefined, { weekday: "long" });
  return date.toLocaleDateString(undefined, { weekday: "long", month: "long", day: "numeric" });
}

function agoLabel(ts) {
  const days = calendarDaysAgo(ts);
  if (days <= 0) return "today";
  if (days === 1) return "yesterday";
  return `${days} days ago`;
}

function clockLabel(ts) {
  return new Date(ts).toLocaleTimeString(undefined, { hour: "numeric", minute: "2-digit" });
}

function monthLabel(ts) {
  return new Date(ts).toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

function matchesFind(fragment, query) {
  const needle = query.trim().toLowerCase();
  if (!needle) return true;
  return fragment.text.toLowerCase().includes(needle);
}

function sortedFragments() {
  return state.fragments.slice().sort((a, b) => a.created - b.created || String(a.id).localeCompare(String(b.id)));
}

function visibleFragments() {
  let list = sortedFragments();
  if (state.gathering) {
    const gathering = gatherings(state.fragments).find((item) => item.term === state.gathering);
    const ids = new Set(gathering ? gathering.ids : []);
    list = list.filter((fragment) => ids.has(fragment.id));
  }
  if (state.find.trim()) list = list.filter((fragment) => matchesFind(fragment, state.find));
  return list;
}

function followerMap() {
  const map = new Map();
  for (const fragment of state.fragments) {
    for (const id of fragment.ties || []) {
      if (!map.has(id)) map.set(id, []);
      map.get(id).push(fragment);
    }
  }
  return map;
}

function newId() {
  return `m_${Math.random().toString(36).slice(2, 8)}${Date.now().toString(36)}`;
}

function renderAll() {
  state.dirtyEdit = false;
  renderNav();
  renderBanner();
  renderStream();
  renderResurface();
  renderFollowing();
  renderDraftTies();
  renderEchoes();
  renderGatherings();
  renderOpen();
  syncView();
  resizeDraft();
}

function renderNav() {
  const open = openQuestions(state.fragments).length;
  $("nav-open").innerHTML = open ? `Open<span class="count">${open}</span>` : "Open";
  for (const id of ["nav-page", "nav-gatherings", "nav-open"]) {
    const button = $(id);
    const on = button.dataset.view === state.view;
    if (on) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  }
}

function renderBanner() {
  const banner = $("banner");
  if (!state.gathering) {
    banner.innerHTML = "";
    return;
  }
  const gathering = gatherings(state.fragments).find((item) => item.term === state.gathering);
  if (!gathering) {
    state.gathering = null;
    banner.innerHTML = "";
    return;
  }
  const noun = gathering.ids.length === 1 ? "sentence" : "sentences";
  banner.innerHTML = `Gathered around ${escapeHtml(gathering.title.toLowerCase())} · ${gathering.ids.length} ${noun}<button type="button" id="clear-gathering">Whole page</button>`;
}

function renderStream() {
  const stream = $("stream");
  const editingId = state.editingId;
  const fragments = visibleFragments();
  if (!fragments.length) {
    const message = state.find.trim()
      ? "Nothing in the notebook matches that."
      : state.gathering
        ? "That gathering is empty."
        : "The page is blank. The first sentence will be the oldest one in the book.";
    stream.innerHTML = `<p class="empty">${message}</p>`;
    return;
  }

  const answered = answeredIds(state.fragments);
  const followers = followerMap();
  const editing = editingId ? findFragment(editingId) : null;
  let html = "";
  let lastDay = "";
  for (const fragment of fragments) {
    const key = String(dayStart(fragment.created));
    if (key !== lastDay) {
      html += `<h2 class="day">${escapeHtml(dayLabel(fragment.created))}</h2>`;
      lastDay = key;
    }
    const question = isQuestion(fragment.text);
    const selected = state.selectedId === fragment.id;
    const classes = [
      "frag",
      question ? "is-question" : "",
      question && answered.has(fragment.id) ? "is-answered" : "",
      selected ? "is-selected" : "",
    ].filter(Boolean).join(" ");
    const ties = (fragment.ties || []).map((id) => findFragment(id)).filter(Boolean);
    const pickedUp = (followers.get(fragment.id) || []).filter((item) => item.id !== fragment.id);
    html += `<article class="${classes}" data-id="${fragment.id}" tabindex="0">
      ${question ? `<span class="mark${answered.has(fragment.id) ? " is-filled" : ""}" aria-hidden="true"></span>` : ""}
      <time class="frag-time" datetime="${new Date(fragment.created).toISOString()}">${escapeHtml(clockLabel(fragment.created))}</time>
      ${fragment.id === editingId
        ? `<textarea class="edit-area" rows="3" aria-label="Edit sentence"></textarea><p class="edit-note">Enter keeps the edit · Esc puts it back</p>`
        : `<div class="frag-text">${renderText(fragment.text)}</div>`}
      ${ties.map((tie) => tieHtml(fragment.id, tie, "with", selected)).join("")}
      ${pickedUp.map((tie) => tieHtml(null, tie, "picked up", false)).join("")}
      <div class="frag-actions">
        <button type="button" data-action="follow">Follow</button>
        <button type="button" data-action="edit">Edit</button>
        <button type="button" data-action="delete" class="quiet">Remove</button>
      </div>
    </article>`;
  }
  stream.innerHTML = html;
  if (editing) {
    const area = stream.querySelector(".edit-area");
    if (area) {
      area.value = editing.text;
      area.focus();
      const end = area.value.length;
      area.setSelectionRange(end, end);
    }
  }
}

function tieHtml(ownerId, target, label, showRelease) {
  const release = showRelease && ownerId
    ? `<button type="button" class="release" data-action="untie" data-tie="${target.id}">Release</button>`
    : "";
  return `<div class="tie-row">
    <button type="button" class="tie" data-jump="${target.id}"><span class="tie-k">${label}</span><span class="tie-text">${escapeHtml(truncate(target.text, 160))}</span></button>
    ${release}
  </div>`;
}

function renderResurface() {
  const host = $("resurface");
  if (state.view !== "page" || state.gathering || state.find.trim() || state.followingId) {
    host.innerHTML = "";
    return;
  }
  const open = openQuestions(state.fragments);
  const dismissed = sessionStorage.getItem(DISMISS_KEY);
  const question = open.find((fragment) => fragment.id !== dismissed && fragment.id !== state.followingId);
  if (!question) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `<p class="kicker">Still open · ${escapeHtml(agoLabel(question.created))}</p>
    <button type="button" class="resurface-q" data-resurface="${question.id}">${escapeHtml(question.text)}</button>
    <button type="button" class="dismiss" data-dismiss="${question.id}">Not now</button>`;
}

function renderFollowing() {
  const host = $("following");
  const fragment = state.followingId ? findFragment(state.followingId) : null;
  if (!fragment) {
    state.followingId = null;
    host.innerHTML = "";
    draftEl().placeholder = "The next sentence";
    return;
  }
  host.innerHTML = `<p class="kicker">Following</p>
    <div class="chip-row">
      <button type="button" class="following-text" data-jump="${fragment.id}">${escapeHtml(truncate(fragment.text, 140))}</button>
      <button type="button" class="release" id="release-follow">Let go</button>
    </div>`;
  draftEl().placeholder = "Continue it";
}

function renderDraftTies() {
  const host = $("draft-ties");
  const ties = state.draftTies.map((id) => findFragment(id)).filter(Boolean);
  state.draftTies = ties.map((fragment) => fragment.id);
  if (!ties.length) {
    host.innerHTML = "";
    return;
  }
  host.innerHTML = `<p class="kicker">Will sit with</p>
    <div class="chip-row">
      ${ties.map((fragment) => `<span class="chip">
        <button type="button" data-jump="${fragment.id}">${escapeHtml(truncate(fragment.text, 80))}</button>
        <button type="button" class="release" data-unpin="${fragment.id}">Release</button>
      </span>`).join("")}
    </div>`;
}

function renderEchoes() {
  const host = $("echoes");
  const typed = draftEl().value.trim();
  const context = state.followingId ? findFragment(state.followingId) : null;
  const query = [context?.text, typed].filter(Boolean).join("\n");
  const exclude = state.followingId ? [state.followingId] : [];
  const hits = query ? echoes(query, state.fragments, { limit: 3, excludeIds: exclude, boost: typed }) : [];
  if (!hits.length) {
    host.innerHTML = "";
    host.setAttribute("aria-hidden", "true");
    renderEchoes.lastKey = "";
    return;
  }
  host.removeAttribute("aria-hidden");
  const key = hits.map((hit) => hit.id).join();
  const changed = key !== renderEchoes.lastKey;
  renderEchoes.lastKey = key;
  const cue = localStorage.getItem("margin.learned") ? "" : `<p class="echo-cue">Click one, and it sits with the line you are writing.</p>`;
  host.innerHTML = `<p class="kicker echoes-kicker">In the margin</p>${cue}
    ${hits.map((hit) => {
      const fragment = findFragment(hit.id);
      const pinned = state.draftTies.includes(hit.id);
      return `<button type="button" class="echo${pinned ? " is-pinned" : ""}" data-echo="${fragment.id}">
        <span class="echo-date">${escapeHtml(monthLabel(fragment.created))}${pinned ? " · sitting with this" : ""}</span>
        <span class="echo-text">${escapeHtml(fragment.text)}</span>
      </button>`;
    }).join("")}`;
  if (changed && key && window.innerWidth < 1240) {
    requestAnimationFrame(() => draftEl().scrollIntoView({ block: "end" }));
  }
}

function renderGatherings() {
  const host = $("view-gatherings");
  const found = gatherings(state.fragments);
  const byId = new Map(state.fragments.map((fragment) => [fragment.id, fragment]));
  const body = found.length
    ? found.map((gathering) => {
      const first = byId.get(gathering.ids[0]);
      const noun = gathering.ids.length === 1 ? "sentence" : "sentences";
      return `<button type="button" class="gather" data-term="${escapeHtml(gathering.term)}">
        <span class="gather-head"><span class="gather-term">${escapeHtml(gathering.title)}</span><span class="gather-count">${gathering.ids.length} ${noun}</span></span>
        <span class="gather-sample">${escapeHtml(truncate(first?.text || "", 140))}</span>
      </button>`;
    }).join("")
    : `<p class="empty">Nothing has returned three times yet. Keep writing, and the words that come back will gather here.</p>`;
  host.innerHTML = `<div class="sheet pad">
    <h1>Gatherings</h1>
    <p class="lede">Words that have come back at least three times. A sentence can sit in more than one.</p>
    ${body}
  </div>`;
}

function renderOpen() {
  const host = $("view-open");
  const open = openQuestions(state.fragments);
  const body = open.length
    ? open.map((fragment) => `<button type="button" class="open-q" data-open="${fragment.id}">
        ${escapeHtml(fragment.text)}
        <span class="open-when">${escapeHtml(agoLabel(fragment.created))}</span>
      </button>`).join("")
    : `<p class="empty">Nothing is waiting. A sentence that ends with a question mark stays here until you follow it.</p>`;
  host.innerHTML = `<div class="sheet pad">
    <h1>Open</h1>
    <p class="lede">Questions you have not yet followed with another sentence.</p>
    ${body}
  </div>`;
}

function syncView() {
  $("view-page").hidden = state.view !== "page";
  $("composer").hidden = state.view !== "page";
  $("view-gatherings").hidden = state.view !== "gatherings";
  $("view-open").hidden = state.view !== "open";
  if (state.view !== "page") $("pen").hidden = true;
}

function resizeDraft() {
  const draft = draftEl();
  draft.style.height = "auto";
  draft.style.height = `${Math.min(draft.scrollHeight, window.innerHeight * 0.4)}px`;
}

function commit() {
  const text = draftEl().value.trim();
  if (!text) return;
  const ties = [];
  if (state.followingId && findFragment(state.followingId)) ties.push(state.followingId);
  for (const id of state.draftTies) {
    if (id !== state.followingId && findFragment(id)) ties.push(id);
  }
  const created = {
    id: newId(),
    text,
    created: Date.now(),
    updated: Date.now(),
    ties,
  };
  snapshot();
  state.fragments.push(created);
  draftEl().value = "";
  state.followingId = null;
  state.draftTies = [];
  state.selectedId = null;
  state.editingId = null;
  if (!visibleFragments().some((fragment) => fragment.id === created.id)) {
    state.gathering = null;
    state.find = "";
    $("find-input").value = "";
    $("find-count").textContent = "";
  }
  save();
  renderAll();
  scrollToPen(true);
}

function follow(id) {
  if (!findFragment(id)) return;
  state.followingId = id;
  state.draftTies = state.draftTies.filter((tie) => tie !== id);
  state.view = "page";
  state.selectedId = id;
  renderAll();
  draftEl().focus({ preventScroll: true });
}

function select(id) {
  state.selectedId = id;
  state.editingId = null;
  renderStream();
  const article = articleById(id);
  article?.focus({ preventScroll: true });
}

function startEdit(id) {
  const fragment = findFragment(id);
  if (!fragment) return;
  state.editingId = id;
  state.selectedId = id;
  renderStream();
}

function stashEdit() {
  if (!state.editingId) return;
  const area = $("stream").querySelector(".edit-area");
  const id = state.editingId;
  const text = area ? area.value.trim() : "";
  state.editingId = null;
  const fragment = findFragment(id);
  if (fragment && text && text !== fragment.text) {
    snapshot();
    fragment.text = text;
    fragment.updated = Date.now();
    save();
    state.dirtyEdit = true;
  }
}

function finishEdit() {
  stashEdit();
  state.dirtyEdit = false;
  renderAll();
}

function cancelEdit() {
  state.editingId = null;
  state.dirtyEdit = false;
  renderStream();
}

function removeFragment(id) {
  if (!findFragment(id)) return;
  snapshot();
  const saved = state.undo[state.undo.length - 1];
  state.fragments = state.fragments.filter((fragment) => fragment.id !== id);
  for (const fragment of state.fragments) {
    if (fragment.ties?.includes(id)) fragment.ties = fragment.ties.filter((tie) => tie !== id);
  }
  if (state.followingId === id) state.followingId = null;
  state.draftTies = state.draftTies.filter((tie) => tie !== id);
  if (state.selectedId === id) state.selectedId = null;
  if (state.editingId === id) state.editingId = null;
  save();
  renderAll();
  showToast("Sentence removed.", () => {
    state.undo.pop();
    state.fragments = JSON.parse(saved);
    save();
    hideToast();
    renderAll();
  });
}

function untie(fromId, toId) {
  const fragment = findFragment(fromId);
  if (!fragment?.ties?.includes(toId)) return;
  snapshot();
  fragment.ties = fragment.ties.filter((id) => id !== toId);
  fragment.updated = Date.now();
  save();
  renderAll();
}

function toggleDraftTie(id) {
  if (id === state.followingId) return;
  localStorage.setItem("margin.learned", "1");
  const index = state.draftTies.indexOf(id);
  if (index >= 0) state.draftTies.splice(index, 1);
  else state.draftTies.push(id);
  renderDraftTies();
  renderEchoes();
  draftEl().focus({ preventScroll: true });
}

function jumpTo(id) {
  const fragment = findFragment(id);
  if (!fragment) return;
  state.view = "page";
  if (state.gathering) {
    const gathering = gatherings(state.fragments).find((item) => item.term === state.gathering);
    if (!gathering || !gathering.ids.includes(id)) state.gathering = null;
  }
  if (state.find.trim() && !matchesFind(fragment, state.find)) {
    state.find = "";
    $("find-input").value = "";
    updateFindCount();
  }
  state.selectedId = id;
  renderAll();
  const article = articleById(id);
  if (!article) return;
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  article.scrollIntoView({ behavior: reduce ? "auto" : "smooth", block: "center" });
  article.classList.add("is-flash");
  window.setTimeout(() => article.classList.remove("is-flash"), 1400);
}

function articleById(id) {
  return $("stream").querySelector(`[data-id="${CSS.escape(id)}"]`);
}

function setView(view) {
  state.view = view;
  if (view !== "page") closeMenu();
  renderAll();
  if (view === "page") scrollToPen(false);
  else window.scrollTo({ top: 0, behavior: "auto" });
}

function openFind() {
  state.findOpen = true;
  $("find-form").hidden = false;
  $("find-input").focus();
  updateFindCount();
}

function closeFind() {
  state.findOpen = false;
  state.find = "";
  $("find-input").value = "";
  $("find-form").hidden = true;
  $("find-count").textContent = "";
  renderBanner();
  renderStream();
  renderResurface();
  draftEl().focus({ preventScroll: true });
}

function updateFindCount() {
  if (!state.find.trim()) {
    $("find-count").textContent = "";
    return;
  }
  const count = visibleFragments().length;
  $("find-count").textContent = count === 1 ? "1 sentence" : `${count} sentences`;
}

function scrollToPen(smooth) {
  const reduce = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
  $("composer").scrollIntoView({ behavior: smooth && !reduce ? "smooth" : "auto", block: "end" });
}

function showToast(message, onUndo) {
  const toast = $("toast");
  toast.innerHTML = `<span>${escapeHtml(message)}</span><button type="button" id="toast-undo">Undo</button>`;
  toast.hidden = false;
  document.body.classList.add("has-toast");
  $("toast-undo").addEventListener("click", onUndo);
  window.clearTimeout(showToast.timer);
  showToast.timer = window.setTimeout(hideToast, 6000);
}

function hideToast() {
  $("toast").hidden = true;
  document.body.classList.remove("has-toast");
}

function closeMenu() {
  $("more-menu").hidden = true;
  $("more-btn").setAttribute("aria-expanded", "false");
  state.confirmRestore = false;
  const restore = $("more-menu").querySelector("[data-more='restore']");
  if (restore) {
    restore.textContent = "Restore the sample";
    restore.classList.remove("is-danger");
  }
}

function exportMarkdown() {
  const lines = ["# Margin", ""];
  let lastDay = "";
  for (const fragment of sortedFragments()) {
    const key = String(dayStart(fragment.created));
    if (key !== lastDay) {
      lines.push(`## ${dayLabel(fragment.created)}`, "");
      lastDay = key;
    }
    lines.push(fragment.text, "");
    for (const id of fragment.ties || []) {
      const tied = findFragment(id);
      if (tied) lines.push(`> ${tied.text.replace(/\s+/g, " ")}`, "");
    }
  }
  const blob = new Blob([lines.join("\n")], { type: "text/markdown;charset=utf-8" });
  const url = URL.createObjectURL(blob);
  const link = document.createElement("a");
  link.href = url;
  link.download = "margin.md";
  document.body.append(link);
  link.click();
  link.remove();
  URL.revokeObjectURL(url);
}

function restoreSample() {
  snapshot();
  state.fragments = createSample();
  state.gathering = null;
  state.followingId = null;
  state.draftTies = [];
  state.selectedId = null;
  state.editingId = null;
  state.find = "";
  $("find-input").value = "";
  save();
  closeMenu();
  renderAll();
  scrollToPen(false);
}

function applyTheme(theme) {
  document.documentElement.dataset.theme = theme;
  $("theme-btn").textContent = theme === "night" ? "Day" : "Night";
  document.querySelector('meta[name="theme-color"]').content = theme === "night" ? "#16140f" : "#e9dfcf";
  localStorage.setItem(THEME_KEY, theme);
}

function watchPen() {
  if (state.view !== "page") {
    $("pen").hidden = true;
    return;
  }
  const rect = $("composer").getBoundingClientRect();
  $("pen").hidden = rect.top < window.innerHeight - 24;
}

function onStreamClick(event) {
  const jump = event.target.closest("[data-jump]");
  if (jump && $("stream").contains(jump)) {
    jumpTo(jump.dataset.jump);
    return;
  }
  const action = event.target.closest("[data-action]");
  const article = event.target.closest(".frag");
  if (!article) return;
  const id = article.dataset.id;
  if (!action) {
    if (state.editingId && state.editingId !== id) return;
    if (event.target.closest(".tie, .tie-row, .edit-area")) return;
    select(id);
    return;
  }
  const name = action.dataset.action;
  if (name === "follow") follow(id);
  if (name === "edit") startEdit(id);
  if (name === "delete") removeFragment(id);
  if (name === "untie") untie(id, action.dataset.tie);
}

function onStreamKeydown(event) {
  if (event.target.classList.contains("edit-area")) {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      cancelEdit();
    } else if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
      event.preventDefault();
      finishEdit();
    }
    return;
  }
  const article = event.target.closest(".frag");
  if (!article) return;
  const id = article.dataset.id;
  if (event.key === "Enter") {
    event.preventDefault();
    follow(id);
  } else if (event.key === "e" || event.key === "E") {
    event.preventDefault();
    startEdit(id);
  } else if (event.key === "Backspace" || event.key === "Delete") {
    event.preventDefault();
    removeFragment(id);
  } else if (event.key === "Escape") {
    event.preventDefault();
    state.selectedId = null;
    renderStream();
    draftEl().focus();
  } else if (event.key === "ArrowDown" || event.key === "ArrowUp") {
    event.preventDefault();
    const items = [...$("stream").querySelectorAll(".frag")];
    const index = items.indexOf(article);
    const next = items[index + (event.key === "ArrowDown" ? 1 : -1)];
    if (next) select(next.dataset.id);
  }
}

function onStreamFocusOut(event) {
  if (!event.target.classList.contains("edit-area")) return;
  stashEdit();
  window.setTimeout(() => {
    if (!state.dirtyEdit) return;
    state.dirtyEdit = false;
    renderAll();
  }, 0);
}

function onDraftKeydown(event) {
  if (event.key === "Enter" && !event.shiftKey && !event.isComposing) {
    event.preventDefault();
    commit();
    return;
  }
  const draft = draftEl();
  if (event.key === "/" && draft.value === "" && draft.selectionStart === 0) {
    event.preventDefault();
    openFind();
    return;
  }
  if (event.key === "ArrowUp" && draft.value === "" && draft.selectionStart === 0) {
    const items = [...$("stream").querySelectorAll(".frag")];
    const last = items[items.length - 1];
    if (last) {
      event.preventDefault();
      select(last.dataset.id);
      last.scrollIntoView({ block: "center" });
    }
  }
}

function onGlobalKeydown(event) {
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "f") {
    event.preventDefault();
    openFind();
    return;
  }
  if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "z" && !event.shiftKey) {
    const draft = draftEl();
    const typing = event.target === draft && draft.value.length > 0;
    const editing = event.target.classList?.contains("edit-area");
    const finding = event.target === $("find-input");
    if (typing || editing || finding) return;
    event.preventDefault();
    undo();
    return;
  }
  if (event.key !== "Escape") return;
  if ($("help").open) return;
  if (!$("more-menu").hidden) {
    closeMenu();
    return;
  }
  if (state.editingId) return;
  if (state.findOpen) {
    closeFind();
    return;
  }
  if (state.followingId || state.draftTies.length) {
    state.followingId = null;
    state.draftTies = [];
    renderFollowing();
    renderDraftTies();
    renderEchoes();
    renderResurface();
    return;
  }
  if (state.selectedId) {
    state.selectedId = null;
    renderStream();
  }
}

function bind() {
  $("brand").addEventListener("click", () => {
    state.gathering = null;
    state.find = "";
    $("find-input").value = "";
    if (state.findOpen) closeFind();
    setView("page");
  });

  document.querySelector(".views").addEventListener("click", (event) => {
    const button = event.target.closest("[data-view]");
    if (!button) return;
    if (button.dataset.view === "page") state.gathering = null;
    setView(button.dataset.view);
  });

  $("find-btn").addEventListener("click", () => {
    if (state.findOpen) closeFind();
    else openFind();
  });
  $("find-close").addEventListener("click", closeFind);
  $("find-form").addEventListener("submit", (event) => event.preventDefault());
  $("find-input").addEventListener("input", () => {
    state.find = $("find-input").value;
    updateFindCount();
    renderBanner();
    renderStream();
    renderResurface();
  });
  $("find-input").addEventListener("keydown", (event) => {
    if (event.key === "Escape") {
      event.preventDefault();
      event.stopPropagation();
      closeFind();
    }
  });

  $("theme-btn").addEventListener("click", () => {
    applyTheme(document.documentElement.dataset.theme === "night" ? "day" : "night");
  });

  $("more-btn").addEventListener("click", () => {
    const menu = $("more-menu");
    const open = menu.hidden;
    menu.hidden = !open;
    $("more-btn").setAttribute("aria-expanded", open ? "true" : "false");
    if (!open) closeMenu();
  });

  $("more-menu").addEventListener("click", (event) => {
    const button = event.target.closest("[data-more]");
    if (!button) return;
    const action = button.dataset.more;
    if (action === "help") {
      closeMenu();
      $("help").showModal();
    } else if (action === "export") {
      exportMarkdown();
      closeMenu();
    } else if (action === "restore") {
      if (!state.confirmRestore) {
        state.confirmRestore = true;
        button.textContent = "Replace this notebook";
        button.classList.add("is-danger");
        return;
      }
      restoreSample();
    }
  });

  document.addEventListener("click", (event) => {
    if (!$("more-menu").hidden && !event.target.closest("#more-wrap")) closeMenu();
  });

  $("stream").addEventListener("click", onStreamClick);
  $("stream").addEventListener("keydown", onStreamKeydown);
  $("stream").addEventListener("focusout", onStreamFocusOut);
  $("stream").addEventListener("dblclick", (event) => {
    const article = event.target.closest(".frag");
    if (!article || event.target.closest("button, textarea")) return;
    startEdit(article.dataset.id);
  });

  $("resurface").addEventListener("click", (event) => {
    const open = event.target.closest("[data-resurface]");
    if (open) {
      follow(open.dataset.resurface);
      scrollToPen(true);
      return;
    }
    const dismiss = event.target.closest("[data-dismiss]");
    if (dismiss) {
      sessionStorage.setItem(DISMISS_KEY, dismiss.dataset.dismiss);
      renderResurface();
    }
  });

  $("composer").addEventListener("submit", (event) => event.preventDefault());
  $("composer").addEventListener("click", (event) => {
    const jump = event.target.closest("[data-jump]");
    if (jump) {
      jumpTo(jump.dataset.jump);
      return;
    }
    const unpin = event.target.closest("[data-unpin]");
    if (unpin) toggleDraftTie(unpin.dataset.unpin);
    if (event.target.id === "release-follow") {
      state.followingId = null;
      renderFollowing();
      renderEchoes();
      renderResurface();
      draftEl().focus();
    }
  });
  $("echoes").addEventListener("click", (event) => {
    const echo = event.target.closest("[data-echo]");
    if (echo) toggleDraftTie(echo.dataset.echo);
  });

  draftEl().addEventListener("input", () => {
    resizeDraft();
    renderEchoes();
  });
  draftEl().addEventListener("keydown", onDraftKeydown);

  $("view-gatherings").addEventListener("click", (event) => {
    const button = event.target.closest("[data-term]");
    if (!button) return;
    state.gathering = button.dataset.term;
    state.view = "page";
    renderAll();
    window.scrollTo({ top: 0, behavior: "auto" });
  });

  $("view-open").addEventListener("click", (event) => {
    const button = event.target.closest("[data-open]");
    if (!button) return;
    follow(button.dataset.open);
    scrollToPen(false);
  });

  $("banner").addEventListener("click", (event) => {
    if (event.target.id !== "clear-gathering") return;
    state.gathering = null;
    renderAll();
  });

  $("pen").addEventListener("click", () => {
    scrollToPen(true);
    draftEl().focus({ preventScroll: true });
  });

  document.addEventListener("keydown", onGlobalKeydown);
  document.addEventListener("scroll", watchPen, { passive: true });
  window.addEventListener("resize", () => {
    resizeDraft();
    watchPen();
  });
}

function init() {
  const storedTheme = localStorage.getItem(THEME_KEY);
  const theme = storedTheme || (window.matchMedia("(prefers-color-scheme: dark)").matches ? "night" : "day");
  applyTheme(theme);
  state.fragments = loadFragments();
  bind();
  renderAll();
  const settle = () => {
    scrollToPen(false);
    watchPen();
  };
  settle();
  document.fonts?.ready?.then(settle);
  draftEl().focus({ preventScroll: true });
}

init();
