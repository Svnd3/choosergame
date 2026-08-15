import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import test from "node:test";

const [htmlSource, scriptSource, styleSource] = await Promise.all([
	readFile(new URL("../src/index.html", import.meta.url), "utf8"),
	readFile(new URL("../src/index.js", import.meta.url), "utf8"),
	readFile(new URL("../src/index.css", import.meta.url), "utf8"),
]);

test("shared-room badge renders only its numeric device count", () => {
	assert.match(htmlSource, /<span id="room-device-count">1<\/span>/);
	assert.doesNotMatch(htmlSource, /room-status-button-dot/);
	assert.match(scriptSource, /roomDeviceCount\.textContent = String\(visibleTotal\)/);
	assert.match(
		scriptSource,
		/`Open shared room details, \$\{deviceLabel\} connected`/,
	);
});

test("the wordmark uses Nok while the shared-room card keeps system fonts", () => {
	assert.match(styleSource, /@font-face \{[\s\S]*?font-family: "Nok";/);
	assert.match(styleSource, /src: url\("fonts\/nok\.otf"\) format\("opentype"\);/);
	assert.match(
		styleSource,
		/\.brand \{[\s\S]*?font-family: "Nok", "Segoe Print", "Bradley Hand", cursive;/,
	);
	assert.match(
		styleSource,
		/\.room-header h2 \{[\s\S]*?font-family: Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif;/,
	);
	assert.match(
		styleSource,
		/#room-dialog \{[\s\S]*?font-family: ui-rounded, "Avenir Next", "Segoe UI", sans-serif;/,
	);
});

test("the visible product branding is Pick and Do", () => {
	assert.match(htmlSource, /<title>Pick and Do — Finger Picker<\/title>/);
	assert.match(
		htmlSource,
		/<p class="brand" aria-label="Pick and Do">Pick <span>and<\/span> Do<\/p>/,
	);
	assert.match(
		htmlSource,
		/<strong>Full deck<\/strong><small>119 included prompts<\/small>/,
	);
	assert.match(scriptSource, /Keep the full deck selected\./);
});

test("shared-room entry uses compact six-character codes", () => {
	assert.match(htmlSource, /maxlength="6"/);
	assert.match(htmlSource, /placeholder="A7K9P2"/);
	assert.match(scriptSource, /\.slice\(0, 6\)/);
	assert.match(scriptSource, /Enter the complete 6-character room code\./);
	assert.doesNotMatch(htmlSource, /ABCD-EFGH-JKMP/);
});
