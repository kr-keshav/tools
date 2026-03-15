import { browser } from '$app/environment';
import { firestore } from '$lib/firebase';
import {
	collection, doc, setDoc, updateDoc, deleteDoc, getDocs,
	onSnapshot, query, orderBy, writeBatch,
	type Unsubscribe,
} from 'firebase/firestore';
import type { Task, Subtask, Tab } from '$lib/db/todo.db';

export type { Task, Subtask, Tab };
export type SectionKey = 'overdue' | 'today' | 'upcoming' | 'noDate';

// ── State ──────────────────────────────────────────────────────────────────

export let tasks = $state<Task[]>([]);
export let tabs  = $state<Tab[]>([]);

export let todoUI = $state<{
	filterText:     string;
	activeTags:     string[];
	focusedTaskId:  string | null;
	expandedTaskId: string | null;
	draggedTaskId:  string | null;
	activeTabId:    string;
	undoItem:       { type: 'complete' | 'delete'; task: Task } | null;
}>({
	filterText:     '',
	activeTags:     [],
	focusedTaskId:  null,
	expandedTaskId: null,
	draggedTaskId:  null,
	activeTabId:    'default',
	undoItem:       null,
});

let _userId  = '';
let _unsubTasks: Unsubscribe | null = null;
let _unsubTabs:  Unsubscribe | null = null;
let _undoTimer: ReturnType<typeof setTimeout> | null = null;

// ── Firestore helpers ──────────────────────────────────────────────────────

const tasksCol  = (uid: string) => collection(firestore, 'users', uid, 'tasks');
const tabsCol   = (uid: string) => collection(firestore, 'users', uid, 'tabs');
const taskDoc   = (uid: string, id: string) => doc(firestore, 'users', uid, 'tasks', id);
const tabDoc    = (uid: string, id: string) => doc(firestore, 'users', uid, 'tabs',  id);

function toTask(id: string, d: Record<string, unknown>): Task {
	return {
		id,
		title:       (d.title       as string)    ?? '',
		notes:       (d.notes       as string)    ?? '',
		completed:   (d.completed   as boolean)   ?? false,
		completedAt: (d.completedAt as number)    ?? undefined,
		priority:    (d.priority    as 0|1|2|3)   ?? 0,
		dueDate:     (d.dueDate     as string)    ?? undefined,
		tags:        (d.tags        as string[])  ?? [],
		subtasks:    (d.subtasks    as Subtask[]) ?? [],
		createdAt:   (d.createdAt   as number)    ?? Date.now(),
		updatedAt:   (d.updatedAt   as number)    ?? Date.now(),
		order:       (d.order       as number)    ?? 0,
		tabId:       (d.tabId       as string)    ?? 'default',
	};
}

function toTab(id: string, d: Record<string, unknown>): Tab {
	return {
		id,
		name:  (d.name  as string) ?? 'Tasks',
		order: (d.order as number) ?? 0,
	};
}

// ── Load / Unload ──────────────────────────────────────────────────────────

export async function loadTasks(userId: string) {
	if (!browser || _userId === userId) return;
	_userId = userId;

	_unsubTabs?.();
	_unsubTasks?.();

	// Tabs listener
	_unsubTabs = onSnapshot(query(tabsCol(userId), orderBy('order')), async (snap) => {
		// If user has no tabs yet, seed the default one
		if (snap.empty) {
			const seed: Tab = { id: 'default', name: 'Tasks', order: 0 };
			await setDoc(tabDoc(userId, 'default'), seed);
			return;
		}
		tabs.splice(0, tabs.length, ...snap.docs.map(d => toTab(d.id, d.data())));
		if (!tabs.find(t => t.id === todoUI.activeTabId)) {
			todoUI.activeTabId = tabs[0]?.id ?? 'default';
		}
	});

	// Tasks listener
	_unsubTasks = onSnapshot(query(tasksCol(userId), orderBy('order')), (snap) => {
		for (const change of snap.docChanges()) {
			const task = toTask(change.doc.id, change.doc.data());
			const idx  = tasks.findIndex(t => t.id === task.id);
			if (change.type === 'removed') {
				if (idx !== -1) tasks.splice(idx, 1);
			} else if (idx !== -1) {
				if (task.updatedAt >= tasks[idx].updatedAt) Object.assign(tasks[idx], task);
			} else {
				tasks.push(task);
			}
		}
	});
}

