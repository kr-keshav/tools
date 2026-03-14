export type PomodoroTask = {
	id: number;
	text: string;
	estimated: number; // pomodoros planned
	completed: number; // pomodoros done
	done: boolean;
};

export let pomoTasks = $state<PomodoroTask[]>([]);
export let pomoMeta  = $state<{ activeTaskId: number | null }>({ activeTaskId: null });

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
	if (task) task.done = !task.done;
}

export function setActive(id: number) {
	pomoMeta.activeTaskId = pomoMeta.activeTaskId === id ? null : id;
}

export function incrementCompleted(id: number) {
	const task = pomoTasks.find((t) => t.id === id);
	if (task) task.completed += 1;
}

export function setEstimated(id: number, val: number) {
	const task = pomoTasks.find((t) => t.id === id);
	if (task) task.estimated = Math.max(1, val);
}
