import {
	CATEGORIES,
	PROMPT_COUNTS,
	createPromptPicker,
	getPromptCounts,
} from "./prompts.js";
import {
	MAX_ROOM_PLAYERS,
	ROOM_PROTOCOL_VERSION,
	connectRoom,
	createRoomCredentials,
	createRoomSecret,
	denormalizePoint,
	deriveRoomSecret,
	formatRoomCode,
	getRoomResumeAction,
	makeRoomUrl,
	normalizeRoomCode,
	normalizePoint,
	parseRoomHash,
	roomUrlRequiresAuth,
	sanitizeFingerIntent,
	signRoomSnapshot,
	verifyRoomSnapshot,
} from "./room.js";

const MIN_PLAYERS = 2;
const CHOOSE_DELAY_MS = 2000;
const REVEAL_ANIMATION_DURATION_MS = 680;
const WINNER_DISPLAY_DURATION_MS = 2600;
const COUNTDOWN_HAPTIC_INTERVAL_MS = 400;
const ELECTRIC_DOT_SPEED = 1.15;
const ROOM_MOVE_INTERVAL_MS = 40;
const ROOM_RECEIVE_MOVE_INTERVAL_MS = 28;
const ROOM_STATE_BROADCAST_INTERVAL_MS = 40;
const ROOM_JOIN_TIMEOUT_MS = 35000;
const ROOM_SYNC_RETRY_DELAYS_MS = [0, 1200, 3000, 7000, 12000, 20000];
const ROOM_SYNC_RESPONSE_INTERVAL_MS = 750;
const ROOM_CHALLENGE_PATTERN = /^[A-Za-z0-9_-]{22}$/;
const SETTINGS_STORAGE_KEY = "chooser-game-settings-v3";
const LEGACY_ROOM_PROMPT_CATEGORIES = new Set([
	"neutral",
	"funny",
	"deep",
	"couples",
	"bold",
	"naughty",
]);
const DEFAULT_ACCENT = "#ff315f";
const PLAYER_HUES = [346, 192, 48, 268, 124, 24, 218, 305, 88, 164, 10, 240];
const SHAPES = [
	{ name: "Triangle", kind: "polygon", sides: 3, rotation: -Math.PI / 2 },
	{ name: "Square", kind: "polygon", sides: 4, rotation: Math.PI / 4 },
	{ name: "Diamond", kind: "polygon", sides: 4, rotation: 0 },
	{ name: "Pentagon", kind: "polygon", sides: 5, rotation: -Math.PI / 2 },
	{ name: "Hexagon", kind: "polygon", sides: 6, rotation: Math.PI / 6 },
	{ name: "Star", kind: "star" },
	{ name: "Cross", kind: "cross" },
	{ name: "Heart", kind: "heart" },
	{ name: "Bolt", kind: "bolt" },
	{ name: "Ring", kind: "ring" },
];

const GESTURE = Object.freeze({
	maxDownSpread: 120,
	maxDuration: 260,
	maxReleaseSpread: 130,
	maxMovement: 18,
	minGap: 40,
	maxGap: 520,
	maxPositionDrift: 90,
});

const canvas = document.getElementById("board");
const ctx = canvas.getContext("2d", { alpha: false });
const body = document.body;
const idlePanel = document.getElementById("idle-panel");
const collectingPanel = document.getElementById("collecting-panel");
const resultPanel = document.getElementById("result-panel");
const countdownLabel = document.getElementById("countdown-label");
const playerCount = document.getElementById("player-count");
const activeConfig = document.getElementById("active-config");
const resultMeta = document.getElementById("result-meta");
const resultPrompt = document.getElementById("result-prompt");
const nextRoundButton = document.getElementById("next-round");
const nextRoundLabel = document.getElementById("next-round-label");
const helpButton = document.getElementById("help-button");
const helpDialog = document.getElementById("help-dialog");
const helpClose = document.getElementById("help-close");
const settingsButton = document.getElementById("settings-button");
const settingsDialog = document.getElementById("settings-dialog");
const settingsClose = document.getElementById("settings-close");
const promptsToggle = document.getElementById("prompts-toggle");
const promptSettings = document.getElementById("prompt-settings");
const hapticsToggle = document.getElementById("haptics-toggle");
const libraryCount = document.getElementById("library-count");
const ariaLive = document.getElementById("live-region");
const version = document.getElementById("version");
const updateAvailable = document.getElementById("update-available");
const updateLink = updateAvailable.querySelector("a");
const roomEntryButton = document.getElementById("room-entry-button");
const roomStatusButton = document.getElementById("room-status-button");
const roomDeviceCount = document.getElementById("room-device-count");
const roomDialog = document.getElementById("room-dialog");
const roomClose = document.getElementById("room-close");
const roomKicker = document.getElementById("room-kicker");
const roomTitle = document.getElementById("room-title");
const roomCopy = document.getElementById("room-copy");
const roomLobby = document.getElementById("room-lobby");
const roomSession = document.getElementById("room-session");
const roomCreate = document.getElementById("room-create");
const roomJoinForm = document.getElementById("room-join-form");
const roomCodeInput = document.getElementById("room-code-input");
const roomCodeSubmit = document.getElementById("room-code-submit");
const roomCodeError = document.getElementById("room-code-error");
const roomStatusLine = document.getElementById("room-status-line");
const roomCodeRow = document.getElementById("room-code-row");
const roomCodeDisplay = document.getElementById("room-code");
const roomShare = document.getElementById("room-share");
const roomCopyLink = document.getElementById("room-copy-link");
const roomEnter = document.getElementById("room-enter");
const roomLeave = document.getElementById("room-leave");
const roomCopyLinkLabel = roomCopyLink.querySelector("span");
const roomEnterLabel = roomEnter.querySelector("span");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

if (!ctx) throw new Error("This browser does not support the 2D canvas API.");

const promptPicker = createPromptPicker({ historySize: 32 });
const players = new Map();
const physicalPointers = new Set();
const localRoomFingerIds = new Map();
const roomActiveFingerIds = new Set();
const roomIntentSequences = new Map();
const roomOutgoingSequences = new Map();
const roomLastMoveSentAt = new Map();
const roomLastMoveReceivedAt = new Map();
const roomPeerIds = new Set();
const roomSyncLastRespondedAt = new Map();

let gameState = "idle";
let completedRounds = 0;
let roundIdentityStyle = "numbers";
let connectorEdges = [];
let connectorRoute = [];
let countdownStartedAt = 0;
let countdownDeadline = 0;
let hapticMilestonesFired = 0;
let revealStartedAt = 0;
let result = null;
let animationFrame = null;
let viewport = { width: window.innerWidth, height: window.innerHeight, dpr: 1 };
let activeChord = null;
let previousChord = null;
let settings = loadSettings();
let localSettingsBeforeRoom = null;
let roomMode = "local";
let roomRole = "guest";
let roomSecret = null;
let activeRoomCode = null;
let roomCredentials = null;
let roomJoinChallenge = null;
let roomAuthRequired = false;
let roomAuthPending = false;
let roomAuthEpoch = 0;
let roomLink = "";
let roomTransport = null;
let roomHostPeerId = null;
let roomStateSequence = 0;
let lastAppliedRoomSequence = 0;
let roomRound = 0;
let roomStatusMessage = "";
let roomConnectionAttempt = 0;
let roomJoinTimeout = null;
let roomSnapshotBroadcastTimeout = null;
let roomLastSnapshotBroadcastAt = 0;
let updateReady = false;
let roomLobbyBusy = false;
let roomLobbyOperation = 0;
let roomDialogOpenedForReconnect = false;
const roomSyncRetryTimers = new Set();

function loadSettings() {
	const fallback = {
		promptsEnabled: false,
		mode: "mix",
		categories: ["photos"],
		haptics: true,
	};

	try {
		const saved = JSON.parse(localStorage.getItem(SETTINGS_STORAGE_KEY));
		const mode = ["truth", "dare", "mix"].includes(saved?.mode)
			? saved.mode
			: fallback.mode;
		const categories = Array.isArray(saved?.categories)
			? [...new Set(saved.categories)].filter((category) => CATEGORIES[category])
			: fallback.categories;

		return {
			promptsEnabled: saved?.promptsEnabled === true,
			mode,
			categories: categories.length ? categories : fallback.categories,
			haptics: saved?.haptics !== false,
		};
	} catch {
		return fallback;
	}
}

function saveSettings(value = settings) {
	try {
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(value));
	} catch {
		// The game remains fully usable when storage is unavailable.
	}
}

function announce(message) {
	const line = document.createElement("div");
	line.textContent = message;
	ariaLive.append(line);
	while (ariaLive.children.length > 8) ariaLive.firstElementChild.remove();
}

function isRoomSession() {
	return roomMode !== "local";
}

function isRoomConnected() {
	return roomMode === "connected" && roomTransport !== null;
}

function isRoomHost() {
	return isRoomSession() && roomRole === "host";
}

function roomDeviceTotal() {
	return roomPeerIds.size + (roomTransport ? 1 : 0);
}

function clearRoomConnectionTimers() {
	if (roomJoinTimeout !== null) window.clearTimeout(roomJoinTimeout);
	if (roomSnapshotBroadcastTimeout !== null) {
		window.clearTimeout(roomSnapshotBroadcastTimeout);
	}
	roomJoinTimeout = null;
	roomSnapshotBroadcastTimeout = null;
	for (const timer of roomSyncRetryTimers) window.clearTimeout(timer);
	roomSyncRetryTimers.clear();
}

function scheduleRoomSnapshotRequests(peerId, connectionAttempt) {
	if (isRoomHost() || (roomHostPeerId && peerId !== roomHostPeerId)) return;

	for (const delay of ROOM_SYNC_RETRY_DELAYS_MS) {
		const timer = window.setTimeout(() => {
			roomSyncRetryTimers.delete(timer);
			if (
				connectionAttempt !== roomConnectionAttempt ||
				roomMode !== "joining" ||
				!roomTransport ||
				(roomHostPeerId && peerId !== roomHostPeerId)
			) {
				return;
			}
			const syncData = roomJoinChallenge ? { challenge: roomJoinChallenge } : null;
			roomTransport.sendSync(peerId, syncData).catch(() => {});
		}, delay);
		roomSyncRetryTimers.add(timer);
	}
}

function startRoomJoinTimeout(connectionAttempt) {
	if (isRoomHost() || roomMode === "connected" || roomJoinTimeout !== null) return;

	roomJoinTimeout = window.setTimeout(() => {
		roomJoinTimeout = null;
		if (connectionAttempt !== roomConnectionAttempt || roomMode === "connected") return;
		roomConnectionAttempt += 1;
		clearRoomConnectionTimers();
		roomTransport?.leave();
		roomTransport = null;
		roomPeerIds.clear();
		setRoomMode(
			"error",
			"We couldn’t connect to the host. Keep their room open, then try again or switch between Wi-Fi and mobile data.",
		);
		showRoomDialog();
	}, ROOM_JOIN_TIMEOUT_MS);
}

