import assert from "node:assert/strict";
import test from "node:test";

import {
	CATEGORY_IDS,
	DARE_ANYONE_HOME,
	DARE_PROMPTS,
	GO_HOME_DARE,
	PROMPT_COUNTS,
	TRUTH_PROMPTS,
	createPromptPicker,
	getPrompts,
} from "../src/prompts.js";
import { SUPPLIED_PROMPTS } from "../src/prompts-content.js";

test("the library contains only the deduplicated supplied-photo deck", () => {
	assert.deepEqual(CATEGORY_IDS, ["photos"]);
	assert.deepEqual(
		TRUTH_PROMPTS.map((prompt) => prompt.text),
		SUPPLIED_PROMPTS.photos.truth,
	);
	assert.deepEqual(
		DARE_PROMPTS.map((prompt) => prompt.text),
		SUPPLIED_PROMPTS.photos.dare,
	);
	assert.deepEqual(
		{
			truth: PROMPT_COUNTS.truth,
			dare: PROMPT_COUNTS.dare,
			total: PROMPT_COUNTS.total,
		},
		{ truth: 68, dare: 51, total: 119 },
	);
});

test("truths, dares, ids, and text are unique", () => {
	const prompts = [...TRUTH_PROMPTS, ...DARE_PROMPTS];

	assert.equal(new Set(prompts.map((prompt) => prompt.id)).size, prompts.length);
	assert.equal(new Set(TRUTH_PROMPTS.map((prompt) => prompt.text)).size, 68);
	assert.equal(new Set(DARE_PROMPTS.map((prompt) => prompt.text)).size, 51);
	assert.ok(prompts.every((prompt) => prompt.category === "photos"));
});

test("both requested go-home dares are present verbatim", () => {
	assert.equal(GO_HOME_DARE, "Go home.");
	assert.equal(DARE_ANYONE_HOME, "Dare anyone here to go home.");
	assert.ok(DARE_PROMPTS.some((prompt) => prompt.text === GO_HOME_DARE));
	assert.ok(DARE_PROMPTS.some((prompt) => prompt.text === DARE_ANYONE_HOME));
});

test("the picker respects truth and dare modes without immediate repeats", () => {
	const picker = createPromptPicker({ random: () => 0, historySize: 4 });
	const first = picker.pick({ mode: "truth", enabledCategories: ["photos"] });
	const second = picker.pick({ mode: "truth", enabledCategories: ["photos"] });

	assert.equal(first.mode, "truth");
	assert.equal(second.mode, "truth");
	assert.notEqual(first.id, second.id);
	assert.ok(getPrompts({ mode: "dare" }).every((prompt) => prompt.mode === "dare"));
});
