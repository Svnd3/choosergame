export const ROOM_PROTOCOL_VERSION = 1;
export const MAX_ROOM_PLAYERS = 12;

const ROOM_SECRET_BYTES = 16;
const ROOM_SECRET_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const ROOM_CODE_LENGTH = 12;
const ROOM_CODE_PATTERN = /^[0-9A-HJKMNP-TV-Z]{12}$/;
const ROOM_CODE_ALPHABET = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";
const ROOM_CODE_KDF_SALT = "choosergame.vercel.app/room-code/v1";
const ROOM_CODE_KDF_ITERATIONS = 150000;
const ROOM_AUTH_PUBLIC_KEY_BYTES = 65;
const ROOM_AUTH_SIGNATURE_BYTES = 64;
const ROOM_AUTH_QUERY_PARAM = "room-auth";
const TRYSTERO_PEER_ID_PATTERN = /^[A-Za-z0-9]{20}$/;
const ROOM_HASH_PATTERN = /^#room=([A-Za-z0-9_-]{22})&host=([^&#=]+)$/;
const BASE64URL_ALPHABET =
	"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";
const ROOM_RELAY_URLS = Object.freeze([
	// The first two also overlap with the v14 relay set during rollout.
	"wss://nostr.data.haus",
	"wss://relay-rpi.edufeed.org",
	"wss://bucket.coracle.social",
	"wss://basspistol.org",
	"wss://nos.lol",
	"wss://hornetstorage.net/relay",
	"wss://nostr-01.uid.ovh",
	"wss://koru.bitcointxoko.org",
]);

const noop = () => {};
const roomAuthKeyCache = new Map();

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

function decodeBase64Url(value, expectedLength) {
	if (typeof value !== "string" || !/^[A-Za-z0-9_-]+$/.test(value)) return null;
	const bytes = [];
	let buffer = 0;
	let bitCount = 0;

	for (const character of value) {
		const digit = BASE64URL_ALPHABET.indexOf(character);
		if (digit < 0) return null;
		buffer = (buffer << 6) | digit;
		bitCount += 6;
		if (bitCount >= 8) {
			bitCount -= 8;
			bytes.push((buffer >>> bitCount) & 255);
			buffer &= (1 << bitCount) - 1;
		}
	}

	if (bitCount > 0 && buffer !== 0) return null;
	if (bytes.length !== expectedLength) return null;
	return new Uint8Array(bytes);
}

function encodeRoomCode(digest) {
	let code = "";
	let buffer = 0;
	let bitCount = 0;

	for (const byte of digest) {
		buffer = (buffer << 8) | byte;
		bitCount += 8;
		while (bitCount >= 5 && code.length < ROOM_CODE_LENGTH) {
			bitCount -= 5;
			code += ROOM_CODE_ALPHABET[(buffer >>> bitCount) & 31];
			buffer &= (1 << bitCount) - 1;
		}
		if (code.length === ROOM_CODE_LENGTH) break;
	}

	return code;
}

function canonicalJson(value) {
	if (value === null || typeof value === "string" || typeof value === "boolean") {
		return JSON.stringify(value);
	}
	if (typeof value === "number" && Number.isFinite(value)) return JSON.stringify(value);
	if (Array.isArray(value)) return `[${value.map(canonicalJson).join(",")}]`;
	if (value && typeof value === "object") {
		return `{${Object.keys(value)
			.filter((key) => value[key] !== undefined)
			.sort()
			.map((key) => `${JSON.stringify(key)}:${canonicalJson(value[key])}`)
			.join(",")}}`;
	}
	throw new TypeError("Room snapshots may contain only JSON values.");
}

async function roomCodeForPublicKey(publicKeyBytes) {
	const digest = await globalThis.crypto.subtle.digest("SHA-256", publicKeyBytes);
	return encodeRoomCode(new Uint8Array(digest));
}

