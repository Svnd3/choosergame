/**
 * Dependency-free prompt library for the chooser party game.
 *
 * Prompts are composed at module load from curated, category-specific phrase
 * pools. Every exported collection and prompt record is frozen. The Naughty
 * category is intended only for consenting adults (18+); no prompt removes a
 * participant's right to decline or asks them to surprise an uninvolved person.
 *
 * @module prompts
 */

const freeze = (value) => Object.freeze(value);

/**
 * Metadata used to render and explain each prompt category.
 * `defaultEnabled: false` on Naughty is deliberate: a UI should require an
 * explicit age confirmation before enabling it.
 */
export const CATEGORIES = freeze({
	neutral: freeze({
		id: "neutral",
		label: "Neutral",
		shortLabel: "Easy",
		description: "Relaxed, all-purpose prompts for almost any group.",
		symbol: "○",
		accent: "#7DD3FC",
		minimumAge: 0,
		contentRating: "everyone",
		requiresConsentReminder: false,
		defaultEnabled: true,
	}),
	funny: freeze({
		id: "funny",
		label: "Funny",
		shortLabel: "Laughs",
		description: "Silly confessions, impressions, and low-stakes chaos.",
		symbol: "△",
		accent: "#FDE047",
		minimumAge: 0,
		contentRating: "everyone",
		requiresConsentReminder: false,
		defaultEnabled: true,
	}),
	deep: freeze({
		id: "deep",
		label: "Deep",
		shortLabel: "Real",
		description: "Reflective prompts for trust, empathy, and real conversation.",
		symbol: "◇",
		accent: "#A78BFA",
		minimumAge: 13,
		contentRating: "teen",
		requiresConsentReminder: true,
		defaultEnabled: true,
	}),
	couples: freeze({
		id: "couples",
		label: "Couples",
		shortLabel: "Us",
		description: "Warm, playful prompts for partners who choose to play together.",
		symbol: "∞",
		accent: "#FB7185",
		minimumAge: 16,
		contentRating: "mature",
		requiresConsentReminder: true,
		defaultEnabled: false,
	}),
	bold: freeze({
		id: "bold",
		label: "Bold",
		shortLabel: "Brave",
		description: "Confident, revealing challenges that stay safe and reversible.",
		symbol: "□",
		accent: "#FB923C",
		minimumAge: 16,
		contentRating: "mature",
		requiresConsentReminder: true,
		defaultEnabled: false,
	}),
	naughty: freeze({
		id: "naughty",
		label: "Naughty · 18+",
		shortLabel: "18+",
		description:
			"Explicit sexual prompts for consenting adults only. Clear consent, boundaries, and the right to pass always apply.",
		symbol: "✦",
		accent: "#F43F5E",
		minimumAge: 18,
		contentRating: "explicit-18+",
		requiresAgeConfirmation: true,
		requiresConsentReminder: true,
		defaultEnabled: false,
	}),
});

/** Backwards-friendly descriptive alias for category metadata. */
export const CATEGORY_METADATA = CATEGORIES;

/** Stable category order for settings and filters. */
export const CATEGORY_IDS = freeze(Object.keys(CATEGORIES));

const DEFAULT_CATEGORY_IDS = freeze(
	CATEGORY_IDS.filter((category) => CATEGORIES[category].defaultEnabled),
);

/** Supported selection modes. `mix` samples from Truths and Dares together. */
export const PROMPT_MODES = freeze(["truth", "dare", "mix"]);

const pair = (pattern, left, right) => ({ pattern, left, right });

