import { browser } from '$app/environment';
import { db } from '$lib/db/todo.db';
export type { Task, Subtask, Tab } from '$lib/db/todo.db';
import type { Task, Subtask, Tab } from '$lib/db/todo.db';

export type SectionKey = 'overdue' | 'today' | 'upcoming' | 'noDate';

// ── State ─────────────────────────────────────────────────────────
export let tasks = $state<Task[]>([]);
export let tabs = $state<Tab[]>([]);

export let todoUI = $state<{
	filterText: string;
	activeTags: string[];
	focusedTaskId: string | null;
	expandedTaskId: string | null;
	draggedTaskId: string | null;
	activeTabId: string;
	undoItem: { type: 'complete' | 'delete'; task: Task } | null;
}>({
	filterText: '',
	activeTags: [],
	focusedTaskId: null,
	expandedTaskId: null,
	draggedTaskId: null,
	activeTabId: 'default',
	undoItem: null,
});

let _undoTimer: ReturnType<typeof setTimeout> | null = null;

// ── Load ─────────────────────────────────────────────────────────
export async function loadTasks() {
	if (!browser || !db) return;

	// Load or seed tabs
	let allTabs = await db.tabs.orderBy('order').toArray();
	if (allTabs.length === 0) {
		const seed: Tab = { id: 'default', name: 'Tasks', order: 0 };
		await db.tabs.add(seed);
		allTabs = [seed];
	}
	tabs.splice(0, tabs.length, ...allTabs);
	todoUI.activeTabId = allTabs[0].id;

	// Load tasks
	const all = await db.tasks.orderBy('order').toArray();
	tasks.splice(0, tasks.length, ...all);
}

// ── Tab CRUD ─────────────────────────────────────────────────────
export async function addTab(): Promise<Tab> {
	const maxOrder = tabs.length > 0 ? Math.max(...tabs.map((t) => t.order)) : -1;
	const tab: Tab = { id: crypto.randomUUID(), name: 'New tab', order: maxOrder + 1 };
	tabs.push(tab);
	todoUI.activeTabId = tab.id;
	if (browser && db) await db.tabs.add(tab);
	return tab;
}

export async function renameTab(id: string, name: string) {
	const tab = tabs.find((t) => t.id === id);
	if (!tab) return;
	tab.name = name.trim() || tab.name;
	if (browser && db) await db.tabs.update(id, { name: tab.name });
}

export async function deleteTab(id: string) {
	if (tabs.length <= 1) return;

	// Remove all tasks in this tab
	for (let i = tasks.length - 1; i >= 0; i--) {
		if (tasks[i].tabId === id) tasks.splice(i, 1);
	}
	if (todoUI.expandedTaskId) {
		const stillExists = tasks.find((t) => t.id === todoUI.expandedTaskId);
		if (!stillExists) todoUI.expandedTaskId = null;
	}

	// Switch active tab before removing
	if (todoUI.activeTabId === id) {
		const remaining = tabs.filter((t) => t.id !== id);
		todoUI.activeTabId = remaining[0]?.id ?? '';
	}

	const idx = tabs.findIndex((t) => t.id === id);
	if (idx !== -1) tabs.splice(idx, 1);

	if (browser && db) {
		await db.tasks.where('tabId').equals(id).delete();
		await db.tabs.delete(id);
	}
}

// ── Task CRUD ─────────────────────────────────────────────────────
export async function addTask(title: string, dueDate?: string): Promise<Task> {
	const tabTasks = tasks.filter((t) => t.tabId === todoUI.activeTabId);
	const maxOrder = tabTasks.length > 0 ? Math.max(...tabTasks.map((t) => t.order)) : -1;
	const task: Task = {
		id: crypto.randomUUID(),
		title,
		notes: '',
		completed: false,
		priority: 0,
		dueDate,
		tags: [],
		subtasks: [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		order: maxOrder + 1,
		tabId: todoUI.activeTabId,
	};
	tasks.push(task);
	if (browser && db) await db.tasks.add(task);
	return task;
}

export async function updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>) {
	const task = tasks.find((t) => t.id === id);
	if (!task) return;
	const updated = { ...patch, updatedAt: Date.now() };
	Object.assign(task, updated);
	if (browser && db) await db.tasks.update(id, updated);
}

export async function deleteTask(id: string, addToUndo = true) {
	const idx = tasks.findIndex((t) => t.id === id);
	if (idx === -1) return;
	const [removed] = tasks.splice(idx, 1);
	if (addToUndo) pushUndo({ type: 'delete', task: { ...removed } });
	if (todoUI.expandedTaskId === id) todoUI.expandedTaskId = null;
	if (todoUI.focusedTaskId === id) todoUI.focusedTaskId = null;
	if (browser && db) await db.tasks.delete(id);
}

