import { browser } from '$app/environment';
import { firestore } from '$lib/firebase';
import {
	collection, doc, setDoc, updateDoc,
	onSnapshot, query, orderBy, writeBatch,
	type Unsubscribe,
} from 'firebase/firestore';
import type { CalcLine, CalcSheet } from '$lib/db/calc.db';
import type { AngleMode } from '$lib/calc/engine';
import { isSelfContained, splitLine, usesSub } from '$lib/calc/tape';

export type { CalcLine, CalcSheet };

/** Sub-calculations nest this many levels below a top-level sheet. */
export const MAX_SUB_DEPTH = 2;

// ── State ──────────────────────────────────────────────────────────────────

export let calcSheets = $state<CalcSheet[]>([]);
export let calcLines  = $state<CalcLine[]>([]);

const PREFS_KEY = 'workkit-calc-prefs';

type CalcPrefs = { mode: 'basic' | 'sci'; angle: AngleMode; keypadOpen: boolean; activeSheetId: string };

function readPrefs(): CalcPrefs {
	const fallback: CalcPrefs = { mode: 'basic', angle: 'deg', keypadOpen: true, activeSheetId: 'default' };
	if (!browser) return fallback;
	try {
		return { ...fallback, ...JSON.parse(localStorage.getItem(PREFS_KEY) ?? '{}') };
	} catch {
		return fallback;
	}
}

type UndoItem = { message: string; lines: CalcLine[]; sheets: CalcSheet[] };

// Keypad layout, angle unit and the open sheet are per-device choices, so they stay
// out of Firestore.
export let calcUI = $state<CalcPrefs & {
	undoItem:  UndoItem | null;
	/** Tape filter — only lines carrying this label tag are shown. */
	activeTag: string | null;
	/** Sub-calculations currently shown open, by parent line id. */
	expanded:  Record<string, boolean>;
}>({
	...readPrefs(),
	undoItem:  null,
	activeTag: null,
	expanded:  {},
});

export function saveCalcPrefs() {
	if (!browser) return;
	const { mode, angle, keypadOpen, activeSheetId } = calcUI;
	try { localStorage.setItem(PREFS_KEY, JSON.stringify({ mode, angle, keypadOpen, activeSheetId })); } catch { /* ignore */ }
}

let _userId = '';
let _unsubLines:  Unsubscribe | null = null;
let _unsubSheets: Unsubscribe | null = null;
let _undoTimer: ReturnType<typeof setTimeout> | null = null;

// ── Firestore helpers ──────────────────────────────────────────────────────

const linesCol  = (uid: string) => collection(firestore, 'users', uid, 'calcLines');
const lineDoc   = (uid: string, id: string) => doc(firestore, 'users', uid, 'calcLines', id);
const sheetsCol = (uid: string) => collection(firestore, 'users', uid, 'calcSheets');
const sheetDoc  = (uid: string, id: string) => doc(firestore, 'users', uid, 'calcSheets', id);

function toLine(id: string, d: Record<string, unknown>): CalcLine {
	return {
		id,
		sheetId:   (d.sheetId   as string)  ?? 'default',
		input:     (d.input     as string)  ?? '',
		order:     (d.order     as number)  ?? 0,
		pinned:    (d.pinned    as boolean) ?? undefined,
		note:      (d.note      as string)  ?? undefined,
		createdAt: (d.createdAt as number)  ?? Date.now(),
		updatedAt: (d.updatedAt as number)  ?? Date.now(),
	};
}

function toSheet(id: string, d: Record<string, unknown>): CalcSheet {
	return {
		id,
		name:         (d.name         as string) ?? 'Tape',
		order:        (d.order        as number) ?? 0,
		parentLineId: (d.parentLineId as string) ?? undefined,
		createdAt:    (d.createdAt    as number) ?? Date.now(),
	};
}

function stripUndefined<T extends object>(obj: T): Partial<T> {
	return Object.fromEntries(Object.entries(obj).filter(([, v]) => v !== undefined)) as Partial<T>;
}

