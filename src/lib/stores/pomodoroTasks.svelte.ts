import { browser } from '$app/environment';

export type PomodoroTask = {
	id: number;
	text: string;
	estimated: number; // pomodoros planned
	completed: number; // pomodoros done
	done: boolean;
};

export let pomoTasks = $state<PomodoroTask[]>([]);
export let pomoMeta  = $state<{ activeTaskId: number | null }>({ activeTaskId: null });

// ── Local persistence ────────────────────────────────────────────
// Per-device only: none of this is part of the synced timer document. Nothing here runs
// until restoreLocal() is called after hydration, so the server never reads or saves, and
// the first client render matches the server's HTML.

/** Loads `key` into state now, then saves state to it on change. Survives bad data and blocked storage. */
export function persistLocal(key: string, read: () => unknown, apply: (raw: unknown) => void) {
	const load = (json: string | null) => {
		if (json === null) return;
		try { apply(JSON.parse(json)); } catch { /* corrupt: keep what we have */ }
	};
	try { load(localStorage.getItem(key)); } catch { /* storage blocked */ }

	let saved = JSON.stringify(read());
	window.addEventListener('storage', (e) => {
		if (e.key !== key || e.newValue === null) return;
		load(e.newValue);
		saved = JSON.stringify(read());
	});
	$effect.root(() => {
		$effect(() => {
			const json = JSON.stringify(read());
			if (json === saved) return;
			saved = json;
			try { localStorage.setItem(key, json); } catch { /* storage blocked or full */ }
		});
	});
}

function asTasks(raw: unknown): PomodoroTask[] {
	if (!Array.isArray(raw)) return [];
	const seen = new Set<number>();
	const out: PomodoroTask[] = [];
	for (const t of raw) {
		if (!t || typeof t.id !== 'number' || !Number.isFinite(t.id) || seen.has(t.id)) continue;
		if (typeof t.text !== 'string' || !t.text.trim()) continue;
		seen.add(t.id);
		out.push({
			id: t.id,
			text: t.text,
			estimated: Math.min(20, Math.max(1, Math.floor(Number(t.estimated)) || 1)),
			completed: Math.max(0, Math.floor(Number(t.completed)) || 0),
			done: t.done === true,
		});
	}
	return out;
}

let _restored = false;

/** Idempotent. Call after hydration, and before anything that changes the tasks. */
export function restorePomoTasks() {
	if (!browser || _restored) return;
	_restored = true;
	persistLocal(
		'workkit-pomo-tasks',
		() => ({ tasks: pomoTasks, activeTaskId: pomoMeta.activeTaskId }),
		(raw) => {
			const data = raw as { tasks?: unknown; activeTaskId?: unknown };
			const tasks = asTasks(data?.tasks);
			pomoTasks.splice(0, pomoTasks.length, ...tasks);
			pomoMeta.activeTaskId = tasks.some((t) => t.id === data?.activeTaskId) ? (data.activeTaskId as number) : null;
		},
	);
}

export function addTask(text: string, estimated = 1) {
	const trimmed = text.trim();
	if (!trimmed) return;
	pomoTasks.push({ id: Date.now(), text: trimmed, estimated, completed: 0, done: false });
}

export function removeTask(id: number) {
	const idx = pomoTasks.findIndex((t) => t.id === id);
	if (idx >= 0) pomoTasks.splice(idx, 1);
	if (pomoMeta.activeTaskId === id) pomoMeta.activeTaskId = null;
}

export function toggleDone(id: number) {
	const task = pomoTasks.find((t) => t.id === id);
	if (!task) return;
	task.done = !task.done;
	if (task.done && pomoMeta.activeTaskId === id) pomoMeta.activeTaskId = null;
}

export function setActive(id: number) {
	pomoMeta.activeTaskId = pomoMeta.activeTaskId === id ? null : id;
}

export function incrementCompleted(id: number) {
	restorePomoTasks();
	const task = pomoTasks.find((t) => t.id === id);
	if (task) task.completed += 1;
}

export function setEstimated(id: number, val: number) {
	const task = pomoTasks.find((t) => t.id === id);
	if (task) task.estimated = Math.min(20, Math.max(1, val));
}