export function unloadTasks() {
	_unsubTasks?.(); _unsubTasks = null;
	_unsubTabs?.();  _unsubTabs  = null;
	_userId = '';
	tasks.splice(0, tasks.length);
	tabs.splice(0, tabs.length);
	todoUI.activeTabId    = 'default';
	todoUI.expandedTaskId = null;
	todoUI.focusedTaskId  = null;
	todoUI.undoItem       = null;
}

// ── Tab CRUD ──────────────────────────────────────────────────────────────

export async function addTab(): Promise<Tab> {
	const maxOrder = tabs.length > 0 ? Math.max(...tabs.map(t => t.order)) : -1;
	const tab: Tab = { id: crypto.randomUUID(), name: 'New tab', order: maxOrder + 1 };
	tabs.push(tab);
	todoUI.activeTabId = tab.id;
	if (_userId) await setDoc(tabDoc(_userId, tab.id), tab);
	return tab;
}

export async function renameTab(id: string, name: string) {
	const tab = tabs.find(t => t.id === id);
	if (!tab) return;
	tab.name = name.trim() || tab.name;
	if (_userId) await updateDoc(tabDoc(_userId, id), { name: tab.name });
}

export async function deleteTab(id: string) {
	if (tabs.length <= 1) return;
	for (let i = tasks.length - 1; i >= 0; i--) {
		if (tasks[i].tabId === id) tasks.splice(i, 1);
	}
	if (todoUI.expandedTaskId && !tasks.find(t => t.id === todoUI.expandedTaskId)) {
		todoUI.expandedTaskId = null;
	}
	if (todoUI.activeTabId === id) {
		todoUI.activeTabId = tabs.find(t => t.id !== id)?.id ?? '';
	}
	const idx = tabs.findIndex(t => t.id === id);
	if (idx !== -1) tabs.splice(idx, 1);
	if (!_userId) return;
	const tabTaskSnap = await getDocs(tasksCol(_userId));
	const batch = writeBatch(firestore);
	tabTaskSnap.docs.filter(d => d.data().tabId === id).forEach(d => batch.delete(d.ref));
	batch.delete(tabDoc(_userId, id));
	await batch.commit();
}

// ── Task CRUD ─────────────────────────────────────────────────────────────

export async function addTask(title: string, dueDate?: string): Promise<Task> {
	const tabTasks = tasks.filter(t => t.tabId === todoUI.activeTabId);
	const maxOrder = tabTasks.length > 0 ? Math.max(...tabTasks.map(t => t.order)) : -1;
	const task: Task = {
		id:        crypto.randomUUID(),
		title,
		notes:     '',
		completed: false,
		priority:  0,
		dueDate,
		tags:      [],
		subtasks:  [],
		createdAt: Date.now(),
		updatedAt: Date.now(),
		order:     maxOrder + 1,
		tabId:     todoUI.activeTabId,
	};
	tasks.push(task);
	if (_userId) await setDoc(taskDoc(_userId, task.id), stripUndefined(task));
	return task;
}

export async function updateTask(id: string, patch: Partial<Omit<Task, 'id' | 'createdAt'>>) {
	const task = tasks.find(t => t.id === id);
	if (!task) return;
	const updated = { ...patch, updatedAt: Date.now() };
	Object.assign(task, updated);
	if (_userId) await updateDoc(taskDoc(_userId, id), stripUndefined(updated));
}

export async function deleteTask(id: string, addToUndo = true) {
	const idx = tasks.findIndex(t => t.id === id);
	if (idx === -1) return;
	const [removed] = tasks.splice(idx, 1);
	if (addToUndo) pushUndo({ type: 'delete', task: { ...removed } });
	if (todoUI.expandedTaskId === id) todoUI.expandedTaskId = null;
	if (todoUI.focusedTaskId  === id) todoUI.focusedTaskId  = null;
	if (_userId) await deleteDoc(taskDoc(_userId, id));
}

export async function toggleTask(id: string) {
	const task = tasks.find(t => t.id === id);
	if (!task) return;
	if (!task.completed) pushUndo({ type: 'complete', task: { ...task } });
	task.completed   = !task.completed;
	task.completedAt = task.completed ? Date.now() : undefined;
	task.updatedAt   = Date.now();
	if (task.completed && todoUI.expandedTaskId === id) todoUI.expandedTaskId = null;
	if (_userId) await updateDoc(taskDoc(_userId, id), stripUndefined({
		completed: task.completed, completedAt: task.completedAt, updatedAt: task.updatedAt,
	}));
}

