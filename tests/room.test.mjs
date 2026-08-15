import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	MAX_ROOM_PLAYERS,
	ROOM_PROTOCOL_VERSION,
	createRoomCode,
	createRoomCredentials,
	createRoomSecret,
	denormalizePoint,
	deriveRoomSecret,
	formatRoomCode,
	isValidRoomSecret,
	makeRoomUrl,
	normalizeRoomCode,
	normalizePoint,
	parseRoomHash,
	roomUrlRequiresAuth,
	sanitizeFingerIntent,
	signRoomSnapshot,
	verifyRoomSnapshot,
} from "../src/room.js";

const VENDOR_BUNDLE_URL = new URL(
	"../src/vendor/trystero-nostr-0.25.3.js",
	import.meta.url,
);

test("room protocol constants stay compatible", () => {
	assert.equal(ROOM_PROTOCOL_VERSION, 2);
	assert.equal(MAX_ROOM_PLAYERS, 12);
});

test("room secrets are random 128-bit base64url values", () => {
	const secrets = Array.from({ length: 128 }, createRoomSecret);

	for (const secret of secrets) {
		assert.match(secret, /^[A-Za-z0-9_-]{22}$/);
		assert.equal(isValidRoomSecret(secret), true);
	}
	assert.equal(new Set(secrets).size, secrets.length);
});

test("room secret validation rejects malformed values", () => {
	assert.equal(isValidRoomSecret(null), false);
	assert.equal(isValidRoomSecret(""), false);
	assert.equal(isValidRoomSecret("a".repeat(21)), false);
	assert.equal(isValidRoomSecret("a".repeat(23)), false);
	assert.equal(isValidRoomSecret(`${"a".repeat(21)}+`), false);
});

test("room codes are random, normalized, and friend-readable", () => {
	const codes = Array.from({ length: 128 }, createRoomCode);

	for (const code of codes) {
		assert.match(code, /^[0-9A-HJKMNP-TV-Z]{6}$/);
		assert.equal(normalizeRoomCode(formatRoomCode(code)), code);
		assert.equal(formatRoomCode(code), code);
	}
	assert.equal(new Set(codes).size, codes.length);
	assert.equal(normalizeRoomCode("o1-il2a"), "01112A");
	assert.equal(normalizeRoomCode("ABC-12"), null);
	assert.equal(normalizeRoomCode("ABCDU1"), null);
	assert.equal(normalizeRoomCode(null), null);
	assert.equal(formatRoomCode("not a code"), null);
});

test("room codes deterministically derive valid private room secrets", async () => {
	const first = await deriveRoomSecret("A1B2C3");
	const repeated = await deriveRoomSecret("a1b-2c3");
	const second = await deriveRoomSecret("A1B2C4");

	assert.equal(first, "OGSnRUma3CZJwgDkfaD9ng");
	assert.equal(first, repeated);
	assert.equal(isValidRoomSecret(first), true);
	assert.notEqual(first, second);
	await assert.rejects(() => deriveRoomSecret("incomplete"), TypeError);
});

test("room codes authenticate signed host snapshots", async () => {
	const credentials = await createRoomCredentials();
	const snapshot = {
		version: ROOM_PROTOCOL_VERSION,
		kind: "snapshot",
		sequence: 1,
		hostPeerId: "HostPeer0123456789Ab",
		authChallenge: createRoomSecret(),
		authTargetPeerId: "GuestPeer0123456789A",
	};
	const signed = await signRoomSnapshot(snapshot, credentials);
	const otherCode = `${credentials.code.slice(0, -1)}${credentials.code.endsWith("0") ? "1" : "0"}`;

	assert.match(credentials.code, /^[0-9A-HJKMNP-TV-Z]{6}$/);
	assert.equal(isValidRoomSecret(credentials.secret), true);
	assert.equal(await verifyRoomSnapshot(signed, credentials.code), true);
	assert.equal(
		await verifyRoomSnapshot({ ...signed, sequence: 2 }, credentials.code),
		false,
	);
	assert.equal(await verifyRoomSnapshot(signed, otherCode), false);
	assert.equal(await verifyRoomSnapshot({ ...signed, authSig: "broken" }, credentials.code), false);
});

