import { browser } from '$app/environment';
import { doc, setDoc, onSnapshot, type Unsubscribe } from 'firebase/firestore';
import { firestore } from '$lib/firebase';

export type TimerMode = 'countdown' | 'stopwatch' | 'pomodoro';
export type PomodoroPhase = 'work' | 'short-break' | 'long-break';
export type BreakType = 'short-break' | 'long-break' | 'no-break';

export type LapEntry = { index: number; lapTime: number; total: number }; // ms for stopwatch
export type SessionEntry = { mode: TimerMode; duration: number; label: string; ts: number };

// ── Pomodoro config ──────────────────────────────────────────────
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
	return Array.from({ length: clamped }, (_, i) => existing?.[i] ?? 'short-break') as BreakType[];
}

// ── Core state ───────────────────────────────────────────────────
export let timerState = $state({
	mode: 'countdown' as TimerMode,
	running: false,
	finished: false,

	// countdown / pomodoro (seconds)
	elapsed: 0,
	countdownTarget: 25 * 60,

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

function tick() {
	const s = timerState;

	if (s.mode === 'stopwatch') return; // stopwatch uses ms via Date.now()

	if (s.mode === 'countdown') {
		if (s.elapsed >= s.countdownTarget) {
			s.running = false;
			s.finished = true;
			clearInterval(_interval!);
			_interval = null;
			playBeep();
			logSession('countdown', s.countdownTarget, 'Countdown');
			writeTimerToFirestore();
			return;
		}
		s.elapsed += 1;
		playTick();
		return;
	}

	if (s.mode === 'pomodoro') {
		const target = pomodoroPhaseTarget();
		s.pomodoroElapsed += 1;
		if (s.pomodoroElapsed >= target) {
			playBeep();
			logSession('pomodoro', target, phaseLabel());
			advancePomodoro();
		} else if (s.pomodoroPhase === 'work') {
			playTick();
		}
	}
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

	if (cfg.autoAdvance) return;
	s.running = false;
	s.waitingForNext = true;
	clearInterval(_interval!);
	_interval = null;
}

function logSession(mode: TimerMode, duration: number, label: string) {
	timerState.sessionLog.unshift({ mode, duration, label, ts: Date.now() });
}

// ── Public actions ───────────────────────────────────────────────
export function startStop() {
	const s = timerState;
	if (s.finished) return;

	if (s.running) {
		s.running = false;
		clearInterval(_interval!);
		_interval = null;
		if (s.mode === 'stopwatch' && s.startedAt > 0) {
			s.accMs += Date.now() - s.startedAt;
			s.startedAt = 0;
		}
	} else {
		s.running = true;
		s.waitingForNext = false;
		if (s.mode === 'stopwatch') {
			s.startedAt = Date.now();
		} else {
			_interval = setInterval(tick, 1000);
		}
	}
	writeTimerToFirestore();
}

export function reset() {
	timerState.running = false;
	timerState.finished = false;
	timerState.elapsed = 0;
	timerState.laps = [];
	timerState.pomodoroElapsed = 0;
	timerState.pomodoroSession = 1;
	timerState.pomodoroPhase = 'work';
	timerState.waitingForNext = false;
	timerState.startedAt = 0;
	timerState.accMs = 0;
	timerState.lapStartTotalMs = 0;
	clearInterval(_interval!);
	_interval = null;
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

export function setMode(mode: TimerMode) {
	reset();
	timerState.mode = mode;
	writeTimerToFirestore();
}

export function setCountdownTarget(seconds: number) {
	timerState.countdownTarget = seconds;
	timerState.elapsed = 0;
	timerState.finished = false;
	writeTimerToFirestore();
}

export function skipPomodoro() {
	if (timerState.mode !== 'pomodoro') return;
	clearInterval(_interval!);
	_interval = null;
	timerState.running = false;
	advancePomodoro();
	writeTimerToFirestore();
}

// ── Derived helpers ───────────────────────────────────────────────
export function currentSeconds(): number {
	const s = timerState;
	if (s.mode === 'countdown') return s.countdownTarget - s.elapsed;
	return pomodoroPhaseTarget() - s.pomodoroElapsed;
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
	};
	setDoc(doc(firestore, `users/${_syncUid}/meta/timer`), data).catch(() => {});
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

			const sinceSyncSecs = d.running ? Math.max(0, Math.floor((Date.now() - d.syncedAt) / 1000)) : 0;

			if (_interval) { clearInterval(_interval); _interval = null; }

			timerState.mode = d.mode;
			timerState.running = d.running;
			timerState.finished = d.finished;
			timerState.countdownTarget = d.countdownTarget;
			timerState.elapsed = d.elapsed + (d.mode === 'countdown' ? sinceSyncSecs : 0);
			timerState.pomodoroSession = d.pomodoroSession;
			timerState.pomodoroPhase = d.pomodoroPhase as PomodoroPhase;
			timerState.pomodoroElapsed = d.pomodoroElapsed + (d.mode === 'pomodoro' ? sinceSyncSecs : 0);
			timerState.waitingForNext = d.waitingForNext;
			timerState.startedAt = d.startedAt;
			timerState.accMs = d.accMs;
			timerState.lapStartTotalMs = d.lapStartTotalMs;
			timerState.laps = d.laps ?? [];

			if (d.running && d.mode !== 'stopwatch') {
				_interval = setInterval(tick, 1000);
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
