import { reportWriteError } from './syncNotice.svelte';
import { browser } from '$app/environment';
import { firestore } from '$lib/firebase';
import {
	collection, doc, setDoc, updateDoc, deleteDoc, getDocs,
	onSnapshot, query, orderBy,
	type Unsubscribe,
} from 'firebase/firestore';
import type { Note, NoteVersion } from '$lib/db/notes.db';

export type { Note, NoteVersion };

// ── Constants ──────────────────────────────────────────────────────────────

// Saved notes store only `key`. `bg` tints the accent over the theme surface, so note
// text stays readable in both light and dark.
export const NOTE_COLORS = [
	{ key: 'red',    bg: 'color-mix(in srgb, #c77171 16%, var(--color-bg-surface))', accent: '#c77171' },
	{ key: 'amber',  bg: 'color-mix(in srgb, #c79f71 16%, var(--color-bg-surface))', accent: '#c79f71' },
	{ key: 'yellow', bg: 'color-mix(in srgb, #c7c071 16%, var(--color-bg-surface))', accent: '#c7c071' },
	{ key: 'green',  bg: 'color-mix(in srgb, #82b366 16%, var(--color-bg-surface))', accent: '#82b366' },
	{ key: 'blue',   bg: 'color-mix(in srgb, #6c8ebf 16%, var(--color-bg-surface))', accent: '#6c8ebf' },
	{ key: 'purple', bg: 'color-mix(in srgb, #9b71c7 16%, var(--color-bg-surface))', accent: '#9b71c7' },
] as const;

export const NOTE_TEMPLATES = [
	{ name: 'Blank',         icon: '○', title: '',               body: '' },
	{ name: 'Meeting Notes', icon: '◉', title: 'Meeting Notes',  body: '## Agenda\n\n- \n\n## Attendees\n\n- \n\n## Notes\n\n\n\n## Action Items\n\n- [ ] First action' },
	{ name: 'Daily Journal', icon: '◈', title: '',               body: '## Morning\n\n\n\n## Highlights\n\n- \n\n## Reflection\n\n\n\n## Tomorrow\n\n- ' },
	{ name: 'Standup',       icon: '◇', title: 'Daily Standup',  body: '## Yesterday\n\n- \n\n## Today\n\n- \n\n## Blockers\n\n- ' },
	{ name: 'Project Brief', icon: '◰', title: 'Project Brief',  body: '## Overview\n\n\n\n## Goals\n\n- \n\n## Non-Goals\n\n- \n\n## Timeline\n\n\n\n## Resources\n\n- ' },
] as const;

// ── State ──────────────────────────────────────────────────────────────────

export let notes = $state<Note[]>([]);

export let notesUI = $state<{
	activeNoteId: string | null;
	searchQuery: string;
	selectedFolder: string | null;
	selectedTag: string | null;
	sortBy: 'updatedAt' | 'createdAt' | 'title';
	saveStatus: 'saved' | 'saving' | 'unsaved' | 'offline';
	undoNote: Note | null;
	isLoading: boolean;
	focusSearchTick: number;
	/** Distraction-free writing: hides the sidebar and every bit of editor chrome. */
	zenMode: boolean;
}>({
	activeNoteId: null,
	searchQuery: '',
	selectedFolder: null,
	selectedTag: null,
	sortBy: 'updatedAt',
	saveStatus: 'saved',
	undoNote: null,
	isLoading: true,
	focusSearchTick: 0,
	zenMode: false,
});

let _userId = '';
let _unsub: Unsubscribe | null = null;
let saveTimer: ReturnType<typeof setTimeout> | null = null;
let undoTimer: ReturnType<typeof setTimeout> | null = null;
let pendingSaveId: string | null = null;
let saveSeq = 0;
const SAVE_ACK_TIMEOUT = 5000;

// ── Private derived ────────────────────────────────────────────────────────

const _liveNotes   = $derived(notes.filter(n => !n.deletedAt));
const _trashedNotes = $derived(notes.filter(n => !!n.deletedAt));

// ── Firestore helpers ──────────────────────────────────────────────────────

