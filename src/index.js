import {
	CATEGORIES,
	PROMPT_COUNTS,
	createPromptPicker,
	getPromptCounts,
} from "./prompts.js";

const MIN_PLAYERS = 2;
const CHOOSE_DELAY_MS = 2000;
const REVEAL_DURATION_MS = 680;
const COUNTDOWN_HAPTIC_INTERVAL_MS = 400;
const SETTINGS_STORAGE_KEY = "chooser-game-settings-v2";
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
const settingsButton = document.getElementById("settings-button");
const settingsDialog = document.getElementById("settings-dialog");
const settingsClose = document.getElementById("settings-close");
const hapticsToggle = document.getElementById("haptics-toggle");
const libraryCount = document.getElementById("library-count");
const ariaLive = document.getElementById("live-region");
const version = document.getElementById("version");
const updateAvailable = document.getElementById("update-available");
const motionQuery = window.matchMedia("(prefers-reduced-motion: reduce)");

if (!ctx) throw new Error("This browser does not support the 2D canvas API.");

const promptPicker = createPromptPicker({ historySize: 32 });
const players = new Map();
const physicalPointers = new Set();

let gameState = "idle";
let completedRounds = 0;
let roundIdentityStyle = "numbers";
let connectorEdges = [];
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

function loadSettings() {
	const fallback = {
		mode: "mix",
		categories: ["neutral", "funny", "bold"],
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
			mode,
			categories: categories.length ? categories : fallback.categories,
			haptics: saved?.haptics !== false,
		};
	} catch {
		return fallback;
	}
}

function saveSettings() {
	try {
		localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings));
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
	const modeLabel = settings.mode === "mix" ? "Mix" : titleCase(settings.mode);
	const categoryLabels = settings.categories.map((category) => CATEGORIES[category].label.replace(" · 18+", ""));
	const vibeLabel =
		categoryLabels.length <= 3
			? categoryLabels.join(" + ")
			: `${categoryLabels.length} vibes`;
	activeConfig.textContent = `${modeLabel} · ${vibeLabel}`;

	const selectedCounts = getPromptCounts({
		mode: settings.mode,
		enabledCategories: settings.categories,
	});
	libraryCount.textContent = `${selectedCounts.total.toLocaleString()} selected · ${PROMPT_COUNTS.truth.toLocaleString()} truths + ${PROMPT_COUNTS.dare.toLocaleString()} dares offline`;
}

function syncSettingsControls() {
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
	if (changedInput.value === "naughty" && changedInput.checked) {
		const confirmed = window.confirm(
			"Naughty prompts are for consenting adults only. Confirm that you are 18 or older to enable them.",
		);
		if (!confirmed) {
			changedInput.checked = false;
			announce("Naughty prompts stayed off.");
		}
	}

	const mode = document.querySelector('input[name="mode"]:checked')?.value ?? "mix";
	const categoryInputs = [...document.querySelectorAll('input[name="category"]')];
	let categories = categoryInputs.filter((input) => input.checked).map((input) => input.value);

	if (categories.length === 0) {
		changedInput.checked = true;
		categories = [changedInput.value];
		announce("Keep at least one vibe selected.");
	}

	settings = { mode, categories, haptics: hapticsToggle.checked };
	if (!settings.haptics && typeof navigator.vibrate === "function") navigator.vibrate(0);
	saveSettings();
	updateSettingsSummary();

	if (changedInput.value === "naughty" && changedInput.checked) {
		announce("Naughty prompts enabled for consenting adults only. Anyone can pass.");
	}
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
		player.x = Math.min(viewport.width, Math.max(0, player.x));
		player.y = Math.min(viewport.height, Math.max(0, player.y));
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

function buildConnectorTopology() {
	const nodes = [...players.values()];
	connectorEdges = [];

	if (nodes.length < 2) {
		collectingPanel.dataset.connectorCount = "0";
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
			seed: connectorEdges.length * 173 + connectedIds.size * 97,
		});
		connectedIds.add(shortest.to);
	}

	collectingPanel.dataset.connectorCount = String(connectorEdges.length);
}

function beginCountdown(now = performance.now()) {
	countdownStartedAt = now;
	countdownDeadline = now + CHOOSE_DELAY_MS;
	hapticMilestonesFired = 0;
	setGameState("countdown");
	requestRender();
}

