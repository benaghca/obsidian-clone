import assert from "node:assert/strict";
import test from "node:test";
import { echoes, gatherings, isQuestion, openQuestions, stem, tokens } from "./engine.js";
import { createSample } from "./sample.js";

const sample = createSample(new Date("2026-10-19T12:00:00").getTime());

function texts(hits) {
  return hits.map((hit) => sample.find((fragment) => fragment.id === hit.id).text);
}

test("stemming folds the plurals a notebook actually uses", () => {
  assert.equal(stem("tomatoes"), "tomato");
  assert.equal(stem("tomato"), "tomato");
  assert.equal(stem("skins"), "skin");
  assert.equal(stem("leaves"), "leave");
  assert.equal(stem("focus"), "focus");
  assert.equal(stem("dough"), "dough");
});

test("tokens drop the words that do not carry a thought", () => {
  assert.deepEqual(tokens("Why do the tomatoes split after rain?"), ["tomato", "split", "rain"]);
});

test("the margin answers a tomato sentence with the tomato sentences", () => {
  const hits = texts(echoes("the tomatoes split when rain comes after a dry week", sample));
  assert.ok(hits[0].includes("week before was dry"));
  assert.ok(hits.some((text) => text.startsWith("Why do the tomatoes split")));
  assert.equal(hits.some((text) => text.includes("starter")), false);
});

test("a single uncommon word is enough to lean the margin in", () => {
  const hits = texts(echoes("dough", sample));
  assert.ok(hits.length >= 1);
  assert.ok(hits.every((text) => text.toLowerCase().includes("dough")));
});

test("yeast in a hot kitchen finds the dough, not the garden", () => {
  const hits = texts(echoes("the yeast died because the dough was warm", sample));
  assert.ok(hits.some((text) => text.includes("hot kitchen")));
  assert.equal(hits.some((text) => text.includes("tomato")), false);
});

test("attention and interruption find the reading notes", () => {
  const hits = texts(echoes("I keep losing attention when there is an interruption", sample));
  assert.ok(hits.some((text) => text.includes("fifteen minutes")));
  assert.equal(hits.some((text) => /tomato|blossom|dough/i.test(text)), false);
});

test("the loaf skin can find the tomato skin", () => {
  const hits = texts(echoes("the skin has to stay elastic while the inside grows", sample));
  assert.match(hits[0], /skin of the loaf/);
  assert.ok(hits.some((text) => text.includes("Tomato skins")));
});

test("empty and stopword queries stay quiet", () => {
  assert.deepEqual(echoes("", sample), []);
  assert.deepEqual(echoes("and the of a", sample), []);
});

test("a sentence does not echo itself", () => {
  const hits = echoes("autolyse flour and water", sample, { excludeIds: ["s28"] });
  assert.equal(hits.some((hit) => hit.id === "s28"), false);
});

test("gatherings form around returning words without merging the whole book", () => {
  const found = gatherings(sample);
  const titles = found.map((gathering) => gathering.title);
  const byTerm = Object.fromEntries(found.map((gathering) => [gathering.term, gathering]));
  assert.ok(byTerm.tomato, `expected tomatoes among ${titles.join(", ")}`);
  assert.ok(byTerm.dough, `expected dough among ${titles.join(", ")}`);
  assert.ok(byTerm.attention, `expected attention among ${titles.join(", ")}`);
  assert.ok(byTerm.skin, `expected the skin bridge among ${titles.join(", ")}`);
  for (const vague of ["One", "Enough", "Keeps", "Morning"]) {
    assert.equal(titles.includes(vague), false, vague);
  }
  assert.equal(byTerm.tomato.ids.includes("s02"), false);
  assert.equal(byTerm.dough.ids.includes("s05"), false);
  assert.ok(byTerm.tomato.ids.length >= 5);
  assert.ok(byTerm.dough.ids.length >= 5);
  assert.ok(byTerm.skin.ids.includes("s05"));
  assert.ok(byTerm.skin.ids.includes("s17"));
});

test("the sample has already been written, even early in the morning", () => {
  const now = new Date("2026-10-19T05:10:00").getTime();
  const early = createSample(now);
  assert.ok(early.every((fragment) => fragment.created <= now));
});

test("questions stay open until a later sentence is sat with them", () => {
  const open = openQuestions(sample).map((fragment) => fragment.id);
  assert.equal(isQuestion("Is the starter hungry or just cold?"), true);
  assert.equal(isQuestion("It was cold."), false);
  assert.ok(open.includes("s07"));
  assert.ok(open.includes("s16"));
  assert.ok(open.includes("s23"));
  assert.ok(open.includes("s33"));
  assert.equal(open.includes("s19"), false);
});