// ── Load / Unload ──────────────────────────────────────────────────────────

export function loadCalc(userId: string) {
	if (!browser || _userId === userId) return;
	_userId = userId;

	_unsubSheets?.();
	_unsubLines?.();

	_unsubSheets = onSnapshot(query(sheetsCol(userId), orderBy('order')), async (snap) => {
		// Phase 1 lines were all written to sheet 'default' — seed it so they have a home
		if (snap.empty) {
			const seed: CalcSheet = { id: 'default', name: 'Tape', order: 0, createdAt: Date.now() };
			await setDoc(sheetDoc(userId, 'default'), seed);
			return;
		}
		calcSheets.splice(0, calcSheets.length, ...snap.docs.map(d => toSheet(d.id, d.data())));
		if (!topSheets().some(s => s.id === calcUI.activeSheetId)) {
			calcUI.activeSheetId = topSheets()[0]?.id ?? 'default';
		}
	});

	_unsubLines = onSnapshot(query(linesCol(userId), orderBy('order')), (snap) => {
		for (const change of snap.docChanges()) {
			const line = toLine(change.doc.id, change.doc.data());
			const idx  = calcLines.findIndex(l => l.id === line.id);
			if (change.type === 'removed') {
				if (idx !== -1) calcLines.splice(idx, 1);
			} else if (idx !== -1) {
				if (line.updatedAt >= calcLines[idx].updatedAt) Object.assign(calcLines[idx], line);
			} else {
				calcLines.push(line);
			}
		}
		// Lines from another device can arrive out of order relative to local ones
		calcLines.sort((a, b) => a.order - b.order);
	});
}

export function unloadCalc() {
	_unsubLines?.();  _unsubLines  = null;
	_unsubSheets?.(); _unsubSheets = null;
	_userId = '';
	calcLines.splice(0, calcLines.length);
	calcSheets.splice(0, calcSheets.length);
	calcUI.undoItem  = null;
	calcUI.activeTag = null;
	calcUI.expanded  = {};
}

// ── Queries ────────────────────────────────────────────────────────────────

/** Tabs: sheets that aren't somebody's sub-calculation. */
export function topSheets(): CalcSheet[] {
	return calcSheets.filter(s => !s.parentLineId);
}

export function linesOf(sheetId: string): CalcLine[] {
	return calcLines.filter(l => l.sheetId === sheetId);
}

export function subSheetOf(lineId: string): CalcSheet | undefined {
	return calcSheets.find(s => s.parentLineId === lineId);
}

/** 0 for a tab, 1 for a sub-calculation inside it, and so on. */
export function sheetDepth(sheetId: string): number {
	let depth = 0;
	let sheet = calcSheets.find(s => s.id === sheetId);
	while (sheet?.parentLineId && depth < 10) {
		const parent = calcLines.find(l => l.id === sheet!.parentLineId);
		sheet = parent && calcSheets.find(s => s.id === parent.sheetId);
		depth++;
	}
	return depth;
}

/** Every sheet nested under these lines, and every line in those sheets, all the way down. */
function descendants(lineIds: string[]): { lines: CalcLine[]; sheets: CalcSheet[] } {
	const lines: CalcLine[] = [];
	const sheets: CalcSheet[] = [];
	const queue = [...lineIds];
	while (queue.length) {
		const id = queue.shift()!;
		for (const sheet of calcSheets.filter(s => s.parentLineId === id)) {
			sheets.push(sheet);
			for (const line of linesOf(sheet.id)) {
				lines.push(line);
				queue.push(line.id);
			}
		}
	}
	return { lines, sheets };
}

// ── Removal with undo ──────────────────────────────────────────────────────

