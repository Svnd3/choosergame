import assert from "node:assert/strict";
import test from "node:test";

import {
	MAX_ROOM_PLAYERS,
	ROOM_PROTOCOL_VERSION,
	createRoomSecret,
	denormalizePoint,
	isValidRoomSecret,
	makeRoomUrl,
	normalizePoint,
	parseRoomHash,
	sanitizeFingerIntent,
} from "../src/room.js";

test("room protocol constants stay compatible", () => {
	assert.equal(ROOM_PROTOCOL_VERSION, 1);
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
	assert.deepEqual(parseRoomHash(url.hash), { secret, hostId });
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
