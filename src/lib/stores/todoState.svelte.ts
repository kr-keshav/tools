import { browser } from '$app/environment';
import { firestore } from '$lib/firebase';
import {
	collection, doc, setDoc, updateDoc, deleteDoc, getDocs,
	onSnapshot, query, orderBy, writeBatch, deleteField,
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
	touchDropTarget: { id: string; position: 'before' | 'after' } | null;
	activeTabId:    string;
	undoItem:       { type: 'complete' | 'delete'; task: Task } | null;
}>({
	filterText:     '',
	activeTags:     [],
	focusedTaskId:  null,
	expandedTaskId: null,
	draggedTaskId:  null,
	touchDropTarget: null,
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

// Synchronous so the caller can start renaming without waiting on the network.
export function addTab(): Tab {
	const maxOrder = tabs.length > 0 ? Math.max(...tabs.map(t => t.order)) : -1;
	const tab: Tab = { id: crypto.randomUUID(), name: 'New tab', order: maxOrder + 1 };
	tabs.push(tab);
	todoUI.activeTabId = tab.id;
	if (_userId) void setDoc(tabDoc(_userId, tab.id), tab);
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

export async function addTask(
	title: string,
	dueDate?: string,
	tags: string[] = [],
	priority: 0 | 1 | 2 | 3 = 0,
): Promise<Task> {
	const tabTasks = tasks.filter(t => t.tabId === todoUI.activeTabId);
	const maxOrder = tabTasks.length > 0 ? Math.max(...tabTasks.map(t => t.order)) : -1;
	const task: Task = {
		id:        crypto.randomUUID(),
		title,
		notes:     '',
		completed: false,
		priority,
		dueDate,
		tags,
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
	if (_userId) await updateDoc(taskDoc(_userId, id), clearUndefined(updated));
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
	if (_userId) await updateDoc(taskDoc(_userId, id), clearUndefined({
		completed: task.completed, completedAt: task.completedAt, updatedAt: task.updatedAt,
	}));
}

export async function reorderTask(id: string, direction: 'up' | 'down') {
	const task = tasks.find(t => t.id === id);
	if (!task) return;
	// Swap within the visible section; neighbours in other sections are not "up" or "down".
	const groups = groupActiveTasks(tasks.filter(t => t.tabId === task.tabId));
	const active = Object.values(groups).find(g => g.some(t => t.id === id)) ?? [];
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
		changed.forEach(t => batch.update(taskDoc(_userId, t.id), clearUndefined({ order: t.order, dueDate: t.dueDate, updatedAt: t.updatedAt })));
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
	a.download = `${tabName}-${todayStr()}.json`;
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

/** For updates: a field set to undefined must be removed from the doc, or the snapshot restores it */
function clearUndefined<T extends object>(obj: T): Record<string, unknown> {
	return Object.fromEntries(
		Object.entries(obj).map(([k, v]) => [k, v === undefined ? deleteField() : v])
	);
}

// ── Date helpers ──────────────────────────────────────────────────────────

/**
 * Format a Date as YYYY-MM-DD in the *local* calendar.
 *
 * toISOString() converts to UTC first, so for anyone ahead of UTC it reports the previous
 * day for much of their morning — "tomorrow" would store today. Every date in this file
 * goes through here so the parser and the filters can never disagree about what day it is.
 */
export function toLocalISODate(d: Date): string {
	const y  = d.getFullYear();
	const m  = String(d.getMonth() + 1).padStart(2, '0');
	const dd = String(d.getDate()).padStart(2, '0');
	return `${y}-${m}-${dd}`;
}

// Read by todayStr and formatDueDate so sections and date pills recompute when the day changes.
let _currentDay = $state(toLocalISODate(new Date()));

/** Keeps the date-based views right across midnight. Returns a stop function. */
export function watchDayChange(): () => void {
	const id = setInterval(() => { _currentDay = toLocalISODate(new Date()); }, 30_000);
	return () => clearInterval(id);
}

export function todayStr(): string {
	void _currentDay;
	return toLocalISODate(new Date());
}

export function parseNaturalDate(input: string): string | undefined {
	const s     = input.toLowerCase().trim();
	const today = new Date();
	today.setHours(0, 0, 0, 0);

	const shift = (days: number) => {
		const d = new Date(today);
		d.setDate(d.getDate() + days);
		return toLocalISODate(d);
	};

	if (s === 'today')      return toLocalISODate(today);
	if (s === 'tomorrow')   return shift(1);
	if (s === 'tmrw')       return shift(1);
	if (s === 'yesterday')  return shift(-1);
	if (s === 'next week')  return shift(7);
	if (s === 'next month') {
		// Clamp, so 31 Jan gives the end of February rather than overflowing into March.
		const lastDay = new Date(today.getFullYear(), today.getMonth() + 2, 0).getDate();
		return toLocalISODate(new Date(today.getFullYear(), today.getMonth() + 1, Math.min(today.getDate(), lastDay)));
	}

	// "in 3 days" / "in 2 weeks"
	const rel = s.match(/^in (\d{1,3}) (day|days|week|weeks)$/);
	if (rel) return shift(parseInt(rel[1]) * (rel[2].startsWith('week') ? 7 : 1));

	const days = ['sunday','monday','tuesday','wednesday','thursday','friday','saturday'];
	const bare = s.replace(/^(next|this)\s+/, '');
	const dayIdx = days.indexOf(bare);
	if (dayIdx !== -1) {
		const diff = (dayIdx - today.getDay() + 7) % 7 || 7;
		return shift(s.startsWith('next ') && diff < 7 ? diff + 7 : diff);
	}
	return undefined;
}

// Longest phrases first so "next week" wins over "week" and "next monday" over "monday".
const WEEKDAY = 'sunday|monday|tuesday|wednesday|thursday|friday|saturday';
const DATE_WORDS = `next month|next week|in \\d{1,3} (?:days?|weeks?)|(?:next|this) (?:${WEEKDAY})|today|tomorrow|tmrw|yesterday|${WEEKDAY}`;
// "by"/"due" lead any date; "on" only a weekday, so "Turn on today" keeps its "on".
const DATE_LEAD = `(?:by\\s+|due\\s+|on\\s+(?=(?:(?:next|this)\\s+)?(?:${WEEKDAY})\\b))`;
// A date word only counts where it reads as a date: at the end, after by/due/on, or an
// unambiguous lead-in. "Buy sunday paper" and "Review yesterday's notes" stay as typed.
const DATE_PATTERNS = [
	new RegExp(`(?:^|\\s)${DATE_LEAD}?(${DATE_WORDS})\\s*$`, 'i'),
	new RegExp(`(?:^|\\s)${DATE_LEAD}(${DATE_WORDS})(?=\\s|$)`, 'i'),
	new RegExp(`^(today|tomorrow|tmrw|next month|next week|in \\d{1,3} (?:days?|weeks?)|(?:next|this) (?:${WEEKDAY}))(?=\\s)`, 'i'),
];

/**
 * Pull a due date, #tags and a p:priority out of what the user typed, wherever they appear.
 * Previously only the final word or two was scanned, so "Ship the report tomorrow #docs"
 * kept the whole string as its title. The tag and priority syntax matches the filter
 * syntax the shortcuts panel already documents.
 */
export function extractDueDate(raw: string): {
	title: string; dueDate?: string; tags: string[]; priority: 0 | 1 | 2 | 3;
} {
	let text = raw.trim();
	let dueDate: string | undefined;
	const tags: string[] = [];
	let priority: 0 | 1 | 2 | 3 = 0;

	// Tags and priority come out first: "Report #today" is a tag, and a date followed only
	// by metadata ("Ship tomorrow #docs") is still at the end of the text.
	text = text.replace(/(^|\s)#([\p{L}\p{N}\p{M}\p{Extended_Pictographic}‍_-]+)/gu, (_m, _s, tag) => {
		const t = tag.toLowerCase();
		if (!tags.includes(t)) tags.push(t);
		return ' ';
	});

	const prio = text.match(/(^|\s)(?:p:(low|med|medium|high)|!p([1-3]))(?=\s|$)/i);
	if (prio) {
		const named = prio[2]?.toLowerCase();
		priority = named
			? (named === 'high' ? 3 : named === 'low' ? 1 : 2)
			: (4 - parseInt(prio[3])) as 1 | 2 | 3;
		text = text.replace(prio[0], ' ');
	}

	text = text.replace(/\s{2,}/g, ' ').trim();
	for (const pattern of DATE_PATTERNS) {
		const m = text.match(pattern);
		const parsed = m ? parseNaturalDate(m[1].replace(/\s+/g, ' ')) : undefined;
		if (m && parsed) {
			dueDate = parsed;
			text = `${text.slice(0, m.index)} ${text.slice(m.index! + m[0].length)}`;
			break;
		}
	}

	const title = text.replace(/\s{2,}/g, ' ').trim();
	// Never hand back an empty title — if the input was only metadata, keep the raw text.
	return { title: title || raw.trim(), dueDate, tags, priority };
}

export function formatDueDate(dueDate: string): { label: string; status: 'overdue' | 'today' | 'soon' | 'future' } {
	void _currentDay;
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