function updateStateForPlayers(now = performance.now()) {
	buildConnectorTopology();
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

	ctx.arc(0, 0, radius * 0.78, 0, Math.PI * 2);
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
	ctx.save();
	ctx.globalAlpha = alpha;

	ctx.beginPath();
	ctx.strokeStyle = playerColor(player.slot, 0.95);
	ctx.lineWidth = 2.4 * scale;
	ctx.shadowColor = playerColor(player.slot, 0.8);
	ctx.shadowBlur = 16 * scale;
	ctx.arc(player.x, player.y, outerRadius, 0, Math.PI * 2);
	ctx.stroke();

	ctx.shadowBlur = 0;
	ctx.beginPath();
	ctx.fillStyle = "rgba(3, 4, 7, 0.92)";
	ctx.strokeStyle = playerColor(player.slot, 0.38);
	ctx.lineWidth = 1;
	ctx.arc(player.x, player.y, innerRadius, 0, Math.PI * 2);
	ctx.fill();
	ctx.stroke();

	if (progress > 0) {
		ctx.beginPath();
		ctx.strokeStyle = playerColor(player.slot, 0.98, 72);
		ctx.lineCap = "round";
		ctx.lineWidth = 4 * scale;
		ctx.shadowColor = playerColor(player.slot, 0.9);
		ctx.shadowBlur = 13 * scale;
		ctx.arc(
			player.x,
			player.y,
			(outerRadius + 8 * scale),
			-Math.PI / 2,
			-Math.PI / 2 + Math.PI * 2 * Math.min(1, progress),
		);
		ctx.stroke();
	}

	ctx.restore();
	drawIdentity(player, roundIdentityStyle, scale, alpha);
	drawIdentityBadge(player, roundIdentityStyle, scale, alpha);
}

function drawElectricPulse(from, to, phase, now, opacity, seed) {
	const dx = to.x - from.x;
	const dy = to.y - from.y;
	const length = Math.hypot(dx, dy);
	if (length < 1) return;

	const tail = Math.min(0.24, 46 / length);
	const start = Math.max(0, phase - tail);
	const points = 7;
	const perpendicularX = -dy / length;
	const perpendicularY = dx / length;
	const tick = Math.floor(now / 46);
	const startX = from.x + dx * start;
	const startY = from.y + dy * start;
	const endX = from.x + dx * phase;
	const endY = from.y + dy * phase;
	const glow = ctx.createLinearGradient(startX, startY, endX, endY);
	glow.addColorStop(0, "rgba(80, 206, 255, 0)");
	glow.addColorStop(0.58, `rgba(85, 220, 255, ${0.72 * opacity})`);
	glow.addColorStop(1, `rgba(255, 255, 255, ${opacity})`);

	ctx.save();
	ctx.globalCompositeOperation = "lighter";
	ctx.strokeStyle = glow;
	ctx.lineWidth = 2;
	ctx.lineCap = "round";
	ctx.lineJoin = "round";
	ctx.shadowColor = `rgba(71, 211, 255, ${0.9 * opacity})`;
	ctx.shadowBlur = 14;
	ctx.beginPath();

	for (let index = 0; index <= points; index += 1) {
		const local = index / points;
		const along = start + (phase - start) * local;
		const jitter =
			index === 0 || index === points
				? 0
				: Math.sin(seed * 0.17 + tick * 1.93 + index * 8.11) * 2.4;
		const x = from.x + dx * along + perpendicularX * jitter;
		const y = from.y + dy * along + perpendicularY * jitter;
		if (index === 0) ctx.moveTo(x, y);
		else ctx.lineTo(x, y);
	}
	ctx.stroke();

	ctx.beginPath();
	ctx.fillStyle = `rgba(255, 255, 255, ${opacity})`;
	ctx.shadowBlur = 18;
	ctx.arc(endX, endY, 2.7, 0, Math.PI * 2);
	ctx.fill();
	ctx.restore();
}

function drawConnectors(now, opacity = 1) {
	if (connectorEdges.length === 0) return;

	ctx.save();
	ctx.strokeStyle = `rgba(151, 225, 255, ${0.085 * opacity})`;
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

	const elapsed = Math.max(0, now - countdownStartedAt);
	for (const edge of connectorEdges) {
		const from = players.get(edge.a);
		const to = players.get(edge.b);
		if (!from || !to) continue;
		const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y));
		const basePhase = ((elapsed * 0.82 + edge.seed) % length) / length;
		drawElectricPulse(from, to, basePhase, now, opacity, edge.seed);
		drawElectricPulse(from, to, (basePhase + 0.52) % 1, now, opacity * 0.72, edge.seed + 41);
	}
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