export async function reorderTask(id: string, direction: 'up' | 'down') {
	const task = tasks.find(t => t.id === id);
	if (!task) return;
	const active = tasks.filter(t => !t.completed && t.tabId === task.tabId).sort((a, b) => a.order - b.order);
	const idx    = active.findIndex(t => t.id === id);
	const swap   = direction === 'up' ? idx - 1 : idx + 1;
	if (swap < 0 || swap >= active.length) return;
	const tmp = active[idx].order;
	active[idx].order  = active[swap].order;
	active[swap].order = tmp;
	if (_userId) {
		const batch = writeBatch(firestore);
		batch.update(taskDoc(_userId, active[idx].id),  { order: active[idx].order });
		batch.update(taskDoc(_userId, active[swap].id), { order: active[swap].order });
		await batch.commit();
	}
}

export async function moveTask(draggedId: string, targetId: string, position: 'before' | 'after') {
	if (draggedId === targetId) return;
	const dragged = tasks.find(t => t.id === draggedId);
	const target  = tasks.find(t => t.id === targetId);
	if (!dragged || !target) return;

	const active = tasks.filter(t => !t.completed && t.tabId === dragged.tabId).sort((a, b) => a.order - b.order);
	const dragIdx   = active.findIndex(t => t.id === draggedId);
	const targetIdx = active.findIndex(t => t.id === targetId);
	if (dragIdx === -1 || targetIdx === -1) return;

	const newDueDate      = target.dueDate;
	const dueDateChanged  = dragged.dueDate !== newDueDate;

	active.splice(dragIdx, 1);
	const newTargetIdx = active.findIndex(t => t.id === targetId);
	active.splice(position === 'before' ? newTargetIdx : newTargetIdx + 1, 0, dragged);

	const changed: Task[] = [];
	active.forEach((t, i) => {
		if (t.order !== i || (t.id === draggedId && dueDateChanged)) {
			t.order = i;
			if (t.id === draggedId && dueDateChanged) t.dueDate = newDueDate;
			t.updatedAt = Date.now();
			changed.push(t);
		}
	});

	if (_userId && changed.length > 0) {
		const batch = writeBatch(firestore);
		changed.forEach(t => batch.update(taskDoc(_userId, t.id), stripUndefined({ order: t.order, dueDate: t.dueDate, updatedAt: t.updatedAt })));
		await batch.commit();
	}
}

export async function addSubtask(taskId: string, title: string) {
	const task = tasks.find(t => t.id === taskId);
	if (!task) return;
	task.subtasks.push({ id: crypto.randomUUID(), title, completed: false });
	task.updatedAt = Date.now();
	if (_userId) await updateDoc(taskDoc(_userId, taskId), { subtasks: task.subtasks, updatedAt: task.updatedAt });
}

export async function toggleSubtask(taskId: string, subtaskId: string) {
	const task = tasks.find(t => t.id === taskId);
	const sub  = task?.subtasks.find(s => s.id === subtaskId);
	if (!task || !sub) return;
	sub.completed  = !sub.completed;
	task.updatedAt = Date.now();
	if (_userId) await updateDoc(taskDoc(_userId, taskId), { subtasks: task.subtasks, updatedAt: task.updatedAt });
}

export async function deleteSubtask(taskId: string, subtaskId: string) {
	const task = tasks.find(t => t.id === taskId);
	if (!task) return;
	task.subtasks  = task.subtasks.filter(s => s.id !== subtaskId);
	task.updatedAt = Date.now();
	if (_userId) await updateDoc(taskDoc(_userId, taskId), { subtasks: task.subtasks, updatedAt: task.updatedAt });
}

// ── Undo ──────────────────────────────────────────────────────────────────

function pushUndo(item: { type: 'complete' | 'delete'; task: Task }) {
	todoUI.undoItem = item;
	if (_undoTimer) clearTimeout(_undoTimer);
	_undoTimer = setTimeout(() => { todoUI.undoItem = null; _undoTimer = null; }, 5000);
}

export async function undo() {
	if (!todoUI.undoItem) return;
	const { type, task } = todoUI.undoItem;
	todoUI.undoItem = null;
	if (_undoTimer) { clearTimeout(_undoTimer); _undoTimer = null; }

	if (type === 'delete') {
		tasks.push(task);
		if (_userId) await setDoc(taskDoc(_userId, task.id), stripUndefined(task));
	} else {
		const t = tasks.find(t => t.id === task.id);
		if (t) {
			t.completed  = false;
			t.completedAt = undefined;
			t.updatedAt  = Date.now();
			if (_userId) await updateDoc(taskDoc(_userId, t.id), { completed: false, completedAt: null, updatedAt: t.updatedAt });
		}
	}
}