const PROMPT_BLUEPRINTS = {
	neutral: {
		truth: [
			pair(
				"What is {a} that {b}?",
				[
					"a tiny habit you rely on",
					"a simple pleasure you protect",
					"an everyday skill you are proud of",
					"a possession you use constantly",
					"a routine that keeps you grounded",
					"a shortcut you swear by",
				],
				[
					"most people overlook",
					"makes difficult days easier",
					"you picked up by accident",
					"says something true about you",
					"you would recommend to this group",
					"you hope never changes",
				],
			),
			pair(
				"Which {a} would you choose {b}, and what makes it your pick?",
				[
					"meal",
					"way to travel",
					"kind of weather",
					"room in a home",
					"day of the week",
					"hour of the day",
				],
				[
					"for a surprise celebration",
					"for a completely free day",
					"to share with everyone here",
					"when you need a reset",
					"to enjoy once a month",
					"as the theme of your next adventure",
				],
			),
			pair(
				"When was the last time {a} made you feel {b}?",
				["a stranger", "a song", "a message", "a meal", "a walk", "a small success"],
				[
					"genuinely lucky",
					"unexpectedly calm",
					"proud of yourself",
					"seen and understood",
					"curious about something new",
					"grateful for an ordinary day",
				],
			),
			pair(
				"What would you {a} if you had {b}?",
				["learn first", "cook first", "organize first", "explore first", "create first", "fix first"],
				[
					"an entirely free weekend",
					"a patient expert helping you",
					"a generous but sensible budget",
					"no fear of getting it wrong",
					"the perfect tools ready",
					"a quiet place all to yourself",
				],
			),
			pair(
				"What is one {a} you would happily {b}?",
				["tradition", "recommendation", "recipe", "piece of advice", "useful object", "local place"],
				[
					"tell a younger person about",
					"share with someone new to your area",
					"recommend to this group",
					"rediscover with fresh eyes",
					"keep in your life for the next decade",
					"explain your appreciation for",
				],
			),
			pair(
				"Which part of {a} do you find {b}, and why?",
				[
					"meeting new people",
					"planning a trip",
					"learning a skill",
					"hosting friends",
					"finishing a project",
					"starting a new routine",
				],
				[
					"easiest to enjoy",
					"hardest to begin",
					"most satisfying",
					"surprisingly revealing",
					"worth doing slowly",
					"better with company",
				],
			),
		],
		dare: [
			pair(
				"Give {a} a sincere compliment about {b}.",
				[
					"the player to your left",
					"the player to your right",
					"the newest player",
					"the quietest player",
					"a player chosen by the group",
					"someone you have not spoken to much",
				],
				[
					"their energy",
					"their sense of humor",
					"their style",
					"their thoughtfulness",
					"something they did tonight",
					"a quality they would bring to a team",
				],
			),
			pair(
				"Without using words, demonstrate {a} as though {b}.",
				[
					"making your favorite drink",
					"getting ready in the morning",
					"packing for a holiday",
					"learning a dance",
					"finding a lost key",
					"cooking your signature meal",
				],
				[
					"a camera crew were filming",
					"gravity had become weaker",
					"you had only ten seconds",
					"you were teaching a beginner",
					"everything were extremely expensive",
					"it were the final scene of a movie",
				],
			),
			pair(
				"Choose {a} and share {b}.",
				[
					"one player",
					"the person opposite you",
					"someone wearing a similar color",
					"the player who arrived first",
					"the player who smiles first",
					"any willing player",
				],
				[
					"a song recommendation",
					"a useful life tip",
					"your favorite snack combination",
					"a place you think they would enjoy",
					"a harmless goal for this week",
					"why you are glad they are here",
				],
			),
			pair(
				"Using {a}, announce {b}.",
				[
					"a calm radio voice",
					"a dramatic movie-trailer voice",
					"your best newsreader voice",
					"a soft bedtime-story voice",
					"an excited sports-commentator voice",
					"a mysterious stage whisper",
				],
				[
					"what you ate most recently",
					"the current time",
					"the name of the game",
					"your plan for tomorrow",
					"the weather you want this weekend",
					"why everyone deserves a snack",
				],
			),
			pair(
				"Let {a} choose {b} for you.",
				[
					"one willing player",
					"the player to your left",
					"the player to your right",
					"the group by a quick vote",
					"the player whose birthday is next",
					"the next player selected",
				],
				[
					"a harmless nickname for one round",
					"a pose to hold for five seconds",
					"a song for your imaginary entrance",
					"a color that matches your mood",
					"a snack you should try next",
					"a word to try using in your next answer",
				],
			),
			pair(
				"Take {a} to create {b}, then show the group.",
				[
					"ten seconds",
					"fifteen seconds",
					"twenty seconds",
					"one quiet minute",
					"the length of one song chorus",
					"the time another player needs to count down from ten",
				],
				[
					"a tiny drawing of your mood",
					"a title for today's imaginary movie",
					"a three-item dream menu",
					"a motto for this group",
					"a hand gesture that means good luck",
					"a simple logo for your personality",
				],
			),
		],
	},
	funny: {
		truth: [
			pair(
				"What is the most ridiculous {a} you have ever {b}?",
				["excuse", "outfit", "misunderstanding", "purchase", "nickname", "food combination"],
				[
					"defended with confidence",
					"kept longer than you should have",
					"shared with another person",
					"tried to make seem normal",
					"been secretly proud of",
					"remembered at the worst possible moment",
				],
			),
			pair(
				"If {a} suddenly became your full-time job, what would {b}?",
				[
					"narrating your own life",
					"reviewing snacks",
					"naming strangers' pets",
					"inventing fake holidays",
					"judging dance moves",
					"translating group chats",
				],
				[
					"your job title be",
					"get you fired first",
					"earn you a promotion",
					"be your signature technique",
					"appear on your business card",
					"make your coworkers concerned",
				],
			),
			pair(
				"Which {a} would expose you fastest during {b}?",
				[
					"weird habit",
					"useless talent",
					"dramatic reaction",
					"accidental catchphrase",
					"questionable dance move",
					"snack obsession",
				],
				[
					"a reality show",
					"a formal dinner",
					"a long road trip",
					"a silent retreat",
					"an awards ceremony",
					"a spy mission",
				],
			),
			pair(
				"What would your {a} say is your funniest {b}?",
				["search history", "kitchen", "alarm clock", "camera roll", "laundry basket", "favorite mug"],
				[
					"recurring decision",
					"personality trait",
					"attempt at adulthood",
					"unnecessary struggle",
					"moment of overconfidence",
					"private performance",
				],
			),
			pair(
				"If you had to replace {a} with {b}, how badly would it go?",
				["your laugh", "your walk", "every greeting", "your phone ringtone", "your signature", "your serious voice"],
				[
					"an animal sound",
					"a dramatic musical note",
					"a celebrity impression",
					"a dance move",
					"a made-up word",
					"an evil-villain flourish",
				],
			),
			pair(
				"What is the funniest thing you could imagine {a} while {b}?",
				[
					"saying with total confidence",
					"wearing proudly",
					"ordering in a serious voice",
					"carrying like priceless treasure",
					"explaining to a child",
					"announcing over a loudspeaker",
				],
				[
					"meeting your hero",
					"entering a wedding",
					"starting a new job",
					"being interviewed live",
					"accepting an award",
					"trying to look mysterious",
				],
			),
		],
		dare: [
			pair(
				"Perform {a} as if {b}.",
				[
					"brushing your teeth",
					"opening a stubborn jar",
					"walking to the fridge",
					"answering a phone call",
					"putting on a jacket",
					"ordering a sandwich",
				],
				[
					"it were an Olympic final",
					"you were a suspicious detective",
					"the floor were made of jelly",
					"you had just won the lottery",
					"a dinosaur were watching",
					"you were in a silent movie",
				],
			),
			pair(
				"Give a {a} acceptance speech for winning {b}.",
				[
					"ten-second",
					"tearful",
					"wildly overconfident",
					"confused",
					"royally dignified",
					"barely awake",
				],
				[
					"Best Use of a Spoon",
					"Most Dramatic Yawn",
					"Outstanding Achievement in Snacking",
					"Fastest Reply Never Sent",
					"Lifetime Excellence in Procrastination",
					"Best Supporting Role in a Group Chat",
				],
			),
			pair(
				"For {a}, replace every {b} with a different sound effect.",
				[
					"the next thirty seconds",
					"the rest of your turn",
					"one full minute",
					"the next question you answer",
					"the next two sentences",
					"forty-five seconds",
				],
				[
					"yes or no",
					"person's name",
					"action word",
					"pause",
					"mention of yourself",
					"word with more than two syllables",
				],
			),
			pair(
				"Let the group choose {a}; then sell it like {b}.",
				[
					"an object nearby",
					"a common snack",
					"a piece of furniture",
					"an imaginary invention",
					"a boring household chore",
					"a random word",
				],
				[
					"a luxury product",
					"a life-changing fitness plan",
					"a mysterious work of art",
					"a must-have travel experience",
					"a revolutionary app",
					"the last item left on Earth",
				],
			),
			pair(
				"Do your best impression of {a} trying to {b}.",
				["a cat", "a robot", "a pirate", "a sleepy superhero", "a tiny dragon", "an offended royal"],
				[
					"order coffee",
					"ask for directions",
					"win an argument",
					"join a video meeting",
					"hide a surprise",
					"learn a dance trend",
				],
			),
			pair(
				"Create {a} using only {b}.",
				[
					"a dramatic dance",
					"a love song",
					"a weather report",
					"an apology",
					"a superhero entrance",
					"a cooking tutorial",
				],
				[
					"one repeated word",
					"animal noises",
					"hand gestures",
					"three facial expressions",
					"sounds made with your mouth",
					"movements in slow motion",
				],
			),
		],
	},
	deep: {
		truth: [
			pair(
				"What has {a} taught you about {b}?",
				[
					"a recent disappointment",
					"a difficult goodbye",
					"an unexpected friendship",
					"a risk that worked",
					"a boundary you set",
					"a season of waiting",
				],
				[
					"trust",
					"your own strength",
					"what matters most",
					"how you want to be loved",
					"the life you are building",
					"when to let go",
				],
			),
			pair(
				"What part of {a} are you learning to {b}?",
				["your past", "your personality", "your daily life", "your ambition", "your relationships", "your future"],
				[
					"accept without apology",
					"treat more gently",
					"understand more honestly",
					"protect with better boundaries",
					"celebrate out loud",
					"change with patience",
				],
			),
			pair(
				"When do you feel most {a}, and what helps you {b}?",
				["at peace", "truly known", "courageous", "creatively alive", "connected", "like yourself"],
				[
					"return to that feeling",
					"trust that feeling",
					"share it with someone",
					"notice it sooner",
					"make room for it",
					"protect it from distraction",
				],
			),
			pair(
				"What belief about {a} have you {b}?",
				["success", "family", "love", "strength", "forgiveness", "happiness"],
				[
					"outgrown completely",
					"softened over time",
					"had to rebuild",
					"learned the hard way",
					"borrowed from someone wise",
					"started questioning recently",
				],
			),
			pair(
				"Who helped you {a} without realizing it, and how did that change {b}?",
				[
					"become braver",
					"feel less alone",
					"choose a new direction",
					"forgive yourself",
					"raise your standards",
					"trust your instincts",
				],
				[
					"your view of yourself",
					"the way you treat others",
					"what you expect from love",
					"your definition of courage",
					"the future you imagine",
					"a choice you made later",
				],
			),
			pair(
				"If you could give your {a} one honest message about {b}, what would it be?",
				[
					"younger self",
					"future self",
					"most fearful self",
					"most ambitious self",
					"heartbroken self",
					"quietest inner voice",
				],
				["belonging", "patience", "love", "failure", "rest", "asking for help"],
			),
		],
		dare: [
			pair(
				"After {a}, tell the group {b}.",
				[
					"one slow breath",
					"ten seconds of reflection",
					"closing your eyes briefly",
					"placing both feet on the floor",
					"letting the room become quiet",
					"counting gently to five",
				],
				[
					"something ordinary you are grateful for",
					"a lesson you want to remember",
					"one thing you need more of",
					"a quality you are learning to value in yourself",
					"something you are ready to release",
					"a hope you have not said aloud lately",
				],
			),
			pair(
				"Choose {a} and thank them specifically for {b}.",
				[
					"someone in the room",
					"a player who supported you",
					"the person who invited you",
					"someone you want to know better",
					"a player whose energy you appreciate",
					"any willing player",
				],
				[
					"a quality you admire",
					"a small kindness",
					"the way they listen",
					"something they taught you",
					"how they affect the group",
					"being present tonight",
				],
			),
			pair(
				"Complete this sentence {a}: “{b}”",
				[
					"without minimizing it",
					"in one honest line",
					"as gently as you can",
					"without making a joke",
					"after a thoughtful pause",
					"with your hand over your heart",
				],
				[
					"I feel most like myself when…",
					"Something I deserve to hear is…",
					"I am learning that love can…",
					"A boundary I respect now is…",
					"I hope my future includes…",
					"I am quietly proud that…",
				],
			),
			pair(
				"Offer {a} to anyone here who {b}.",
				[
					"a sentence of encouragement",
					"a specific offer of practical help",
					"an attentive listening ear",
					"a genuine compliment",
					"a calming reminder",
					"permission to rest without guilt",
				],
				[
					"needs a fresh start",
					"recently took a risk",
					"has felt unnoticed",
					"is carrying too much",
					"feels uncertain about a choice",
					"made you feel welcome",
				],
			),
			pair(
				"Name {a}, then identify {b} as a possible next step.",
				[
					"a fear you are ready to shrink",
					"a goal you keep postponing",
					"a need you rarely voice",
					"a belief you want to outgrow",
					"a relationship you want to nurture",
					"a strength you underuse",
				],
				[
					"a patient first step",
					"one person you could ask for support",
					"one small action for this week",
					"a boundary that would make progress easier",
					"an honest question to sit with",
					"a realistic habit you could try",
				],
			),
			pair(
				"Give the group {a} that you learned from {b}.",
				[
					"a piece of advice",
					"a boundary worth keeping",
					"a question worth asking",
					"a reminder about self-respect",
					"a truth about friendship",
					"a reason to stay hopeful",
				],
				["a mistake", "a mentor", "a turning point", "heartbreak", "success", "a quiet season"],
			),
		],
	},
	couples: {
		truth: [
			pair(
				"What is one {a} your partner does that makes you feel {b}?",
				[
					"small gesture",
					"daily habit",
					"familiar phrase",
					"way of looking at you",
					"kind of check-in",
					"unexpected kindness",
				],
				["loved", "desired", "supported", "safe", "understood", "like a true teammate"],
			),
			pair(
				"When would you most like the two of you to {a}, and what would make it feel {b}?",
				[
					"escape for a day",
					"cook something new",
					"turn your phones off",
					"revisit an early memory",
					"try a new hobby",
					"plan a future adventure",
				],
				["romantic", "playful", "restful", "meaningful", "spontaneous", "completely yours"],
			),
			pair(
				"Which part of your relationship has {a}, and what helped it {b}?",
				[
					"surprised you most",
					"grown quietly",
					"challenged you",
					"become funnier",
					"made you proud",
					"changed your priorities",
				],
				[
					"feel secure",
					"stay interesting",
					"recover after tension",
					"become more honest",
					"deepen with time",
					"feel like a team",
				],
			),
			pair(
				"What do you wish your partner could instantly understand about {a} when you are {b}?",
				[
					"how you receive affection",
					"what reassures you",
					"why you become quiet",
					"the support you need",
					"how you repair after conflict",
					"what makes you feel chosen",
				],
				["tired", "stressed", "excited", "insecure", "overwhelmed", "ready for closeness"],
			),
			pair(
				"What is one {a} you would love to {b} together?",
				[
					"shared tradition",
					"screen-free ritual",
					"dream trip",
					"creative project",
					"learning adventure",
					"meaningful experience",
				],
				[
					"make part of this year",
					"prioritize even when life gets busy",
					"shape entirely your own way",
					"look back on in ten years",
					"plan without outside opinions",
					"use to reconnect after hard weeks",
				],
			),
			pair(
				"Which {a} between you deserves {b}, and why?",
				["inside joke", "shared achievement", "difference", "promise", "turning point", "quiet strength"],
				[
					"more celebration",
					"an honest conversation",
					"a place in your future plans",
					"a private ritual",
					"more patience from both of you",
					"to be remembered tonight",
				],
			),
		],
		dare: [
			pair(
				"Ask your partner whether they would enjoy {a}; if yes, {b}.",
				[
					"a twenty-second hug",
					"a forehead kiss",
					"holding hands in silence",
					"a gentle hand massage",
					"a slow dance without music",
					"sitting shoulder to shoulder",
				],
				[
					"share it slowly",
					"let them choose the duration",
					"make it playful",
					"pair it with a sincere compliment",
					"pause once to check their comfort",
					"finish by saying thank you",
				],
			),
			pair(
				"Tell your partner {a} in the style of {b}.",
				[
					"one reason you desire them",
					"a quality that makes you proud",
					"your favorite memory together",
					"what you hope to do together next",
					"a tiny thing you always notice",
					"why you would choose them again",
				],
				[
					"a handwritten love letter",
					"a movie trailer",
					"a warm whisper",
					"a playful wedding vow",
					"a breaking-news report",
					"a line from a romance novel",
				],
			),
			pair(
				"Together, choose {a} and spend {b} planning it.",
				[
					"a dream date",
					"a screen-free evening",
					"a new shared ritual",
					"a surprise for your future selves",
					"a tiny weekend adventure",
					"a meal neither of you has tried",
				],
				[
					"thirty seconds",
					"one focused minute",
					"the rest of this turn",
					"up to two minutes",
					"the length of a favorite chorus",
					"no more than ninety seconds",
				],
			),
			pair(
				"Ask your partner for consent to {a}; if they agree, do it {b}.",
				[
					"kiss their hand",
					"slow-dance together",
					"trace a heart on their palm",
					"feed them one bite of food",
					"sit knee-to-knee",
					"give a brief shoulder rub",
				],
				[
					"gently",
					"with warm eye contact",
					"for no more than ten seconds",
					"while saying something affectionate",
					"at the pace they choose",
					"with one comfort check halfway through",
				],
			),
			pair(
				"Take turns sharing {a}; each person gets {b}.",
				[
					"a favorite shared memory",
					"one thing you appreciate today",
					"a hope for the relationship",
					"something that still makes you laugh",
					"one way you have grown together",
					"a date idea worth saving",
				],
				[
					"one uninterrupted sentence",
					"fifteen uninterrupted seconds",
					"one honest example",
					"a chance to ask one follow-up",
					"the other person's full attention",
					"a hand squeeze when finished, if wanted",
				],
			),
			pair(
				"Let your partner choose {a} for you, provided {b}.",
				[
					"an affectionate nickname for one round",
					"a playful pose",
					"a song for your couple entrance",
					"the snack for your next date",
					"a simple dance move",
					"a compliment to repeat about yourself",
				],
				[
					"it feels good to both of you",
					"either person can veto it",
					"it stays kind",
					"no private information is revealed",
					"you agree before continuing",
					"it ends when this round ends",
				],
			),
		],
	},
	bold: {
		truth: [
			pair(
				"Which {a} felt boldest when {b}?",
				[
					"message you sent",
					"decision you made",
					"outfit you wore",
					"confession you shared",
					"comeback you delivered",
					"invitation you offered",
				],
				[
					"you had no time to overthink it",
					"you were under pressure",
					"other people were watching",
					"the other person intimidated you",
					"you knew you had to follow through",
					"you saw the result afterward",
				],
			),
			pair(
				"Which {a} would you reveal if doing so could {b}?",
				[
					"unpopular opinion",
					"secret ambition",
					"first impression",
					"hidden talent",
					"personal rule",
					"harmless fantasy",
				],
				[
					"win someone's respect",
					"make the whole room laugh",
					"start an unforgettable conversation",
					"change a wrong assumption about you",
					"give someone else courage",
					"open an unexpected door",
				],
			),
			pair(
				"When have you {a} even though {b}?",
				[
					"stood up for yourself",
					"made the first move",
					"walked away",
					"asked for exactly what you wanted",
					"admitted you were wrong",
					"taken a visible risk",
				],
				[
					"someone might judge you",
					"your heart was pounding",
					"the outcome was uncertain",
					"you had no backup plan",
					"it changed how people saw you",
					"staying quiet would have been easier",
				],
			),
			pair(
				"What would you {a} if embarrassment were impossible {b}?",
				["sing", "wear", "ask for", "admit", "pursue", "post"],
				[
					"tonight",
					"on your next date",
					"in front of this group",
					"during your next holiday",
					"before the end of this year",
					"with your closest friend watching",
				],
			),
			pair(
				"Who here would you trust to {a}, and what makes them {b}?",
				[
					"choose an outfit for you",
					"handle one of your secrets",
					"speak for you in a difficult room",
					"plan a spontaneous trip",
					"give you brutally honest advice",
					"introduce you to someone important",
				],
				[
					"the obvious choice",
					"feel dependable",
					"seem brave enough",
					"understand your style",
					"unlikely to judge you",
					"good under pressure",
				],
			),
			pair(
				"What bolder response could you give to the {a} {b}?",
				[
					"fear you have been avoiding",
					"grudge taking up your energy",
					"excuse holding you back",
					"safe choice that feels too small",
					"conversation you keep postponing",
					"outdated version of yourself",
				],
				[
					"right now",
					"before the end of this year",
					"the next time you notice it",
					"with someone you trust nearby",
					"even if responding feels uncomfortable",
					"so you can move forward",
				],
			),
		],
		dare: [
			pair(
				"For {a}, do {b} with complete confidence.",
				[
					"ten seconds",
					"fifteen seconds",
					"one full minute",
					"the rest of your turn",
					"twenty seconds",
					"the length of a short chorus",
				],
				[
					"a model walk",
					"a freestyle dance",
					"a dramatic pose",
					"an improvised toast",
					"a sung chorus",
					"a playful pickup line to an imaginary stranger",
				],
			),
			pair(
				"Let the group suggest {a}; if you accept it, {b}.",
				[
					"a harmless word",
					"a fake professional title",
					"an everyday object",
					"a ridiculous topic",
					"a song title",
					"a fictional character",
				],
				[
					"use it in a flirty sentence",
					"defend it in a serious debate",
					"turn it into a personal motto",
					"make it sound intimidating",
					"include it in your victory speech",
					"build a ten-second performance around it",
				],
			),
			pair(
				"Draft—but do not send—a message to {a} that contains {b}, then read it confidently.",
				[
					"a trusted friend",
					"someone you admire",
					"a former classmate",
					"your future self",
					"a fictional celebrity",
					"the person you were five years ago",
				],
				[
					"a genuinely bold compliment",
					"an invitation for coffee",
					"an honest thank-you",
					"a brave question",
					"a boundary stated clearly",
					"an ambitious announcement",
				],
			),
			pair(
				"Choose a willing player to {a}; if you both agree, {b}.",
				[
					"join a staring contest",
					"perform a two-person improv scene",
					"create a secret handshake",
					"trade harmless first impressions",
					"attempt a synchronized dance",
					"stage a dramatic reunion",
				],
				[
					"continue for ten seconds",
					"let the group count you in",
					"make it as confident as possible",
					"end with a theatrical bow",
					"pause halfway to check that both of you are comfortable",
					"keep it playful and low-pressure",
				],
			),
			pair(
				"Reveal {a}, then let the group {b}.",
				[
					"a harmless unpopular opinion",
					"a secret talent",
					"an ambitious goal",
					"a recent brave choice",
					"your first impression of this game",
					"a fashion risk you would try",
				],
				[
					"ask one respectful follow-up",
					"give it a movie title",
					"turn it into a newspaper headline",
					"suggest one bold next step",
					"celebrate it with applause",
					"summarize it in three words",
				],
			),
			pair(
				"Stand up and {a} like {b}.",
				[
					"enter the room again",
					"announce your full name",
					"dance for ten seconds",
					"toast the group",
					"celebrate yourself",
					"take a final bow",
				],
				[
					"the headline act",
					"a returning champion",
					"a charming movie villain",
					"a runway star",
					"the room already adores you",
					"this is your greatest moment",
				],
			),
		],
	},
	naughty: {
		truth: [
			pair(
				"Which {a} makes you feel most {b}, and why?",
				[
					"form of foreplay",
					"kind of kiss",
					"piece of lingerie",
					"erotic compliment",
					"consensual power dynamic",
					"intimate setting",
				],
				["turned on", "desired", "confident", "playfully exposed", "in control", "ready to let go"],
			),
			pair(
				"What is the most {a} experience you have shared with another consenting adult involving {b}?",
				["daring", "spontaneous", "seductive", "playful", "explicit", "adventurous"],
				[
					"something whispered during sex",
					"a request made in the bedroom",
					"an outfit chosen for an intimate night",
					"something explored behind closed doors",
					"an explicit sext",
					"a fantasy admitted during an intimate conversation",
				],
			),
			pair(
				"How do you prefer a willing adult partner to {a} when you want {b}?",
				["initiate sex", "kiss you", "talk dirty", "build anticipation", "touch you", "check in with you"],
				[
					"slow tension",
					"playful energy",
					"strong chemistry",
					"extra reassurance",
					"to surrender some control",
					"to take the lead",
				],
			),
			pair(
				"Which {a} are you most curious about exploring with a consenting adult partner {b}, and what boundary would matter?",
				[
					"role-play scenario",
					"sex toy",
					"bedroom fantasy",
					"form of restraint",
					"power exchange",
					"sensual game",
				],
				[
					"after an open discussion",
					"at a deliberately slow pace",
					"after researching it together",
					"only within your current comfort zone",
					"as part of planned intimate time",
					"without any promise to act on it",
				],
			),
			pair(
				"What is your honest reaction to {a} during {b}?",
				[
					"explicit dirty talk",
					"using sex toys",
					"watching yourselves in a mirror",
					"giving detailed instructions",
					"receiving oral sex",
					"being deliberately teased",
				],
				[
					"slow sex",
					"an established relationship",
					"a first night with a new consenting partner",
					"a planned intimate evening",
					"a playful quickie",
					"a trust-heavy encounter",
				],
			),
			pair(
				"What would make you feel safe enough to {a} with a consenting adult partner {b}?",
				[
					"share a detailed sexual fantasy",
					"ask for a specific sexual act",
					"try light bondage",
					"exchange explicit sexts",
					"be fully naked with the lights on",
					"explore giving up some control",
				],
				[
					"for the first time",
					"after a vulnerable conversation",
					"without feeling judged",
					"at your preferred pace",
					"after agreeing on privacy and boundaries",
					"while knowing either person can stop instantly",
				],
			),
		],
		dare: [
			pair(
				"Describe—without acting it out—{a} you would enjoy with a consenting adult partner, including {b}.",
				[
					"a deeply sexy kiss",
					"your ideal foreplay scene",
					"a favorite sexual position",
					"an erotic role-play",
					"a private striptease",
					"a consensual bondage scene",
				],
				[
					"where you would check in",
					"one firm boundary",
					"the pace you would want",
					"a safeword or stop signal",
					"what would make it exciting",
					"how either person could pause it",
				],
			),
			pair(
				"Give the group {a} example of {b} you might say to a consenting adult partner; keep it verbal only.",
				["a one-line", "a whispered", "a playful", "a confident", "a teasing", "an explicit but respectful"],
				[
					"dirty talk",
					"a sexy invitation",
					"a request for more",
					"a boundary during sex",
					"a compliment about their body",
					"a line used during foreplay",
				],
			),
			pair(
				"Using only your own clothing and body, perform {a} as though {b}; stay fully clothed.",
				[
					"a five-second seductive pose",
					"one slow turn",
					"a playful lip-bite reaction",
					"a confident walk",
					"a flirty wink sequence",
					"one beat of a sensual dance",
				],
				[
					"an imaginary camera were filming",
					"you were entering a private party",
					"you had just received a sexy compliment",
					"you were starring in a music video",
					"you knew exactly how attractive you looked",
					"you were teasing an imaginary lover",
				],
			),
			pair(
				"Name {a} you would consider using during consensual sex, then explain {b}.",
				["a safeword", "a sex toy", "a kind of lubricant", "a blindfold", "a restraint style", "a piece of lingerie"],
				[
					"one boundary connected to it",
					"how you would introduce it",
					"the safety or comfort check you would make",
					"what makes it appealing",
					"what information you would want first",
					"what would make you say no",
				],
			),
			pair(
				"Ask a willing adult player if they want you to {a}; only if they clearly say yes, {b}.",
				[
					"give them a flirtatious compliment",
					"hold five seconds of charged eye contact with them",
					"share a one-line sexy fantasy with them",
					"slow-dance with them while fully clothed",
					"kiss their hand",
					"give them a teasing nickname for one round",
				],
				[
					"do exactly that and nothing beyond what they approved",
					"do it while letting them set every limit",
					"check their comfort once more, then do it",
					"do it briefly and stop instantly if asked",
					"do it respectfully and for under ten seconds",
					"do it gently, then thank them when it ends",
				],
			),
			pair(
				"Answer in one explicit but respectful sentence: how would you {a} while {b}?",
				[
					"initiate sex",
					"ask to receive oral sex",
					"request a sex toy",
					"ask to be touched harder",
					"pause a sexual encounter",
					"check whether a partner wants more",
				],
				[
					"keeping consent unmistakable",
					"making no easy to say",
					"honoring an existing boundary",
					"staying attentive to body language",
					"leaving room to change your mind",
					"speaking clearly and respectfully",
				],
			),
		],
	},
};