test("room hashes parse only the exact supported fragment", () => {
	const secret = "Abcdefghijklmnopqrstu_";
	const hostId = "HostPeer0123456789Ab";
	const parsed = parseRoomHash(`#room=${secret}&host=${hostId}`);

	assert.deepEqual(parsed, { secret, hostId });
	assert.equal(Object.isFrozen(parsed), true);
	assert.equal(parseRoomHash(`#room=${secret}`), null);
	assert.equal(parseRoomHash(`room=${secret}&host=${hostId}`), null);
	assert.equal(parseRoomHash(`#host=${hostId}&room=${secret}`), null);
	assert.equal(parseRoomHash(`#room=${secret}&host=${hostId}&extra=true`), null);
	assert.equal(parseRoomHash(`#room=${secret}&host=${hostId}&host=${hostId}`), null);
	assert.equal(parseRoomHash(`#other=${secret}&host=${hostId}`), null);
	assert.equal(parseRoomHash(`#room=not-a-valid-secret&host=${hostId}`), null);
	assert.equal(parseRoomHash(`#room=${secret}&host=${"a".repeat(19)}`), null);
	assert.equal(parseRoomHash(`#room=${secret}&host=${"a".repeat(21)}`), null);
	assert.equal(parseRoomHash(`#room=${secret}&host=Host-Peer0123456789A`), null);
	assert.equal(parseRoomHash(`#room=${secret}&host=%48ostPeer0123456789Ab`), null);
	assert.equal(parseRoomHash(`#room=${secret}&host=%`), null);
	assert.equal(parseRoomHash(null), null);
});

test("room URL generation preserves path and query while replacing the hash", () => {
	const secret = "Abcdefghijklmnopqrstu_";
	const hostId = "HostPeer0123456789Ab";
	const result = makeRoomUrl(
		secret,
		hostId,
		"https://example.com/play/together?theme=neon&sound=on#old-fragment",
	);
	const url = new URL(result);

	assert.equal(url.origin, "https://example.com");
	assert.equal(url.pathname, "/play/together");
	assert.equal(url.search, "?theme=neon&sound=on");
	assert.equal(url.hash, `#room=${secret}&host=${hostId}`);
	assert.equal(roomUrlRequiresAuth(url), false);
	assert.deepEqual(parseRoomHash(url.hash), { secret, hostId });

	const authenticatedUrl = new URL(makeRoomUrl(secret, hostId, url, true));
	assert.equal(authenticatedUrl.searchParams.get("room-auth"), "1");
	assert.equal(roomUrlRequiresAuth(authenticatedUrl), true);
	assert.equal(roomUrlRequiresAuth("not a URL"), false);
	assert.equal(roomUrlRequiresAuth(null), false);
	assert.equal(new URL(makeRoomUrl(secret, hostId, authenticatedUrl)).search, url.search);
	assert.throws(() => makeRoomUrl("bad", hostId, result), TypeError);
	assert.throws(() => makeRoomUrl(secret, "short", result), TypeError);
	assert.throws(() => makeRoomUrl(secret, "Host-Peer0123456789A", result), TypeError);
	assert.throws(() => makeRoomUrl(secret, result), TypeError);
});

test("coordinates normalize, clamp, and round-trip across viewports", () => {
	assert.deepEqual(normalizePoint(250, 150, 1000, 600), {
		nx: 0.25,
		ny: 0.25,
	});
	assert.deepEqual(normalizePoint(-20, 900, 1000, 600), { nx: 0, ny: 1 });
	assert.deepEqual(denormalizePoint(-0.2, 1.4, 400, 800), { x: 0, y: 800 });

	const normalized = normalizePoint(378, 412, 1080, 1920);
	const point = denormalizePoint(normalized.nx, normalized.ny, 1080, 1920);
	assert.ok(Math.abs(point.x - 378) < Number.EPSILON * 1080);
	assert.ok(Math.abs(point.y - 412) < Number.EPSILON * 1920);
});

test("valid finger intents are minimized and frozen", () => {
	const down = sanitizeFingerIntent(
		{
			type: "down",
			id: "peer-a:pointer-7",
			seq: 0,
			nx: 0.25,
			ny: 1,
			ignored: "peer-controlled extra data",
		},
		"peer-a",
	);
	const up = sanitizeFingerIntent(
		{
			type: "up",
			id: "peer-a:pointer-7",
			seq: Number.MAX_SAFE_INTEGER,
			nx: 0.8,
			ny: 0.2,
		},
		"peer-a",
	);

	assert.deepEqual(down, {
		type: "down",
		id: "peer-a:pointer-7",
		seq: 0,
		nx: 0.25,
		ny: 1,
	});
	assert.equal(Object.isFrozen(down), true);
	assert.deepEqual(up, {
		type: "up",
		id: "peer-a:pointer-7",
		seq: Number.MAX_SAFE_INTEGER,
	});
	assert.equal(Object.isFrozen(up), true);
});