function setRoomMode(nextMode, statusMessage = "") {
	if (nextMode === "connected" && roomJoinTimeout !== null) {
		window.clearTimeout(roomJoinTimeout);
		roomJoinTimeout = null;
	}
	if (nextMode === "connected") {
		for (const timer of roomSyncRetryTimers) window.clearTimeout(timer);
		roomSyncRetryTimers.clear();
	}
	roomMode = nextMode;
	roomStatusMessage = statusMessage;
	body.dataset.roomMode = nextMode;
	body.dataset.roomRole = roomRole;
	updateAvailable.hidden = !(updateReady && nextMode === "local");
	updateRoomChrome();
}

function updateRoomChrome() {
	const total = roomDeviceTotal();
	roomStatusButton.hidden = roomMode === "local";
	const visibleTotal = Math.max(1, total);
	const deviceLabel = `${visibleTotal} device${visibleTotal === 1 ? "" : "s"}`;
	roomDeviceCount.textContent = String(visibleTotal);
	roomStatusButton.setAttribute(
		"aria-label",
		`Open shared room details, ${deviceLabel} connected`,
	);
	settingsButton.hidden = false;
	syncSettingsAccess();
	updateRoomDialog();
}

function setRoomCodeError(message = "") {
	roomCodeError.textContent = message;
	roomCodeError.hidden = message.length === 0;
	roomCodeInput.setAttribute("aria-invalid", String(message.length > 0));
}

function setRoomLobbyBusy(isBusy) {
	roomLobbyBusy = isBusy;
	roomCreate.disabled = isBusy;
	roomCodeInput.disabled = isBusy;
	roomCodeSubmit.disabled = isBusy;
}

function cancelRoomLobbyOperation() {
	roomLobbyOperation += 1;
	setRoomLobbyBusy(false);
}

function roomWireCategories(categories) {
	const wireCategories = new Set();
	for (const category of categories) {
		wireCategories.add(category);
		if (category === "photos") wireCategories.add("neutral");
	}
	return [...wireCategories];
}

function toLocalRoomCategory(category) {
	if (CATEGORIES[category]) return category;
	if (CATEGORIES.photos && LEGACY_ROOM_PROMPT_CATEGORIES.has(category)) return "photos";
	return null;
}

function updateRoomDialog() {
	const showingLobby = roomMode === "local";
	roomLobby.hidden = !showingLobby;
	roomSession.hidden = showingLobby;
	if (showingLobby) {
		roomKicker.textContent = "Pick and Do room";
		roomTitle.textContent = "Play together.";
		roomCopy.textContent = "Create a room, or enter the code from a friend.";
		setRoomLobbyBusy(roomLobbyBusy);
		return;
	}

	const total = Math.max(1, roomDeviceTotal());
	const deviceLabel = `${total} device${total === 1 ? "" : "s"} connected`;
	const formattedCode = activeRoomCode ? formatRoomCode(activeRoomCode) : null;
	roomCodeRow.hidden = !formattedCode;
	roomCodeDisplay.textContent = formattedCode ?? "";
	roomShare.hidden = !isRoomHost() || roomMode !== "connected" || !roomLink;
	roomCopyLink.hidden = !isRoomHost() || roomMode !== "connected" || !roomLink;
	roomEnter.hidden = false;
	roomEnter.disabled = roomMode === "joining";

	if (roomMode === "error") {
		const hostEndedRoom = roomStatusMessage.includes("closed the room");
		roomKicker.textContent = "Connection ended";
		roomTitle.textContent = isRoomHost()
			? "Room couldn’t start."
			: hostEndedRoom
				? "The host left."
				: "Room couldn’t open.";
		roomCopy.textContent =
			roomStatusMessage ||
			"Return to local play, then create or open a fresh room link.";
		roomStatusLine.textContent = "Room offline";
		roomEnterLabel.textContent = "Try again";
		return;
	}

	if (roomRole === "host") {
		roomKicker.textContent = "Your shared room";
		roomTitle.textContent = roomMode === "joining" ? "Opening the room…" : "Room’s live.";
		roomCopy.textContent =
			"Share the link or room code. Everyone joins, enters the board, and holds a finger.";
		roomStatusLine.textContent = roomMode === "joining" ? "Connecting securely" : deviceLabel;
		roomEnterLabel.textContent = "Go to the board";
		return;
	}

	roomKicker.textContent = "Pick and Do room";
	roomTitle.textContent = roomMode === "connected" ? "You’re in." : "Finding the room…";
	roomCopy.textContent =
		roomMode === "connected"
			? "Hold a finger anywhere. Every live touch appears on every screen."
			: roomStatusMessage || "Keep this page open while we connect you to the host.";
	roomStatusLine.textContent = roomMode === "connected" ? deviceLabel : "Connecting securely";
	roomEnterLabel.textContent = "Enter the board";
}

function showRoomDialog() {
	updateRoomDialog();
	if (roomDialog.open) return;
	if (typeof roomDialog.showModal === "function") roomDialog.showModal();
	else roomDialog.setAttribute("open", "");
}

function closeRoomDialog() {
	if (!roomDialog.open) return;
	if (typeof roomDialog.close === "function") roomDialog.close();
	else roomDialog.removeAttribute("open");
}

function showRoomReconnectDialog() {
	if (!roomDialog.open) roomDialogOpenedForReconnect = true;
	showRoomDialog();
}

async function copyRoomInvite() {
	if (!roomLink) return;
	let copied = false;
	try {
		await navigator.clipboard.writeText(roomLink);
		copied = true;
	} catch {
		window.prompt("Copy this private room link", roomLink);
	}
	if (copied) {
		const previousLabel = roomCopyLinkLabel.textContent;
		roomCopyLinkLabel.textContent = "Copied";
		announce("Room link copied.");
		window.setTimeout(() => {
			roomCopyLinkLabel.textContent = previousLabel;
		}, 1600);
	}
}

async function shareRoomInvite() {
	if (!roomLink) return;
	if (typeof navigator.share !== "function") {
		await copyRoomInvite();
		return;
	}
	try {
		await navigator.share({
			title: "Join my Pick and Do room",
			text: activeRoomCode
				? `Enter room code ${formatRoomCode(activeRoomCode)}, or open this link.`
				: "Open this link, then place a finger on your screen.",
			url: roomLink,
		});
	} catch (error) {
		if (error?.name !== "AbortError") await copyRoomInvite();
	}
}

function setGameState(nextState) {
	gameState = nextState;
	body.dataset.gameState = nextState;
	idlePanel.hidden = nextState !== "idle";
	collectingPanel.hidden = !["collecting", "countdown"].includes(nextState);
	resultPanel.hidden = nextState !== "result";

	if (nextState === "collecting") {
		countdownLabel.textContent = "Hold steady";
		playerCount.textContent = "One more finger";
	}
}

function titleCase(value) {
	return value.charAt(0).toUpperCase() + value.slice(1);
}

function updateSettingsSummary() {
	promptSettings.hidden = !settings.promptsEnabled;
	const guestRoom = isRoomSession() && !isRoomHost();

	if (!settings.promptsEnabled) {
		activeConfig.textContent = "Pick only";
		libraryCount.textContent = guestRoom
			? "The host controls room prompts · haptics stay personal"
			: "Truth or Dare is off · prompts stay hidden after each pick";
		return;
	}

	const modeLabel = settings.mode === "mix" ? "Mix" : titleCase(settings.mode);
	const categoryLabels = settings.categories.map((category) => CATEGORIES[category].label);
	const deckLabel =
		categoryLabels.length <= 3
			? categoryLabels.join(" + ")
			: `${categoryLabels.length} decks`;
	activeConfig.textContent = `${modeLabel} · ${deckLabel}`;

	const selectedCounts = getPromptCounts({
		mode: settings.mode,
		enabledCategories: settings.categories,
	});
	libraryCount.textContent = guestRoom
		? "The host controls room prompts · haptics stay personal"
		: `${selectedCounts.total.toLocaleString()} selected · ${PROMPT_COUNTS.truth.toLocaleString()} truths + ${PROMPT_COUNTS.dare.toLocaleString()} dares offline`;
}

function syncSettingsAccess() {
	const hostControlled = isRoomSession() && !isRoomHost();
	promptsToggle.disabled = hostControlled;
	document
		.querySelectorAll('input[name="mode"], input[name="category"]')
		.forEach((input) => {
			input.disabled = hostControlled;
		});
}

function syncSettingsControls() {
	syncSettingsAccess();
	promptsToggle.checked = settings.promptsEnabled;
	document.querySelectorAll('input[name="mode"]').forEach((input) => {
		input.checked = input.value === settings.mode;
	});
	document.querySelectorAll('input[name="category"]').forEach((input) => {
		input.checked = settings.categories.includes(input.value);
	});
	hapticsToggle.checked = settings.haptics;
	updateSettingsSummary();
}

function readSettingsControls(changedInput) {
	if (isRoomSession() && !isRoomHost()) {
		if (changedInput !== hapticsToggle) {
			syncSettingsControls();
			return;
		}
		settings = { ...settings, haptics: hapticsToggle.checked };
		if (localSettingsBeforeRoom) {
			localSettingsBeforeRoom.haptics = settings.haptics;
		}
		if (!settings.haptics && typeof navigator.vibrate === "function") {
			navigator.vibrate(0);
		}
		saveSettings(localSettingsBeforeRoom ?? settings);
		updateSettingsSummary();
		return;
	}

	const mode = document.querySelector('input[name="mode"]:checked')?.value ?? "mix";
	const categoryInputs = [...document.querySelectorAll('input[name="category"]')];
	let categories = categoryInputs.filter((input) => input.checked).map((input) => input.value);

	if (categories.length === 0 && changedInput.name === "category") {
		changedInput.checked = true;
		categories = [changedInput.value];
		announce("Keep the full deck selected.");
	}

	settings = {
		promptsEnabled: promptsToggle.checked,
		mode,
		categories,
		haptics: hapticsToggle.checked,
	};
	if (!settings.haptics && typeof navigator.vibrate === "function") navigator.vibrate(0);
	saveSettings();
	updateSettingsSummary();
}

function safeVibrate(pattern) {
	if (!settings.haptics || typeof navigator.vibrate !== "function") return false;
	try {
		return navigator.vibrate(pattern);
	} catch {
		return false;
	}
}

function playerHue(slot) {
	return PLAYER_HUES[slot % PLAYER_HUES.length];
}

function playerColor(slot, alpha = 1, lightness = 61) {
	return `hsla(${playerHue(slot)}, 96%, ${lightness}%, ${alpha})`;
}

function requestRender() {
	if (animationFrame === null) animationFrame = window.requestAnimationFrame(render);
}

function resizeCanvas() {
	const dpr = Math.min(window.devicePixelRatio || 1, 3);
	viewport = {
		width: Math.max(1, window.innerWidth),
		height: Math.max(1, window.innerHeight),
		dpr,
	};
	canvas.width = Math.round(viewport.width * dpr);
	canvas.height = Math.round(viewport.height * dpr);
	canvas.style.width = `${viewport.width}px`;
	canvas.style.height = `${viewport.height}px`;
	ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

	for (const player of players.values()) {
		if (isRoomSession() && Number.isFinite(player.nx) && Number.isFinite(player.ny)) {
			const point = denormalizePoint(player.nx, player.ny, viewport.width, viewport.height);
			player.x = point.x;
			player.y = point.y;
		} else {
			player.x = Math.min(viewport.width, Math.max(0, player.x));
			player.y = Math.min(viewport.height, Math.max(0, player.y));
		}
	}
	requestRender();
}