async function removeAll(message: string, lines: CalcLine[], sheets: CalcSheet[]) {
	if (lines.length === 0 && sheets.length === 0) return;
	const lineIds  = new Set(lines.map(l => l.id));
	const sheetIds = new Set(sheets.map(s => s.id));
	for (let i = calcLines.length - 1; i >= 0; i--) if (lineIds.has(calcLines[i].id)) calcLines.splice(i, 1);
	for (let i = calcSheets.length - 1; i >= 0; i--) if (sheetIds.has(calcSheets[i].id)) calcSheets.splice(i, 1);

	calcUI.undoItem = {
		message,
		lines:  lines.map(l => ({ ...l })),
		sheets: sheets.map(s => ({ ...s })),
	};
	if (_undoTimer) clearTimeout(_undoTimer);
	_undoTimer = setTimeout(() => { calcUI.undoItem = null; }, 5000);

	if (!_userId) return;
	const batch = writeBatch(firestore);
	lines.forEach(l => batch.delete(lineDoc(_userId, l.id)));
	sheets.forEach(s => batch.delete(sheetDoc(_userId, s.id)));
	await batch.commit();
}

export async function undoDelete() {
	const item = calcUI.undoItem;
	if (!item) return;
	calcUI.undoItem = null;
	if (_undoTimer) clearTimeout(_undoTimer);
	calcSheets.push(...item.sheets);
	calcSheets.sort((a, b) => a.order - b.order);
	calcLines.push(...item.lines);
	calcLines.sort((a, b) => a.order - b.order);
	if (item.sheets.some(s => !s.parentLineId)) calcUI.activeSheetId = item.sheets.find(s => !s.parentLineId)!.id;
	if (!_userId) return;
	const batch = writeBatch(firestore);
	item.sheets.forEach(s => batch.set(sheetDoc(_userId, s.id), stripUndefined(s)));
	item.lines.forEach(l => batch.set(lineDoc(_userId, l.id), stripUndefined(l)));
	await batch.commit();
}

// ── Sheet CRUD ─────────────────────────────────────────────────────────────

export function setActiveSheet(id: string) {
	calcUI.activeSheetId = id;
	calcUI.activeTag = null;
	saveCalcPrefs();
}

export async function addSheet(): Promise<CalcSheet> {
	const tops = topSheets();
	const maxOrder = tops.length > 0 ? Math.max(...tops.map(s => s.order)) : -1;
	const sheet: CalcSheet = {
		id:        crypto.randomUUID(),
		name:      `Sheet ${tops.length + 1}`,
		order:     maxOrder + 1,
		createdAt: Date.now(),
	};
	calcSheets.push(sheet);
	setActiveSheet(sheet.id);
	if (_userId) await setDoc(sheetDoc(_userId, sheet.id), sheet);
	return sheet;
}

export async function renameSheet(id: string, name: string) {
	const sheet = calcSheets.find(s => s.id === id);
	const next = name.trim();
	if (!sheet || !next || next === sheet.name) return;
	sheet.name = next;
	if (_userId) await updateDoc(sheetDoc(_userId, id), { name: next });
}

export async function deleteSheet(id: string) {
	const sheet = calcSheets.find(s => s.id === id);
	if (!sheet || topSheets().length <= 1) return;
	const own = linesOf(id);
	const nested = descendants(own.map(l => l.id));
	if (calcUI.activeSheetId === id) setActiveSheet(topSheets().find(s => s.id !== id)!.id);
	await removeAll(`Deleted “${sheet.name}”`, [...own, ...nested.lines], [sheet, ...nested.sheets]);
}

// ── Line CRUD ──────────────────────────────────────────────────────────────

export async function addLine(input: string, sheetId = calcUI.activeSheetId): Promise<CalcLine> {
	const siblings = linesOf(sheetId);
	const maxOrder = siblings.length > 0 ? Math.max(...siblings.map(l => l.order)) : -1;
	const now = Date.now();
	const line: CalcLine = {
		id:        crypto.randomUUID(),
		sheetId,
		input,
		order:     maxOrder + 1,
		createdAt: now,
		updatedAt: now,
	};
	calcLines.push(line);
	// Started first so the sub-calc appears now, not after the server acknowledges the line
	const sub = ensureSubSheet(line);
	if (_userId) await setDoc(lineDoc(_userId, line.id), line);
	await sub;
	return line;
}

