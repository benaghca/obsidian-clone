// Fuzzy subsequence matching for the quick switcher. Tighter matches (runs
// of consecutive letters, word starts, earlier positions) score higher.

export interface FuzzyMatch {
  score: number;
  /** Indices of matched characters in the candidate, for bolding. */
  indices: number[];
}

const isWordStart = (text: string, i: number) => i === 0 || /[\s\-_/.([]/.test(text[i - 1]);

export function fuzzyMatch(query: string, text: string): FuzzyMatch | null {
  const q = query.toLowerCase().replace(/\s+/g, "");
  if (!q) return { score: 0, indices: [] };
  const t = text.toLowerCase();

  // Prefer a contiguous substring when there is one: it is what people mean.
  const at = t.indexOf(q);
  if (at >= 0) {
    const indices = Array.from(q, (_, i) => at + i);
    return { score: 1000 - at + (isWordStart(t, at) ? 200 : 0) - t.length * 0.1, indices };
  }

  const indices: number[] = [];
  let score = 0;
  let ti = 0;
  for (const ch of q) {
    const found = t.indexOf(ch, ti);
    if (found < 0) return null;
    const prev = indices[indices.length - 1];
    if (prev !== undefined && found === prev + 1) score += 15;
    else if (isWordStart(t, found)) score += 10;
    else score -= found - ti;
    indices.push(found);
    ti = found + 1;
  }
  return { score: score - indices[0] - t.length * 0.1, indices };
}

/** Render text with matched indices wrapped in <span class="suggestion-highlight">. */
export function highlight(text: string, indices: number[]): DocumentFragment {
  const frag = document.createDocumentFragment();
  const set = new Set(indices);
  let run = "";
  let runMatched = false;
  const flush = () => {
    if (!run) return;
    if (runMatched) {
      const b = document.createElement("span");
      b.className = "suggestion-highlight";
      b.textContent = run;
      frag.append(b);
    } else frag.append(run);
    run = "";
  };
  for (let i = 0; i < text.length; i++) {
    const m = set.has(i);
    if (m !== runMatched) {
      flush();
      runMatched = m;
    }
    run += text[i];
  }
  flush();
  return frag;
}