function notesCol(uid: string) {
	return collection(firestore, 'users', uid, 'notes');
}
function noteDoc(uid: string, id: string) {
	return doc(firestore, 'users', uid, 'notes', id);
}
function versionsCol(uid: string) {
	return collection(firestore, 'users', uid, 'noteVersions');
}
function versionDoc(uid: string, id: string) {
	return doc(firestore, 'users', uid, 'noteVersions', id);
}

function toNote(id: string, d: Record<string, unknown>): Note {
	return {
		id,
		title:     (d.title     as string)  ?? '',
		body:      (d.body      as string)  ?? '',
		tags:      (d.tags      as string[]) ?? [],
		color:     (d.color     as string | null) ?? null,
		pinned:    (d.pinned    as boolean) ?? false,
		folder:    (d.folder    as string | null) ?? null,
		deletedAt: (d.deletedAt as number | null) ?? null,
		createdAt: (d.createdAt as number)  ?? Date.now(),
		updatedAt: (d.updatedAt as number)  ?? Date.now(),
	};
}

// ── Getters ────────────────────────────────────────────────────────────────

export function getActiveNote(): Note | null {
	return notes.find(n => n.id === notesUI.activeNoteId) ?? null;
}
export function getLiveNotes():    Note[]   { return _liveNotes; }
export function getTrashedNotes(): Note[]   { return _trashedNotes; }

export function getFolders(): string[] {
	return [...new Set(_liveNotes.filter(n => n.folder).map(n => n.folder!))].sort();
}
export function getAllTags(): string[] {
	return [...new Set(_liveNotes.flatMap(n => n.tags))].sort();
}