const formatPrompt = (pattern, a, b) =>
	pattern.replace("{a}", a).replace("{b}", b).replace(/\s+/g, " ").trim();

const generateCategoryPrompts = (category, mode) => {
	const records = [];
	const blueprints = PROMPT_BLUEPRINTS[category][mode];

	for (const blueprint of blueprints) {
		for (const a of blueprint.left) {
			for (const b of blueprint.right) {
				let text = formatPrompt(blueprint.pattern, a, b);
				if (category === "naughty") {
					text +=
						mode === "truth"
							? " Adults only: answer only if comfortable; passing is always okay."
							: " Clear consent is required, and anyone may pass.";
				}

				records.push(
					freeze({
						id: `${mode}-${category}-${String(records.length + 1).padStart(3, "0")}`,
						mode,
						category,
						text,
						minimumAge: CATEGORIES[category].minimumAge,
					}),
				);
			}
		}
	}

	return freeze(records);
};

const truthByCategory = {};
const dareByCategory = {};

for (const category of CATEGORY_IDS) {
	truthByCategory[category] = generateCategoryPrompts(category, "truth");
	dareByCategory[category] = generateCategoryPrompts(category, "dare");
}

freeze(truthByCategory);
freeze(dareByCategory);

/** All generated Truth prompt records, frozen in stable category order. */
export const TRUTH_PROMPTS = freeze(CATEGORY_IDS.flatMap((category) => truthByCategory[category]));

