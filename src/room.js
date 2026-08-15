// Version 4 isolates numeric-code rendezvous and the opt-in adult deck from
// older clients that cannot interpret either wire format safely.
export const ROOM_PROTOCOL_VERSION = 4;
export const MAX_ROOM_PLAYERS = 12;

const ROOM_SECRET_BYTES = 16;
const ROOM_SECRET_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const ROOM_CODE_MIN_LENGTH = 2;
const ROOM_CODE_MAX_LENGTH = 4;
const ROOM_CODE_PATTERN = /^[0-9]{2,4}$/;
const ROOM_CODE_KDF_SALT = "choosergame.vercel.app/room-code/v4";
const ROOM_CODE_KDF_ITERATIONS = 150000;
const ROOM_CODE_INVITE_KIND = "room-code-invite-v4";
const ROOM_CODE_RESOLVE_KIND = "room-code-resolve-v4";
const ROOM_CODE_CLAIM_WAIT_MS = 2200;
const ROOM_CODE_RESOLVE_WAIT_MS = 8000;
const ROOM_CODE_FOUR_DIGIT_ATTEMPTS = 6;
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

function assertRoomCodeLength(length) {
	if (
		!Number.isInteger(length) ||
		length < ROOM_CODE_MIN_LENGTH ||
		length > ROOM_CODE_MAX_LENGTH
	) {
		throw new RangeError("Room code length must be an integer from 2 through 4.");
	}
}