async function roomAuthMaterial(authKey) {
	if (roomAuthKeyCache.has(authKey)) return roomAuthKeyCache.get(authKey);
	const publicKeyBytes = decodeBase64Url(authKey, ROOM_AUTH_PUBLIC_KEY_BYTES);
	if (!publicKeyBytes) return null;
	try {
		const [code, publicKey] = await Promise.all([
			roomCodeForPublicKey(publicKeyBytes),
			globalThis.crypto.subtle.importKey(
				"raw",
				publicKeyBytes,
				{ name: "ECDSA", namedCurve: "P-256" },
				false,
				["verify"],
			),
		]);
		const material = Object.freeze({ code, publicKey });
		roomAuthKeyCache.set(authKey, material);
		while (roomAuthKeyCache.size > 8) {
			roomAuthKeyCache.delete(roomAuthKeyCache.keys().next().value);
		}
		return material;
	} catch {
		return null;
	}
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

export function normalizeRoomCode(value) {
	if (typeof value !== "string") return null;
	const normalized = value
		.toUpperCase()
		.replace(/[\s-]+/g, "")
		.replace(/[IL]/g, "1")
		.replace(/O/g, "0");
	return ROOM_CODE_PATTERN.test(normalized) ? normalized : null;
}

export function formatRoomCode(value) {
	const normalized = normalizeRoomCode(value);
	if (!normalized) return null;
	return normalized.match(/.{4}/g).join("-");
}

export function createRoomCode() {
	const cryptoApi = globalThis.crypto;
	if (typeof cryptoApi?.getRandomValues !== "function") {
		throw new Error("Secure random number generation is unavailable.");
	}

	const bytes = new Uint8Array(ROOM_CODE_LENGTH);
	cryptoApi.getRandomValues(bytes);
	let code = "";
	for (const byte of bytes) code += ROOM_CODE_ALPHABET[byte & 31];
	return code;
}

export async function createRoomCredentials() {
	const cryptoApi = globalThis.crypto;
	if (
		typeof cryptoApi?.subtle?.generateKey !== "function" ||
		typeof cryptoApi?.subtle?.exportKey !== "function"
	) {
		throw new Error("Secure room authentication is unavailable.");
	}

	const keyPair = await cryptoApi.subtle.generateKey(
		{ name: "ECDSA", namedCurve: "P-256" },
		true,
		["sign", "verify"],
	);
	const publicKeyBytes = new Uint8Array(
		await cryptoApi.subtle.exportKey("raw", keyPair.publicKey),
	);
	const code = await roomCodeForPublicKey(publicKeyBytes);
	const secret = await deriveRoomSecret(code);

	return Object.freeze({
		code,
		secret,
		privateKey: keyPair.privateKey,
		publicKey: encodeBase64Url(publicKeyBytes),
	});
}

export async function signRoomSnapshot(snapshot, credentials) {
	if (
		!snapshot ||
		typeof snapshot !== "object" ||
		Array.isArray(snapshot) ||
		!credentials?.privateKey ||
		decodeBase64Url(credentials.publicKey, ROOM_AUTH_PUBLIC_KEY_BYTES) === null
	) {
		throw new TypeError("Valid room credentials are required.");
	}

	const unsigned = { ...snapshot };
	delete unsigned.authKey;
	delete unsigned.authSig;
	const signature = await globalThis.crypto.subtle.sign(
		{ name: "ECDSA", hash: "SHA-256" },
		credentials.privateKey,
		new TextEncoder().encode(canonicalJson(unsigned)),
	);
	return Object.freeze({
		...unsigned,
		authKey: credentials.publicKey,
		authSig: encodeBase64Url(new Uint8Array(signature)),
	});
}

export async function verifyRoomSnapshot(snapshot, expectedCode) {
	const normalizedCode = normalizeRoomCode(expectedCode);
	if (!normalizedCode || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
		return false;
	}
	const signatureBytes = decodeBase64Url(snapshot.authSig, ROOM_AUTH_SIGNATURE_BYTES);
	const material = await roomAuthMaterial(snapshot.authKey);
	if (!material || !signatureBytes || material.code !== normalizedCode) return false;

	try {
		const unsigned = { ...snapshot };
		delete unsigned.authKey;
		delete unsigned.authSig;
		return globalThis.crypto.subtle.verify(
			{ name: "ECDSA", hash: "SHA-256" },
			material.publicKey,
			signatureBytes,
			new TextEncoder().encode(canonicalJson(unsigned)),
		);
	} catch {
		return false;
	}
}

export async function deriveRoomSecret(code) {
	const normalized = normalizeRoomCode(code);
	const cryptoApi = globalThis.crypto;
	if (!normalized) throw new TypeError("A valid room code is required.");
	if (
		typeof cryptoApi?.subtle?.importKey !== "function" ||
		typeof cryptoApi?.subtle?.deriveBits !== "function"
	) {
		throw new Error("Secure room-code derivation is unavailable.");
	}

	const encoder = new TextEncoder();
	const key = await cryptoApi.subtle.importKey(
		"raw",
		encoder.encode(normalized),
		"PBKDF2",
		false,
		["deriveBits"],
	);
	const bits = await cryptoApi.subtle.deriveBits(
		{
			name: "PBKDF2",
			hash: "SHA-256",
			iterations: ROOM_CODE_KDF_ITERATIONS,
			salt: encoder.encode(ROOM_CODE_KDF_SALT),
		},
		key,
		ROOM_SECRET_BYTES * 8,
	);
	return encodeBase64Url(new Uint8Array(bits));
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
	authenticated = false,
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
	if (authenticated) url.searchParams.set(ROOM_AUTH_QUERY_PARAM, "1");
	else url.searchParams.delete(ROOM_AUTH_QUERY_PARAM);
	url.hash = `room=${secret}&host=${encodeURIComponent(hostId)}`;
	return url.toString();
}

export function roomUrlRequiresAuth(href = globalThis.location?.href) {
	if (typeof href !== "string" && !(href instanceof URL)) return false;
	try {
		return new URL(href.toString()).searchParams.get(ROOM_AUTH_QUERY_PARAM) === "1";
	} catch {
		return false;
	}
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
	onSync,
	onError,
} = {}) {
	if (!isValidRoomSecret(secret)) {
		throw new TypeError("A valid room secret is required.");
	}

	const handlePeerJoin = callbackOrNoop(onPeerJoin);
	const handlePeerLeave = callbackOrNoop(onPeerLeave);
	const handleState = callbackOrNoop(onState);
	const handleIntent = callbackOrNoop(onIntent);
	const handleSync = callbackOrNoop(onSync);
	const handleError = callbackOrNoop(onError);

	const { joinRoom, selfId } = await import(
		"./vendor/trystero-nostr-0.25.3.js"
	);
	const room = joinRoom(
		{
			appId: "choosergame.vercel.app/realtime/v1",
			password: secret,
			relayConfig: {
				urls: ROOM_RELAY_URLS,
				warnOnRelayFailure: false,
			},
		},
		`chooser-${secret}`,
		{ onJoinError: handleError },
	);
	const stateAction = room.makeAction("state-v1");
	const intentAction = room.makeAction("intent-v1");
	const syncAction = room.makeAction("sync-v1");

	room.onPeerJoin = handlePeerJoin;
	room.onPeerLeave = handlePeerLeave;
	stateAction.onMessage = (data, metadata = {}) =>
		handleState(data, metadata.peerId);
	intentAction.onMessage = (data, metadata = {}) =>
		handleIntent(data, metadata.peerId);
	syncAction.onMessage = (data, metadata = {}) =>
		handleSync(data, metadata.peerId);

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
		sendSync(target, data = null) {
			if (typeof target !== "string" || target.length === 0) {
				return Promise.reject(new TypeError("A target peer ID is required."));
			}
			return syncAction.send(data, { target });
		},
		leave: () => room.leave(),
	};
}
