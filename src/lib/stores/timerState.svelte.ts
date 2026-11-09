import { reportWriteError } from './syncNotice.svelte';
import { browser } from '$app/environment';
import { doc, setDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { firestore } from '$lib/firebase';
import { pomoMeta, incrementCompleted, persistLocal, restorePomoTasks } from './pomodoroTasks.svelte';

export type TimerMode = 'countdown' | 'stopwatch' | 'pomodoro';
export type PomodoroPhase = 'work' | 'short-break' | 'long-break';
export type BreakType = 'short-break' | 'long-break' | 'no-break';

export type LapEntry = { index: number; lapTime: number; total: number }; // ms for stopwatch
export type SessionEntry = { mode: TimerMode; duration: number; label: string; ts: number };

// ── Pomodoro config ──────────────────────────────────────────────
export const MAX_POMO_MINUTES = 180;
export const MAX_COUNTDOWN_SECONDS = 99 * 3600 + 59 * 60 + 59; // the most HH:MM:SS can show

export let pomodoroConfig = $state({
	workDuration: 25 * 60,
	shortBreak: 5 * 60,
	longBreak: 15 * 60,
	autoAdvance: false,
	// breakPattern[i] = what break follows work session i+1
	breakPattern: ['short-break', 'short-break', 'short-break', 'long-break'] as BreakType[],
});

export function buildBreakPattern(rounds: number, existing?: BreakType[]): BreakType[] {
	const clamped = Math.max(1, Math.min(10, rounds));
	// Existing break types are kept, but a cycle always ends with a long break.
	return Array.from({ length: clamped }, (_, i) =>
		i === clamped - 1 ? 'long-break' : existing?.[i] ?? 'short-break'
	) as BreakType[];
}

// ── Core state ───────────────────────────────────────────────────
export let timerState = $state({
	mode: 'countdown' as TimerMode,
	running: false,
	finished: false,

	// countdown / pomodoro (seconds)
	elapsed: 0,
	countdownTarget: 25 * 60,

	// Wall-clock anchor for countdown/pomodoro. While running, elapsed is derived from
	// these rather than counted per tick, so throttled or suspended tabs can't lose time.
	runStartedAt: 0,      // Date.now() when the current run period began (0 = not running)
	runBaseElapsed: 0,    // seconds already banked when that run period began

	// stopwatch ms-precision timing
	startedAt: 0,         // Date.now() when current run started (0 = not running)
	accMs: 0,             // ms accumulated before current run period
	lapStartTotalMs: 0,   // total ms when current lap started

	// stopwatch laps
	laps: [] as LapEntry[],

	// pomodoro
	pomodoroSession: 1,
	pomodoroPhase: 'work' as PomodoroPhase,
	pomodoroElapsed: 0,
	waitingForNext: false,

	// session log
	sessionLog: [] as SessionEntry[],
});

// ── Internal tick handle ─────────────────────────────────────────
let _interval: ReturnType<typeof setInterval> | null = null;
let _swTitleTick = $state(0); // Date.now() isn't reactive, so the stopwatch tab title reads this
// Countdown progress keeps fractions of a second, so a whole-second tick could land up to
// a second late; a shorter tick keeps the display and the finish on time.
const TICK_MS = 250;
let _pomoJumpSecs = 0; // seconds of this phase passed over by editing the clock, not focused

/**
 * Seconds elapsed in the active countdown/pomodoro run, read from the clock.
 * Falls back to the banked value when paused, so this is always safe to call.
 */
function liveElapsed(): number {
	const s = timerState;
	const banked = s.mode === 'pomodoro' ? s.pomodoroElapsed : s.elapsed;
	if (!s.running || s.runStartedAt === 0) return banked;
	return s.runBaseElapsed + (Date.now() - s.runStartedAt) / 1000;
}

/** Fold the in-flight run period back into the banked elapsed value and stop the clock. */
function bankElapsed() {
	const s = timerState;
	const value = liveElapsed();
	if (s.mode === 'pomodoro') s.pomodoroElapsed = value;
	else s.elapsed = value;
	s.runStartedAt = 0;
	s.runBaseElapsed = value;
}

function stopInterval() {
	if (_interval) { clearInterval(_interval); _interval = null; }
}

function tick() {
	restoreTimerLocal(); // the settings decide when a phase ends, even on routes without the timer
	const s = timerState;

	if (s.mode === 'stopwatch') { // stopwatch uses ms via Date.now(); this only repaints the tab title
		_swTitleTick++;
		return;
	}

	// Derived from the wall clock, so a throttled or suspended tab catches up
	// on its next tick instead of silently falling behind.
	const value = liveElapsed();

	if (s.mode === 'countdown') {
		const prev = s.elapsed;
		s.elapsed = Math.min(value, s.countdownTarget);
		if (value >= s.countdownTarget) {
			s.running = false;
			s.finished = true;
			s.runStartedAt = 0;
			s.runBaseElapsed = s.countdownTarget;
			stopInterval();
			playBeep();
			notifyDone('Timer finished', `${formatTime(s.countdownTarget)} countdown is up.`);
			logSession('countdown', s.countdownTarget, 'Countdown');
			writeTimerToFirestore();
			return;
		}
		if (Math.floor(s.elapsed) !== Math.floor(prev)) playTick();
		return;
	}

	if (s.mode === 'pomodoro') {
		const target = pomodoroPhaseTarget();
		const prev = s.pomodoroElapsed;
		s.pomodoroElapsed = Math.min(value, target);
		if (value >= target) {
			playBeep();
			const done = phaseLabel();
			logSession('pomodoro', Math.max(0, target - _pomoJumpSecs), done);
			// Here rather than in TimerTool, which is unmounted on routes without the timer.
			if (s.pomodoroPhase === 'work' && pomoMeta.activeTaskId !== null) incrementCompleted(pomoMeta.activeTaskId);
			advancePomodoro();
			notifyDone(`${done} finished`, pomodoroConfig.autoAdvance ? `${phaseLabel()} has started.` : `${phaseLabel()} is ready when you are.`);
		} else if (s.pomodoroPhase === 'work' && Math.floor(s.pomodoroElapsed) !== Math.floor(prev)) {
			playTick();
		}
	}
}

// A hidden tab's interval is throttled, so re-sync the moment it comes back.
if (browser) {
	document.addEventListener('visibilitychange', () => {
		if (!document.hidden && timerState.running && timerState.mode !== 'stopwatch') tick();
	});
}

function pomodoroPhaseTarget(): number {
	const p = timerState.pomodoroPhase;
	if (p === 'work') return pomodoroConfig.workDuration;
	if (p === 'short-break') return pomodoroConfig.shortBreak;
	return pomodoroConfig.longBreak;
}

function phaseLabel(): string {
	const p = timerState.pomodoroPhase;
	if (p === 'work') return `Work #${timerState.pomodoroSession}`;
	if (p === 'short-break') return 'Short break';
	return 'Long break';
}

function advancePomodoro() {
	const s = timerState;
	const cfg = pomodoroConfig;
	const pattern = cfg.breakPattern;

	if (s.pomodoroPhase === 'work') {
		const idx = (s.pomodoroSession - 1) % pattern.length;
		const breakType = pattern[idx];
		if (breakType === 'no-break') {
			// Skip break — jump directly to next work session
			if (s.pomodoroSession >= pattern.length) s.pomodoroSession = 1;
			else s.pomodoroSession += 1;
			s.pomodoroPhase = 'work';
		} else {
			s.pomodoroPhase = breakType;
		}
	} else {
		const cycleLen = pattern.length;
		if (s.pomodoroSession >= cycleLen) s.pomodoroSession = 1;
		else s.pomodoroSession += 1;
		s.pomodoroPhase = 'work';
	}

	s.pomodoroElapsed = 0;
	_pomoJumpSecs = 0;
	// New phase starts from zero — re-anchor so the next tick measures from here.
	s.runBaseElapsed = 0;
	s.runStartedAt = cfg.autoAdvance ? Date.now() : 0;

	if (cfg.autoAdvance) return;
	s.running = false;
	s.waitingForNext = true;
	stopInterval();
}

function logSession(mode: TimerMode, duration: number, label: string) {
	restoreTimerLocal();
	timerState.sessionLog.unshift({ mode, duration, label, ts: Date.now() });
}

// ── Completion alerts ────────────────────────────────────────────
// A focus timer is used while you are looking at something else, so finishing has to be
// announced outside the page: the tab title carries the countdown, and a notification
// fires when it ends.

export function requestNotificationPermission() {
	if (!browser || !('Notification' in window)) return;
	if (Notification.permission === 'default') Notification.requestPermission().catch(() => {});
}

function notifyDone(title: string, body: string) {
	if (!browser) return;
	if ('Notification' in window && Notification.permission === 'granted') {
		try { new Notification(title, { body, tag: 'workkit-timer', icon: '/favicon.svg' }); } catch { /* ignore */ }
	}
	try { navigator.vibrate?.([180, 90, 180]); } catch { /* not supported */ }
}

const BASE_TITLE = 'WorkKit';

/** Keeps the tab title in step with the timer: "07:12 · Focus · WorkKit". */
export function timerTabTitle(pageName: string): string {
	const s = timerState;
	if (s.mode === 'stopwatch') {
		void _swTitleTick;
		return s.running ? `${formatLapMs(swTotalMs()).split('.')[0]} · Stopwatch · ${BASE_TITLE}` : `${pageName} · ${BASE_TITLE}`;
	}
	if (s.finished) return `Done · ${BASE_TITLE}`;
	if (s.mode === 'pomodoro' && s.waitingForNext) {
		return `${s.pomodoroPhase === 'work' ? 'Focus' : 'Break'} ready · ${BASE_TITLE}`;
	}
	if (!s.running) return `${pageName} · ${BASE_TITLE}`;
	const label = s.mode === 'pomodoro' ? phaseLabel() : 'Timer';
	return `${formatTime(currentSeconds())} · ${label} · ${BASE_TITLE}`;
}

// ── Public actions ───────────────────────────────────────────────
export function startStop() {
	const s = timerState;
	if (s.finished) return;

	if (s.running) {
		if (s.mode !== 'stopwatch') bankElapsed();
		s.running = false;
		stopInterval();
		if (s.mode === 'stopwatch' && s.startedAt > 0) {
			s.accMs += Date.now() - s.startedAt;
			s.startedAt = 0;
		}
	} else {
		s.running = true;
		if (s.mode === 'pomodoro') s.waitingForNext = false;
		if (s.mode === 'stopwatch') {
			s.startedAt = Date.now();
			_interval = setInterval(tick, 1000);
		} else {
			// Anchor to the clock so elapsed is measured, not counted.
			s.runBaseElapsed = s.mode === 'pomodoro' ? s.pomodoroElapsed : s.elapsed;
			s.runStartedAt = Date.now();
			_interval = setInterval(tick, TICK_MS);
		}
	}
	writeTimerToFirestore();
}

/** Resets the current mode only: like setMode, the other modes keep their progress. */
export function reset() {
	const mode = timerState.mode;
	timerState.running = false;
	timerState.finished = false;
	if (mode === 'countdown') timerState.elapsed = 0;
	if (mode === 'stopwatch') {
		timerState.laps = [];
		timerState.startedAt = 0;
		timerState.accMs = 0;
		timerState.lapStartTotalMs = 0;
	}
	if (mode === 'pomodoro') {
		timerState.pomodoroElapsed = 0;
		_pomoJumpSecs = 0;
		timerState.pomodoroSession = 1;
		timerState.pomodoroPhase = 'work';
		timerState.waitingForNext = false;
	}
	timerState.runStartedAt = 0;
	timerState.runBaseElapsed = 0;
	stopInterval();
	writeTimerToFirestore();
}

export function lap() {
	if (timerState.mode !== 'stopwatch' || !timerState.running) return;
	const now = Date.now();
	const total = timerState.accMs + (now - timerState.startedAt);
	const lapTime = total - timerState.lapStartTotalMs;
	timerState.laps.push({ index: timerState.laps.length + 1, lapTime, total });
	timerState.lapStartTotalMs = total;
	writeTimerToFirestore();
}

/**
 * Switching mode pauses whatever was running and keeps its progress. The three modes
 * hold their state in separate fields, so returning to a mode resumes where you left it —
 * a tab that discards work on a stray click is not a tab.
 */
export function setMode(mode: TimerMode) {
	const s = timerState;
	if (s.mode === mode) return;

	if (s.running) {
		if (s.mode === 'stopwatch') {
			if (s.startedAt > 0) { s.accMs += Date.now() - s.startedAt; s.startedAt = 0; }
		} else {
			bankElapsed();
		}
		s.running = false;
		stopInterval();
	}

	s.mode = mode;
	// `finished` belongs to the countdown; recompute it for the mode we just entered.
	s.finished = mode === 'countdown' && s.elapsed >= s.countdownTarget && s.countdownTarget > 0;
	writeTimerToFirestore();
}

export function setCountdownTarget(seconds: number) {
	timerState.countdownTarget = seconds;
	timerState.elapsed = 0;
	timerState.finished = false;
	writeTimerToFirestore();
}

/** Sets the time left in the current pomodoro phase by hand. */
export function setPomodoroRemaining(secs: number) {
	const s = timerState;
	const next = Math.max(0, currentTotal() - secs);
	_pomoJumpSecs += next - s.pomodoroElapsed;
	s.pomodoroElapsed = next;
	s.finished = false;
}

export function skipPomodoro() {
	if (timerState.mode !== 'pomodoro') return;
	// With Auto on, a running session flows straight into the next phase.
	const keepRunning = pomodoroConfig.autoAdvance && timerState.running;
	if (!keepRunning) {
		stopInterval();
		timerState.running = false;
	}
	advancePomodoro();
	if (!keepRunning) timerState.runStartedAt = 0;
	writeTimerToFirestore();
}

// ── Derived helpers ───────────────────────────────────────────────
export function currentSeconds(): number {
	const s = timerState;
	// liveElapsed() reads the clock while running, so the display stays true even if
	// the interval that repaints it was throttled.
	const elapsed = s.running ? liveElapsed() : (s.mode === 'pomodoro' ? s.pomodoroElapsed : s.elapsed);
	const whole = Math.floor(elapsed); // the fraction is kept, but only full seconds show
	if (s.mode === 'countdown') return Math.max(0, s.countdownTarget - whole);
	return Math.max(0, pomodoroPhaseTarget() - whole);
}

export function currentTotal(): number {
	const s = timerState;
	if (s.mode === 'countdown') return s.countdownTarget;
	return pomodoroPhaseTarget();
}

// Returns current total stopwatch ms (call frequently from RAF)
export function swTotalMs(): number {
	const s = timerState;
	return s.accMs + (s.startedAt > 0 ? Date.now() - s.startedAt : 0);
}

// Returns current lap ms
export function swLapMs(): number {
	return swTotalMs() - timerState.lapStartTotalMs;
}

export function formatTime(secs: number): string {
	const s = Math.max(0, Math.floor(secs));
	const h = Math.floor(s / 3600);
	const m = Math.floor((s % 3600) / 60);
	const sec = s % 60;
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(sec).padStart(2, '0')}`;
}

// HH:MM:SS.cc — for stopwatch display
export function formatMs(ms: number): string {
	const t = Math.max(0, ms);
	const h = Math.floor(t / 3600000);
	const m = Math.floor((t % 3600000) / 60000);
	const s = Math.floor((t % 60000) / 1000);
	const cs = Math.floor((t % 1000) / 10);
	return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

// MM:SS.cc (+ HH: prefix if ≥ 1h) — for lap display
export function formatLapMs(ms: number): string {
	const t = Math.max(0, ms);
	const h = Math.floor(t / 3600000);
	const m = Math.floor((t % 3600000) / 60000);
	const s = Math.floor((t % 60000) / 1000);
	const cs = Math.floor((t % 1000) / 10);
	const prefix = h > 0 ? `${h}:` : '';
	return `${prefix}${String(m).padStart(2, '0')}:${String(s).padStart(2, '0')}.${String(cs).padStart(2, '0')}`;
}

export function todayFocusSeconds(): number {
	const midnight = new Date();
	midnight.setHours(0, 0, 0, 0);
	return timerState.sessionLog
		.filter((e) => e.ts >= midnight.getTime() && (e.mode === 'countdown' || (e.mode === 'pomodoro' && e.label.startsWith('Work'))))
		.reduce((acc, e) => acc + e.duration, 0);
}

// ── Firestore sync ────────────────────────────────────────────────
let _syncUid: string | null = null;
let _lastWrittenAt = 0; // timestamp of our last write — used for last-write-wins conflict resolution
let _unsubTimer: Unsubscribe | null = null;

interface TimerSyncDoc {
	mode: TimerMode;
	running: boolean;
	syncedAt: number;
	elapsed: number;
	countdownTarget: number;
	pomodoroSession: number;
	pomodoroPhase: string;
	pomodoroElapsed: number;
	waitingForNext: boolean;
	finished: boolean;
	startedAt: number;
	accMs: number;
	lapStartTotalMs: number;
	laps: LapEntry[];
	runStartedAt: number;
	runBaseElapsed: number;
}

function writeTimerToFirestore() {
	if (!_syncUid || !browser) return;
	_lastWrittenAt = Date.now();
	const s = timerState;
	const data: TimerSyncDoc = {
		mode: s.mode,
		running: s.running,
		syncedAt: _lastWrittenAt,
		elapsed: s.elapsed,
		countdownTarget: s.countdownTarget,
		pomodoroSession: s.pomodoroSession,
		pomodoroPhase: s.pomodoroPhase,
		pomodoroElapsed: s.pomodoroElapsed,
		waitingForNext: s.waitingForNext,
		finished: s.finished,
		startedAt: s.startedAt,
		accMs: s.accMs,
		lapStartTotalMs: s.lapStartTotalMs,
		laps: s.laps,
		runStartedAt: s.runStartedAt,
		runBaseElapsed: s.runBaseElapsed,
	};
	setDoc(doc(firestore, `users/${_syncUid}/meta/timer`), data).catch(reportWriteError);
}

/**
 * Unified timer sync — works for both the owner and any device that has the share URL.
 * Last-write-wins: incoming snapshots are only applied if their syncedAt is newer
 * than the last write this device made, so both devices can freely start/stop/reset
 * and whichever action happened most recently is the truth.
 */
export function setupTimerSync(uid: string) {
	if (!browser) return;
	_unsubTimer?.();
	_syncUid = uid;
	_lastWrittenAt = 0; // reset so the first snapshot is always applied

	_unsubTimer = onSnapshot(
		doc(firestore, `users/${uid}/meta/timer`),
		(snap) => {
			if (!snap.exists()) return;
			const d = snap.data() as TimerSyncDoc;

			// Last-write-wins: ignore snapshots older than our last write
			if (d.syncedAt <= _lastWrittenAt) return;

			stopInterval();

			if (d.pomodoroPhase !== timerState.pomodoroPhase || d.pomodoroSession !== timerState.pomodoroSession) _pomoJumpSecs = 0;
			timerState.mode = d.mode;
			timerState.running = d.running;
			timerState.finished = d.finished;
			timerState.countdownTarget = d.countdownTarget;
			timerState.pomodoroSession = d.pomodoroSession;
			timerState.pomodoroPhase = d.pomodoroPhase as PomodoroPhase;
			timerState.waitingForNext = d.waitingForNext;
			timerState.startedAt = d.startedAt;
			timerState.accMs = d.accMs;
			timerState.lapStartTotalMs = d.lapStartTotalMs;
			timerState.laps = d.laps ?? [];

			// The run anchor is an absolute timestamp, so it transfers across devices as-is
			// and elapsed can be derived locally. Older documents without it fall back to
			// the stored elapsed plus the time since that write.
			const sinceSyncSecs = d.running ? Math.max(0, Math.floor((Date.now() - d.syncedAt) / 1000)) : 0;
			const hasAnchor = typeof d.runStartedAt === 'number' && d.runStartedAt > 0;
			timerState.runStartedAt = hasAnchor ? d.runStartedAt : (d.running ? Date.now() : 0);
			timerState.runBaseElapsed = hasAnchor
				? (d.runBaseElapsed ?? 0)
				: (d.mode === 'pomodoro' ? d.pomodoroElapsed : d.elapsed) + sinceSyncSecs;

			timerState.elapsed = d.mode === 'countdown' && d.running
				? liveElapsed()
				: d.elapsed + (d.mode === 'countdown' ? sinceSyncSecs : 0);
			timerState.pomodoroElapsed = d.mode === 'pomodoro' && d.running
				? liveElapsed()
				: d.pomodoroElapsed + (d.mode === 'pomodoro' ? sinceSyncSecs : 0);

			if (d.running) {
				_interval = setInterval(tick, d.mode === 'stopwatch' ? 1000 : TICK_MS);
			}
		}
	);
}

export function unloadTimerState() {
	_unsubTimer?.();
	_unsubTimer = null;
	_syncUid = null;
	_lastWrittenAt = 0;
}

// ── Sound config ─────────────────────────────────────────────────
export let soundConfig = $state({
	alarmEnabled: true,
	tickEnabled: false,
});

// ── Local persistence ────────────────────────────────────────────
// Pomodoro settings, sound choices and the session log live on this device only. They are
// not in TimerSyncDoc and snapshots never touch them, so they can't fight the synced timer.
const BREAK_TYPES: BreakType[] = ['short-break', 'long-break', 'no-break'];
const MODES: TimerMode[] = ['countdown', 'stopwatch', 'pomodoro'];
const MAX_LOG_ENTRIES = 500;

const asMinutes = (v: unknown, fallback: number) =>
	typeof v === 'number' && Number.isFinite(v) && v >= 60 && v <= MAX_POMO_MINUTES * 60 ? v : fallback;

function applyPrefs(raw: unknown) {
	const d = raw as { pomodoro?: Record<string, unknown>; sound?: Record<string, unknown> } | null;
	const p = d?.pomodoro;
	if (p) {
		pomodoroConfig.workDuration = asMinutes(p.workDuration, pomodoroConfig.workDuration);
		pomodoroConfig.shortBreak = asMinutes(p.shortBreak, pomodoroConfig.shortBreak);
		pomodoroConfig.longBreak = asMinutes(p.longBreak, pomodoroConfig.longBreak);
		if (typeof p.autoAdvance === 'boolean') pomodoroConfig.autoAdvance = p.autoAdvance;
		const bp = p.breakPattern;
		if (Array.isArray(bp) && bp.length >= 1 && bp.length <= 10 && bp.every((b) => BREAK_TYPES.includes(b))) {
			pomodoroConfig.breakPattern = bp as BreakType[];
		}
	}
	if (typeof d?.sound?.alarmEnabled === 'boolean') soundConfig.alarmEnabled = d.sound.alarmEnabled;
	if (typeof d?.sound?.tickEnabled === 'boolean') soundConfig.tickEnabled = d.sound.tickEnabled;
}

function applyLog(raw: unknown) {
	if (!Array.isArray(raw)) return;
	timerState.sessionLog = raw
		.filter((e) => e && MODES.includes(e.mode) && typeof e.label === 'string'
			&& typeof e.duration === 'number' && Number.isFinite(e.duration) && e.duration >= 0
			&& typeof e.ts === 'number' && Number.isFinite(e.ts))
		.slice(0, MAX_LOG_ENTRIES) as SessionEntry[];
}

let _localRestored = false;

/** Idempotent. Runs after hydration (TimerTool's onMount) or before the first thing that needs it. */
export function restoreTimerLocal() {
	if (!browser || _localRestored) return;
	_localRestored = true;
	restorePomoTasks();
	persistLocal('workkit-timer-prefs', () => ({ pomodoro: pomodoroConfig, sound: soundConfig }), applyPrefs);
	persistLocal('workkit-timer-log', () => timerState.sessionLog.slice(0, MAX_LOG_ENTRIES), applyLog);
}

// ── Sound ────────────────────────────────────────────────────────
function playBeep() {
	if (!soundConfig.alarmEnabled) return;
	try {
		const ctx = new AudioContext();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.frequency.value = 880;
		osc.type = 'sine';
		gain.gain.setValueAtTime(0.4, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 1.2);
		osc.start(ctx.currentTime);
		osc.stop(ctx.currentTime + 1.2);
	} catch {
		// audio not available
	}
}

export function playTick() {
	if (!soundConfig.tickEnabled) return;
	try {
		const ctx = new AudioContext();
		const osc = ctx.createOscillator();
		const gain = ctx.createGain();
		osc.connect(gain);
		gain.connect(ctx.destination);
		osc.frequency.value = 1200;
		osc.type = 'sine';
		gain.gain.setValueAtTime(0.06, ctx.currentTime);
		gain.gain.exponentialRampToValueAtTime(0.001, ctx.currentTime + 0.04);
		osc.start(ctx.currentTime);
		osc.stop(ctx.currentTime + 0.04);
	} catch {
		// audio not available
	}
}
