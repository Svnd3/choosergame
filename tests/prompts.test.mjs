import assert from "node:assert/strict";
import test from "node:test";

import {
	CATEGORY_IDS,
	CATEGORIES,
	DARE_ANYONE_HOME,
	DARE_PROMPTS,
	GO_HOME_DARE,
	PROMPT_COUNTS,
	TRUTH_PROMPTS,
	createPromptPicker,
	getPromptCounts,
	getPrompts,
} from "../src/prompts.js";
import { CURATED_PROMPTS } from "../src/prompts-content.js";

const normalizePrompt = (prompt) =>
	prompt
		.normalize("NFKC")
		.toLocaleLowerCase("en")
		.replace(/[‘’]/g, "'")
		.replace(/[^\p{L}\p{N}]+/gu, " ")
		.trim();

test("the library contains 68 truths and exactly three times the former dare count", () => {
	assert.deepEqual(CATEGORY_IDS, ["photos", "naughty"]);
	assert.equal(CATEGORIES.photos.label, "Standard");
	assert.equal(CATEGORIES.naughty.label, "Naughty · 18+");
	assert.equal(CATEGORIES.naughty.defaultEnabled, false);
	assert.equal(CATEGORIES.naughty.minimumAge, 18);

	assert.deepEqual(
		TRUTH_PROMPTS.filter((prompt) => prompt.category === "photos").map(
			(prompt) => prompt.text,
		),
		CURATED_PROMPTS.photos.truth,
	);
	assert.deepEqual(
		TRUTH_PROMPTS.filter((prompt) => prompt.category === "naughty").map(
			(prompt) => prompt.text,
		),
		CURATED_PROMPTS.naughty.truth,
	);
	assert.deepEqual(
		DARE_PROMPTS.filter((prompt) => prompt.category === "photos").map(
			(prompt) => prompt.text,
		),
		CURATED_PROMPTS.photos.dare,
	);
	assert.deepEqual(
		DARE_PROMPTS.filter((prompt) => prompt.category === "naughty").map(
			(prompt) => prompt.text,
		),
		CURATED_PROMPTS.naughty.dare,
	);
	assert.deepEqual(
		{
			truth: PROMPT_COUNTS.truth,
			dare: PROMPT_COUNTS.dare,
			total: PROMPT_COUNTS.total,
		},
		{ truth: 68, dare: 153, total: 221 },
	);
	assert.deepEqual(PROMPT_COUNTS.byCategory.photos, {
		truth: 64,
		dare: 113,
		total: 177,
	});
	assert.deepEqual(PROMPT_COUNTS.byCategory.naughty, {
		truth: 4,
		dare: 40,
		total: 44,
	});
});

test("truths, dares, ids, and normalized text are unique", () => {
	const prompts = [...TRUTH_PROMPTS, ...DARE_PROMPTS];
	const normalizedTruths = TRUTH_PROMPTS.map((prompt) => normalizePrompt(prompt.text));
	const normalizedDares = DARE_PROMPTS.map((prompt) => normalizePrompt(prompt.text));

	assert.equal(new Set(prompts.map((prompt) => prompt.id)).size, prompts.length);
	assert.equal(new Set(TRUTH_PROMPTS.map((prompt) => prompt.text)).size, 68);
	assert.equal(new Set(DARE_PROMPTS.map((prompt) => prompt.text)).size, 153);
	assert.equal(new Set(normalizedTruths).size, normalizedTruths.length);
	assert.equal(new Set(normalizedDares).size, normalizedDares.length);
	assert.ok(prompts.every((prompt) => CATEGORY_IDS.includes(prompt.category)));
	assert.ok(prompts.every((prompt) => !("minimumAge" in prompt)));
	assert.ok(prompts.every((prompt) => !("contentRating" in prompt)));
});

test("Naughty Mode is an explicit opt-in and never leaks into the standard pool", () => {
	const defaultMix = getPrompts();
	const defaultDares = getPrompts({ mode: "dare" });
	const allDares = getPrompts({ mode: "dare", enabledCategories: CATEGORY_IDS });
	const naughtyDares = getPrompts({
		mode: "dare",
		enabledCategories: ["naughty"],
	});

	assert.equal(defaultMix.length, 177);
	assert.equal(defaultDares.length, 113);
	assert.ok(defaultMix.every((prompt) => prompt.category === "photos"));
	assert.ok(defaultDares.every((prompt) => prompt.category === "photos"));
	assert.equal(allDares.length, 153);
	assert.equal(naughtyDares.length, 40);
	assert.ok(naughtyDares.every((prompt) => prompt.category === "naughty"));
	assert.deepEqual(getPromptCounts(), {
		mode: "mix",
		enabledCategories: ["photos"],
		truth: 64,
		dare: 113,
		total: 177,
		byCategory: {
			photos: { truth: 64, dare: 113, total: 177 },
			naughty: { truth: 0, dare: 0, total: 0 },
		},
	});
});

test("both requested go-home dares remain in the standard deck verbatim", () => {
	assert.equal(GO_HOME_DARE, "Go home.");
	assert.equal(DARE_ANYONE_HOME, "Dare anyone here to go home.");
	assert.ok(CURATED_PROMPTS.photos.dare.includes(GO_HOME_DARE));
	assert.ok(CURATED_PROMPTS.photos.dare.includes(DARE_ANYONE_HOME));
});

test("the picker respects modes, opt-in decks, and recent history", () => {
	const picker = createPromptPicker({ random: () => 0, historySize: 40 });
	const standardPicks = Array.from({ length: 40 }, () =>
		picker.pick({ mode: "dare" }),
	);
	const naughtyPick = picker.pick({
		mode: "dare",
		enabledCategories: ["naughty"],
	});

	assert.ok(standardPicks.every((prompt) => prompt.mode === "dare"));
	assert.ok(standardPicks.every((prompt) => prompt.category === "photos"));
	assert.equal(new Set(standardPicks.map((prompt) => prompt.id)).size, 40);
	assert.equal(naughtyPick.category, "naughty");
	assert.ok(getPrompts({ mode: "truth" }).every((prompt) => prompt.mode === "truth"));
});
