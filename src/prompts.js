/** Truth or Dare library built only from the prompts supplied by the user. */

import {
	DARE_ANYONE_HOME,
	GO_HOME_DARE,
	SUPPLIED_PROMPTS,
} from "./prompts-content.js";

const freeze = (value) => Object.freeze(value);

export { DARE_ANYONE_HOME, GO_HOME_DARE };

export const CATEGORIES = freeze({
	photos: freeze({
		id: "photos",
		label: "Supplied photos",
		shortLabel: "Photos",
		description: "Only prompts transcribed from the supplied photos.",
		symbol: "○",
		accent: "#7DD3FC",
		minimumAge: 18,
		contentRating: "mature",
		requiresConsentReminder: true,
		defaultEnabled: true,
	}),
});

export const CATEGORY_METADATA = CATEGORIES;
export const CATEGORY_IDS = freeze(Object.keys(CATEGORIES));
export const PROMPT_MODES = freeze(["truth", "dare", "mix"]);

const DEFAULT_CATEGORY_IDS = freeze(
	CATEGORY_IDS.filter((category) => CATEGORIES[category].defaultEnabled),
);

const makeRecords = (category, mode) =>
	freeze(
		SUPPLIED_PROMPTS[category][mode].map((prompt, index) =>
			freeze({
				id: `${mode}-${category}-${String(index + 1).padStart(3, "0")}`,
				mode,
				category,
				text: prompt,
				minimumAge: CATEGORIES[category].minimumAge,
				contentRating: CATEGORIES[category].contentRating,
				requiresConsentReminder: CATEGORIES[category].requiresConsentReminder,
				locale: "en",
			}),
		),
	);

const truthByCategory = {};
const dareByCategory = {};

for (const category of CATEGORY_IDS) {
	truthByCategory[category] = makeRecords(category, "truth");
	dareByCategory[category] = makeRecords(category, "dare");
}

freeze(truthByCategory);
freeze(dareByCategory);

export const TRUTH_PROMPTS = freeze(
	CATEGORY_IDS.flatMap((category) => truthByCategory[category]),
);
export const DARE_PROMPTS = freeze(
	CATEGORY_IDS.flatMap((category) => dareByCategory[category]),
);
export const PROMPT_LIBRARY = freeze({
	truth: TRUTH_PROMPTS,
	dare: DARE_PROMPTS,
});

for (const mode of ["truth", "dare"]) {
	const prompts = PROMPT_LIBRARY[mode];
	if (
		new Set(prompts.map((prompt) => prompt.id)).size !== prompts.length ||
		new Set(prompts.map((prompt) => prompt.text)).size !== prompts.length
	) {
		throw new Error(`Supplied ${mode} library contains duplicate prompts.`);
	}
}

const normalizeMode = (mode = "mix") => {
	if (!PROMPT_MODES.includes(mode)) {
		throw new RangeError(`Unknown prompt mode “${mode}”. Use truth, dare, or mix.`);
	}
	return mode;
};

const normalizeCategories = (enabledCategories) => {
	if (enabledCategories == null) return DEFAULT_CATEGORY_IDS;

	let requested;
	if (typeof enabledCategories === "string") {
		requested = [enabledCategories];
	} else if (enabledCategories?.[Symbol.iterator]) {
		requested = Array.from(enabledCategories);
	} else if (typeof enabledCategories === "object" && enabledCategories !== null) {
		requested = Object.keys(enabledCategories).filter((key) => enabledCategories[key]);
	} else {
		throw new TypeError(
			"enabledCategories must be a category, iterable, or enabled-category map.",
		);
	}

	const unique = [...new Set(requested)];
	const unknown = unique.filter((category) => !CATEGORY_IDS.includes(category));
	if (unknown.length > 0) {
		throw new RangeError(
			`Unknown prompt ${unknown.length === 1 ? "category" : "categories"}: ${unknown.join(", ")}`,
		);
	}
	return freeze(CATEGORY_IDS.filter((category) => unique.includes(category)));
};

export function getPrompts({ mode = "mix", enabledCategories } = {}) {
	const normalizedMode = normalizeMode(mode);
	const categories = normalizeCategories(enabledCategories);
	const modes = normalizedMode === "mix" ? ["truth", "dare"] : [normalizedMode];
	const prompts = [];

	for (const selectedMode of modes) {
		const source = selectedMode === "truth" ? truthByCategory : dareByCategory;
		for (const category of categories) prompts.push(...source[category]);
	}
	return freeze(prompts);
}

const makeCounts = (mode, categories) => {
	const includeTruth = mode === "truth" || mode === "mix";
	const includeDare = mode === "dare" || mode === "mix";
	const byCategory = {};
	let truth = 0;
	let dare = 0;

	for (const category of CATEGORY_IDS) {
		const enabled = categories.includes(category);
		const truthCount = enabled && includeTruth ? truthByCategory[category].length : 0;
		const dareCount = enabled && includeDare ? dareByCategory[category].length : 0;
		truth += truthCount;
		dare += dareCount;
		byCategory[category] = freeze({
			truth: truthCount,
			dare: dareCount,
			total: truthCount + dareCount,
		});
	}
	return freeze({
		mode,
		enabledCategories: freeze([...categories]),
		truth,
		dare,
		total: truth + dare,
		byCategory: freeze(byCategory),
	});
};

export function getPromptCounts({ mode = "mix", enabledCategories } = {}) {
	return makeCounts(normalizeMode(mode), normalizeCategories(enabledCategories));
}

export const PROMPT_COUNTS = getPromptCounts({ enabledCategories: CATEGORY_IDS });

const randomIndex = (length, random) => {
	const sample = Number(random());
	if (!Number.isFinite(sample)) {
		throw new TypeError("The random function must return a finite number.");
	}
	const normalized = sample - Math.floor(sample);
	return Math.min(length - 1, Math.floor(normalized * length));
};

export function createPromptPicker(options = {}) {
	const config = typeof options === "function" ? { random: options } : options;
	const random = config.random ?? Math.random;
	const historySize = config.historySize ?? 24;
	if (typeof random !== "function") throw new TypeError("random must be a function.");
	if (!Number.isInteger(historySize) || historySize < 1) {
		throw new RangeError("historySize must be a positive integer.");
	}

	const recentIds = [];
	const pick = (selection = {}) => {
		const pool = getPrompts(selection);
		if (pool.length === 0) return null;

		const recent = new Set(recentIds);
		let candidates = pool.filter((prompt) => !recent.has(prompt.id));
		if (candidates.length === 0) {
			const immediatelyPrevious = recentIds.at(-1);
			candidates = pool.filter((prompt) => prompt.id !== immediatelyPrevious);
			if (candidates.length === 0) candidates = [...pool];
		}

		const chosen = candidates[randomIndex(candidates.length, random)];
		recentIds.push(chosen.id);
		if (recentIds.length > historySize) {
			recentIds.splice(0, recentIds.length - historySize);
		}
		return chosen;
	};

	const reset = () => {
		recentIds.length = 0;
	};
	const history = () => freeze([...recentIds]);
	return freeze({ pick, next: pick, reset, history });
}

const defaultPicker = createPromptPicker();

export function getRandomPrompt(options = {}) {
	return defaultPicker.pick(options);
}

export function resetPromptHistory() {
	defaultPicker.reset();
}
