// The notebook's memory. No documents, folders, or tags — a sentence is the
// whole note. The margin offers earlier sentences that share uncommon words
// with what you are writing, and gatherings are just the words that keep
// coming back. All of it is counted locally from the text you already kept.

const STOP = new Set(`
  a an the of to and in on for is it that this with as at be are was were
  been being but or if from by you your i me my we our they them their not
  no nor so just than then into about over after before out up down off
  what when how why which who whom whose there here all some any each few
  more most other such only own same too very can will would should could
  may might must shall do does did doing done have has had having
  also still already again ever never really much many every both
  its it's im i've i'd don't doesn't didn't can't won't isn't aren't wasn't
  weren't let lets like just because while where get got
  one keep keeps kept enough thing things something everything nothing
  someone somebody really even back way ways lot lots bit kind sort
  come comes came going went want wants wanted look looks looked looking
  need needs needed take takes took taken give gives gave know knew known
  think thought thinking make makes made feel felt feeling leave leaves left
  stay stayed start starts started seem seems seemed say says said
  time times day days week weeks morning evening afternoon today hour hours
  minute minutes always sometimes often away around another
  good best better little great big small well put
  whole part parts actually maybe perhaps without within across through
  during until since everyone first last next half
`.trim().split(/\s+/));

/**
 * Light English stemming so "tomatoes" and "tomato" count as one word.
 * Enough for a notebook, not a search engine.
 */
export function stem(word) {
  let w = word;
  if (w.length > 4 && w.endsWith("oes")) w = w.slice(0, -2);
  else if (w.length > 5 && w.endsWith("ies")) w = w.slice(0, -3) + "y";
  else if (w.length > 4 && /(ches|shes|sses|xes|zes)$/.test(w)) w = w.slice(0, -2);
  else if (
    w.length > 4 &&
    w.endsWith("s") &&
    !w.endsWith("ss") &&
    !w.endsWith("us") &&
    !w.endsWith("is")
  ) {
    w = w.slice(0, -1);
  }
  return w;
}