export async function toggleTask(id: string) {
	const task = tasks.find((t) => t.id === id);
	if (!task) return;
	if (!task.completed) pushUndo({ type: 'complete', task: { ...task } });
	task.completed = !task.completed;
	task.completedAt = task.completed ? Date.now() : undefined;
	task.updatedAt = Date.now();
	if (task.completed && todoUI.expandedTaskId === id) todoUI.expandedTaskId = null;
	if (browser && db) {
		await db.tasks.update(id, {
			completed: task.completed,
			completedAt: task.completedAt,
			updatedAt: task.updatedAt,
		});
	}
}

export async function reorderTask(id: string, direction: 'up' | 'down') {
	const task = tasks.find((t) => t.id === id);
	if (!task) return;
	const tabActive = tasks
		.filter((t) => !t.completed && t.tabId === task.tabId)
		.sort((a, b) => a.order - b.order);
	const idx = tabActive.findIndex((t) => t.id === id);
	if (idx === -1) return;
	const swapIdx = direction === 'up' ? idx - 1 : idx + 1;
	if (swapIdx < 0 || swapIdx >= tabActive.length) return;
	const a = tabActive[idx];
	const b = tabActive[swapIdx];
	const tmp = a.order;
	a.order = b.order;
	b.order = tmp;
	if (browser && db) await db.tasks.bulkPut([a, b]);
}

export async function moveTask(draggedId: string, targetId: string, position: 'before' | 'after') {
	if (draggedId === targetId) return;
	const dragged = tasks.find((t) => t.id === draggedId);
	const target = tasks.find((t) => t.id === targetId);
	if (!dragged || !target) return;

	// Only reorder within the same tab
	const active = tasks
		.filter((t) => !t.completed && t.tabId === dragged.tabId)
		.sort((a, b) => a.order - b.order);

	const draggedIdx = active.findIndex((t) => t.id === draggedId);
	const targetIdx = active.findIndex((t) => t.id === targetId);
	if (draggedIdx === -1 || targetIdx === -1) return;

	// Inherit dueDate from target when crossing sections
	const newDueDate = target.dueDate;
	const dueDateChanged = dragged.dueDate !== newDueDate;

	active.splice(draggedIdx, 1);
	const newTargetIdx = active.findIndex((t) => t.id === targetId);
	const insertAt = position === 'before' ? newTargetIdx : newTargetIdx + 1;
	active.splice(insertAt, 0, dragged);

	const changed: Task[] = [];
	active.forEach((t, i) => {
		if (t.order !== i || (t.id === draggedId && dueDateChanged)) {
			t.order = i;
			if (t.id === draggedId && dueDateChanged) t.dueDate = newDueDate;
			t.updatedAt = Date.now();
			changed.push(t);
		}
	});

	if (browser && db && changed.length > 0) await db.tasks.bulkPut(changed);
}

export async function addSubtask(taskId: string, title: string) {
	const task = tasks.find((t) => t.id === taskId);
	if (!task) return;
	const sub: Subtask = { id: crypto.randomUUID(), title, completed: false };
	task.subtasks.push(sub);
	task.updatedAt = Date.now();
	if (browser && db) await db.tasks.update(taskId, { subtasks: task.subtasks, updatedAt: task.updatedAt });
}

export async function toggleSubtask(taskId: string, subtaskId: string) {
	const task = tasks.find((t) => t.id === taskId);
	if (!task) return;
	const sub = task.subtasks.find((s) => s.id === subtaskId);
	if (!sub) return;
	sub.completed = !sub.completed;
	task.updatedAt = Date.now();
	if (browser && db) await db.tasks.update(taskId, { subtasks: task.subtasks, updatedAt: task.updatedAt });
}

export async function deleteSubtask(taskId: string, subtaskId: string) {
	const task = tasks.find((t) => t.id === taskId);
	if (!task) return;
	task.subtasks = task.subtasks.filter((s) => s.id !== subtaskId);
	task.updatedAt = Date.now();
	if (browser && db) await db.tasks.update(taskId, { subtasks: task.subtasks, updatedAt: task.updatedAt });
}

// ── Undo ─────────────────────────────────────────────────────────
function pushUndo(item: { type: 'complete' | 'delete'; task: Task }) {
	todoUI.undoItem = item;
	if (_undoTimer) clearTimeout(_undoTimer);
	_undoTimer = setTimeout(() => {
		todoUI.undoItem = null;
		_undoTimer = null;
	}, 5000);
}

