import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile } from "node:fs/promises";
import test from "node:test";

import {
	MAX_ROOM_PLAYERS,
	ROOM_PROTOCOL_VERSION,
	claimShortestRoomCode,
	createRoomCode,
	createRoomCredentials,
	createRoomSecret,
	denormalizePoint,
	deriveRoomSecret,
	formatRoomCode,
	getRoomResumeAction,
	isValidRoomSecret,
	makeRoomUrl,
	normalizeRoomCode,
	normalizePoint,
	parseRoomHash,
	resolveRoomCode,
	roomUrlRequiresAuth,
	sanitizeFingerIntent,
	signRoomSnapshot,
	verifyRoomSnapshot,
} from "../src/room.js";

const VENDOR_BUNDLE_URL = new URL(
	"../src/vendor/trystero-nostr-0.25.3.js",
	import.meta.url,
);

test("room protocol isolates clients without numeric-code or Naughty Mode support", () => {
	assert.equal(ROOM_PROTOCOL_VERSION, 5);
	assert.equal(MAX_ROOM_PLAYERS, 12);
});

test("room resume actions preserve backgrounded shared sessions", () => {
	const connectedGuest = {
		hidden: false,
		roomMode: "connected",
		roomRole: "guest",
		hasSecret: true,
		hasTransport: true,
		hasHostPeer: true,
	};

	assert.equal(getRoomResumeAction(connectedGuest), "sync");
	assert.equal(getRoomResumeAction({ ...connectedGuest, hidden: true }), null);
	assert.equal(getRoomResumeAction({ ...connectedGuest, hasHostPeer: false }), "wait");
	assert.equal(getRoomResumeAction({ ...connectedGuest, roomRole: "host" }), "broadcast");
	assert.equal(getRoomResumeAction({ ...connectedGuest, roomMode: "local" }), null);
	assert.equal(getRoomResumeAction({ ...connectedGuest, hasTransport: false }), null);
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

test("room codes preserve exact 2–4 digit strings and leading zeroes", () => {
	for (const code of ["00", "09", "42", "000", "007", "999", "0000", "0042", "9999"]) {
		assert.equal(normalizeRoomCode(code), code);
		assert.equal(formatRoomCode(code), code);
	}
	for (const invalid of ["", "0", "12345", "1A", "12.3", "+12", " 12", null]) {
		assert.equal(normalizeRoomCode(invalid), null);
		assert.equal(formatRoomCode(invalid), null);
	}

	for (const length of [2, 3, 4]) {
		const codes = Array.from({ length: 64 }, () => createRoomCode(length));
		for (const code of codes) assert.match(code, new RegExp(`^\\d{${length}}$`));
	}
	assert.throws(() => createRoomCode(1), RangeError);
	assert.throws(() => createRoomCode(5), RangeError);
});

test("room-code rendezvous secrets are deterministic and length-sensitive", async () => {
	const first = await deriveRoomSecret("00");
	const repeated = await deriveRoomSecret("00");
	const variants = await Promise.all(["000", "0000", "42", "042", "0042"].map(deriveRoomSecret));

	assert.equal(first, "GhPABEiaIsznvmkHjxdJ0g");
	assert.equal(first, repeated);
	assert.equal(isValidRoomSecret(first), true);
	assert.equal(new Set([first, ...variants]).size, variants.length + 1);
	for (const secret of variants) assert.equal(isValidRoomSecret(secret), true);
	await assert.rejects(() => deriveRoomSecret("0"), TypeError);
	await assert.rejects(() => deriveRoomSecret("12345"), TypeError);
});

test("2–4 digit room codes authenticate signed host snapshots", async () => {
	for (const length of [2, 3, 4]) {
		const credentials = await createRoomCredentials(length);
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
		const derivedRendezvousSecret = await deriveRoomSecret(credentials.code);

		assert.match(credentials.code, new RegExp(`^\\d{${length}}$`));
		assert.equal(isValidRoomSecret(credentials.secret), true);
		assert.notEqual(credentials.secret, derivedRendezvousSecret);
		assert.equal(await verifyRoomSnapshot(signed, credentials.code), true);
		assert.equal(
			await verifyRoomSnapshot(signed, credentials.code, credentials.publicKey),
			true,
		);
		assert.equal(await verifyRoomSnapshot(signed, credentials.code, "different-key"), false);
		assert.equal(
			await verifyRoomSnapshot({ ...signed, sequence: 2 }, credentials.code),
			false,
		);
		assert.equal(await verifyRoomSnapshot(signed, otherCode), false);
		assert.equal(await verifyRoomSnapshot({ ...signed, authSig: "broken" }, credentials.code), false);
	}
});

test("room-code claims use 2 digits when no live collision is observed", async () => {
	const hostId = "HostPeer0123456789Ab";
	const requestedLengths = [];
	let left = false;
	const claim = await claimShortestRoomCode({
		createCredentials: async (length) => {
			requestedLengths.push(length);
			return {
				code: "07",
				secret: createRoomSecret(),
				privateKey: {},
				publicKey: "test-public-key",
			};
		},
		deriveSecret: async () => createRoomSecret(),
		signSnapshot: async (snapshot) => snapshot,
		verifySnapshot: async () => true,
		wait: async () => {},
		claimWaitMs: 0,
		connect: async () => ({
			selfId: hostId,
			getPeerIds: () => [],
			sendState: async () => {},
			sendSync: async () => {},
			leave() {
				left = true;
			},
		}),
	});

	assert.deepEqual(requestedLengths, [2]);
	assert.equal(claim.credentials.code, "07");
	await claim.activate();
	claim.leave();
	assert.equal(left, true);
});

test("room-code claims fall back through 3 to 4 after live collisions", async () => {
	const hostId = "HostPeer0123456789Ab";
	const codeByLength = { 2: "07", 3: "007", 4: "0007" };
	const opened = [];
	const credentialsRequested = [];
	const credentialsFor = async (length) => {
		credentialsRequested.push(length);
		return {
			code: codeByLength[length],
			secret: createRoomSecret(),
			privateKey: {},
			publicKey: "test-public-key",
		};
	};
	const connect = async (options) => {
		const attempt = opened.length;
		const record = { channel: options.channel, left: false };
		opened.push(record);
		if (attempt < 2) options.onPeerJoin(hostId);
		return {
			selfId: hostId,
			getPeerIds: () => [],
			sendState: async () => {},
			sendSync: async () => {},
			leave() {
				record.left = true;
			},
		};
	};

	const claim = await claimShortestRoomCode({
		connect,
		createCredentials: credentialsFor,
		deriveSecret: async () => createRoomSecret(),
		signSnapshot: async (snapshot) => snapshot,
		verifySnapshot: async () => true,
		wait: async () => {},
		claimWaitMs: 0,
		fourDigitAttempts: 1,
	});

	assert.deepEqual(credentialsRequested, [2, 3, 4]);
	assert.equal(claim.credentials.code, "0007");
	assert.deepEqual(opened.map(({ channel }) => channel), ["code", "code", "code"]);
	assert.deepEqual(opened.map(({ left }) => left), [true, true, false]);
	await claim.activate();
	claim.leave();
	assert.equal(opened[2].left, true);
});

test("room-code resolution accepts a verified signed host invite", async () => {
	const code = "07";
	const hostId = "HostPeer0123456789Ab";
	const secret = createRoomSecret();
	let left = false;
	let request = null;
	let derivedCode = null;
	const invite = {
		version: ROOM_PROTOCOL_VERSION,
		kind: "room-code-invite-v5",
		code,
		secret,
		hostId,
		authKey: "test-public-key",
		authSig: "test-signature",
	};
	const connect = async (options) => ({
		selfId: "GuestPeer0123456789A",
		getPeerIds: () => [hostId],
		sendState: async () => {},
		async sendSync(target, payload) {
			request = { target, payload };
			options.onState(invite, hostId);
		},
		leave() {
			left = true;
		},
	});

	const result = await resolveRoomCode(code, {
		connect,
		deriveSecret: async (value) => {
			derivedCode = value;
			return createRoomSecret();
		},
		verifySnapshot: async (payload, expectedCode) =>
			payload === invite && expectedCode === code,
		wait: async () => {},
		timeoutMs: 0,
	});

	assert.deepEqual(result, { secret, hostId, authKey: invite.authKey });
	assert.equal(Object.isFrozen(result), true);
	assert.equal(derivedCode, code);
	assert.equal(request.target, hostId);
	assert.equal(request.payload.kind, "room-code-resolve-v5");
	assert.equal(request.payload.code, code);
	assert.equal(left, true);
	await assert.rejects(() => resolveRoomCode("7"), TypeError);
});

test("room-code resolution retains one live peer until the game room attaches", async () => {
	const code = "42";
	const hostId = "HostPeer0123456789Ab";
	const secret = createRoomSecret();
	const invite = {
		version: ROOM_PROTOCOL_VERSION,
		kind: "room-code-invite-v5",
		code,
		secret,
		hostId,
		authKey: "test-public-key",
		authSig: "test-signature",
	};
	const openRetainedInvite = async (signal, onLeave) =>
		resolveRoomCode(code, {
			signal,
			keepAlive: true,
			connect: async (options) => ({
				selfId: "GuestPeer0123456789A",
				getPeerIds: () => [hostId],
				sendState: async () => {},
				async sendSync() {
					options.onState(invite, hostId);
				},
				leave: onLeave,
			}),
			deriveSecret: async () => createRoomSecret(),
			verifySnapshot: async () => true,
			wait: () => new Promise(() => {}),
		});

	let explicitLeaves = 0;
	const retained = await openRetainedInvite(undefined, () => {
		explicitLeaves += 1;
	});
	assert.equal(typeof retained.release, "function");
	assert.equal(Object.isFrozen(retained), true);
	assert.equal(explicitLeaves, 0);
	await retained.release();
	await retained.release();
	assert.equal(explicitLeaves, 1);

	let abortedLeaves = 0;
	const controller = new AbortController();
	await openRetainedInvite(controller.signal, () => {
		abortedLeaves += 1;
	});
	controller.abort();
	assert.equal(abortedLeaves, 1);
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

test("room transport shares v5 peers across game/code channels and is cached by v26", async () => {
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
	assert.doesNotMatch(roomSource, /hornetstorage\.net/);
	assert.match(roomSource, /nostr-relay\.corb\.net/);
	assert.match(roomSource, /ROOM_CODE_RESOLVE_WAIT_MS = 15000/);
	assert.match(roomSource, /appId:\s*"choosergame\.vercel\.app\/realtime\/v5"/);
	assert.match(roomSource, /`chooser-v5-\$\{channel\}-\$\{secret\}`/);
	assert.match(roomSource, /makeAction\(`\$\{channel\}-state-v5`\)/);
	assert.match(roomSource, /makeAction\(`\$\{channel\}-intent-v5`\)/);
	assert.match(roomSource, /makeAction\(`\$\{channel\}-sync-v5`\)/);
	assert.match(roomSource, /sendSync\(target, data = null\)/);
	assert.match(roomSource, /handleSync\(data, metadata\.peerId\)/);
	assert.match(roomSource, /syncAction\.send\(data, \{ target \}\)/);
	assert.match(workerSource, /CACHE_NAME = `\$\{CACHE_PREFIX\}v26`/);
	assert.match(workerSource, /"vendor\/trystero-nostr-0\.25\.3\.js"/);
	assert.match(workerSource, /"fonts\/nok\.otf"/);
	assert.match(vendorNote, /59,959-byte ESM bundle/);
	assert.match(
		vendorNote,
		/673ed5914efae7a34eedeb4dc54f3ec18260a9c485874a822b065ee611992640/,
	);
});