function availableSlot() {
	const used = new Set([...players.values()].map((player) => player.slot));
	let slot = 0;
	while (used.has(slot)) slot += 1;
	return slot;
}

function identityName(player, style = roundIdentityStyle) {
	if (style === "numbers") return `Player ${player.slot + 1}`;
	const shape = SHAPES[player.slot % SHAPES.length];
	return `${shape.name} player`;
}

function cryptoRandomIndex(length) {
	if (!Number.isInteger(length) || length < 1) return 0;
	const limit = Math.floor(0x100000000 / length) * length;
	const random = new Uint32Array(1);
	do crypto.getRandomValues(random);
	while (random[0] >= limit);
	return random[0] % length;
}

function serializeRoomPlayer(player) {
	const normalized =
		Number.isFinite(player.nx) && Number.isFinite(player.ny)
			? { nx: player.nx, ny: player.ny }
			: normalizePoint(player.x, player.y, viewport.width, viewport.height);
	return {
		id: String(player.pointerId),
		clientId: String(player.clientId ?? roomTransport?.selfId ?? "local"),
		slot: player.slot,
		nx: normalized.nx,
		ny: normalized.ny,
	};
}

function serializeRoomResult() {
	if (!result) return null;
	const prompt = result.prompt
		? {
				mode: result.prompt.mode,
				category: result.prompt.category,
				text: result.prompt.text,
			}
		: null;
	return {
		winner: serializeRoomPlayer(result.winner),
		identityStyle: result.identityStyle,
		// Legacy clients accept null; current clients read the additive promptV2 field.
		prompt: null,
		promptV2: prompt,
	};
}

function buildRoomSnapshot() {
	const now = performance.now();
	return {
		version: ROOM_PROTOCOL_VERSION,
		kind: "snapshot",
		sequence: ++roomStateSequence,
		hostPeerId: roomTransport?.selfId ?? roomHostPeerId,
		roomCode: activeRoomCode,
		phase: gameState,
		round: roomRound,
		completedRounds,
		identityStyle: roundIdentityStyle,
		countdownRemainingMs:
			gameState === "countdown" ? Math.max(0, countdownDeadline - now) : 0,
		revealElapsedMs:
			gameState === "reveal" ? Math.max(0, now - revealStartedAt) : 0,
		players: [...players.values()].map(serializeRoomPlayer),
		activeFingerIds: [...roomActiveFingerIds],
		settings: {
			promptsEnabled: settings.promptsEnabled,
			mode: settings.mode,
			// Both names keep the immediately previous photo deck and older category deck compatible.
			categories: roomWireCategories(settings.categories),
			haptics: settings.haptics,
		},
		result: serializeRoomResult(),
	};
}

function broadcastRoomSnapshot(target = null, challenge = null) {
	if (!isRoomConnected() || !isRoomHost()) return;
	if (target === null) {
		if (roomSnapshotBroadcastTimeout !== null) {
			window.clearTimeout(roomSnapshotBroadcastTimeout);
			roomSnapshotBroadcastTimeout = null;
		}
		roomLastSnapshotBroadcastAt = performance.now();
	}
	const transport = roomTransport;
	const connectionAttempt = roomConnectionAttempt;
	const snapshot = buildRoomSnapshot();
	if (target && challenge) {
		snapshot.authChallenge = challenge;
		snapshot.authTargetPeerId = target;
	}
	void (async () => {
		const payload = roomCredentials
			? await signRoomSnapshot(snapshot, roomCredentials)
			: snapshot;
		if (
			connectionAttempt !== roomConnectionAttempt ||
			transport !== roomTransport ||
			!isRoomConnected()
		) {
			return;
		}
		await transport.sendState(payload, target);
	})().catch((error) => {
		console.warn("Room state could not be sent:", error);
	});
}

function queueRoomSnapshotBroadcast() {
	if (!isRoomConnected() || !isRoomHost() || roomSnapshotBroadcastTimeout !== null) return;
	const delay = Math.max(
		0,
		ROOM_STATE_BROADCAST_INTERVAL_MS -
			(performance.now() - roomLastSnapshotBroadcastAt),
	);
	if (delay === 0) {
		broadcastRoomSnapshot();
		return;
	}
	roomSnapshotBroadcastTimeout = window.setTimeout(() => {
		roomSnapshotBroadcastTimeout = null;
		broadcastRoomSnapshot();
	}, delay);
}

function sanitizeRoomSettings(value) {
	if (!value || typeof value !== "object") return null;
	const mode = ["truth", "dare", "mix"].includes(value.mode) ? value.mode : null;
	const categories = Array.isArray(value.categories)
		? [
				...new Set(
					value.categories
						.map((category) => toLocalRoomCategory(category))
						.filter(Boolean),
				),
			]
		: [];
	if (!mode || categories.length === 0) return null;
	return {
		promptsEnabled: value.promptsEnabled === true,
		mode,
		categories,
		haptics: value.haptics !== false,
	};
}

function sanitizeRoomPlayer(value) {
	if (!value || typeof value !== "object") return null;
	if (
		typeof value.id !== "string" ||
		value.id.length < 3 ||
		value.id.length > 96 ||
		typeof value.clientId !== "string" ||
		value.clientId.length < 3 ||
		value.clientId.length > 64 ||
		!value.id.startsWith(`${value.clientId}:`) ||
		!Number.isInteger(value.slot) ||
		value.slot < 0 ||
		value.slot >= MAX_ROOM_PLAYERS ||
		!Number.isFinite(value.nx) ||
		!Number.isFinite(value.ny) ||
		value.nx < 0 ||
		value.nx > 1 ||
		value.ny < 0 ||
		value.ny > 1
	) {
		return null;
	}
	const point = denormalizePoint(value.nx, value.ny, viewport.width, viewport.height);
	return {
		pointerId: value.id,
		clientId: value.clientId,
		slot: value.slot,
		nx: value.nx,
		ny: value.ny,
		x: point.x,
		y: point.y,
	};
}

function sanitizeRoomPrompt(value) {
	if (value === null) return null;
	const category = toLocalRoomCategory(value?.category);
	if (
		!value ||
		typeof value !== "object" ||
		!["truth", "dare"].includes(value.mode) ||
		!category ||
		typeof value.text !== "string" ||
		value.text.length < 1 ||
		value.text.length > 500
	) {
		return undefined;
	}
	return Object.freeze({
		mode: value.mode,
		category,
		text: value.text,
	});
}

function sanitizeRoomResult(value, roomPlayers) {
	if (value === null) return null;
	if (!value || typeof value !== "object") return undefined;
	const winner = sanitizeRoomPlayer(value.winner);
	const prompt = sanitizeRoomPrompt(value.promptV2 ?? value.prompt);
	const identityStyle = ["numbers", "shapes"].includes(value.identityStyle)
		? value.identityStyle
		: null;
	if (!winner || prompt === undefined || !identityStyle || !roomPlayers.has(winner.pointerId)) {
		return undefined;
	}
	return { winner, identityStyle, prompt };
}

async function applyRoomSnapshot(payload, peerId, connectionAttempt = roomConnectionAttempt) {
	if (
		isRoomHost() ||
		!payload ||
		typeof payload !== "object" ||
		payload.version !== ROOM_PROTOCOL_VERSION ||
		payload.kind !== "snapshot" ||
		payload.hostPeerId !== peerId ||
		(roomHostPeerId && roomHostPeerId !== peerId) ||
		!Number.isInteger(payload.sequence) ||
		payload.sequence <= lastAppliedRoomSequence ||
		!["idle", "collecting", "countdown", "reveal", "result"].includes(payload.phase) ||
		!["numbers", "shapes"].includes(payload.identityStyle) ||
		!Array.isArray(payload.players) ||
		payload.players.length > MAX_ROOM_PLAYERS ||
		!Array.isArray(payload.activeFingerIds) ||
		payload.activeFingerIds.length > MAX_ROOM_PLAYERS
	) {
		return;
	}
	const snapshotRoomCode =
		payload.roomCode == null ? null : normalizeRoomCode(payload.roomCode);
	if (
		(payload.roomCode != null && !snapshotRoomCode) ||
		(activeRoomCode && snapshotRoomCode !== activeRoomCode)
	) {
		return;
	}
	let expectedCode = activeRoomCode;
	if (roomAuthRequired) {
		const authEpoch = roomAuthEpoch;
		const authWasPending = roomAuthPending;
		const expectedChallenge = roomJoinChallenge;
		const hasTargetedAuth =
			payload.authChallenge !== undefined || payload.authTargetPeerId !== undefined;
		if (
			authWasPending &&
			(payload.authChallenge !== expectedChallenge ||
				payload.authTargetPeerId !== roomTransport?.selfId)
		) {
			return;
		}
		if (!authWasPending && hasTargetedAuth) return;
		if (!expectedCode) {
			expectedCode = snapshotRoomCode;
			if (!expectedCode) return;
			const derivedSecret = await deriveRoomSecret(expectedCode);
			if (
				authEpoch !== roomAuthEpoch ||
				roomAuthPending !== authWasPending ||
				roomJoinChallenge !== expectedChallenge ||
				derivedSecret !== roomSecret
			) {
				return;
			}
		}
		if (!(await verifyRoomSnapshot(payload, expectedCode))) return;
		if (
			authEpoch !== roomAuthEpoch ||
			roomAuthPending !== authWasPending ||
			roomJoinChallenge !== expectedChallenge ||
			connectionAttempt !== roomConnectionAttempt ||
			!roomPeerIds.has(peerId) ||
			(activeRoomCode && activeRoomCode !== expectedCode) ||
			(roomHostPeerId && roomHostPeerId !== peerId) ||
			payload.sequence <= lastAppliedRoomSequence
		) {
			return;
		}
	}

	const nextPlayers = new Map();
	const usedSlots = new Set();
	for (const value of payload.players) {
		const player = sanitizeRoomPlayer(value);
		if (!player || nextPlayers.has(player.pointerId) || usedSlots.has(player.slot)) return;
		nextPlayers.set(player.pointerId, player);
		usedSlots.add(player.slot);
	}

	const nextActiveIds = new Set();
	for (const id of payload.activeFingerIds) {
		if (typeof id !== "string" || !nextPlayers.has(id)) return;
		nextActiveIds.add(id);
	}

	const nextSettings = sanitizeRoomSettings(payload.settings);
	const nextResult = sanitizeRoomResult(payload.result, nextPlayers);
	if (!nextSettings || nextResult === undefined) return;
	if (["reveal", "result"].includes(payload.phase) && !nextResult) return;
	nextSettings.haptics = settings.haptics;

	const previousPhase = gameState;
	const discoveredHost = roomHostPeerId === null;
	roomHostPeerId = peerId;
	if (roomAuthRequired && roomAuthPending) roomAuthEpoch += 1;
	roomAuthPending = false;
	roomJoinChallenge = null;
	if (!activeRoomCode && (expectedCode || snapshotRoomCode)) {
		activeRoomCode = expectedCode || snapshotRoomCode;
	}
	if (discoveredHost && roomSecret) {
		roomLink = makeRoomUrl(
			roomSecret,
			peerId,
			window.location.href,
			roomAuthRequired,
		);
		replaceLocationWithRoom(roomSecret, peerId, roomAuthRequired);
	}
	lastAppliedRoomSequence = payload.sequence;
	roomRound = Number.isInteger(payload.round) && payload.round >= 0 ? payload.round : roomRound;
	completedRounds =
		Number.isInteger(payload.completedRounds) && payload.completedRounds >= 0
			? payload.completedRounds
			: completedRounds;
	roundIdentityStyle = payload.identityStyle;
	body.dataset.identityStyle = roundIdentityStyle;
	players.clear();
	for (const [id, player] of nextPlayers) players.set(id, player);
	roomActiveFingerIds.clear();
	for (const id of nextActiveIds) roomActiveFingerIds.add(id);
	settings = nextSettings;
	result = nextResult;

	const now = performance.now();
	if (payload.phase === "countdown") {
		const remaining = Math.max(
			0,
			Math.min(CHOOSE_DELAY_MS, Number(payload.countdownRemainingMs) || 0),
		);
		countdownDeadline = now + remaining;
		countdownStartedAt = countdownDeadline - CHOOSE_DELAY_MS;
	} else {
		countdownDeadline = 0;
		countdownStartedAt = 0;
	}
	if (payload.phase === "reveal") {
		const elapsed = Math.max(
			0,
			Math.min(WINNER_DISPLAY_DURATION_MS, Number(payload.revealElapsedMs) || 0),
		);
		revealStartedAt = now - elapsed;
	} else revealStartedAt = 0;

	if (result) {
		updateResultContent();
		document.documentElement.style.setProperty("--accent", playerColor(result.winner.slot));
		body.dataset.winnerDevice = String(result.winner.clientId === roomTransport?.selfId);
	} else {
		body.dataset.winnerDevice = "false";
		document.documentElement.style.setProperty("--accent", DEFAULT_ACCENT);
	}

	setGameState(payload.phase);
	buildConnectorTopology();
	updateSettingsSummary();
	updateNextRoundAvailability();
	setRoomMode("connected");
	if (roomDialogOpenedForReconnect) {
		roomDialogOpenedForReconnect = false;
		closeRoomDialog();
	}
	requestRender();

	if (previousPhase !== "reveal" && payload.phase === "reveal" && result) {
		const winnerName = identityName(result.winner, result.identityStyle);
		safeVibrate(result.winner.clientId === roomTransport?.selfId ? [35, 25, 70] : 20);
		announce(
			result.winner.clientId === roomTransport?.selfId
				? `You were chosen as ${winnerName}.`
				: `${winnerName} was chosen on another phone.`,
		);
	}
}

