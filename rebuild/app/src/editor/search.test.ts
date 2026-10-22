import { search, SearchQuery, setSearchQuery } from "@codemirror/search";
import { EditorState } from "@codemirror/state";
import { expect, test } from "vitest";
import { searchMatches } from "./editor";

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