// ── Export ────────────────────────────────────────────────────────────────

export function exportTasks() {
	const tabTasks = tasks.filter(t => t.tabId === todoUI.activeTabId);
	const blob = new Blob([JSON.stringify(tabTasks, null, 2)], { type: 'application/json' });
	const url  = URL.createObjectURL(blob);
	const a    = document.createElement('a');
	a.href     = url;
	const tabName = tabs.find(t => t.id === todoUI.activeTabId)?.name ?? 'tasks';
	a.download = `${tabName}-${new Date().toISOString().slice(0, 10)}.json`;
	a.click();
	URL.revokeObjectURL(url);
}

// ── Helpers ───────────────────────────────────────────────────────────────

/** Remove undefined values — Firestore doesn't accept them */
function stripUndefined<T extends object>(obj: T): Partial<T> {
	return Object.fromEntries(
		Object.entries(obj).filter(([, v]) => v !== undefined)
	) as Partial<T>;
}

// ── Date helpers ──────────────────────────────────────────────────────────

export function todayStr(): string {
	return new Date().toISOString().slice(0, 10);
}

export function parseNaturalDate(input: string): string | undefined {
	const s     = input.toLowerCase().trim();
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	if (s === 'today')     return today.toISOString().slice(0, 10);
	if (s === 'tomorrow')  { const d = new Date(today); d.setDate(d.getDate() + 1); return d.toISOString().slice(0, 10); }
	if (s === 'yesterday') { const d = new Date(today); d.setDate(d.getDate() - 1); return d.toISOString().slice(0, 10); }
	if (s === 'next week') { const d = new Date(today); d.setDate(d.getDate() + 7); return d.toISOString().slice(0, 10); }

	const days  = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
	const dayIdx = days.indexOf(s);
	if (dayIdx !== -1) {
		const d    = new Date(today);
		const diff = (dayIdx - today.getDay() + 7) % 7 || 7;
		d.setDate(d.getDate() + diff);
		return d.toISOString().slice(0, 10);
	}
	return undefined;
}

export function extractDueDate(raw: string): { title: string; dueDate?: string } {
	const words = raw.trim().split(/\s+/);
	if (words.length < 2) return { title: raw };
	const parsed = parseNaturalDate(words[words.length - 1]);
	if (parsed) return { title: words.slice(0, -1).join(' '), dueDate: parsed };
	if (words.length >= 3) {
		const parsed2 = parseNaturalDate(words.slice(-2).join(' '));
		if (parsed2) return { title: words.slice(0, -2).join(' '), dueDate: parsed2 };
	}
	return { title: raw };
}

export function formatDueDate(dueDate: string): { label: string; status: 'overdue' | 'today' | 'soon' | 'future' } {
	const today = new Date(); today.setHours(0, 0, 0, 0);
	const due   = new Date(dueDate + 'T00:00:00');
	const diff  = Math.round((due.getTime() - today.getTime()) / 86400000);
	if (diff < 0)  return { label: diff === -1 ? 'Yesterday' : `${Math.abs(diff)}d ago`, status: 'overdue' };
	if (diff === 0) return { label: 'Today',    status: 'today' };
	if (diff === 1) return { label: 'Tomorrow', status: 'soon' };
	if (diff < 7) {
		const days = ['Sun','Mon','Tue','Wed','Thu','Fri','Sat'];
		return { label: days[due.getDay()], status: 'soon' };
	}
	const months = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];
	return { label: `${months[due.getMonth()]} ${due.getDate()}`, status: 'future' };
}

export function groupActiveTasks(taskList: Task[]): Record<SectionKey, Task[]> {
	const today  = todayStr();
	const groups: Record<SectionKey, Task[]> = { overdue: [], today: [], upcoming: [], noDate: [] };
	for (const task of taskList) {
		if (task.completed) continue;
		if (!task.dueDate)           groups.noDate.push(task);
		else if (task.dueDate < today) groups.overdue.push(task);
		else if (task.dueDate === today) groups.today.push(task);
		else                           groups.upcoming.push(task);
	}
	for (const key of Object.keys(groups) as SectionKey[]) {
		groups[key].sort((a, b) => a.order - b.order);
	}
	return groups;
}
