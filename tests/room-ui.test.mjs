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
		/<strong>Standard<\/strong><small>64 truths \+ 113 dares<\/small>/,
	);
	assert.match(scriptSource, /Keep at least one deck selected\./);
});

test("shared-room entry accepts only exact 2–4 digit convenience codes", () => {
	assert.match(htmlSource, /type="text"[\s\S]*?inputmode="numeric"/);
	assert.match(htmlSource, /minlength="2"/);
	assert.doesNotMatch(htmlSource, /maxlength="4"/);
	assert.match(htmlSource, /pattern="\[0-9\]\{2,4\}"/);
	assert.match(htmlSource, /placeholder="42"/);
	assert.match(scriptSource, /const code = normalizeRoomCode\(value\);/);
	assert.doesNotMatch(scriptSource, /replace\(\/\[\^0-9\]/);
	assert.match(scriptSource, /Enter a 2–4 digit room code\./);
});

test("shared rooms resynchronize after a mobile browser returns", () => {
	assert.doesNotMatch(scriptSource, /ROOM_HOST_RECONNECT_GRACE_MS/);
	assert.doesNotMatch(scriptSource, /The link creator closed the room/);
	assert.match(scriptSource, /function resumeSharedRoomConnection\(\)/);
	assert.match(
		scriptSource,
		/document\.addEventListener\("visibilitychange", \(\) => \{[\s\S]*?else resumeSharedRoomConnection\(\);[\s\S]*?\}\);/,
	);
	assert.match(scriptSource, /window\.addEventListener\("pageshow",/);
	assert.match(scriptSource, /window\.addEventListener\("online", resumeSharedRoomConnection\);/);
});

test("room-code joins reuse their live peer and never fail on a fixed timer", () => {
	const slowJoinHandler = scriptSource.match(
		/function startRoomJoinTimeout\(connectionAttempt\) \{[\s\S]*?\n\}\n\nfunction setRoomMode/,
	)?.[0];

	assert.ok(slowJoinHandler);
	assert.doesNotMatch(scriptSource, /ROOM_JOIN_TIMEOUT_MS/);
	assert.doesNotMatch(slowJoinHandler, /roomTransport\?\.leave|roomTransport = null/);
	assert.doesNotMatch(slowJoinHandler, /setRoomMode\(\s*"error"/);
	assert.match(slowJoinHandler, /Still connecting automatically/);
	assert.match(slowJoinHandler, /startRoomJoinTimeout\(connectionAttempt\)/);
	assert.match(scriptSource, /keepAlive: true/);
	assert.match(scriptSource, /invite\.authKey,\s*invite,\s*\);/);
	assert.match(
		scriptSource,
		/peerId === roomHostPeerId\)[\s\S]*?releaseRoomCodeRendezvous\(rendezvous\)/,
	);
});