function drawReveal(now) {
	const progress = Math.min(1, (now - revealStartedAt) / REVEAL_DURATION_MS);
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

function commitResult(now) {
	if (gameState !== "countdown" || players.size < MIN_PLAYERS) return;
	const candidates = [...players.values()];
	const winner = candidates[Math.floor(Math.random() * candidates.length)];
	const prompt = promptPicker.pick({
		mode: settings.mode,
		enabledCategories: settings.categories,
	});
	const frozenWinner = { ...winner };

	result = {
		winner: frozenWinner,
		identityStyle: roundIdentityStyle,
		prompt:
			prompt ??
			Object.freeze({
				mode: "truth",
				category: "neutral",
				text: "What made you smile today?",
			}),
	};
	completedRounds += 1;
	revealStartedAt = now;
	resultMeta.textContent = `${identityName(frozenWinner, result.identityStyle)} · ${result.prompt.mode} · ${CATEGORIES[result.prompt.category].label}`;
	resultPrompt.textContent = result.prompt.text;
	resultPrompt.classList.toggle("long-prompt", result.prompt.text.length > 135);
	resultPrompt.classList.toggle("very-long-prompt", result.prompt.text.length > 190);
	document.documentElement.style.setProperty("--accent", playerColor(winner.slot));
	setGameState("reveal");
	updateNextRoundAvailability();
	safeVibrate([35, 25, 70]);
	announce(`${identityName(frozenWinner, result.identityStyle)} was chosen. ${titleCase(result.prompt.mode)}: ${result.prompt.text}`);
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
		if (now - revealStartedAt >= REVEAL_DURATION_MS) {
			setGameState("result");
			updateNextRoundAvailability();
			drawResult();
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

function prepareNextRound() {
	players.clear();
	physicalPointers.clear();
	connectorEdges = [];
	countdownStartedAt = 0;
	countdownDeadline = 0;
	hapticMilestonesFired = 0;
	result = null;
	resultPrompt.classList.remove("long-prompt", "very-long-prompt");
	roundIdentityStyle = completedRounds % 2 === 0 ? "numbers" : "shapes";
	body.dataset.identityStyle = roundIdentityStyle;
	collectingPanel.dataset.connectorCount = "0";
	document.documentElement.style.setProperty("--accent", DEFAULT_ACCENT);
	resetGesture();
	setGameState("idle");
	requestRender();
}

function updateNextRoundAvailability() {
	const waiting = physicalPointers.size > 0;
	nextRoundButton.disabled = waiting;
	nextRoundLabel.textContent = waiting ? "Lift fingers" : "Next round";
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

function onPointerDown(event) {
	if (settingsDialog.open || gameState === "reveal") return;
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

	if (["reveal", "result"].includes(gameState)) {
		updateNextRoundAvailability();
		return;
	}

	removePlayer(event);
	trackGestureUp(event, cancelled);
}

function clearInterruptedRound() {
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
	if (settingsDialog.open) return;
	prepareNextRound();
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

canvas.addEventListener("pointerdown", onPointerDown);
canvas.addEventListener("pointermove", onPointerMove);
canvas.addEventListener("pointerup", (event) => onPointerEnd(event));
canvas.addEventListener("pointercancel", (event) => onPointerEnd(event, true));
canvas.addEventListener("contextmenu", (event) => event.preventDefault());

settingsButton.addEventListener("click", () => openSettings("button"));
settingsClose.addEventListener("click", closeSettings);
nextRoundButton.addEventListener("click", () => {
	if (physicalPointers.size === 0) prepareNextRound();
});

settingsDialog.addEventListener("click", (event) => {
	if (event.target === settingsDialog) closeSettings();
});
settingsDialog.addEventListener("close", () => {
	delete body.dataset.settingsOpenedBy;
	setGameState("idle");
	requestRender();
});
settingsDialog.addEventListener("change", (event) => {
	if (event.target.matches('input[name="mode"], input[name="category"], #haptics-toggle')) {
		readSettingsControls(event.target);
	}
});

window.addEventListener("resize", resizeCanvas);
window.addEventListener("blur", clearInterruptedRound);
document.addEventListener("visibilitychange", () => {
	if (document.hidden) clearInterruptedRound();
});
motionQuery.addEventListener?.("change", requestRender);

syncSettingsControls();
setGameState("idle");
resizeCanvas();

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
		if (hadServiceWorkerController) updateAvailable.hidden = false;
	});
	navigator.serviceWorker.addEventListener("message", (event) => {
		if (event.data?.version) version.textContent = event.data.version;
	});
	navigator.serviceWorker.ready.then((registration) => {
		registration.active?.postMessage("version");
	});
}