export async function undo() {
	if (!todoUI.undoItem) return;
	const { type, task } = todoUI.undoItem;
	todoUI.undoItem = null;
	if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }

	if (type === 'delete') {
		tasks.push(task);
		if (browser && db) await db.tasks.add(task);
	} else if (type === 'complete') {
		const t = tasks.find((t) => t.id === task.id);
		if (t) {
			t.completed = false;
			t.completedAt = undefined;
			t.updatedAt = Date.now();
			if (browser && db) await db.tasks.update(t.id, { completed: false, completedAt: undefined, updatedAt: t.updatedAt });
		}
	}
}

// ── Export ───────────────────────────────────────────────────────
export function exportTasks() {
	const tabTasks = tasks.filter((t) => t.tabId === todoUI.activeTabId);
	const json = JSON.stringify(tabTasks, null, 2);
	const blob = new Blob([json], { type: 'application/json' });
	const url = URL.createObjectURL(blob);
	const a = document.createElement('a');
	a.href = url;
	const tabName = tabs.find((t) => t.id === todoUI.activeTabId)?.name ?? 'tasks';
	a.download = `${tabName}-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

// ── Date helpers ─────────────────────────────────────────────────
export function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

export function parseNaturalDate(input: string): string | undefined {
	const s = input.toLowerCase().trim();
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	if (s === 'today') return today.toISOString().slice(0, 10);
	if (s === 'tomorrow') {
		const d = new Date(today);
		d.setDate(d.getDate() + 1);
		return d.toISOString().slice(0, 10);
	}
	if (s === 'yesterday') {
		const d = new Date(today);
		d.setDate(d.getDate() - 1);
		return d.toISOString().slice(0, 10);
	}
	if (s === 'next week') {
		const d = new Date(today);
		d.setDate(d.getDate() + 7);
		return d.toISOString().slice(0, 10);
	}

	const days = ['sunday', 'monday', 'tuesday', 'wednesday', 'thursday', 'friday', 'saturday'];
	const dayIdx = days.indexOf(s);
	if (dayIdx !== -1) {
		const d = new Date(today);
		const diff = (dayIdx - today.getDay() + 7) % 7 || 7;
		d.setDate(d.getDate() + diff);
		return d.toISOString().slice(0, 10);
	}

	return undefined;
}

export function extractDueDate(raw: string): { title: string; dueDate?: string } {
	const words = raw.trim().split(/\s+/);
	if (words.length < 2) return { title: raw };

	const last = words[words.length - 1];
	const parsed = parseNaturalDate(last);
	if (parsed) return { title: words.slice(0, -1).join(' '), dueDate: parsed };

	if (words.length >= 3) {
		const lastTwo = words.slice(-2).join(' ');
		const parsed2 = parseNaturalDate(lastTwo);
		if (parsed2) return { title: words.slice(0, -2).join(' '), dueDate: parsed2 };
	}

	return { title: raw };
}

export function formatDueDate(dueDate: string): { label: string; status: 'overdue' | 'today' | 'soon' | 'future' } {
	const today = new Date();
	today.setHours(0, 0, 0, 0);
	const due = new Date(dueDate + 'T00:00:00');
	const diff = Math.round((due.getTime() - today.getTime()) / 86400000);

	if (diff < 0) return { label: diff === -1 ? 'Yesterday' : `${Math.abs(diff)}d ago`, status: 'overdue' };
	if (diff === 0) return { label: 'Today', status: 'today' };
	if (diff === 1) return { label: 'Tomorrow', status: 'soon' };
	if (diff < 7) {
		const days = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
		return { label: days[due.getDay()], status: 'soon' };
	}
	const months = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
	return { label: `${months[due.getMonth()]} ${due.getDate()}`, status: 'future' };
}

// ── Section grouping ─────────────────────────────────────────────
export function groupActiveTasks(taskList: Task[]): Record<SectionKey, Task[]> {
	const today = todayStr();
	const groups: Record<SectionKey, Task[]> = { overdue: [], today: [], upcoming: [], noDate: [] };

	for (const task of taskList) {
		if (task.completed) continue;
		if (!task.dueDate) groups.noDate.push(task);
		else if (task.dueDate < today) groups.overdue.push(task);
		else if (task.dueDate === today) groups.today.push(task);
		else groups.upcoming.push(task);
	}

	for (const key of Object.keys(groups) as SectionKey[]) {
		groups[key].sort((a, b) => a.order - b.order);
	}

	return groups;
}
