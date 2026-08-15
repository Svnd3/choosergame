import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [htmlSource, scriptSource, styleSource] = await Promise.all([
	readFile(new URL("../src/index.html", import.meta.url), "utf8"),
	readFile(new URL("../src/index.js", import.meta.url), "utf8"),
	readFile(new URL("../src/index.css", import.meta.url), "utf8"),
]);

test("the help control is accessible from the initial screen", () => {
	assert.match(htmlSource, /id="help-button"/);
	assert.match(htmlSource, /aria-label="Open game rules and navigation guide"/);
	assert.match(htmlSource, /aria-controls="help-dialog"/);
	assert.match(styleSource, /--help-red: #ff315f/);
	assert.doesNotMatch(
		styleSource,
		/body\[data-game-state="idle"\] \.topbar[\s\S]*?display: none !important/,
	);
});

test("the guide contains rules and accurate navigation help", () => {
	assert.match(htmlSource, /<dialog[\s\S]*?id="help-dialog"/);
	assert.match(htmlSource, /Choose on one screen/);
	assert.match(htmlSource, /Play across phones/);
	assert.match(htmlSource, /Find your way around/);
	assert.match(htmlSource, /Keep it fair/);
	assert.match(htmlSource, /Shared rooms support up to 12 active fingers/);
	assert.match(htmlSource, /local games work offline/);
});

test("the help dialog opens, closes, and blocks board input", () => {
	const openHelpSource = scriptSource.slice(
		scriptSource.indexOf("function openHelp()"),
		scriptSource.indexOf("function closeHelp()"),
	);

	assert.match(scriptSource, /helpButton\.addEventListener\("click", openHelp\)/);
	assert.match(scriptSource, /helpClose\.addEventListener\("click", closeHelp\)/);
	assert.match(scriptSource, /helpDialog\.showModal\(\)/);
	assert.match(scriptSource, /helpDialog\.open \|\| settingsDialog\.open/);
	assert.match(
		scriptSource,
		/if \(event\.target === helpDialog\) closeHelp\(\)/,
	);
	assert.doesNotMatch(openHelpSource, /prepareNextRound|broadcastRoomSnapshot/);
});