/** All generated Dare prompt records, frozen in stable category order. */
export const DARE_PROMPTS = freeze(CATEGORY_IDS.flatMap((category) => dareByCategory[category]));

/**
 * Immutable generated prompt library.
 *
 * @type {Readonly<{truth: readonly object[], dare: readonly object[]}>}
 */
export const PROMPT_LIBRARY = freeze({
	truth: TRUTH_PROMPTS,
	dare: DARE_PROMPTS,
});

const assertUniqueLibrary = () => {
	for (const mode of ["truth", "dare"]) {
		const prompts = PROMPT_LIBRARY[mode];
		const ids = new Set(prompts.map((prompt) => prompt.id));
		const texts = new Set(prompts.map((prompt) => prompt.text));

		if (ids.size !== prompts.length || texts.size !== prompts.length) {
			throw new Error(`Generated ${mode} library contains duplicate prompts.`);
		}
	}
};

assertUniqueLibrary();

const normalizeMode = (mode = "mix") => {
	if (!PROMPT_MODES.includes(mode)) {
		throw new RangeError(`Unknown prompt mode “${mode}”. Use truth, dare, or mix.`);
	}
	return mode;
};

const normalizeCategories = (enabledCategories) => {
	if (enabledCategories == null) return DEFAULT_CATEGORY_IDS;

	let requested;
	if (typeof enabledCategories === "string") {
		requested = [enabledCategories];
	} else if (typeof enabledCategories[Symbol.iterator] === "function") {
		requested = Array.from(enabledCategories);
	} else if (typeof enabledCategories === "object") {
		requested = Object.keys(enabledCategories).filter((key) => enabledCategories[key]);
	} else {
		throw new TypeError("enabledCategories must be a category, iterable, or enabled-category map.");
	}

	const unique = [...new Set(requested)];
	const unknown = unique.filter((category) => !CATEGORY_IDS.includes(category));
	if (unknown.length > 0) {
		throw new RangeError(`Unknown prompt ${unknown.length === 1 ? "category" : "categories"}: ${unknown.join(", ")}`);
	}

	return freeze(CATEGORY_IDS.filter((category) => unique.includes(category)));
};