function removePeerFingers(peerId) {
	let changed = false;
	for (const [id, player] of players) {
		if (player.clientId !== peerId) continue;
		roomActiveFingerIds.delete(id);
		roomIntentSequences.delete(id);
		roomLastMoveReceivedAt.delete(id);
		if (!["reveal", "result"].includes(gameState)) players.delete(id);
		changed = true;
	}
	return changed;
}

function handleRoomPeerLeave(peerId) {
	roomPeerIds.delete(peerId);
	roomSyncLastRespondedAt.delete(peerId);
	updateRoomChrome();

	if (isRoomHost()) {
		if (removePeerFingers(peerId)) {
			if (!["reveal", "result"].includes(gameState)) updateStateForPlayers();
			else updateNextRoundAvailability();
		}
		broadcastRoomSnapshot();
		return;
	}

	if (peerId === roomHostPeerId) {
		if (roomAuthRequired) {
			roomAuthEpoch += 1;
			roomAuthPending = true;
			roomJoinChallenge = createRoomSecret();
		}
		setRoomMode("joining", "Reconnecting to the room host.");
		showRoomReconnectDialog();
	}
}

async function connectSharedRoom(
	secret,
	role,
	expectedHostId = null,
	code = null,
	credentials = null,
	authenticated = false,
) {
	const connectionAttempt = ++roomConnectionAttempt;
	clearRoomConnectionTimers();
	roomSecret = secret;
	activeRoomCode = normalizeRoomCode(code);
	roomCredentials = role === "host" ? credentials : null;
	roomAuthRequired = role === "host" ? Boolean(credentials) : Boolean(authenticated || activeRoomCode);
	roomAuthPending = role === "guest" && roomAuthRequired;
	roomAuthEpoch += 1;
	roomJoinChallenge = roomAuthPending ? createRoomSecret() : null;
	roomRole = role;
	roomHostPeerId = role === "guest" ? expectedHostId : null;
	roomStateSequence = 0;
	lastAppliedRoomSequence = 0;
	roomPeerIds.clear();
	roomSyncLastRespondedAt.clear();
	roomLink =
		role === "guest" && expectedHostId
			? makeRoomUrl(secret, expectedHostId, window.location.href, roomAuthRequired)
			: "";
	if (role === "guest" && !localSettingsBeforeRoom) {
		localSettingsBeforeRoom = { ...settings, categories: [...settings.categories] };
	} else if (role === "host") localSettingsBeforeRoom = null;
	body.dataset.winnerDevice = "false";
	setRoomMode("joining");
	showRoomDialog();

	try {
		const transport = await connectRoom({
			secret,
			onPeerJoin(peerId) {
				if (connectionAttempt !== roomConnectionAttempt) return;
				roomPeerIds.add(peerId);
				updateRoomChrome();
				if (isRoomHost()) window.queueMicrotask(() => broadcastRoomSnapshot(peerId));
				else scheduleRoomSnapshotRequests(peerId, connectionAttempt);
			},
			onPeerLeave(peerId) {
				if (connectionAttempt === roomConnectionAttempt) {
					handleRoomPeerLeave(peerId);
				}
			},
			onState(payload, peerId) {
				if (connectionAttempt !== roomConnectionAttempt) return;
				void applyRoomSnapshot(payload, peerId, connectionAttempt).catch((error) => {
					console.warn("Room state could not be verified:", error);
				});
			},
			onIntent(payload, peerId) {
				if (connectionAttempt !== roomConnectionAttempt || !isRoomHost()) return;
				const intent = sanitizeFingerIntent(payload, peerId);
				if (intent) handleRoomFingerIntent(intent, peerId);
			},
			onSync(payload, peerId) {
				if (connectionAttempt === roomConnectionAttempt && isRoomHost()) {
					const now = performance.now();
					const lastResponse = roomSyncLastRespondedAt.get(peerId) ?? -Infinity;
					if (now - lastResponse < ROOM_SYNC_RESPONSE_INTERVAL_MS) return;
					roomSyncLastRespondedAt.set(peerId, now);
					const challenge = ROOM_CHALLENGE_PATTERN.test(payload?.challenge)
						? payload.challenge
						: null;
					if (payload !== null && !challenge) return;
					broadcastRoomSnapshot(peerId, challenge);
				}
			},
			onError(details) {
				if (connectionAttempt !== roomConnectionAttempt) return;
				const message = typeof details?.error === "string" ? details.error : "Peer connection failed.";
				console.warn("Pick and Do room connection warning:", message);
				if (
					!isRoomHost() &&
					roomMode !== "connected" &&
					(!details?.peerId || details.peerId === roomHostPeerId)
				) {
					setRoomMode(
						"joining",
						"This connection is taking longer than usual. Keep both room pages open while we retry.",
					);
				}
			},
		});

		if (
			connectionAttempt !== roomConnectionAttempt ||
			roomSecret !== secret ||
			["local", "error"].includes(roomMode)
		) {
			transport.leave();
			return;
		}

		roomTransport = transport;
		for (const peerId of transport.getPeerIds()) roomPeerIds.add(peerId);
		if (isRoomHost()) {
			roomHostPeerId = transport.selfId;
			roomLink = makeRoomUrl(
				secret,
				transport.selfId,
				window.location.href,
				roomAuthRequired,
			);
			replaceLocationWithRoom(secret, transport.selfId, roomAuthRequired);
			setRoomMode("connected");
			broadcastRoomSnapshot();
		} else {
			startRoomJoinTimeout(connectionAttempt);
			if (roomHostPeerId && roomPeerIds.has(roomHostPeerId)) {
				scheduleRoomSnapshotRequests(roomHostPeerId, connectionAttempt);
			} else {
				for (const peerId of roomPeerIds) {
					scheduleRoomSnapshotRequests(peerId, connectionAttempt);
				}
			}
			updateRoomChrome();
		}
	} catch (error) {
		if (connectionAttempt !== roomConnectionAttempt) return;
		console.error("Shared room could not start:", error);
		roomConnectionAttempt += 1;
		clearRoomConnectionTimers();
		setRoomMode(
			"error",
			"The secure room service is unavailable right now. Pick and Do still works offline.",
		);
		showRoomDialog();
	}
}

function replaceLocationWithRoom(secret, hostId, authenticated = false) {
	const nextUrl = new URL(
		makeRoomUrl(secret, hostId, window.location.href, authenticated),
	);
	history.replaceState(null, "", `${nextUrl.pathname}${nextUrl.search}${nextUrl.hash}`);
}

function normalizeRoomCodeDraft(value) {
	return value
		.toUpperCase()
		.replace(/[IL]/g, "1")
		.replace(/O/g, "0")
		.replace(/[^0-9A-HJKMNP-TV-Z]/g, "")
		.slice(0, 6);
}

function formatRoomCodeDraft(value) {
	return normalizeRoomCodeDraft(value);
}

function showRoomLobby() {
	if (roomMode !== "local") return;
	setRoomCodeError();
	setRoomLobbyBusy(false);
	showRoomDialog();
}

async function createSharedRoom() {
	if (roomMode !== "local" || roomLobbyBusy) return;
	const operation = ++roomLobbyOperation;
	setRoomCodeError();
	setRoomLobbyBusy(true);
	try {
		const credentials = await createRoomCredentials();
		if (operation !== roomLobbyOperation || roomMode !== "local" || !roomDialog.open) return;
		prepareNextRound({ broadcast: false });
		void connectSharedRoom(
			credentials.secret,
			"host",
			null,
			credentials.code,
			credentials,
		);
	} catch (error) {
		if (operation !== roomLobbyOperation || !roomDialog.open) return;
		console.error("Room code could not be created:", error);
		setRoomCodeError("A secure room code couldn’t be created on this device.");
	} finally {
		if (operation === roomLobbyOperation) setRoomLobbyBusy(false);
	}
}

