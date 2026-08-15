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

test("shared-room card uses local system font fallbacks", () => {
	assert.doesNotMatch(styleSource, /@font-face/);
	assert.doesNotMatch(styleSource, /url\("fonts\//);
	assert.match(
		styleSource,
		/\.room-header h2 \{[\s\S]*?font-family: Impact, Haettenschweiler, "Arial Narrow Bold", sans-serif;/,
	);
	assert.match(
		styleSource,
		/#room-dialog \{[\s\S]*?font-family: ui-rounded, "Avenir Next", "Segoe UI", sans-serif;/,
	);
});