function encodeRoomCode(digest, length) {
	assertRoomCodeLength(length);
	const modulus = 10 ** length;
	let value = 0;
	for (const byte of digest) value = (value * 256 + byte) % modulus;
	return String(value).padStart(length, "0");
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

async function roomCodeForPublicKey(publicKeyBytes, length) {
	const digest = await globalThis.crypto.subtle.digest("SHA-256", publicKeyBytes);
	return encodeRoomCode(new Uint8Array(digest), length);
}

async function roomAuthMaterial(authKey) {
	if (roomAuthKeyCache.has(authKey)) return roomAuthKeyCache.get(authKey);
	const publicKeyBytes = decodeBase64Url(authKey, ROOM_AUTH_PUBLIC_KEY_BYTES);
	if (!publicKeyBytes) return null;
	try {
		const [digest, publicKey] = await Promise.all([
			globalThis.crypto.subtle.digest("SHA-256", publicKeyBytes),
			globalThis.crypto.subtle.importKey(
				"raw",
				publicKeyBytes,
				{ name: "ECDSA", namedCurve: "P-256" },
				false,
				["verify"],
			),
		]);
		const material = Object.freeze({ digest: new Uint8Array(digest), publicKey });
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
	return ROOM_CODE_PATTERN.test(value) ? value : null;
}

export function getRoomResumeAction({
	hidden,
	roomMode,
	roomRole,
	hasSecret,
	hasTransport,
	hasHostPeer,
} = {}) {
	if (hidden || roomMode === "local" || !hasSecret || !hasTransport) return null;
	if (roomRole === "host") return "broadcast";
	return hasHostPeer ? "sync" : "wait";
}

export function formatRoomCode(value) {
	const normalized = normalizeRoomCode(value);
	if (!normalized) return null;
	return normalized;
}

export function createRoomCode(length = ROOM_CODE_MIN_LENGTH) {
	assertRoomCodeLength(length);
	const cryptoApi = globalThis.crypto;
	if (typeof cryptoApi?.getRandomValues !== "function") {
		throw new Error("Secure random number generation is unavailable.");
	}

	let code = "";
	const bytes = new Uint8Array(length);
	while (code.length < length) {
		cryptoApi.getRandomValues(bytes);
		for (const byte of bytes) {
			if (byte >= 250) continue;
			code += String(byte % 10);
			if (code.length === length) break;
		}
	}
	return code;
}

export async function createRoomCredentials(length = ROOM_CODE_MIN_LENGTH) {
	assertRoomCodeLength(length);
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
	const [code, secret] = await Promise.all([
		roomCodeForPublicKey(publicKeyBytes, length),
		Promise.resolve().then(createRoomSecret),
	]);

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

export async function verifyRoomSnapshot(snapshot, expectedCode, expectedAuthKey = null) {
	const normalizedCode = normalizeRoomCode(expectedCode);
	if (!normalizedCode || !snapshot || typeof snapshot !== "object" || Array.isArray(snapshot)) {
		return false;
	}
	if (expectedAuthKey !== null && snapshot.authKey !== expectedAuthKey) return false;
	const signatureBytes = decodeBase64Url(snapshot.authSig, ROOM_AUTH_SIGNATURE_BYTES);
	const material = await roomAuthMaterial(snapshot.authKey);
	if (
		!material ||
		!signatureBytes ||
		encodeRoomCode(material.digest, normalizedCode.length) !== normalizedCode
	) {
		return false;
	}

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
	channel = "game",
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
	if (channel !== "game" && channel !== "code") {
		throw new TypeError('Room channel must be either "game" or "code".');
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
			appId: `choosergame.vercel.app/realtime/v4/${channel}`,
			password: secret,
			relayConfig: {
				urls: ROOM_RELAY_URLS,
				warnOnRelayFailure: false,
			},
		},
		`chooser-v4-${channel}-${secret}`,
		{ onJoinError: handleError },
	);
	const stateAction = room.makeAction(`${channel}-state-v4`);
	const intentAction = room.makeAction(`${channel}-intent-v4`);
	const syncAction = room.makeAction(`${channel}-sync-v4`);

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

function makeAbortError() {
	if (typeof DOMException === "function") {
		return new DOMException("The operation was aborted.", "AbortError");
	}
	const error = new Error("The operation was aborted.");
	error.name = "AbortError";
	return error;
}

function throwIfAborted(signal) {
	if (!signal?.aborted) return;
	throw signal.reason?.name === "AbortError" ? signal.reason : makeAbortError();
}

function waitForDelay(milliseconds, signal) {
	return new Promise((resolve, reject) => {
		throwIfAborted(signal);
		const timeout = setTimeout(() => {
			signal?.removeEventListener("abort", handleAbort);
			resolve();
		}, milliseconds);
		function handleAbort() {
			clearTimeout(timeout);
			reject(signal.reason?.name === "AbortError" ? signal.reason : makeAbortError());
		}
		signal?.addEventListener("abort", handleAbort, { once: true });
	});
}

function assertInjectedFunction(value, name) {
	if (typeof value !== "function") throw new TypeError(`${name} must be a function.`);
}

function assertNonNegativeDuration(value, name) {
	if (!Number.isFinite(value) || value < 0) {
		throw new RangeError(`${name} must be a non-negative finite number.`);
	}
}

function sendWithoutWaiting(callback) {
	try {
		Promise.resolve(callback()).catch(noop);
	} catch {
		// A disappearing rendezvous peer is expected and does not invalidate a claim.
	}
}

function roomCodeRequest(code) {
	return Object.freeze({
		version: ROOM_PROTOCOL_VERSION,
		kind: ROOM_CODE_RESOLVE_KIND,
		code,
	});
}

function isRoomCodeRequest(payload, code) {
	return (
		payload !== null &&
		typeof payload === "object" &&
		!Array.isArray(payload) &&
		payload.version === ROOM_PROTOCOL_VERSION &&
		payload.kind === ROOM_CODE_RESOLVE_KIND &&
		payload.code === code
	);
}

function isRoomCodeInvite(payload, code, peerId) {
	return (
		payload !== null &&
		typeof payload === "object" &&
		!Array.isArray(payload) &&
		payload.version === ROOM_PROTOCOL_VERSION &&
		payload.kind === ROOM_CODE_INVITE_KIND &&
		payload.code === code &&
		isValidRoomSecret(payload.secret) &&
		typeof peerId === "string" &&
		payload.hostId === peerId &&
		TRYSTERO_PEER_ID_PATTERN.test(payload.hostId)
	);
}

function transportPeerIds(transport) {
	if (typeof transport?.getPeerIds !== "function") return [];
	const peerIds = transport.getPeerIds();
	return Array.isArray(peerIds) ? peerIds : [];
}

async function openRoomCodeClaim(
	credentials,
	{
		signal,
		connect,
		deriveSecret,
		signSnapshot,
		verifySnapshot,
		wait,
		claimWaitMs,
	},
) {
	const code = normalizeRoomCode(credentials?.code);
	if (
		!code ||
		!isValidRoomSecret(credentials?.secret) ||
		!credentials.privateKey ||
		typeof credentials.publicKey !== "string"
	) {
		throw new TypeError("The room credential factory returned invalid credentials.");
	}

	throwIfAborted(signal);
	const rendezvousSecret = await deriveSecret(code);
	throwIfAborted(signal);

	let transport = null;
	let closed = false;
	let activeInvite = null;
	let activationPromise = null;
	let occupied = false;
	let probing = true;
	let markOccupied;
	const occupiedPromise = new Promise((resolve) => {
		markOccupied = () => {
			occupied = true;
			resolve(true);
		};
	});
	const pendingRequests = new Set();
	const pendingInviteChecks = new Set();

	const requestInvite = (peerId) => {
		if (closed || typeof peerId !== "string" || peerId.length === 0) return;
		if (!transport) {
			pendingRequests.add(peerId);
			return;
		}
		sendWithoutWaiting(() => transport.sendSync(peerId, roomCodeRequest(code)));
	};
	const serveInvite = (peerId) => {
		if (
			closed ||
			!activeInvite ||
			!transport ||
			typeof peerId !== "string" ||
			peerId.length === 0
		) {
			return;
		}
		sendWithoutWaiting(() => transport.sendState(activeInvite, peerId));
	};
	const inspectInvite = (payload, peerId) => {
		if (closed || !isRoomCodeInvite(payload, code, peerId)) return;
		const check = Promise.resolve(verifySnapshot(payload, code))
			.then((isValid) => {
				if (isValid && !closed && !activeInvite) markOccupied();
			})
			.catch(noop)
			.finally(() => pendingInviteChecks.delete(check));
		pendingInviteChecks.add(check);
	};

	try {
		transport = await connect({
			secret: rendezvousSecret,
			channel: "code",
			signal,
			onPeerJoin(peerId) {
				if (activeInvite) serveInvite(peerId);
				else {
					if (probing) markOccupied();
					requestInvite(peerId);
				}
			},
			onState: inspectInvite,
			onSync(payload, peerId) {
				if (isRoomCodeRequest(payload, code)) serveInvite(peerId);
			},
		});
		throwIfAborted(signal);
		for (const peerId of pendingRequests) requestInvite(peerId);
		pendingRequests.clear();
		const existingPeerIds = transportPeerIds(transport);
		if (existingPeerIds.length > 0) markOccupied();
		for (const peerId of existingPeerIds) requestInvite(peerId);

		const collision = await Promise.race([
			occupiedPromise,
			Promise.resolve(wait(claimWaitMs, signal)).then(() => false),
		]);
		if (!collision && pendingInviteChecks.size > 0) {
			await Promise.all([...pendingInviteChecks]);
		}
		probing = false;
		throwIfAborted(signal);
		if (occupied) {
			closed = true;
			transport.leave();
			return null;
		}
	} catch (error) {
		closed = true;
		transport?.leave();
		throw error;
	}

	const leave = () => {
		if (closed) return;
		closed = true;
		transport.leave();
	};
	const activate = () => {
		if (activationPromise) return activationPromise;
		activationPromise = (async () => {
			throwIfAborted(signal);
			if (closed) throw new Error("The room-code claim has been released.");
			if (occupied) throw new Error("The room code is already claimed.");
			if (!TRYSTERO_PEER_ID_PATTERN.test(transport.selfId)) {
				throw new Error("The room-code transport returned an invalid host ID.");
			}
			const invite = await signSnapshot(
				{
					version: ROOM_PROTOCOL_VERSION,
					kind: ROOM_CODE_INVITE_KIND,
					code,
					secret: credentials.secret,
					hostId: transport.selfId,
				},
				credentials,
			);
			throwIfAborted(signal);
			if (closed) throw new Error("The room-code claim has been released.");
			if (occupied) throw new Error("The room code is already claimed.");
			activeInvite = invite;
			for (const peerId of transportPeerIds(transport)) serveInvite(peerId);
		})();
		return activationPromise;
	};

	return Object.freeze({ credentials, activate, leave });
}

export async function claimShortestRoomCode({
	signal,
	connect = connectRoom,
	createCredentials = createRoomCredentials,
	deriveSecret = deriveRoomSecret,
	signSnapshot = signRoomSnapshot,
	verifySnapshot = verifyRoomSnapshot,
	wait = waitForDelay,
	claimWaitMs = ROOM_CODE_CLAIM_WAIT_MS,
	fourDigitAttempts = ROOM_CODE_FOUR_DIGIT_ATTEMPTS,
} = {}) {
	assertInjectedFunction(connect, "connect");
	assertInjectedFunction(createCredentials, "createCredentials");
	assertInjectedFunction(deriveSecret, "deriveSecret");
	assertInjectedFunction(signSnapshot, "signSnapshot");
	assertInjectedFunction(verifySnapshot, "verifySnapshot");
	assertInjectedFunction(wait, "wait");
	assertNonNegativeDuration(claimWaitMs, "claimWaitMs");
	if (!Number.isInteger(fourDigitAttempts) || fourDigitAttempts < 1) {
		throw new RangeError("fourDigitAttempts must be a positive integer.");
	}

	throwIfAborted(signal);
	const lengths = [
		ROOM_CODE_MIN_LENGTH,
		ROOM_CODE_MIN_LENGTH + 1,
		...Array(fourDigitAttempts).fill(ROOM_CODE_MAX_LENGTH),
	];
	for (const length of lengths) {
		throwIfAborted(signal);
		const credentials = await createCredentials(length);
		if (normalizeRoomCode(credentials?.code)?.length !== length) {
			throw new TypeError("The room credential factory returned a code of the wrong length.");
		}
		const claim = await openRoomCodeClaim(credentials, {
			signal,
			connect,
			deriveSecret,
			signSnapshot,
			verifySnapshot,
			wait,
			claimWaitMs,
		});
		if (!claim) continue;

		const handleAbort = () => claim.leave();
		signal?.addEventListener("abort", handleAbort, { once: true });
		return Object.freeze({
			credentials: claim.credentials,
			activate: claim.activate,
			leave() {
				signal?.removeEventListener("abort", handleAbort);
				claim.leave();
			},
		});
	}

	throw new Error("A room code could not be claimed.");
}

export async function resolveRoomCode(
	code,
	{
		signal,
		connect = connectRoom,
		deriveSecret = deriveRoomSecret,
		verifySnapshot = verifyRoomSnapshot,
		wait = waitForDelay,
		timeoutMs = ROOM_CODE_RESOLVE_WAIT_MS,
	} = {},
) {
	const normalizedCode = normalizeRoomCode(code);
	if (!normalizedCode) throw new TypeError("A valid room code is required.");
	assertInjectedFunction(connect, "connect");
	assertInjectedFunction(deriveSecret, "deriveSecret");
	assertInjectedFunction(verifySnapshot, "verifySnapshot");
	assertInjectedFunction(wait, "wait");
	assertNonNegativeDuration(timeoutMs, "timeoutMs");
	throwIfAborted(signal);

	const rendezvousSecret = await deriveSecret(normalizedCode);
	throwIfAborted(signal);
	let transport = null;
	let closed = false;
	let resolvedInvite = null;
	let resolveInvite;
	const invitePromise = new Promise((resolve) => {
		resolveInvite = resolve;
	});
	const pendingRequests = new Set();
	const pendingInviteChecks = new Set();
	const requestInvite = (peerId) => {
		if (closed || typeof peerId !== "string" || peerId.length === 0) return;
		if (!transport) {
			pendingRequests.add(peerId);
			return;
		}
		sendWithoutWaiting(() =>
			transport.sendSync(peerId, roomCodeRequest(normalizedCode)),
		);
	};
	const inspectInvite = (payload, peerId) => {
		if (closed || resolvedInvite || !isRoomCodeInvite(payload, normalizedCode, peerId)) {
			return;
		}
		const check = Promise.resolve(verifySnapshot(payload, normalizedCode))
			.then((isValid) => {
				if (!isValid || closed || resolvedInvite) return;
				resolvedInvite = Object.freeze({
					secret: payload.secret,
					hostId: payload.hostId,
					authKey: payload.authKey,
				});
				resolveInvite(resolvedInvite);
			})
			.catch(noop)
			.finally(() => pendingInviteChecks.delete(check));
		pendingInviteChecks.add(check);
	};

	try {
		transport = await connect({
			secret: rendezvousSecret,
			channel: "code",
			signal,
			onPeerJoin: requestInvite,
			onState: inspectInvite,
		});
		throwIfAborted(signal);
		for (const peerId of pendingRequests) requestInvite(peerId);
		pendingRequests.clear();
		for (const peerId of transportPeerIds(transport)) requestInvite(peerId);

		const result = await Promise.race([
			invitePromise,
			Promise.resolve(wait(timeoutMs, signal)).then(() => null),
		]);
		if (result === null && pendingInviteChecks.size > 0) {
			await Promise.all([...pendingInviteChecks]);
		}
		throwIfAborted(signal);
		return resolvedInvite;
	} finally {
		closed = true;
		transport?.leave();
	}
}