export function getVisibleNotes(): Note[] {
	let list: Note[];
	if (notesUI.selectedFolder === '__trash__')      list = [..._trashedNotes];
	else if (notesUI.selectedFolder)                 list = _liveNotes.filter(n => n.folder === notesUI.selectedFolder);
	else                                             list = [..._liveNotes];

	if (notesUI.selectedTag)
		list = list.filter(n => n.tags.includes(notesUI.selectedTag!));

	if (notesUI.searchQuery.trim()) {
		const q = notesUI.searchQuery.trim().replace(/^#/, '').toLowerCase();
		list = list.filter(n =>
			n.title.toLowerCase().includes(q) ||
			n.body.toLowerCase().includes(q)  ||
			n.tags.some(t => t.toLowerCase().includes(q))
		);
	}

	return [...list].sort((a, b) => {
		if (a.pinned !== b.pinned) return b.pinned ? 1 : -1;
		if (notesUI.sortBy === 'title')     return (a.title || '\uFFFF').localeCompare(b.title || '\uFFFF');
		if (notesUI.sortBy === 'createdAt') return b.createdAt - a.createdAt;
		return b.updatedAt - a.updatedAt;
	});
}

// ── Load / Unload ──────────────────────────────────────────────────────────

export function loadNotes(userId: string) {
	if (!browser || _userId === userId) return;
	_userId = userId;
	notesUI.isLoading = true;
	// A ?view= session is looking at someone else's notes: never store or restore drafts there.
	_draftsEnabled = !new URLSearchParams(location.search).has('view');
	_draftsReconciled = false;
	hookPageHide();

	// Unsubscribe any previous listener
	_unsub?.();

	_unsub = onSnapshot(notesCol(userId), (snapshot) => {
		for (const change of snapshot.docChanges()) {
			const note = toNote(change.doc.id, change.doc.data());
			const idx  = notes.findIndex(n => n.id === note.id);

			if (change.type === 'removed') {
				if (idx !== -1) notes.splice(idx, 1);
			} else if (change.type === 'added') {
				if (idx === -1) notes.unshift(note);
				else if (note.updatedAt >= notes[idx].updatedAt) Object.assign(notes[idx], note);
			} else {
				// modified — only apply if server version is newer (avoid overwriting unsaved local edits)
				if (idx !== -1 && note.updatedAt >= notes[idx].updatedAt) Object.assign(notes[idx], note);
				else if (idx === -1) notes.unshift(note);
			}
		}
		notesUI.isLoading = false;
		// Only the server can say whether a draft is still newer; a cache-only snapshot can't.
		if (!_draftsReconciled && !snapshot.metadata.fromCache) {
			_draftsReconciled = true;
			restoreNoteDrafts();
		}
		// Select most-recent note on first load (the Trash view may legitimately have none)
		if (!notesUI.activeNoteId && notesUI.selectedFolder !== '__trash__' && _liveNotes.length > 0) {
			const first = [..._liveNotes].sort((a, b) => b.updatedAt - a.updatedAt)[0];
			notesUI.activeNoteId = first.id;
		}
	}, (err) => {
		// e.g. rules or quota: without this the panel sits on "Loading..." forever.
		console.error('Notes listener failed', err);
		notesUI.isLoading = false;
	});
}

export function unloadNotes() {
	if (saveTimer) {
		// The session is ending, so this can't be sent; keep it for the next load instead.
		clearTimeout(saveTimer);
		saveTimer = null;
		const pending = notes.find(n => n.id === pendingSaveId);
		if (pending) saveDraft(pending);
	}
	_unsub?.();
	_unsub    = null;
	_userId   = '';
	notes.splice(0, notes.length);
	notesUI.activeNoteId  = null;
	notesUI.isLoading     = true;
	notesUI.saveStatus    = 'saved';
	notesUI.undoNote      = null;
	notesUI.searchQuery   = '';
	notesUI.selectedFolder = null;
	notesUI.selectedTag   = null;
}

// ── CRUD ───────────────────────────────────────────────────────────────────

export async function createNote(template?: { title: string; body: string }): Promise<Note> {
	const now  = Date.now();
	const note: Note = {
		id:        crypto.randomUUID(),
		title:     template?.title ?? '',
		body:      template?.body  ?? '',
		tags:      [],
		color:     null,
		pinned:    false,
		folder:    notesUI.selectedFolder && notesUI.selectedFolder !== '__trash__' ? notesUI.selectedFolder : null,
		deletedAt: null,
		createdAt: now,
		updatedAt: now,
	};
	// Optimistic local update
	notes.unshift(note);
	notesUI.activeNoteId = note.id;
	notesUI.saveStatus   = 'saved';
	// Persist
	if (_userId) await setDoc(noteDoc(_userId, note.id), note);
	return note;
}

export function updateNoteField(id: string, field: keyof Note, value: unknown) {
	const idx = notes.findIndex(n => n.id === id);
	if (idx === -1) return;
	(notes[idx] as unknown as Record<string, unknown>)[field] = value;
	notes[idx].updatedAt = Date.now();
}

export function updateActiveNoteField(field: keyof Note, value: unknown) {
	if (!notesUI.activeNoteId) return;
	updateNoteField(notesUI.activeNoteId, field, value);
	queueSave();
}

export async function selectNote(id: string) {
	if (id === notesUI.activeNoteId) return;
	// Flush pending save immediately
	flushPendingSave();
	notesUI.activeNoteId = id;
}

/** Switch the list between All Notes (null), a folder, or Trash, keeping the editor in step with it. */
export function showFolder(folder: string | null) {
	const wasTrash = notesUI.selectedFolder === '__trash__';
	notesUI.selectedFolder = folder;
	notesUI.selectedTag = null;
	const isTrash = folder === '__trash__';
	if (wasTrash === isTrash) return;
	flushPendingSave();
	// A note from the other side must not stay open once the list no longer contains it.
	notesUI.activeNoteId = getVisibleNotes()[0]?.id ?? null;
}

export async function deleteNote(id: string) {
	const idx = notes.findIndex(n => n.id === id);
	if (idx === -1) return;
	notes[idx].deletedAt = Date.now();
	notesUI.undoNote = { ...notes[idx] };
	if (undoTimer) clearTimeout(undoTimer);
	undoTimer = setTimeout(() => { notesUI.undoNote = null; }, 5000);
	if (notesUI.activeNoteId === id) {
		notesUI.activeNoteId = _liveNotes.find(n => n.id !== id)?.id ?? null;
	}
	if (_userId) await updateDoc(noteDoc(_userId, id), { deletedAt: notes[idx].deletedAt });
}

export async function undoDelete() {
	if (!notesUI.undoNote) return;
	const id  = notesUI.undoNote.id;
	const idx = notes.findIndex(n => n.id === id);
	if (idx !== -1) {
		notes[idx].deletedAt = null;
		if (_userId) await updateDoc(noteDoc(_userId, id), { deletedAt: null });
	}
	notesUI.activeNoteId = id;
	notesUI.undoNote = null;
	if (undoTimer) { clearTimeout(undoTimer); undoTimer = null; }
}

export async function restoreNote(id: string) {
	const idx = notes.findIndex(n => n.id === id);
	if (idx === -1) return;
	notes[idx].deletedAt = null;
	if (_userId) await updateDoc(noteDoc(_userId, id), { deletedAt: null });
	notesUI.activeNoteId   = id;
	notesUI.selectedFolder = null;
}

export async function permanentlyDeleteNote(id: string) {
	const idx = notes.findIndex(n => n.id === id);
	if (idx !== -1) notes.splice(idx, 1);
	if (!_userId) return;
	await deleteDoc(noteDoc(_userId, id));
	// Delete versions
	const snap = await getDocs(query(versionsCol(_userId)));
	const dels = snap.docs.filter(d => d.data().noteId === id).map(d => deleteDoc(d.ref));
	await Promise.all(dels);
}

export async function emptyTrash() {
	const ids = _trashedNotes.map(n => n.id);
	for (let i = notes.length - 1; i >= 0; i--) {
		if (ids.includes(notes[i].id)) notes.splice(i, 1);
	}
	if (!_userId) return;
	await Promise.all(ids.map(id => deleteDoc(noteDoc(_userId, id))));
}

// ── Properties ─────────────────────────────────────────────────────────────

export async function togglePin(id: string) {
	const idx = notes.findIndex(n => n.id === id);
	if (idx === -1) return;
	notes[idx].pinned    = !notes[idx].pinned;
	notes[idx].updatedAt = Date.now();
	if (_userId) await updateDoc(noteDoc(_userId, id), { pinned: notes[idx].pinned, updatedAt: notes[idx].updatedAt });
}

export async function setNoteColor(id: string, color: string | null) {
	const idx = notes.findIndex(n => n.id === id);
	if (idx === -1) return;
	notes[idx].color = color;
	if (_userId) await updateDoc(noteDoc(_userId, id), { color });
}

export async function addTag(id: string, tag: string) {
	const trimmed = tag.trim().toLowerCase().replace(/^#/, '');
	if (!trimmed) return;
	const idx = notes.findIndex(n => n.id === id);
	if (idx === -1 || notes[idx].tags.includes(trimmed)) return;
	notes[idx].tags      = [...notes[idx].tags, trimmed];
	notes[idx].updatedAt = Date.now();
	if (_userId) await updateDoc(noteDoc(_userId, id), { tags: notes[idx].tags, updatedAt: notes[idx].updatedAt });
}

export async function removeTag(id: string, tag: string) {
	const idx = notes.findIndex(n => n.id === id);
	if (idx === -1) return;
	notes[idx].tags      = notes[idx].tags.filter(t => t !== tag);
	notes[idx].updatedAt = Date.now();
	if (_userId) await updateDoc(noteDoc(_userId, id), { tags: notes[idx].tags, updatedAt: notes[idx].updatedAt });
}

export async function setFolder(id: string, folder: string | null) {
	const idx = notes.findIndex(n => n.id === id);
	if (idx === -1) return;
	notes[idx].folder    = folder || null;
	notes[idx].updatedAt = Date.now();
	if (_userId) await updateDoc(noteDoc(_userId, id), { folder: notes[idx].folder, updatedAt: notes[idx].updatedAt });
}

// ── Auto-Save ──────────────────────────────────────────────────────────────

export function queueSave() {
	notesUI.saveStatus = 'unsaved';
	// The timer below only remembers one note, so don't let a different one replace it.
	if (saveTimer && pendingSaveId !== notesUI.activeNoteId) flushPendingSave();
	if (saveTimer) clearTimeout(saveTimer);
	pendingSaveId = notesUI.activeNoteId;
	saveTimer = setTimeout(async () => {
		saveTimer = null;
		await flushSave(pendingSaveId);
	}, 600);
}

function flushPendingSave() {
	if (!saveTimer) return;
	clearTimeout(saveTimer);
	saveTimer = null;
	// Not awaited: an offline write never resolves, and nothing here can wait on it.
	void flushSave(pendingSaveId);
}

// ── Unsaved drafts ─────────────────────────────────────────────────────────
// A write started while the page unloads may never reach the server. A copy stays in
// localStorage from before the write until the server acknowledges it, and the next load
// restores it only if it is still newer than the server's note. Keyed by account.

interface NoteDraft { title: string; body: string; updatedAt: number; }

let _draftsEnabled = false;
let _draftsReconciled = false;
let _pageHideHooked = false;

function draftsKey() { return `workkit-note-drafts:${_userId}`; }

function readDrafts(): Record<string, NoteDraft> {
	try { return JSON.parse(localStorage.getItem(draftsKey()) ?? '{}'); } catch { return {}; }
}

function writeDrafts(drafts: Record<string, NoteDraft>) {
	try {
		if (Object.keys(drafts).length) localStorage.setItem(draftsKey(), JSON.stringify(drafts));
		else localStorage.removeItem(draftsKey());
	} catch { /* storage full or blocked: the normal save still runs */ }
}

function saveDraft(note: Note) {
	if (!_draftsEnabled || !_userId) return;
	const drafts = readDrafts();
	drafts[note.id] = { title: note.title, body: note.body, updatedAt: note.updatedAt };
	writeDrafts(drafts);
}

function clearDraft(id: string, savedAt: number) {
	if (!_draftsEnabled || !_userId) return;
	const drafts = readDrafts();
	if (!drafts[id] || drafts[id].updatedAt > savedAt) return;
	delete drafts[id];
	writeDrafts(drafts);
}

/** Apply leftover drafts that beat the server's copy and drop the rest. Needs server-fresh `notes`. */
export function restoreNoteDrafts() {
	if (!_draftsEnabled || !_userId) return;
	const drafts = readDrafts();
	const restored: string[] = [];
	for (const [id, draft] of Object.entries(drafts)) {
		const note = notes.find(n => n.id === id);
		if (note && !note.deletedAt && draft.updatedAt > note.updatedAt) {
			Object.assign(note, draft);
			restored.push(id);
		} else {
			delete drafts[id];
		}
	}
	writeDrafts(drafts);
	// Each restored draft is cleared by its own save, once acknowledged.
	for (const id of restored) void flushSave(id);
}

function hookPageHide() {
	if (_pageHideHooked) return;
	_pageHideHooked = true;
	document.addEventListener('visibilitychange', () => {
		if (document.visibilityState === 'hidden') flushPendingSave();
	});
	window.addEventListener('pagehide', flushPendingSave);
}

async function flushSave(id: string | null) {
	if (!id || !_userId) return;
	const note = notes.find(n => n.id === id);
	if (!note) return;
	notesUI.saveStatus = 'saving';
	const seq = ++saveSeq;
	saveDraft(note);
	const savedAt = note.updatedAt;
	// Ignore a result once newer typing or a newer save owns the status.
	const setStatus = (status: 'saved' | 'unsaved' | 'offline') => {
		if (seq === saveSeq && !saveTimer) notesUI.saveStatus = status;
	};
	const write = updateDoc(noteDoc(_userId, id), {
		title:     note.title,
		body:      note.body,
		updatedAt: note.updatedAt,
	});
	// Firestore holds offline writes and resolves only when the server acknowledges them.
	const offlineTimer = setTimeout(() => setStatus('offline'), SAVE_ACK_TIMEOUT);
	try {
		await write;
		setStatus('saved');
		clearDraft(id, savedAt);
		// A failed history snapshot isn't a failed save.
		maybeSaveVersion({ ...note }).catch(() => {});
	} catch (e) {
		reportWriteError(e);
		setStatus('unsaved');
	} finally {
		clearTimeout(offlineTimer);
	}
}

async function maybeSaveVersion(note: Note) {
	if (!_userId) return;
	const snap     = await getDocs(query(versionsCol(_userId)));
	const versions = snap.docs
		.filter(d => d.data().noteId === note.id)
		.map(d => d.data() as NoteVersion)
		.sort((a, b) => a.savedAt - b.savedAt);
	const last     = versions[versions.length - 1];
	const timeDiff = Date.now() - (last?.savedAt ?? 0);
	const bodyDiff = Math.abs(note.body.length - (last?.body?.length ?? 0));
	if (!last || bodyDiff > 20 || timeDiff > 5 * 60 * 1000) {
		if (versions.length >= 10) {
			await deleteDoc(versionDoc(_userId, versions[0].id));
		}
		const ver: NoteVersion = {
			id:      crypto.randomUUID(),
			noteId:  note.id,
			title:   note.title,
			body:    note.body,
			savedAt: Date.now(),
		};
		await setDoc(versionDoc(_userId, ver.id), ver);
	}
}

// ── Version History ────────────────────────────────────────────────────────

export async function getVersions(noteId: string): Promise<NoteVersion[]> {
	if (!_userId) return [];
	const snap = await getDocs(versionsCol(_userId));
	return snap.docs
		.filter(d => d.data().noteId === noteId)
		.map(d => d.data() as NoteVersion)
		.sort((a, b) => b.savedAt - a.savedAt);
}

export async function restoreVersion(noteId: string, version: NoteVersion) {
	const idx = notes.findIndex(n => n.id === noteId);
	if (idx === -1) return;
	notes[idx].title     = version.title;
	notes[idx].body      = version.body;
	notes[idx].updatedAt = Date.now();
	notesUI.saveStatus = 'saved';
	// Not awaited, so the modal can close while offline; Firestore delivers it later.
	if (_userId) updateDoc(noteDoc(_userId, noteId), {
		title: version.title, body: version.body, updatedAt: notes[idx].updatedAt,
	}).catch((e) => { notesUI.saveStatus = 'unsaved'; reportWriteError(e); });
}

// ── Export / Import ────────────────────────────────────────────────────────

export function exportNote(note: Note, format: 'md' | 'txt') {
	const heading = !note.title ? '' : format === 'md' ? `# ${note.title}\n\n` : `${note.title}\n\n`;
	const content = heading + note.body;
	const blob = new Blob([content], { type: 'text/plain;charset=utf-8' });
	const a    = document.createElement('a');
	a.href     = URL.createObjectURL(blob);
	a.download = `${note.title || 'untitled'}.${format}`;
	a.click();
	URL.revokeObjectURL(a.href);
}

export async function importNoteFromText(title: string, body: string) {
	return createNote({ title, body });
}

// ── Utilities ──────────────────────────────────────────────────────────────

export function relativeTime(ts: number): string {
	const diff = Date.now() - ts;
	const s = Math.floor(diff / 1000);
	const m = Math.floor(s / 60);
	const h = Math.floor(m / 60);
	const d = Math.floor(h / 24);
	if (s < 60)  return 'just now';
	if (m < 60)  return `${m}m ago`;
	if (h < 24)  return `${h}h ago`;
	if (d === 1) return 'yesterday';
	if (d < 7)   return `${d}d ago`;
	return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
}

export function stripMarkdown(text: string): string {
	return text
		.replace(/^\|[\s:|-]*\|\s*$/gm, '')
		.replace(/^\|(.*)\|\s*$/gm, (_, row: string) => row.replace(/\|/g, ' '))
		.replace(/#{1,6}\s/g, '')
		.replace(/\*\*(.+?)\*\*/g, '$1')
		.replace(/\*(.+?)\*/g, '$1')
		.replace(/~~(.+?)~~/g, '$1')
		.replace(/`(.+?)`/g, '$1')
		.replace(/\[(.+?)\]\(.+?\)/g, '$1')
		.replace(/^[-*+]\s/gm, '')
		.replace(/^\d+\.\s/gm, '')
		.replace(/^>\s/gm, '')
		.replace(/\n+/g, ' ')
		.trim();
}