async function joinSharedRoomByCode(value) {
	if (roomMode !== "local" || roomLobbyBusy) return;
	const code = normalizeRoomCode(value);
	if (!code) {
		setRoomCodeError("Enter the complete 6-character room code.");
		roomCodeInput.focus();
		return;
	}

	const operation = ++roomLobbyOperation;
	setRoomCodeError();
	setRoomLobbyBusy(true);
	try {
		const secret = await deriveRoomSecret(code);
		if (operation !== roomLobbyOperation || roomMode !== "local" || !roomDialog.open) return;
		prepareNextRound({ broadcast: false });
		void connectSharedRoom(secret, "guest", null, code);
	} catch (error) {
		if (operation !== roomLobbyOperation || !roomDialog.open) return;
		console.error("Room code could not be opened:", error);
		setRoomCodeError("This room code couldn’t be opened on this device.");
	} finally {
		if (operation === roomLobbyOperation) setRoomLobbyBusy(false);
	}
}

function retrySharedRoom() {
	if (roomMode !== "error" || !roomSecret) return;
	const role = roomRole;
	const expectedHostId = role === "guest" ? roomHostPeerId : null;
	prepareNextRound({ broadcast: false });
	void connectSharedRoom(
		roomSecret,
		role,
		expectedHostId,
		activeRoomCode,
		role === "host" ? roomCredentials : null,
		roomAuthRequired,
	);
}

function resumeSharedRoomConnection() {
	const hostPeerId = roomHostPeerId;
	const action = getRoomResumeAction({
		hidden: document.hidden,
		roomMode,
		roomRole,
		hasSecret: Boolean(roomSecret),
		hasTransport: Boolean(roomTransport),
		hasHostPeer: Boolean(hostPeerId && roomPeerIds.has(hostPeerId)),
	});

	if (action === "broadcast") {
		broadcastRoomSnapshot();
		return;
	}
	if (action === "wait") {
		setRoomMode("joining", "Reconnecting to the room host.");
		showRoomReconnectDialog();
		return;
	}
	if (action !== "sync" || !hostPeerId || !roomTransport) return;

	if (roomMode === "joining") {
		scheduleRoomSnapshotRequests(hostPeerId, roomConnectionAttempt);
		return;
	}

	const transport = roomTransport;
	const connectionAttempt = roomConnectionAttempt;
	const syncData = roomJoinChallenge ? { challenge: roomJoinChallenge } : null;
	transport.sendSync(hostPeerId, syncData).catch(() => {
		if (
			document.hidden ||
			connectionAttempt !== roomConnectionAttempt ||
			transport !== roomTransport ||
			roomMode === "local"
		) {
			return;
		}
		setRoomMode("joining", "Reconnecting to the room host.");
		showRoomReconnectDialog();
		scheduleRoomSnapshotRequests(hostPeerId, connectionAttempt);
	});
}

function restoreLocalSettings() {
	if (!localSettingsBeforeRoom) return;
	settings = localSettingsBeforeRoom;
	localSettingsBeforeRoom = null;
	syncSettingsControls();
}

function leaveSharedRoom() {
	if (roomMode === "local") return;
	roomConnectionAttempt += 1;
	clearRoomConnectionTimers();
	roomTransport?.leave();
	roomTransport = null;
	roomPeerIds.clear();
	localRoomFingerIds.clear();
	roomActiveFingerIds.clear();
	roomIntentSequences.clear();
	roomOutgoingSequences.clear();
	roomLastMoveSentAt.clear();
	roomLastMoveReceivedAt.clear();
	physicalPointers.clear();
	roomSecret = null;
	activeRoomCode = null;
	roomCredentials = null;
	roomJoinChallenge = null;
	roomAuthRequired = false;
	roomAuthPending = false;
	roomAuthEpoch += 1;
	roomSyncLastRespondedAt.clear();
	roomLink = "";
	roomHostPeerId = null;
	roomRole = "guest";
	roomDialogOpenedForReconnect = false;
	roomStateSequence = 0;
	lastAppliedRoomSequence = 0;
	restoreLocalSettings();
	const localUrl = new URL(window.location.href);
	localUrl.searchParams.delete("room-auth");
	localUrl.hash = "";
	history.replaceState(null, "", `${localUrl.pathname}${localUrl.search}`);
	closeRoomDialog();
	prepareNextRound({ broadcast: false });
	setRoomMode("local");
	announce("Shared room closed. Pick and Do is ready.");
}

function initializeRoomFromLocation() {
	const invite = parseRoomHash(window.location.hash);
	if (invite) {
		void connectSharedRoom(
			invite.secret,
			"guest",
			invite.hostId,
			null,
			null,
			roomUrlRequiresAuth(window.location.href),
		);
		return;
	}
	if (window.location.hash.startsWith("#room=")) {
		roomRole = "guest";
		setRoomMode("error", "This invite link is incomplete or invalid. Ask the host to share it again.");
		showRoomDialog();
	}
}

function buildConnectorTopology() {
	const nodes = [...players.values()];
	connectorEdges = [];
	connectorRoute = [];

	if (nodes.length < 2) {
		collectingPanel.dataset.connectorCount = "0";
		collectingPanel.dataset.travelingDotCount = "0";
		return;
	}

	const connectedIds = new Set([nodes[0].pointerId]);
	while (connectedIds.size < nodes.length) {
		let shortest = null;

		for (const from of nodes) {
			if (!connectedIds.has(from.pointerId)) continue;
			for (const to of nodes) {
				if (connectedIds.has(to.pointerId)) continue;
				const distance = Math.hypot(to.x - from.x, to.y - from.y);
				if (!shortest || distance < shortest.distance) {
					shortest = { from: from.pointerId, to: to.pointerId, distance };
				}
			}
		}

		if (!shortest) break;
		connectorEdges.push({
			a: shortest.from,
			b: shortest.to,
		});
		connectedIds.add(shortest.to);
	}

	collectingPanel.dataset.connectorCount = String(connectorEdges.length);
	const adjacency = new Map(
		nodes.map((player) => [player.pointerId, []]),
	);
	for (const edge of connectorEdges) {
		adjacency.get(edge.a)?.push(edge.b);
		adjacency.get(edge.b)?.push(edge.a);
	}

	const visit = (pointerId, parentId = null) => {
		connectorRoute.push(pointerId);
		for (const neighborId of adjacency.get(pointerId) ?? []) {
			if (neighborId === parentId) continue;
			visit(neighborId, pointerId);
			connectorRoute.push(pointerId);
		}
	};
	visit(nodes[0].pointerId);
	collectingPanel.dataset.travelingDotCount = "1";
}

function beginCountdown(now = performance.now()) {
	if (isRoomHost() && gameState !== "countdown") roomRound += 1;
	countdownStartedAt = now;
	countdownDeadline = now + CHOOSE_DELAY_MS;
	hapticMilestonesFired = 0;
	setGameState("countdown");
	requestRender();
}

function updateStateForPlayers(now = performance.now()) {
	buildConnectorTopology();
	if (isRoomSession() && !isRoomHost()) {
		requestRender();
		return;
	}
	if (players.size >= MIN_PLAYERS) {
		beginCountdown(now);
	} else if (players.size === 1) {
		countdownStartedAt = 0;
		countdownDeadline = 0;
		setGameState("collecting");
		requestRender();
	} else {
		countdownStartedAt = 0;
		countdownDeadline = 0;
		setGameState("idle");
		requestRender();
	}
}

function addPlayer(event) {
	if (players.has(event.pointerId)) return;
	const slot = availableSlot();
	const player = {
		pointerId: event.pointerId,
		slot,
		x: event.clientX,
		y: event.clientY,
	};
	players.set(event.pointerId, player);
	announce(`${identityName(player)} connected.`);
	updateStateForPlayers();
}

function updatePlayer(event) {
	const player = players.get(event.pointerId);
	if (!player) return;
	player.x = event.clientX;
	player.y = event.clientY;
	requestRender();
}

function removePlayer(event) {
	const player = players.get(event.pointerId);
	if (!player) return;
	players.delete(event.pointerId);
	announce(`${identityName(player)} disconnected.`);
	updateStateForPlayers();
}

function handleRoomFingerIntent(intent, peerId) {
	if (!isRoomHost() || peerId !== intent.id.split(":", 1)[0]) return;
	const existing = players.get(intent.id);
	if (intent.type === "down") {
		if (["reveal", "result"].includes(gameState) || existing) return;
		const previousSequence = roomIntentSequences.get(intent.id) ?? -1;
		if (intent.seq <= previousSequence) return;
		if (!existing && players.size >= MAX_ROOM_PLAYERS) return;
		roomIntentSequences.set(intent.id, intent.seq);
		const point = denormalizePoint(intent.nx, intent.ny, viewport.width, viewport.height);
		const player = {
			pointerId: intent.id,
			clientId: peerId,
			slot: availableSlot(),
		};
		player.nx = intent.nx;
		player.ny = intent.ny;
		player.x = point.x;
		player.y = point.y;
		players.set(intent.id, player);
		roomActiveFingerIds.add(intent.id);
		updateStateForPlayers();
		broadcastRoomSnapshot();
		return;
	}

	if (!existing || existing.clientId !== peerId) return;
	const previousSequence = roomIntentSequences.get(intent.id) ?? -1;
	if (intent.seq <= previousSequence) return;
	roomIntentSequences.set(intent.id, intent.seq);
	if (intent.type === "move") {
		if (!roomActiveFingerIds.has(intent.id) || ["reveal", "result"].includes(gameState)) return;
		const receivedAt = performance.now();
		if (
			receivedAt - (roomLastMoveReceivedAt.get(intent.id) ?? 0) <
			ROOM_RECEIVE_MOVE_INTERVAL_MS
		) {
			return;
		}
		roomLastMoveReceivedAt.set(intent.id, receivedAt);
		const point = denormalizePoint(intent.nx, intent.ny, viewport.width, viewport.height);
		existing.nx = intent.nx;
		existing.ny = intent.ny;
		existing.x = point.x;
		existing.y = point.y;
		buildConnectorTopology();
		requestRender();
		queueRoomSnapshotBroadcast();
		return;
	}

	roomActiveFingerIds.delete(intent.id);
	roomIntentSequences.delete(intent.id);
	roomLastMoveReceivedAt.delete(intent.id);
	if (!["reveal", "result"].includes(gameState)) {
		players.delete(intent.id);
		updateStateForPlayers();
	} else updateNextRoundAvailability();
	broadcastRoomSnapshot();
}