/**
 * Return a frozen prompt pool for a mode and category selection.
 *
 * @param {object} [options]
 * @param {'truth'|'dare'|'mix'} [options.mode='mix'] Prompt mode.
 * @param {string|string[]|Set<string>|Record<string, boolean>} [options.enabledCategories]
 * Categories to include. Omit to use categories marked `defaultEnabled`.
 * @returns {readonly object[]} A newly frozen array of immutable prompt records.
 */
export function getPrompts({ mode = "mix", enabledCategories } = {}) {
	const normalizedMode = normalizeMode(mode);
	const categories = normalizeCategories(enabledCategories);
	const modes = normalizedMode === "mix" ? ["truth", "dare"] : [normalizedMode];
	const prompts = [];

	for (const selectedMode of modes) {
		const source = selectedMode === "truth" ? truthByCategory : dareByCategory;
		for (const category of categories) prompts.push(...source[category]);
	}

	return freeze(prompts);
}

const makeCounts = (mode, categories) => {
	const includeTruth = mode === "truth" || mode === "mix";
	const includeDare = mode === "dare" || mode === "mix";
	const byCategory = {};
	let truth = 0;
	let dare = 0;

	for (const category of CATEGORY_IDS) {
		const enabled = categories.includes(category);
		const truthCount = enabled && includeTruth ? truthByCategory[category].length : 0;
		const dareCount = enabled && includeDare ? dareByCategory[category].length : 0;
		truth += truthCount;
		dare += dareCount;
		byCategory[category] = freeze({
			truth: truthCount,
			dare: dareCount,
			total: truthCount + dareCount,
		});
	}

	return freeze({
		mode,
		enabledCategories: freeze([...categories]),
		truth,
		dare,
		total: truth + dare,
		byCategory: freeze(byCategory),
	});
};

