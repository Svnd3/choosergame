export const ROOM_PROTOCOL_VERSION = 1;
export const MAX_ROOM_PLAYERS = 12;

const ROOM_SECRET_BYTES = 16;
const ROOM_SECRET_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const TRYSTERO_PEER_ID_PATTERN = /^[A-Za-z0-9]{20}$/;
const ROOM_HASH_PATTERN = /^#room=([A-Za-z0-9_-]{22})&host=([^&#=]+)$/;
const BASE64URL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

const noop = () => {};

function clampUnit(value) {
	return Math.min(1, Math.max(0, value));
}

function assertFiniteNumber(value, name) {
	if (!Number.isFinite(value)) {
		throw new TypeError(`${name} must be a finite number.`);
	}
}

function assertViewportSize(value, name) {
	assertFiniteNumber(value, name);
	if (value <= 0) throw new RangeError(`${name} must be greater than zero.`);
}

function encodeBase64Url(bytes) {
	let result = "";

	for (let index = 0; index < bytes.length; index += 3) {
		const remaining = bytes.length - index;
		const first = bytes[index];
		const second = remaining > 1 ? bytes[index + 1] : 0;
		const third = remaining > 2 ? bytes[index + 2] : 0;
		const value = (first << 16) | (second << 8) | third;

		result += BASE64URL_ALPHABET[(value >>> 18) & 63];
		result += BASE64URL_ALPHABET[(value >>> 12) & 63];
		if (remaining > 1) result += BASE64URL_ALPHABET[(value >>> 6) & 63];
		if (remaining > 2) result += BASE64URL_ALPHABET[value & 63];
	}

	return result;
}

export function createRoomSecret() {
	const cryptoApi = globalThis.crypto;
	if (typeof cryptoApi?.getRandomValues !== "function") {
		throw new Error("Secure random number generation is unavailable.");
	}

	const bytes = new Uint8Array(ROOM_SECRET_BYTES);
	cryptoApi.getRandomValues(bytes);
	return encodeBase64Url(bytes);
}

export function isValidRoomSecret(secret) {
	return typeof secret === "string" && ROOM_SECRET_PATTERN.test(secret);
}

export function parseRoomHash(hash = globalThis.location?.hash ?? "") {
	if (typeof hash !== "string") return null;
	const match = ROOM_HASH_PATTERN.exec(hash);
	if (!match || !isValidRoomSecret(match[1])) return null;

	let hostId;
	try {
		hostId = decodeURIComponent(match[2]);
	} catch {
		return null;
	}
	if (
		!TRYSTERO_PEER_ID_PATTERN.test(hostId) ||
		encodeURIComponent(hostId) !== match[2]
	) {
		return null;
	}

	return Object.freeze({ secret: match[1], hostId });
}

export function makeRoomUrl(
	secret,
	hostId,
	href = globalThis.location?.href,
) {
	if (!isValidRoomSecret(secret)) {
		throw new TypeError("A valid room secret is required.");
	}
	if (typeof hostId !== "string" || !TRYSTERO_PEER_ID_PATTERN.test(hostId)) {
		throw new TypeError("A valid Trystero host peer ID is required.");
	}
	if (typeof href !== "string" && !(href instanceof URL)) {
		throw new TypeError("A valid base URL is required.");
	}

	const url = new URL(href.toString());
	url.hash = `room=${secret}&host=${encodeURIComponent(hostId)}`;
	return url.toString();
}

export function normalizePoint(x, y, width, height) {
	assertFiniteNumber(x, "x");
	assertFiniteNumber(y, "y");
	assertViewportSize(width, "width");
	assertViewportSize(height, "height");

	return Object.freeze({
		nx: clampUnit(x / width),
		ny: clampUnit(y / height),
	});
}

export function denormalizePoint(nx, ny, width, height) {
	assertFiniteNumber(nx, "nx");
	assertFiniteNumber(ny, "ny");
	assertViewportSize(width, "width");
	assertViewportSize(height, "height");

	return Object.freeze({
		x: clampUnit(nx) * width,
		y: clampUnit(ny) * height,
	});
}

export function sanitizeFingerIntent(payload, peerId) {
	if (
		payload === null ||
		typeof payload !== "object" ||
		Array.isArray(payload) ||
		typeof peerId !== "string" ||
		peerId.length === 0
	) {
		return null;
	}

	const { type, id, seq } = payload;
	if (
		(type !== "down" && type !== "move" && type !== "up") ||
		typeof id !== "string" ||
		id.length > 96 ||
		!id.startsWith(`${peerId}:`) ||
		!Number.isSafeInteger(seq) ||
		seq < 0
	) {
		return null;
	}

	if (type === "up") return Object.freeze({ type, id, seq });

	const { nx, ny } = payload;
	if (
		!Number.isFinite(nx) ||
		!Number.isFinite(ny) ||
		nx < 0 ||
		nx > 1 ||
		ny < 0 ||
		ny > 1
	) {
		return null;
	}

	return Object.freeze({ type, id, seq, nx, ny });
}

function callbackOrNoop(callback) {
	return typeof callback === "function" ? callback : noop;
}

export async function connectRoom({
	secret,
	onPeerJoin,
	onPeerLeave,
	onState,
	onIntent,
	onError,
} = {}) {
	if (!isValidRoomSecret(secret)) {
		throw new TypeError("A valid room secret is required.");
	}

	const handlePeerJoin = callbackOrNoop(onPeerJoin);
	const handlePeerLeave = callbackOrNoop(onPeerLeave);
	const handleState = callbackOrNoop(onState);
	const handleIntent = callbackOrNoop(onIntent);
	const handleError = callbackOrNoop(onError);

	const { joinRoom, selfId } = await import(
		"https://esm.sh/trystero@0.25.3?bundle"
	);
	const room = joinRoom(
		{
			appId: "choosergame.vercel.app/realtime/v1",
			password: secret,
			relayConfig: {
				redundancy: 3,
				warnOnRelayFailure: false,
			},
		},
		`chooser-${secret}`,
		{ onJoinError: handleError },
	);
	const stateAction = room.makeAction("state-v1");
	const intentAction = room.makeAction("intent-v1");

	room.onPeerJoin = handlePeerJoin;
	room.onPeerLeave = handlePeerLeave;
	stateAction.onMessage = (data, metadata = {}) =>
		handleState(data, metadata.peerId);
	intentAction.onMessage = (data, metadata = {}) =>
		handleIntent(data, metadata.peerId);

	return {
		selfId,
		getPeerIds: () => Object.keys(room.getPeers()),
		sendState(data, target) {
			return target == null
				? stateAction.send(data)
				: stateAction.send(data, { target });
		},
		sendIntent(data, target) {
			if (typeof target !== "string" || target.length === 0) {
				return Promise.reject(new TypeError("A target peer ID is required."));
			}
			return intentAction.send(data, { target });
		},
		leave: () => room.leave(),
	};
}