test("invalid and sender-spoofed finger intents are rejected", () => {
	const peerId = "peer-a";
	const validMove = {
		type: "move",
		id: `${peerId}:pointer-1`,
		seq: 4,
		nx: 0.4,
		ny: 0.6,
	};

	assert.deepEqual(sanitizeFingerIntent(validMove, peerId), validMove);
	assert.equal(
		sanitizeFingerIntent({ ...validMove, id: "peer-b:pointer-1" }, peerId),
		null,
	);
	assert.equal(sanitizeFingerIntent({ ...validMove, type: "tap" }, peerId), null);
	assert.equal(sanitizeFingerIntent({ ...validMove, seq: -1 }, peerId), null);
	assert.equal(sanitizeFingerIntent({ ...validMove, seq: 1.5 }, peerId), null);
	assert.equal(sanitizeFingerIntent({ ...validMove, nx: Infinity }, peerId), null);
	assert.equal(sanitizeFingerIntent({ ...validMove, ny: 1.01 }, peerId), null);
	assert.equal(
		sanitizeFingerIntent({ ...validMove, id: `${peerId}:${"x".repeat(100)}` }, peerId),
		null,
	);
	assert.equal(
		sanitizeFingerIntent(
		{ type: "down", id: `${peerId}:pointer-1`, seq: 5, nx: 0.2 },
		peerId,
		),
		null,
	);
	assert.equal(sanitizeFingerIntent(null, peerId), null);
	assert.equal(sanitizeFingerIntent([validMove], peerId), null);
});

test("vendored Trystero is the exact pinned ESM artifact", async () => {
	const bundle = await readFile(VENDOR_BUNDLE_URL);

	assert.equal(bundle.byteLength, 59_959);
	assert.equal(
		createHash("sha256").update(bundle).digest("hex"),
		"673ed5914efae7a34eedeb4dc54f3ec18260a9c485874a822b065ee611992640",
	);
	assert.match(bundle.toString("utf8"), /Bundled license information/);
});

test("room transport loads locally with eight fixed relays and is cached by v22", async () => {
	const [roomSource, workerSource, vendorNote] = await Promise.all([
		readFile(new URL("../src/room.js", import.meta.url), "utf8"),
		readFile(new URL("../src/sw.js", import.meta.url), "utf8"),
		readFile(new URL("../src/vendor/README.md", import.meta.url), "utf8"),
	]);

	assert.match(
		roomSource,
		/import\(\s*["']\.\/vendor\/trystero-nostr-0\.25\.3\.js["']\s*\)/,
	);
	assert.doesNotMatch(roomSource, /https:\/\/esm\.sh\/trystero/);
	assert.equal(roomSource.match(/"wss:\/\//g)?.length, 8);
	assert.match(roomSource, /urls:\s*ROOM_RELAY_URLS/);
	assert.doesNotMatch(roomSource, /communities\.nos\.social/);
	assert.match(roomSource, /appId:\s*["']choosergame\.vercel\.app\/realtime\/v2["']/);
	assert.match(roomSource, /`chooser-v2-\$\{secret\}`/);
	assert.match(roomSource, /makeAction\(["']state-v2["']\)/);
	assert.match(roomSource, /makeAction\(["']intent-v2["']\)/);
	assert.match(roomSource, /makeAction\(["']sync-v2["']\)/);
	assert.match(roomSource, /sendSync\(target, data = null\)/);
	assert.match(roomSource, /handleSync\(data, metadata\.peerId\)/);
	assert.match(roomSource, /syncAction\.send\(data, \{ target \}\)/);
	assert.match(workerSource, /CACHE_NAME = `\$\{CACHE_PREFIX\}v22`/);
	assert.match(workerSource, /"vendor\/trystero-nostr-0\.25\.3\.js"/);
	assert.match(workerSource, /"fonts\/nok\.otf"/);
	assert.match(vendorNote, /59,959-byte ESM bundle/);
	assert.match(
		vendorNote,
		/673ed5914efae7a34eedeb4dc54f3ec18260a9c485874a822b065ee611992640/,
	);
});