/** Content words, in order, so pairs of neighbors can be scored too. */
export function tokens(text) {
  const raw = String(text).toLowerCase().match(/[a-z0-9']+/g) || [];
  const out = [];
  for (const piece of raw) {
    const w = piece.replace(/'/g, "");
    if (w.length <= 2 || STOP.has(w)) continue;
    out.push(stem(w));
  }
  return out;
}

function unique(list) {
  return [...new Set(list)];
}

function bigrams(terms) {
  const out = [];
  for (let i = 0; i < terms.length - 1; i++) out.push(`${terms[i]} ${terms[i + 1]}`);
  return out;
}

export function indexFragments(fragments) {
  const docs = fragments.map((f) => ({
    id: f.id,
    terms: unique(tokens(f.text)),
    sequence: tokens(f.text),
  }));
  const n = docs.length || 1;
  const df = {};
  for (const doc of docs) for (const term of doc.terms) df[term] = (df[term] || 0) + 1;
  const idf = {};
  for (const term of Object.keys(df)) idf[term] = Math.log(n / df[term]);
  return { docs, df, idf, n };
}

/**
 * Earlier sentences that rhyme with a query.
 * Two shared words are enough. One word is enough only when it is uncommon
 * in this notebook (it shows up in less than about a quarter of the sentences).
 * `boost` is the sentence currently being written; its words count extra,
 * so the margin follows the pen rather than only the sentence you are answering.
 */
export function echoes(query, fragments, options = {}) {
  const limit = options.limit ?? 3;
  const exclude = new Set(options.excludeIds || []);
  const queryTerms = tokens(query);
  if (!queryTerms.length || !fragments.length) return [];

  const { docs, idf } = indexFragments(fragments);
  const byId = new Map(docs.map((doc) => [doc.id, doc]));
  const boost = new Set(tokens(options.boost || ""));
  const queryBigrams = new Set(bigrams(queryTerms));
  const scored = [];

  for (const fragment of fragments) {
    if (exclude.has(fragment.id)) continue;
    const doc = byId.get(fragment.id);
    if (!doc) continue;
    const have = new Set(doc.terms);
    let score = 0;
    let shared = 0;
    let rarest = 0;
    for (const term of new Set(queryTerms)) {
      if (!have.has(term)) continue;
      shared += 1;
      const weight = idf[term] ?? 0;
      rarest = Math.max(rarest, weight);
      score += weight * (boost.has(term) ? 1.85 : 1);
    }
    if (!shared) continue;
    const docBigrams = new Set(bigrams(doc.sequence));
    for (const pair of queryBigrams) {
      if (docBigrams.has(pair)) score += 1.6;
    }
    const rareEnough = shared === 1 && rarest >= 1.35;
    if (shared < 2 && !rareEnough) continue;
    scored.push({ id: fragment.id, score, shared });
  }

  scored.sort((a, b) => b.score - a.score || b.shared - a.shared);
  return scored.slice(0, limit);
}

function surfaceForm(stemTerm, fragments) {
  const counts = {};
  for (const fragment of fragments) {
    const raw = fragment.text.toLowerCase().match(/[a-z0-9']+/g) || [];
    for (const piece of raw) {
      const w = piece.replace(/'/g, "");
      if (stem(w) === stemTerm) counts[w] = (counts[w] || 0) + 1;
    }
  }
  const best = Object.entries(counts).sort((a, b) => b[1] - a[1] || b[0].length - a[0].length)[0];
  const word = best ? best[0] : stemTerm;
  return word.charAt(0).toUpperCase() + word.slice(1);
}

function jaccard(a, b) {
  let inter = 0;
  for (const id of a) if (b.has(id)) inter += 1;
  const union = a.size + b.size - inter;
  return union ? inter / union : 0;
}

/**
 * Words that have returned at least three times, and that are not simply
 * another name for a gathering already chosen. A sentence may sit in more
 * than one gathering — that is the point of a commonplace.
 */
export function gatherings(fragments) {
  if (fragments.length < 3) return [];
  const { docs, df, idf, n } = indexFragments(fragments);
  const chronological = fragments.slice().sort((a, b) => a.created - b.created);
  const candidates = Object.keys(df)
    .filter((term) => df[term] >= 3 && df[term] <= Math.max(3, n * 0.45))
    .map((term) => ({ term, score: df[term] * (idf[term] || 0) }))
    .sort((a, b) => b.score - a.score || a.term.localeCompare(b.term));

  const chosen = [];
  for (const candidate of candidates) {
    const members = new Set(docs.filter((doc) => doc.terms.includes(candidate.term)).map((doc) => doc.id));
    if (chosen.some((kept) => jaccard(members, kept.ids) >= 0.55)) continue;
    const ids = chronological.filter((fragment) => members.has(fragment.id)).map((fragment) => fragment.id);
    chosen.push({
      term: candidate.term,
      title: surfaceForm(candidate.term, fragments),
      ids: new Set(ids),
      ordered: ids,
    });
    if (chosen.length >= 8) break;
  }

  return chosen
    .map((gathering) => ({
      term: gathering.term,
      title: gathering.title,
      ids: gathering.ordered,
    }))
    .sort((a, b) => b.ids.length - a.ids.length || a.title.localeCompare(b.title));
}

export function isQuestion(text) {
  return /\?\s*$/.test(String(text).trim());
}

/** A question is answered only when you chose to sit a later sentence with it. */
export function answeredIds(fragments) {
  const answered = new Set();
  for (const fragment of fragments) {
    for (const id of fragment.ties || []) answered.add(id);
  }
  return answered;
}

export function openQuestions(fragments) {
  const answered = answeredIds(fragments);
  return fragments
    .filter((fragment) => isQuestion(fragment.text) && !answered.has(fragment.id))
    .slice()
    .sort((a, b) => a.created - b.created);
}