/**
 * Count prompts available to the supplied filter. Counts mirror `getPrompts`.
 *
 * @param {object} [options]
 * @param {'truth'|'dare'|'mix'} [options.mode='mix'] Prompt mode.
 * @param {string|string[]|Set<string>|Record<string, boolean>} [options.enabledCategories]
 * Categories to include. Omit to use categories marked `defaultEnabled`.
 * @returns {Readonly<{mode:string, enabledCategories:readonly string[], truth:number, dare:number, total:number, byCategory:object}>}
 */
export function getPromptCounts({ mode = "mix", enabledCategories } = {}) {
	const normalizedMode = normalizeMode(mode);
	const categories = normalizeCategories(enabledCategories);
	return makeCounts(normalizedMode, categories);
}

/** Counts for the entire generated library, including per-category totals. */
export const PROMPT_COUNTS = getPromptCounts({ enabledCategories: CATEGORY_IDS });

const randomIndex = (length, random) => {
	const sample = Number(random());
	if (!Number.isFinite(sample)) throw new TypeError("The random function must return a finite number.");
	const normalized = sample - Math.floor(sample);
	return Math.min(length - 1, Math.floor(normalized * length));
};

/**
 * Create an independent stateful random prompt picker.
 *
 * Recent prompts are withheld when alternatives exist. If a small filtered
 * pool exhausts the history window, history is relaxed while the immediately
 * previous prompt remains excluded. This guarantees no immediate repeat when
 * at least two eligible prompts exist.
 *
 * @param {object|Function} [options]
 * @param {Function} [options.random=Math.random] RNG returning any finite number.
 * @param {number} [options.historySize=24] Number of recent prompt IDs to avoid.
 * @returns {Readonly<{pick: Function, next: Function, reset: Function, history: Function}>}
 */
