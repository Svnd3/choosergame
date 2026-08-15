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

test("shared-room card loads and applies the supplied display fonts", () => {
	assert.match(styleSource, /font-family: "Bombing";/);
	assert.match(styleSource, /url\("fonts\/bombing-regular\.ttf"\)/);
	assert.match(styleSource, /url\("fonts\/papernotes-regular\.woff2"\)/);
	assert.match(styleSource, /url\("fonts\/papernotes-bold\.woff2"\)/);
	assert.match(
		styleSource,
		/\.room-header h2 \{[\s\S]*?font-family: "Bombing", Impact, sans-serif;/,
	);
	assert.match(
		styleSource,
		/#room-dialog \{[\s\S]*?font-family: "Papernotes", "Segoe UI", sans-serif;/,
	);
});
