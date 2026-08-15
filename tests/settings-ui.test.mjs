import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [htmlSource, scriptSource, styleSource] = await Promise.all([
	readFile(new URL("../src/index.html", import.meta.url), "utf8"),
	readFile(new URL("../src/index.js", import.meta.url), "utf8"),
	readFile(new URL("../src/index.css", import.meta.url), "utf8"),
]);

test("Naughty Mode is visible, adults-only, consent-forward, and off by default", () => {
	const naughtyToggle = htmlSource.match(/<input\s+id="naughty-toggle"[\s\S]*?\/>/)?.[0];

	assert.match(
		htmlSource,
		/<strong id="naughty-mode-label">Naughty Mode <em>18\+<\/em><\/strong>/,
	);
	assert.match(htmlSource, /4 adult truths \+ 40 really naughty dares/);
	assert.ok(naughtyToggle);
	assert.match(
		naughtyToggle,
		/id="naughty-toggle"[\s\S]*?type="checkbox"[\s\S]*?name="category"[\s\S]*?value="naughty"[\s\S]*?aria-labelledby="naughty-mode-label"[\s\S]*?aria-describedby="naughty-mode-description"/,
	);
	assert.doesNotMatch(naughtyToggle, /\bchecked\b/);
	assert.match(htmlSource, /Naughty Mode is for consenting adults\. Anyone can pass\./);
	assert.match(styleSource, /\.category-option em \{/);
});

test("Naughty Mode uses the persisted category and host-controlled room pipeline", () => {
	assert.match(scriptSource, /categories: \["photos"\]/);
	assert.match(
		scriptSource,
		/querySelectorAll\('input\[name="mode"\], input\[name="category"\]'\)/,
	);
	assert.match(scriptSource, /categories: roomWireCategories\(settings\.categories\)/);
	assert.match(scriptSource, /\.map\(\(category\) => toLocalRoomCategory\(category\)\)/);
	assert.match(
		scriptSource,
		/promptPicker\.pick\(\{[\s\S]*?enabledCategories: settings\.categories/,
	);
});