export function createPromptPicker(options = {}) {
	const config = typeof options === "function" ? { random: options } : options;
	const random = config.random ?? Math.random;
	const historySize = config.historySize ?? 24;

	if (typeof random !== "function") throw new TypeError("random must be a function.");
	if (!Number.isInteger(historySize) || historySize < 1) {
		throw new RangeError("historySize must be a positive integer.");
	}

	const recentIds = [];

	/** @param {Parameters<typeof getPrompts>[0]} [selection] */
	const pick = (selection = {}) => {
		const pool = getPrompts(selection);
		if (pool.length === 0) return null;

		const recent = new Set(recentIds);
		let candidates = pool.filter((prompt) => !recent.has(prompt.id));

		if (candidates.length === 0) {
			const immediatelyPrevious = recentIds.at(-1);
			candidates = pool.filter((prompt) => prompt.id !== immediatelyPrevious);
			if (candidates.length === 0) candidates = [...pool];
		}

		const chosen = candidates[randomIndex(candidates.length, random)];
		recentIds.push(chosen.id);
		if (recentIds.length > historySize) recentIds.splice(0, recentIds.length - historySize);
		return chosen;
	};

	const reset = () => {
		recentIds.length = 0;
	};

	const history = () => freeze([...recentIds]);

	return freeze({ pick, next: pick, reset, history });
}

const defaultPicker = createPromptPicker();

/**
 * Pick a random prompt with module-level recent-history protection.
 * Returns `null` only when the selected category set is empty.
 *
 * @param {Parameters<typeof getPrompts>[0]} [options]
 * @returns {Readonly<{id:string, mode:'truth'|'dare', category:string, text:string, minimumAge:number}>|null}
 */
export function getRandomPrompt(options = {}) {
	return defaultPicker.pick(options);
}

/** Clear the module-level random picker's recent-prompt history. */
export function resetPromptHistory() {
	defaultPicker.reset();
}