export async function updateLine(id: string, patch: Partial<Pick<CalcLine, 'input' | 'pinned' | 'note'>>) {
	const line = calcLines.find(l => l.id === id);
	if (!line) return;
	const changed = (Object.keys(patch) as (keyof typeof patch)[]).some(k => line[k] !== patch[k]);
	if (!changed) return;
	Object.assign(line, patch, { updatedAt: Date.now() });
	const sub = patch.input !== undefined ? ensureSubSheet(line) : undefined;
	if (_userId) {
		// Firestore rejects undefined; clearing a field is written as null and read back as unset
		const write = Object.fromEntries(Object.entries(patch).map(([k, v]) => [k, v ?? null]));
		await updateDoc(lineDoc(_userId, id), { ...write, updatedAt: line.updatedAt });
	}
	await sub;
}

export async function deleteLine(id: string) {
	const line = calcLines.find(l => l.id === id);
	if (!line) return;
	const nested = descendants([id]);
	await removeAll(
		nested.lines.length ? `Line and its sub-calc deleted` : 'Line deleted',
		[line, ...nested.lines],
		nested.sheets,
	);
}

export async function clearSheet(sheetId: string) {
	const own = linesOf(sheetId);
	const nested = descendants(own.map(l => l.id));
	await removeAll(`${own.length} ${own.length === 1 ? 'line' : 'lines'} cleared`, [...own, ...nested.lines], nested.sheets);
}

export function togglePin(id: string) {
	const line = calcLines.find(l => l.id === id);
	if (line) updateLine(id, { pinned: line.pinned ? undefined : true });
}

export function setNote(id: string, note: string) {
	updateLine(id, { note: note.trim() || undefined });
}

// ── Sub-calculations ───────────────────────────────────────────────────────

/** Typing `sub` into a line is all it takes — the sub-calculation appears, open. */
async function ensureSubSheet(line: CalcLine) {
	if (subSheetOf(line.id) || !usesSub(line.input)) return;
	if (sheetDepth(line.sheetId) >= MAX_SUB_DEPTH) return;
	await createSheetFor(line);
}

async function createSheetFor(line: CalcLine, firstInput?: string): Promise<CalcSheet> {
	const { label, name } = splitLine(line.input);
	const sheet: CalcSheet = {
		id:           crypto.randomUUID(),
		name:         label ?? name ?? 'Sub-calc',
		order:        0,
		parentLineId: line.id,
		createdAt:    Date.now(),
	};
	calcSheets.push(sheet);
	calcUI.expanded[line.id] = true;
	await Promise.all([
		_userId ? setDoc(sheetDoc(_userId, sheet.id), sheet) : undefined,
		firstInput ? addLine(firstInput, sheet.id) : undefined,
	]);
	return sheet;
}

/** Whether "Break into sub-calc" can move this line's working without changing its meaning. */
export function canBreakOut(line: CalcLine): boolean {
	if (subSheetOf(line.id) || sheetDepth(line.sheetId) >= MAX_SUB_DEPTH) return false;
	return isSelfContained(splitLine(line.input).expr);
}

/**
 * `Swiggy: 540 + 210 #food` becomes `Swiggy: sub #food`, with `540 + 210` as the first
 * line of its sub-calculation — same value, now with room to show the working.
 */
export async function breakIntoSubCalc(lineId: string) {
	const line = calcLines.find(l => l.id === lineId);
	if (!line || !canBreakOut(line)) return;
	const { label, name, expr, tags } = splitLine(line.input);
	const created = createSheetFor(line, expr);
	const head = [label ? `${label}: ` : '', name ? `${name} = ` : ''].join('');
	const tail = tags.map(t => ` #${t}`).join('');
	await Promise.all([created, updateLine(lineId, { input: `${head}sub${tail}` })]);
}

export function toggleExpanded(lineId: string) {
	calcUI.expanded[lineId] = !calcUI.expanded[lineId];
}
