import { search, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { searchMatches, searchMatchAtOrAfter, searchMatchIndex } from "./editor";

test("find counts use the same query options as next/previous match", () => {
  let state = EditorState.create({ doc: "one One alone\none", extensions: search() });
  const matches = (query: SearchQuery) => {
    state = state.update({ effects: setSearchQuery.of(query) }).state;
    return searchMatches(state).map(({ from, to }) => state.sliceDoc(from, to));
  };
  expect(matches(new SearchQuery({ search: "one" }))).toEqual(["one", "One", "one", "one"]);
  expect(matches(new SearchQuery({ search: "one", caseSensitive: true, wholeWord: true }))).toEqual(["one", "one"]);
  expect(matches(new SearchQuery({ search: "o.e", regexp: true }))).toHaveLength(4);
  expect(matches(new SearchQuery({ search: "[", regexp: true }))).toEqual([]);
  expect(matches(new SearchQuery({ search: "" }))).toEqual([]);
});

test("typing a find query selects at or after the selection start and wraps", () => {
  let state = EditorState.create({ doc: "alpha beta alpha", selection: { anchor: 10 }, extensions: search() });
  for (const search of ["a", "al", "alp", "alph", "alpha"]) {
    state = state.update({ effects: setSearchQuery.of(new SearchQuery({ search })) }).state;
    const match = searchMatchAtOrAfter(searchMatches(state), state.selection.main.from)!;
    state = state.update({ selection: { anchor: match.from, head: match.to } }).state;
    expect(state.selection.main.from).toBe(11);
    expect(state.sliceDoc(match.from, match.to)).toBe(search);
  }
  const matches = searchMatches(state);
  expect(searchMatchAtOrAfter(matches, state.doc.length)).toEqual(matches[0]);
  expect(searchMatchAtOrAfter([], 0)).toBeUndefined();
});

test("the find index counts an exact selection or a caret inside a match", () => {
  const matches = [{ from: 2, to: 7 }, { from: 7, to: 12 }, { from: 14, to: 14 }];
  const index = (from: number, to = from) => searchMatchIndex(matches, { from, to });
  expect(index(2, 7)).toBe(0);
  expect(index(2)).toBe(0);
  expect(index(5)).toBe(0);
  expect(index(7)).toBe(1);
  expect(index(12)).toBe(-1);
  expect(index(14)).toBe(2);
  expect(index(0)).toBe(-1);
  expect(index(3, 6)).toBe(-1);
  expect(searchMatchIndex([], { from: 0, to: 0 })).toBe(-1);
});