function polygonPath(sides, radius, rotation) {
	for (let point = 0; point < sides; point += 1) {
		const angle = rotation + (point / sides) * Math.PI * 2;
		const x = Math.cos(angle) * radius;
		const y = Math.sin(angle) * radius;
		if (point === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.closePath();
}

function shapePath(shape, radius) {
	if (shape.kind === "polygon") {
		polygonPath(shape.sides, radius, shape.rotation);
		return;
	}

	if (shape.kind === "star") {
		for (let point = 0; point < 10; point += 1) {
			const angle = -Math.PI / 2 + (point / 10) * Math.PI * 2;
			const pointRadius = point % 2 === 0 ? radius : radius * 0.44;
			const x = Math.cos(angle) * pointRadius;
			const y = Math.sin(angle) * pointRadius;
			if (point === 0) ctx.moveTo(x, y);
			else ctx.lineTo(x, y);
		}
		ctx.closePath();
		return;
	}

	if (shape.kind === "cross") {
		const outer = radius;
		const inner = radius * 0.36;
		ctx.moveTo(-inner, -outer);
		ctx.lineTo(inner, -outer);
		ctx.lineTo(inner, -inner);
		ctx.lineTo(outer, -inner);
		ctx.lineTo(outer, inner);
		ctx.lineTo(inner, inner);
		ctx.lineTo(inner, outer);
		ctx.lineTo(-inner, outer);
		ctx.lineTo(-inner, inner);
		ctx.lineTo(-outer, inner);
		ctx.lineTo(-outer, -inner);
		ctx.lineTo(-inner, -inner);
		ctx.closePath();
		return;
	}

	if (shape.kind === "heart") {
		ctx.moveTo(0, radius * 0.9);
		ctx.bezierCurveTo(-radius * 1.05, radius * 0.25, -radius, -radius * 0.7, -radius * 0.42, -radius * 0.72);
		ctx.bezierCurveTo(-radius * 0.12, -radius * 0.74, 0, -radius * 0.45, 0, -radius * 0.28);
		ctx.bezierCurveTo(0, -radius * 0.45, radius * 0.12, -radius * 0.74, radius * 0.42, -radius * 0.72);
		ctx.bezierCurveTo(radius, -radius * 0.7, radius * 1.05, radius * 0.25, 0, radius * 0.9);
		ctx.closePath();
		return;
	}

	if (shape.kind === "bolt") {
		ctx.moveTo(radius * 0.16, -radius);
		ctx.lineTo(-radius * 0.65, radius * 0.05);
		ctx.lineTo(-radius * 0.08, radius * 0.05);
		ctx.lineTo(-radius * 0.28, radius);
		ctx.lineTo(radius * 0.7, -radius * 0.18);
		ctx.lineTo(radius * 0.08, -radius * 0.18);
		ctx.closePath();
		return;
	}

	ctx.arc(0, 0, radius, 0, Math.PI * 2);
}

function beginPlayerHaloPath(player, radius, style = roundIdentityStyle) {
	ctx.beginPath();
	if (style === "numbers") {
		ctx.arc(player.x, player.y, radius, 0, Math.PI * 2);
		return;
	}

	ctx.save();
	ctx.translate(player.x, player.y);
	shapePath(SHAPES[player.slot % SHAPES.length], radius);
	ctx.restore();
}

function shapePerimeter(shape, radius) {
	if (shape.kind === "polygon") {
		return 2 * shape.sides * radius * Math.sin(Math.PI / shape.sides);
	}
	if (shape.kind === "star") {
		const innerRadius = radius * 0.44;
		const edge = Math.sqrt(
			radius ** 2 +
				innerRadius ** 2 -
				2 * radius * innerRadius * Math.cos(Math.PI / 5),
		);
		return edge * 10;
	}
	if (shape.kind === "cross") return radius * 7.7;
	if (shape.kind === "heart") return radius * 6.2;
	if (shape.kind === "bolt") return radius * 6.8;
	return Math.PI * 2 * radius;
}

function drawIdentity(player, style, scale = 1, alpha = 1) {
	ctx.save();
	ctx.translate(player.x, player.y);
	ctx.globalAlpha *= alpha;
	ctx.fillStyle = "#ffffff";
	ctx.strokeStyle = "#ffffff";
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.shadowColor = "rgba(255, 255, 255, 0.28)";
	ctx.shadowBlur = 10 * scale;

	if (style === "numbers") {
		ctx.font = `750 ${Math.round(23 * scale)}px "Avenir Next", "Segoe UI", sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(String(player.slot + 1), 0, 1 * scale);
	} else {
		ctx.beginPath();
		shapePath(SHAPES[player.slot % SHAPES.length], 12.5 * scale);
		ctx.lineWidth = Math.max(1.8, 2.4 * scale);
		ctx.stroke();
	}
	ctx.restore();
}

function drawIdentityBadge(player, style, scale = 1, alpha = 1) {
	const offset = 52 * scale;
	const badge = {
		...player,
		x: player.x > viewport.width - 72 * scale ? player.x - offset : player.x + offset,
		y: player.y < 72 * scale ? player.y + offset : player.y - offset,
	};

	ctx.save();
	ctx.globalAlpha = alpha;
	ctx.beginPath();
	ctx.fillStyle = "rgba(5, 6, 8, 0.94)";
	ctx.strokeStyle = playerColor(player.slot, 0.72);
	ctx.lineWidth = Math.max(1, 1.4 * scale);
	ctx.arc(badge.x, badge.y, 15.5 * scale, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();
	ctx.restore();
	drawIdentity(badge, style, 0.62 * scale, alpha);
}

function drawPlayer(player, progress = 0, alpha = 1, scale = 1) {
	const outerRadius = 47 * scale;
	const innerRadius = 34 * scale;
	const isShapeRound = roundIdentityStyle === "shapes";
	ctx.save();
	ctx.globalAlpha = alpha;

	beginPlayerHaloPath(player, outerRadius);
	ctx.strokeStyle = playerColor(player.slot, 0.95);
	ctx.lineWidth = 2.4 * scale;
	ctx.shadowColor = playerColor(player.slot, 0.8);
	ctx.shadowBlur = 16 * scale;
	ctx.stroke();

	ctx.shadowBlur = 0;
	beginPlayerHaloPath(player, innerRadius);
	ctx.fillStyle = "rgba(3, 4, 7, 0.92)";
	ctx.strokeStyle = playerColor(player.slot, 0.38);
	ctx.lineWidth = 1;
	ctx.fill();
	ctx.stroke();

	if (progress > 0) {
		ctx.strokeStyle = playerColor(player.slot, 0.98, 72);
		ctx.lineCap = "round";
		ctx.lineWidth = 4 * scale;
		ctx.shadowColor = playerColor(player.slot, 0.9);
		ctx.shadowBlur = 13 * scale;
		if (isShapeRound) {
			const progressRadius = outerRadius + 8 * scale;
			const perimeter = shapePerimeter(
				SHAPES[player.slot % SHAPES.length],
				progressRadius,
			);
			beginPlayerHaloPath(player, progressRadius);
			ctx.setLineDash([
				Math.max(0.01, Math.min(1, progress)) * perimeter,
				perimeter + 2,
			]);
		} else {
			ctx.beginPath();
			ctx.arc(
				player.x,
				player.y,
				outerRadius + 8 * scale,
				-Math.PI / 2,
				-Math.PI / 2 + Math.PI * 2 * Math.min(1, progress),
			);
		}
		ctx.stroke();
		ctx.setLineDash([]);
	}

	ctx.restore();
	if (!isShapeRound) {
		drawIdentity(player, roundIdentityStyle, scale, alpha);
		drawIdentityBadge(player, roundIdentityStyle, scale, alpha);
	}
}

function drawTravelingConnectorDot(now, opacity) {
	if (connectorRoute.length < 2) return;

	const segments = [];
	let routeLength = 0;
	for (let index = 1; index < connectorRoute.length; index += 1) {
		const from = players.get(connectorRoute[index - 1]);
		const to = players.get(connectorRoute[index]);
		if (!from || !to) continue;
		const length = Math.hypot(to.x - from.x, to.y - from.y);
		if (length < 1) continue;
		segments.push({ from, to, length, startsAt: routeLength });
		routeLength += length;
	}
	if (routeLength < 1) return;

	const elapsed = Math.max(0, now - countdownStartedAt);
	const routeDuration = Math.min(
		900,
		Math.max(280, routeLength / ELECTRIC_DOT_SPEED),
	);
	const distance = ((elapsed % routeDuration) / routeDuration) * routeLength;
	const segment =
		segments.find(
			(candidate) => distance < candidate.startsAt + candidate.length,
		) ?? segments[segments.length - 1];
	const progress = (distance - segment.startsAt) / segment.length;
	const x = segment.from.x + (segment.to.x - segment.from.x) * progress;
	const y = segment.from.y + (segment.to.y - segment.from.y) * progress;

	ctx.save();
	ctx.globalAlpha = opacity;
	ctx.globalCompositeOperation = "lighter";
	ctx.fillStyle = "#ffffff";
	ctx.shadowColor = "rgba(64, 218, 255, 0.98)";
	ctx.shadowBlur = 17;
	ctx.beginPath();
	ctx.arc(x, y, 3.1, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

function drawConnectors(now, opacity = 1) {
	if (connectorEdges.length === 0) return;

	ctx.save();
	ctx.strokeStyle = `rgba(151, 225, 255, ${0.055 * opacity})`;
	ctx.lineWidth = 1;
	for (const edge of connectorEdges) {
		const from = players.get(edge.a);
		const to = players.get(edge.b);
		if (!from || !to) continue;
		ctx.beginPath();
		ctx.moveTo(from.x, from.y);
		ctx.lineTo(to.x, to.y);
		ctx.stroke();
	}
	ctx.restore();

	if (motionQuery.matches) return;

	drawTravelingConnectorDot(now, opacity);
}

function easeOutQuint(value) {
	return 1 - Math.pow(1 - value, 5);
}

function farthestCornerRadius(x, y) {
	return Math.hypot(
		Math.max(x, viewport.width - x),
		Math.max(y, viewport.height - y),
	);
}

function isWinnerDevice() {
	return !isRoomSession() || result?.winner.clientId === roomTransport?.selfId;
}

function drawObserverReveal(now) {
	const progress = Math.min(
		1,
		Math.max(0, (now - revealStartedAt) / REVEAL_ANIMATION_DURATION_MS),
	);
	const eased = easeOutQuint(progress);
	const winnerId = result.winner.pointerId;
	ctx.fillStyle = "#050608";
	ctx.fillRect(0, 0, viewport.width, viewport.height);
	drawConnectors(now, Math.max(0, 1 - progress * 1.4));
	for (const player of players.values()) {
		const isWinner = player.pointerId === winnerId;
		drawPlayer(
			player,
			1,
			isWinner ? 1 : Math.max(0.12, 1 - progress * 1.25),
			isWinner ? 1 + eased * 0.32 : 1,
		);
	}
}

function drawReveal(now) {
	if (!isWinnerDevice()) {
		drawObserverReveal(now);
		return;
	}
	const progress = Math.min(
		1,
		(now - revealStartedAt) / REVEAL_ANIMATION_DURATION_MS,
	);
	const eased = easeOutQuint(progress);
	const winner = result.winner;
	const hue = playerHue(winner.slot);

	ctx.fillStyle = "#050608";
	ctx.fillRect(0, 0, viewport.width, viewport.height);
	drawConnectors(now, Math.max(0, 1 - progress * 1.6));

	for (const player of players.values()) {
		drawPlayer(player, 1, Math.max(0, 1 - progress * 1.8), 1);
	}

	ctx.save();
	ctx.beginPath();
	ctx.fillStyle = `hsl(${hue} 68% 13%)`;
	ctx.shadowColor = playerColor(winner.slot, 0.75);
	ctx.shadowBlur = 46;
	ctx.arc(
		winner.x,
		winner.y,
		Math.max(1, farthestCornerRadius(winner.x, winner.y) * eased),
		0,
		Math.PI * 2,
	);
	ctx.fill();
	ctx.restore();
	if (result.identityStyle === "shapes") {
		ctx.save();
		ctx.translate(winner.x, winner.y);
		ctx.beginPath();
		shapePath(
			SHAPES[winner.slot % SHAPES.length],
			Math.max(1, farthestCornerRadius(winner.x, winner.y) * eased * 1.45),
		);
		ctx.globalAlpha = 0.34;
		ctx.fillStyle = `hsl(${hue} 82% 22%)`;
		ctx.fill();
		ctx.restore();
	}

	drawPlayer(winner, 1, 1, 1 + eased * 0.34);
}

function drawWinnerWatermark() {
	const winner = result.winner;
	const centerPlayer = {
		...winner,
		x: viewport.width / 2,
		y: viewport.height / 2,
	};

	ctx.save();
	ctx.globalAlpha = 0.045;
	if (result.identityStyle === "numbers") {
		ctx.fillStyle = "#fff";
		ctx.font = `800 ${Math.round(Math.min(viewport.width, viewport.height) * 0.58)}px "Avenir Next", "Segoe UI", sans-serif`;
		ctx.textAlign = "center";
		ctx.textBaseline = "middle";
		ctx.fillText(String(winner.slot + 1), centerPlayer.x, centerPlayer.y);
	} else {
		ctx.translate(centerPlayer.x, centerPlayer.y);
		ctx.beginPath();
		shapePath(
			SHAPES[winner.slot % SHAPES.length],
			Math.min(viewport.width, viewport.height) * 0.28,
		);
		ctx.strokeStyle = "#fff";
		ctx.lineWidth = 7;
		ctx.stroke();
	}
	ctx.restore();
}

function drawResult() {
	const winner = result.winner;
	const hue = playerHue(winner.slot);
	if (!isWinnerDevice()) {
		ctx.fillStyle = "#050608";
		ctx.fillRect(0, 0, viewport.width, viewport.height);
		const currentWinner = players.get(winner.pointerId) ?? winner;
		for (const player of players.values()) {
			if (player.pointerId !== winner.pointerId) drawPlayer(player, 1, 0.1, 1);
		}
		drawPlayer(currentWinner, 1, 1, 1.28);
		return;
	}
	const radius = Math.max(viewport.width, viewport.height) * 0.78;
	const gradient = ctx.createRadialGradient(
		winner.x,
		winner.y,
		0,
		winner.x,
		winner.y,
		radius,
	);
	gradient.addColorStop(0, `hsl(${hue} 72% 17%)`);
	gradient.addColorStop(0.58, `hsl(${hue} 58% 10%)`);
	gradient.addColorStop(1, "#050608");
	ctx.fillStyle = gradient;
	ctx.fillRect(0, 0, viewport.width, viewport.height);
	drawWinnerWatermark();
}

function maybePlayCountdownHaptic(now) {
	const elapsed = now - countdownStartedAt;
	const reached = Math.min(
		4,
		Math.floor(elapsed / COUNTDOWN_HAPTIC_INTERVAL_MS),
	);
	if (reached <= hapticMilestonesFired) return;
	hapticMilestonesFired = reached;
	safeVibrate(7);
}

function updateResultContent() {
	if (!result) return;
	const winnerName = identityName(result.winner, result.identityStyle);
	const winnerDevice = isWinnerDevice();
	if (result.prompt) {
		const ownerLabel =
			isRoomSession() && winnerDevice
				? "You’re chosen"
				: winnerName;
		resultMeta.textContent = `${ownerLabel} · ${result.prompt.mode} · ${CATEGORIES[result.prompt.category].label}`;
		resultPrompt.textContent = result.prompt.text;
		resultPrompt.classList.toggle("long-prompt", result.prompt.text.length > 135);
		resultPrompt.classList.toggle("very-long-prompt", result.prompt.text.length > 190);
		return;
	}
	resultMeta.textContent =
		isRoomSession() && winnerDevice
			? "You’re chosen"
			: isRoomSession()
				? "Chosen on another phone"
				: "Chosen";
	resultPrompt.textContent = winnerName;
	resultPrompt.classList.remove("long-prompt", "very-long-prompt");
}

function commitResult(now) {
	if (gameState !== "countdown" || players.size < MIN_PLAYERS) return;
	if (isRoomSession() && !isRoomHost()) return;
	const candidates = [...players.values()];
	const winner = candidates[cryptoRandomIndex(candidates.length)];
	const prompt = settings.promptsEnabled
		? promptPicker.pick({
				mode: settings.mode,
				enabledCategories: settings.categories,
			})
		: null;
	const frozenWinner = { ...winner };

	result = {
		winner: frozenWinner,
		identityStyle: roundIdentityStyle,
		prompt,
	};
	completedRounds += 1;
	revealStartedAt = now;
	const winnerName = identityName(frozenWinner, result.identityStyle);
	body.dataset.winnerDevice = String(isWinnerDevice());
	updateResultContent();
	document.documentElement.style.setProperty("--accent", playerColor(winner.slot));
	setGameState("reveal");
	updateNextRoundAvailability();
	safeVibrate(isWinnerDevice() ? [35, 25, 70] : 20);
	broadcastRoomSnapshot();
	announce(
		result.prompt
			? `${winnerName} was chosen. ${titleCase(result.prompt.mode)}: ${result.prompt.text}`
			: `${winnerName} was chosen.`,
	);
}

function updateCountdownText(now) {
	const remaining = Math.max(0, (countdownDeadline - now) / 1000);
	countdownLabel.textContent = `Choosing in ${remaining.toFixed(1)}`;
	playerCount.textContent = `${players.size} players connected`;
}

function render(now) {
	animationFrame = null;

	if (gameState === "countdown" && now >= countdownDeadline) commitResult(now);

	ctx.fillStyle = "#050608";
	ctx.fillRect(0, 0, viewport.width, viewport.height);

	if (gameState === "collecting") {
		for (const player of players.values()) drawPlayer(player);
	} else if (gameState === "countdown") {
		const progress = Math.min(1, (now - countdownStartedAt) / CHOOSE_DELAY_MS);
		updateCountdownText(now);
		maybePlayCountdownHaptic(now);
		drawConnectors(now);
		for (const player of players.values()) drawPlayer(player, progress);
	} else if (gameState === "reveal") {
		if (now - revealStartedAt >= WINNER_DISPLAY_DURATION_MS) {
			setGameState("result");
			updateNextRoundAvailability();
			drawResult();
			broadcastRoomSnapshot();
		} else drawReveal(now);
	} else if (gameState === "result") {
		drawResult();
	}

	if (["countdown", "reveal"].includes(gameState)) requestRender();
}

function resetGesture() {
	activeChord = null;
	previousChord = null;
}

function prepareNextRound({ broadcast = isRoomConnected() && isRoomHost() } = {}) {
	players.clear();
	physicalPointers.clear();
	localRoomFingerIds.clear();
	roomActiveFingerIds.clear();
	roomIntentSequences.clear();
	roomOutgoingSequences.clear();
	roomLastMoveSentAt.clear();
	roomLastMoveReceivedAt.clear();
	connectorEdges = [];
	connectorRoute = [];
	countdownStartedAt = 0;
	countdownDeadline = 0;
	hapticMilestonesFired = 0;
	result = null;
	resultPrompt.classList.remove("long-prompt", "very-long-prompt");
	roundIdentityStyle = completedRounds % 2 === 0 ? "numbers" : "shapes";
	body.dataset.identityStyle = roundIdentityStyle;
	collectingPanel.dataset.connectorCount = "0";
	collectingPanel.dataset.travelingDotCount = "0";
	document.documentElement.style.setProperty("--accent", DEFAULT_ACCENT);
	body.dataset.winnerDevice = "false";
	resetGesture();
	setGameState("idle");
	requestRender();
	if (broadcast) broadcastRoomSnapshot();
}

function updateNextRoundAvailability() {
	if (isRoomSession() && !isRoomHost()) {
		nextRoundButton.disabled = true;
		nextRoundLabel.textContent = "Host starts next";
		return;
	}
	const waiting = isRoomHost() ? roomActiveFingerIds.size > 0 : physicalPointers.size > 0;
	nextRoundButton.disabled = waiting;
	nextRoundLabel.textContent = waiting
		? isRoomHost()
			? "Everyone lifts"
			: "Lift fingers"
		: "Next round";
}

function chordPositionsMatch(first, second) {
	const [a, b] = first.points;
	const [c, d] = second.points;
	const distance = (one, two) => Math.hypot(one.x - two.x, one.y - two.y);
	const direct = Math.max(distance(a, c), distance(b, d));
	const crossed = Math.max(distance(a, d), distance(b, c));
	return Math.min(direct, crossed) <= GESTURE.maxPositionDrift;
}

function trackGestureDown(event) {
	if (event.pointerType !== "touch") return;
	const now = performance.now();

	if (!activeChord) {
		activeChord = {
			startedAt: now,
			contacts: new Map(),
			invalid: false,
		};
	}

	if (
		activeChord.contacts.size >= 2 ||
		now - activeChord.startedAt > GESTURE.maxDownSpread
	) {
		activeChord.invalid = true;
	}

	activeChord.contacts.set(event.pointerId, {
		x: event.clientX,
		y: event.clientY,
		upAt: null,
	});
}

function trackGestureMove(event) {
	const contact = activeChord?.contacts.get(event.pointerId);
	if (!contact) return;
	if (
		Math.hypot(event.clientX - contact.x, event.clientY - contact.y) >
		GESTURE.maxMovement
	) {
		activeChord.invalid = true;
	}
}

function finishChord(now) {
	const chord = activeChord;
	activeChord = null;
	if (!chord || chord.invalid || chord.contacts.size !== 2) {
		previousChord = null;
		return false;
	}

	const contacts = [...chord.contacts.values()];
	const upTimes = contacts.map((contact) => contact.upAt);
	const duration = now - chord.startedAt;
	const releaseSpread = Math.max(...upTimes) - Math.min(...upTimes);
	if (
		duration > GESTURE.maxDuration ||
		releaseSpread > GESTURE.maxReleaseSpread
	) {
		previousChord = null;
		return false;
	}

	const completedChord = {
		endedAt: now,
		points: contacts.map(({ x, y }) => ({ x, y })),
	};
	const gap = previousChord ? chord.startedAt - previousChord.endedAt : Infinity;
	if (
		previousChord &&
		gap >= GESTURE.minGap &&
		gap <= GESTURE.maxGap &&
		chordPositionsMatch(previousChord, completedChord)
	) {
		previousChord = null;
		openSettings("gesture");
		return true;
	}

	previousChord = completedChord;
	return false;
}

function trackGestureUp(event, cancelled = false) {
	const contact = activeChord?.contacts.get(event.pointerId);
	if (!contact) return false;
	if (cancelled) activeChord.invalid = true;
	contact.upAt = performance.now();
	const contacts = [...activeChord.contacts.values()];
	if (contacts.every((item) => item.upAt !== null)) {
		return finishChord(contact.upAt);
	}
	return false;
}

function nextRoomIntent(pointerId, type, point = null) {
	const fingerId = localRoomFingerIds.get(pointerId);
	if (!fingerId) return null;
	const seq = (roomOutgoingSequences.get(fingerId) ?? 0) + 1;
	roomOutgoingSequences.set(fingerId, seq);
	return {
		type,
		id: fingerId,
		seq,
		...(point ? { nx: point.nx, ny: point.ny } : {}),
	};
}

function dispatchRoomIntent(intent) {
	if (!intent || !isRoomConnected()) return;
	if (isRoomHost()) {
		handleRoomFingerIntent(intent, roomTransport.selfId);
		return;
	}
	if (!roomHostPeerId) return;
	roomTransport.sendIntent(intent, roomHostPeerId).catch((error) => {
		console.warn("Finger update could not be sent:", error);
	});
}

function addOptimisticRoomFinger(intent) {
	if (players.has(intent.id) || players.size >= MAX_ROOM_PLAYERS) return;
	const point = denormalizePoint(intent.nx, intent.ny, viewport.width, viewport.height);
	players.set(intent.id, {
		pointerId: intent.id,
		clientId: roomTransport.selfId,
		slot: availableSlot(),
		nx: intent.nx,
		ny: intent.ny,
		x: point.x,
		y: point.y,
	});
	roomActiveFingerIds.add(intent.id);
	buildConnectorTopology();
	if (gameState === "idle") setGameState("collecting");
	requestRender();
}

function releaseRoomFinger(pointerId) {
	const fingerId = localRoomFingerIds.get(pointerId);
	if (!fingerId) return;
	const intent = nextRoomIntent(pointerId, "up");
	localRoomFingerIds.delete(pointerId);
	roomLastMoveSentAt.delete(pointerId);
	if (!isRoomHost()) {
		roomActiveFingerIds.delete(fingerId);
		if (!["reveal", "result"].includes(gameState)) {
			players.delete(fingerId);
			updateStateForPlayers();
		} else updateNextRoundAvailability();
	}
	dispatchRoomIntent(intent);
}

function releaseAllLocalRoomFingers() {
	for (const pointerId of [...localRoomFingerIds.keys()]) releaseRoomFinger(pointerId);
	physicalPointers.clear();
}

function onPointerDown(event) {
	if (helpDialog.open || settingsDialog.open || gameState === "reveal") return;
	if (isRoomSession()) {
		if (!isRoomConnected() || roomDialog.open || ["reveal", "result"].includes(gameState)) return;
		event.preventDefault();
		if (players.size >= MAX_ROOM_PLAYERS) {
			announce(`This room supports up to ${MAX_ROOM_PLAYERS} fingers.`);
			return;
		}
		physicalPointers.add(event.pointerId);
		try {
			canvas.setPointerCapture(event.pointerId);
		} catch {
			// Synthetic pointers and a few older browsers cannot be captured.
		}
		const fingerId = `${roomTransport.selfId}:${event.pointerId}`;
		localRoomFingerIds.set(event.pointerId, fingerId);
		const point = normalizePoint(event.clientX, event.clientY, viewport.width, viewport.height);
		const intent = nextRoomIntent(event.pointerId, "down", point);
		if (!isRoomHost()) addOptimisticRoomFinger(intent);
		dispatchRoomIntent(intent);
		return;
	}
	event.preventDefault();

	if (gameState === "result") {
		if (physicalPointers.size > 0) return;
		prepareNextRound();
	}

	physicalPointers.add(event.pointerId);
	try {
		canvas.setPointerCapture(event.pointerId);
	} catch {
		// Synthetic pointers and a few older browsers cannot be captured.
	}
	trackGestureDown(event);
	addPlayer(event);
}

function onPointerMove(event) {
	if (isRoomSession()) {
		const fingerId = localRoomFingerIds.get(event.pointerId);
		const player = fingerId ? players.get(fingerId) : null;
		if (!player || !roomActiveFingerIds.has(fingerId)) return;
		const point = normalizePoint(event.clientX, event.clientY, viewport.width, viewport.height);
		const localPoint = denormalizePoint(point.nx, point.ny, viewport.width, viewport.height);
		player.nx = point.nx;
		player.ny = point.ny;
		player.x = localPoint.x;
		player.y = localPoint.y;
		buildConnectorTopology();
		requestRender();

		const now = performance.now();
		if (now - (roomLastMoveSentAt.get(event.pointerId) ?? 0) < ROOM_MOVE_INTERVAL_MS) return;
		roomLastMoveSentAt.set(event.pointerId, now);
		dispatchRoomIntent(nextRoomIntent(event.pointerId, "move", point));
		return;
	}
	trackGestureMove(event);
	updatePlayer(event);
}

function onPointerEnd(event, cancelled = false) {
	physicalPointers.delete(event.pointerId);
	try {
		if (canvas.hasPointerCapture(event.pointerId)) canvas.releasePointerCapture(event.pointerId);
	} catch {
		// Ignore unsupported or already-released pointer capture.
	}
	if (isRoomSession()) {
		releaseRoomFinger(event.pointerId);
		return;
	}

	if (["reveal", "result"].includes(gameState)) {
		updateNextRoundAvailability();
		return;
	}

	removePlayer(event);
	trackGestureUp(event, cancelled);
}

function clearInterruptedRound() {
	if (isRoomSession()) {
		releaseAllLocalRoomFingers();
		return;
	}
	if (gameState === "reveal") {
		physicalPointers.clear();
		setGameState("result");
		updateNextRoundAvailability();
		requestRender();
		return;
	}
	if (["collecting", "countdown"].includes(gameState)) prepareNextRound();
}

function openSettings(source = "button") {
	if (helpDialog.open || settingsDialog.open) return;
	if (isRoomSession() && !isRoomHost()) releaseAllLocalRoomFingers();
	else prepareNextRound();
	syncSettingsControls();
	if (typeof settingsDialog.showModal === "function") settingsDialog.showModal();
	else settingsDialog.setAttribute("open", "");
	body.dataset.settingsOpenedBy = source;
	announce("Game settings opened.");
}

function closeSettings() {
	if (!settingsDialog.open) return;
	if (typeof settingsDialog.close === "function") settingsDialog.close();
	else settingsDialog.removeAttribute("open");
	announce("Game settings closed.");
}

function openHelp() {
	if (helpDialog.open || settingsDialog.open || roomDialog.open) return;
	if (typeof helpDialog.showModal === "function") helpDialog.showModal();
	else helpDialog.setAttribute("open", "");
	announce("Game rules and navigation guide opened.");
}

function closeHelp() {
	if (!helpDialog.open) return;
	if (typeof helpDialog.close === "function") helpDialog.close();
	else helpDialog.removeAttribute("open");
	announce("Game rules and navigation guide closed.");
}

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", (event) => onPointerEnd(event));
canvas.addEventListener("pointercancel", (event) => onPointerEnd(event, true));
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

helpButton.addEventListener("click", openHelp);
helpClose.addEventListener("click", closeHelp);
settingsButton.addEventListener("click", () => openSettings("button"));
settingsClose.addEventListener("click", closeSettings);
nextRoundButton.addEventListener("click", () => {
	const ready = isRoomHost()
		? roomActiveFingerIds.size === 0
		: physicalPointers.size === 0;
	if (ready) prepareNextRound();
});

roomEntryButton.addEventListener("click", showRoomLobby);
roomCreate.addEventListener("click", () => void createSharedRoom());
roomJoinForm.addEventListener("submit", (event) => {
	event.preventDefault();
	void joinSharedRoomByCode(roomCodeInput.value);
});
roomCodeInput.addEventListener("input", () => {
	const caret = roomCodeInput.selectionStart ?? roomCodeInput.value.length;
	const charactersBeforeCaret = normalizeRoomCodeDraft(
		roomCodeInput.value.slice(0, caret),
	).length;
	roomCodeInput.value = formatRoomCodeDraft(roomCodeInput.value);
	roomCodeInput.setSelectionRange(charactersBeforeCaret, charactersBeforeCaret);
	if (!roomCodeError.hidden) setRoomCodeError();
});
roomStatusButton.addEventListener("click", showRoomDialog);
roomShare.addEventListener("click", () => void shareRoomInvite());
roomCopyLink.addEventListener("click", () => void copyRoomInvite());
roomEnter.addEventListener("click", () => {
	if (roomMode === "connected") closeRoomDialog();
	else if (roomMode === "error") retrySharedRoom();
});
roomLeave.addEventListener("click", leaveSharedRoom);
roomClose.addEventListener("click", () => {
	if (roomMode === "error" || roomMode === "joining") leaveSharedRoom();
	else {
		if (roomMode === "local") cancelRoomLobbyOperation();
		closeRoomDialog();
	}
});
roomDialog.addEventListener("cancel", (event) => {
	event.preventDefault();
	if (roomMode === "error" || roomMode === "joining") leaveSharedRoom();
	else {
		if (roomMode === "local") cancelRoomLobbyOperation();
		closeRoomDialog();
	}
});

updateLink.addEventListener("click", (event) => {
	event.preventDefault();
	if (roomMode !== "local") return;
	window.location.reload();
});

helpDialog.addEventListener("click", (event) => {
	if (event.target === helpDialog) closeHelp();
});

settingsDialog.addEventListener("click", (event) => {
	if (event.target === settingsDialog) closeSettings();
});
settingsDialog.addEventListener("close", () => {
	delete body.dataset.settingsOpenedBy;
	if (isRoomSession() && !isRoomHost()) {
		requestRender();
		return;
	}
	setGameState("idle");
	requestRender();
	broadcastRoomSnapshot();
});
settingsDialog.addEventListener("change", (event) => {
	if (event.target.matches('input[name="mode"], input[name="category"], #prompts-toggle, #haptics-toggle')) {
		readSettingsControls(event.target);
		broadcastRoomSnapshot();
	}
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("blur", clearInterruptedRound);
window.addEventListener("hashchange", () => window.location.reload());
document.addEventListener("visibilitychange", () => {
	if (document.hidden) clearInterruptedRound();
	else resumeSharedRoomConnection();
});
window.addEventListener("pageshow", (event) => {
	if (event.persisted) resumeSharedRoomConnection();
});
window.addEventListener("online", resumeSharedRoomConnection);
motionQuery.addEventListener?.("change", requestRender);

syncSettingsControls();
setGameState("idle");
resizeCanvas();
setRoomMode("local");
initializeRoomFromLocation();

if (
	"serviceWorker" in navigator &&
	location.protocol.startsWith("http") &&
	!["localhost", "127.0.0.1"].includes(location.hostname)
) {
	const hadServiceWorkerController = Boolean(navigator.serviceWorker.controller);
	window.addEventListener("load", () => {
		navigator.serviceWorker.register(new URL("./sw.js", import.meta.url)).catch((error) => {
			console.warn("Service worker registration failed:", error);
		});
	});
	navigator.serviceWorker.addEventListener("controllerchange", () => {
		if (hadServiceWorkerController) {
			updateReady = true;
			updateAvailable.hidden = roomMode !== "local";
		}
	});
	navigator.serviceWorker.addEventListener("message", (event) => {
		if (event.data?.version) version.textContent = event.data.version;
	});
	navigator.serviceWorker.ready.then((registration) => {
		registration.active?.postMessage("version");
	});
}
