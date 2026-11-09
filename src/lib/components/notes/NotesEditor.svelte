<script lang="ts">
	import { tagTone } from '$lib/calc/tape';
	import { untrack } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { Editor, Extension, InputRule } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Markdown } from 'tiptap-markdown';
	import Placeholder from '@tiptap/extension-placeholder';
	import TaskList from '@tiptap/extension-task-list';
	import TaskItem from '@tiptap/extension-task-item';
	import Link from '@tiptap/extension-link';
	import { Table, TableRow, TableCell, TableHeader } from '@tiptap/extension-table';
	import {
		notesUI,
		getActiveNote,
		getFolders,
		NOTE_COLORS,
		NOTE_TEMPLATES,
		updateActiveNoteField,
		togglePin,
		setNoteColor,
		addTag,
		removeTag,
		setFolder,
		deleteNote,
		restoreNote,
		permanentlyDeleteNote,
		exportNote,
		createNote,
		emptyTrash,
		getLiveNotes,
	} from '$lib/stores/notesState.svelte';
	import { closeLeft, closeRight } from '$lib/stores/panelState.svelte';
	import VersionHistoryModal from './VersionHistoryModal.svelte';

	// TipTap only turns "[ ] " into a task at the start of a plain paragraph. Typing the
	// usual "- [ ] " makes a bullet first, so convert that bullet here. It must run before
	// the stock rule, which edits the shared transaction even when it then gives up.
	const TaskItemWithBullet = TaskItem.extend({
		addInputRules() {
			const bulletTask = new InputRule({
				find: /^\[([ xX]?)\]\s$/,
				handler: ({ state, range, match, chain }) => {
					const from = state.selection.$from;
					if (from.depth < 2 || from.node(-1).type.name !== 'listItem' || from.index(-1) !== 0) return null;
					const steps = chain().deleteRange(range).toggleTaskList();
					if (match[1]?.toLowerCase() === 'x') steps.updateAttributes('taskItem', { checked: true });
					steps.run();
				},
			});
			return [bulletTask, ...(this.parent?.() ?? [])];
		},
	});

	// Round 1 stored table markdown inside a ```table code block because no table node
	// existed. tiptap-markdown runs this setup on every parse, so register the rule once.
	const unfencedParsers = new WeakSet<object>();

	// markdown-it and prosemirror-markdown's own types aren't available here, hence `any`.
	const MarkdownTable = Table.extend({
		addStorage() {
			return {
				...this.parent?.(),
				markdown: {
					// The stock serializer writes a literal "[table]" (dropping the whole table)
					// for any cell it can't express, such as one with two paragraphs. Markdown
					// cells are one line, so flatten those instead of losing them.
					serialize(state: any, node: any) {
						let columns = 0;
						node.forEach((row: any, _o: number, rowIndex: number) => {
							state.write('| ');
							row.forEach((cell: any, _p: number, cellIndex: number) => {
								if (cellIndex) state.write(' | ');
								const start = state.out.length;
								let first = true;
								cell.descendants((block: any) => {
									if (!block.isTextblock) return true;
									if (!first) state.write(' ');
									first = false;
									if (block.textContent.trim()) state.renderInline(block);
									return false;
								});
								state.out = state.out.slice(0, start) + state.out.slice(start).replace(/\\?\n/g, ' ').replace(/\|/g, '\\|');
								for (let extra = 1; extra < cell.attrs.colspan; extra++) state.write(' | ');
								if (!rowIndex) columns += cell.attrs.colspan;
							});
							state.write(' |');
							state.ensureNewLine();
							if (!rowIndex) {
								state.write(`| ${Array(columns).fill('---').join(' | ')} |`);
								state.ensureNewLine();
							}
						});
						state.closeBlock(node);
					},
					parse: {
						setup(md: any) {
							if (unfencedParsers.has(md)) return;
							unfencedParsers.add(md);
							md.core.ruler.after('block', 'unfence_tables', (state: any) => {
								state.tokens = state.tokens.flatMap((token: any) => {
									if (token.type !== 'fence' || token.info.trim() !== 'table') return [token];
									const inner: any[] = [];
									md.block.parse(token.content, md, state.env, inner);
									const onlyTable = inner[0]?.type === 'table_open' && inner.at(-1)?.type === 'table_close'
										&& inner.filter(t => t.type === 'table_open').length === 1;
									return onlyTable ? inner : [token];
								});
							});
						},
					},
				},
			};
		},
	});

	// tiptap-markdown only marks bullet and numbered lists tight, so each save put a blank
	// line between checklist items.
	const TightTaskList = TaskList.extend({
		addAttributes() {
			return { ...this.parent?.(), tight: { default: true, rendered: false } };
		},
	});

	// Pasted markdown is parsed with whitespace preserved, so "- [ ] x" arrives as " x"
	// and every paste adds another leading space to the saved body.
	const TrimTaskText = Extension.create({
		name: 'trimTaskText',
		addStorage() {
			return {
				markdown: {
					parse: {
						updateDOM(element: HTMLElement) {
							element.querySelectorAll('.task-list-item').forEach(item => {
								const first = (item.querySelector(':scope > p') ?? item).firstChild;
								if (first?.nodeType === Node.TEXT_NODE) first.textContent = first.textContent!.replace(/^\s+/, '');
							});
						},
					},
				},
			};
		},
	});

	const activeNote = $derived(getActiveNote());
	const folders = $derived(getFolders());
	const hasAnyNotes = $derived(getLiveNotes().length > 0);

	let editorEl = $state<HTMLDivElement | null>(null);
	let titleEl = $state<HTMLInputElement | null>(null);

	// TipTap editor instance — not $state (non-plain object)
	let editor: Editor | null = null;
	let updatingContent = false;
	// Incremented on every editor transaction so derived toolbar state stays reactive
	let editorTick = $state(0);

	let showMoreMenu = $state(false);
	let showColorPicker = $state(false);
	let showFolderInput = $state(false);
	let showTemplates = $state(false);
	let showVersionHistory = $state(false);
	let tagInput = $state('');
	let folderInputVal = $state('');
	let copyLabel = $state('Copy');
	let confirmAction = $state<'delete' | 'empty' | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;
	let moreMenuEl = $state<HTMLDivElement | null>(null);
	let colorMenuEl = $state<HTMLDivElement | null>(null);

	const isCenter = $derived(page.url.pathname === '/notes');
	const isInTrash = $derived(!!activeNote?.deletedAt);
	const colorConfig = $derived(NOTE_COLORS.find(c => c.key === activeNote?.color) ?? null);

	// Counted from the rendered text, not the markdown source — otherwise "##", list
	// bullets and the URL half of every link get counted as words the user never typed.
	// Pushed from the editor's own callbacks rather than pulled in a $derived: reading
	// the editor mid-render can collide with a ProseMirror transaction.
	let plainText = $state('');

	function syncCounts() {
		plainText = editor?.getText() ?? '';
	}
	const wordCount = $derived(plainText.trim() === '' ? 0 : plainText.trim().split(/\s+/).length);
	// getText() pads blocks with separators; trim so the count matches what's on screen.
	const charCount = $derived(plainText.trim().length);
	const readTime = $derived(Math.max(1, Math.ceil(wordCount / 200)));

	// ── Editor lifecycle ───────────────────────────────────────────────────

	let prevNoteId: string | null = null;

	// The editor element only exists while a note is active, so bind creation to the
	// element itself rather than to mount — otherwise loading with no note selected
	// (empty state) leaves the editor uninitialised for the rest of the session.
	$effect(() => {
		const el = editorEl;
		if (!browser || !el) return;

		// `editorEl` is the only dependency this effect may have. Every read of note
		// state is untracked — the notes are $state proxies, so tracking one would
		// tear down and rebuild the editor on each keystroke, losing focus and caret.
		const instance = untrack(() => {
			const initial = getActiveNote();
			prevNoteId = notesUI.activeNoteId;

			return new Editor({
				element: el,
				extensions: [
					// Link is registered below with our own options.
					StarterKit.configure({ link: false }),
					MarkdownTable.configure({ renderWrapper: true, cellMinWidth: 96 }),
					TableRow,
					TableCell,
					TableHeader,
					Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
					Placeholder.configure({ placeholder: 'Start writing…' }),
					TightTaskList,
					TaskItemWithBullet.configure({ nested: true }),
					TrimTaskText,
					Link.configure({ openOnClick: false }),
				],
				content: initial?.body ?? '',
				editable: !initial?.deletedAt,
				editorProps: {
					attributes: { class: 'tiptap-editor focus:outline-none' },
				},
				// Untracked: setContent runs inside the sync $effect below, and a tracked `++`
					// there made the effect depend on what it writes, looping on any body
					// that doesn't round-trip through markdown exactly (imports, templates).
					onTransaction: () => { untrack(() => editorTick++); },
				onUpdate: ({ editor: e }) => {
					syncCounts();
					if (updatingContent) return;
					updateActiveNoteField('body', e.storage.markdown.getMarkdown());
				},
			});
		});
		editor = instance;
		syncCounts();
		// The id-change path below doesn't run for the note the editor is created with.
		untrack(() => {
			const initial = getActiveNote();
			if (isCenter && initial && !initial.title && !initial.body) setTimeout(() => titleEl?.focus(), 50);
		});

		return () => {
			instance.destroy();
			if (editor === instance) editor = null;
		};
	});

	// Update editor when active note changes or its body is updated externally (e.g. Firestore sync)
	$effect(() => {
		const id = notesUI.activeNoteId;
		const note = getActiveNote(); // track dependency on both id and note content
		if (!editor) return;
		if (id !== prevNoteId) {
			prevNoteId = id;
			updatingContent = true;
			editor.commands.setContent(note?.body ?? '');
			editor.setEditable(!note?.deletedAt);
			updatingContent = false;
			syncCounts();
			tagInput = '';
			closeMenus();
			if (!note?.title && !note?.body) setTimeout(() => titleEl?.focus(), 50);
		} else if (note && !updatingContent) {
			// Same note — apply body changes that came in externally (viewer mode / Firestore sync)
			const currentMd = editor.storage.markdown.getMarkdown();
			if (note.body !== currentMd) {
				updatingContent = true;
				editor.commands.setContent(note.body);
				updatingContent = false;
				syncCounts();
			}
		}
	});

	// Sync editable flag when trash status changes
	$effect(() => {
		const trashed = isInTrash;
		editor?.setEditable(!trashed);
	});

	// ── Title ──────────────────────────────────────────────────────────────

	function handleTitleInput(e: Event) {
		updateActiveNoteField('title', (e.currentTarget as HTMLInputElement).value);
	}

	function handleTitleKeydown(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === 'ArrowDown') {
			e.preventDefault();
			editor?.commands.focus('start');
		}
	}

	// ── Toolbar ────────────────────────────────────────────────────────────

	function isActive(type: string, attrs?: Record<string, unknown>): boolean {
		void editorTick; // reactivity
		return editor?.isActive(type, attrs) ?? false;
	}

	// A bare "example.com" would otherwise be a relative link into this app.
	function normalizeLink(raw: string): string {
		const url = raw.trim();
		if (/^[a-z][a-z\d+.-]*:(?!\d)/i.test(url) || /^[/#?]/.test(url)) return url;
		if (/^[^\s@/]+@[^\s@/]+\.[^\s@/]+$/.test(url)) return `mailto:${url}`;
		return `https://${url}`;
	}

	const TOOLBAR_NODES: Record<string, string> = {
		h1: 'heading', h2: 'heading', h3: 'heading',
		codeblock: 'codeBlock', quote: 'blockquote', ul: 'bulletList', ol: 'orderedList', check: 'taskList',
	};

	// Select All also spans the empty paragraph TipTap keeps after a heading or code block,
	// so block toggles would see a mixed selection and apply themselves to that paragraph.
	function selectionWithoutEmptyBlocks(): { from: number; to: number } | null {
		if (!editor) return null;
		const { selection, doc } = editor.state;
		if (selection.empty) return null;
		let from: number | null = null;
		let to = selection.to;
		doc.nodesBetween(selection.from, selection.to, (node, pos) => {
			if (!node.isTextblock || !node.content.size) return true;
			from ??= Math.max(selection.from, pos + 1);
			to = Math.min(selection.to, pos + 1 + node.content.size);
			return false;
		});
		return from === null ? null : { from, to };
	}

	function handleToolbar(id: string) {
		if (!editor) return;
		const c = editor.chain().focus();
		if (TOOLBAR_NODES[id]) {
			const range = selectionWithoutEmptyBlocks();
			if (range) c.setTextSelection(range);
		}
		switch (id) {
			case 'bold':      c.toggleBold().run(); break;
			case 'italic':    c.toggleItalic().run(); break;
			case 'strike':    c.toggleStrike().run(); break;
			case 'h1':        c.toggleHeading({ level: 1 }).run(); break;
			case 'h2':        c.toggleHeading({ level: 2 }).run(); break;
			case 'h3':        c.toggleHeading({ level: 3 }).run(); break;
			case 'code':      c.toggleCode().run(); break;
			case 'codeblock': c.toggleCodeBlock().run(); break;
			case 'quote':     c.toggleBlockquote().run(); break;
			case 'ul':        c.toggleBulletList().run(); break;
			case 'ol':        c.toggleOrderedList().run(); break;
			case 'check':     c.toggleTaskList().run(); break;
			case 'link': {
				const prev = editor.getAttributes('link').href ?? '';
				const url = window.prompt('Link URL:', prev);
				if (url === null) { editor.chain().focus().run(); break; }
				if (url.trim() === '') { c.unsetLink().run(); break; }
				c.setLink({ href: normalizeLink(url) }).run();
				break;
			}
			case 'hr': c.setHorizontalRule().run(); break;
			// Tab from the last cell adds rows too; the buttons below cover touch screens.
			case 'table':
				if (!editor.isActive('table')) c.insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run();
				else c.run();
				break;
			case 'rowAdd': c.addRowAfter().run(); break;
			case 'colAdd': c.addColumnAfter().run(); break;
			case 'rowDel': c.deleteRow().run(); break;
			case 'colDel': c.deleteColumn().run(); break;
			case 'tableDel': c.deleteTable().run(); break;
		}
	}

	// ── Tags ───────────────────────────────────────────────────────────────

	function commitTagInput() {
		const id = notesUI.activeNoteId;
		if (id) tagInput.split(',').forEach(t => { if (t.trim()) addTag(id, t); });
		tagInput = '';
	}

	function handleTagKeydown(e: KeyboardEvent) {
		if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
			e.preventDefault();
			commitTagInput();
		}
		if (e.key === 'Backspace' && !tagInput && activeNote?.tags.length) {
			if (notesUI.activeNoteId) removeTag(notesUI.activeNoteId, activeNote.tags[activeNote.tags.length - 1]);
		}
	}

	// ── Folder ─────────────────────────────────────────────────────────────

	function handleFolderSubmit(e: Event) {
		e.preventDefault();
		if (notesUI.activeNoteId) setFolder(notesUI.activeNoteId, folderInputVal.trim() || null);
		showFolderInput = false;
		showMoreMenu = false;
		folderInputVal = '';
	}

	function focusOnMount(node: HTMLInputElement) {
		node.focus();
	}

	// ── Menus ──────────────────────────────────────────────────────────────

	function closeMenus() {
		showMoreMenu = false;
		showColorPicker = false;
		showTemplates = false;
		showFolderInput = false;
	}

	// Submenus and an armed delete must not survive the menu closing.
	$effect(() => {
		if (showMoreMenu) return;
		showTemplates = false;
		showFolderInput = false;
		resetConfirm();
	});

	function onWindowPointerDown(e: PointerEvent) {
		if (!showMoreMenu && !showColorPicker) return;
		const target = e.target as Node;
		if (!moreMenuEl?.contains(target)) showMoreMenu = false;
		if (!colorMenuEl?.contains(target)) showColorPicker = false;
	}

	function resetConfirm() {
		if (confirmTimer) clearTimeout(confirmTimer);
		confirmTimer = null;
		confirmAction = null;
	}

	// Permanent deletes have no undo: first click arms, second click within 3s runs.
	function confirmThen(action: 'delete' | 'empty', run: () => void) {
		if (confirmAction !== action) {
			resetConfirm();
			confirmAction = action;
			confirmTimer = setTimeout(resetConfirm, 3000);
			return;
		}
		resetConfirm();
		run();
		showMoreMenu = false;
	}

	// ── Copy ───────────────────────────────────────────────────────────────

	async function handleCopy() {
		if (!activeNote) return;
		await navigator.clipboard.writeText(`${activeNote.title}\n\n${activeNote.body}`);
		copyLabel = 'Copied!';
		// Keep the menu up briefly, or the label is never seen.
		setTimeout(() => { showMoreMenu = false; }, 700);
		setTimeout(() => copyLabel = 'Copy', 2000);
	}

	// ── Zen mode ───────────────────────────────────────────────────────────
	// Distraction-free writing: everything except the text goes away, the column narrows
	// to a comfortable measure, and Escape brings the room back.

	// Lives in the store so NotesTool can fold away the notes list at the same time.
	const zenMode = $derived(notesUI.zenMode);

	function handleZen() {
		showMoreMenu = false;
		closeLeft();
		closeRight();
		notesUI.zenMode = true;
		// Focus natively rather than via editor.commands.focus(): the command dispatches a
		// ProseMirror transaction, which races the zen re-render and throws "Applying a
		// mismatched transaction". Focusing the contenteditable directly has no such risk.
		setTimeout(() => {
			(editorEl?.querySelector('.ProseMirror') as HTMLElement | null)?.focus({ preventScroll: true });
		}, 60);
	}

	function exitZen() {
		notesUI.zenMode = false;
	}

	function onZenKey(e: KeyboardEvent) {
		if (e.key === 'Escape' && (showMoreMenu || showColorPicker)) {
			e.preventDefault();
			closeMenus();
			return;
		}
		if (zenMode && e.key === 'Escape') {
			e.preventDefault();
			exitZen();
		}
	}

	// ── Template ───────────────────────────────────────────────────────────

	function handleTemplate(tpl: { title: string; body: string }) {
		createNote(tpl);
		showTemplates = false;
		showMoreMenu = false;
	}

	// ── Relative time ──────────────────────────────────────────────────────

	function relTime(ts: number): string {
		const diff = Date.now() - ts;
		const m = Math.floor(diff / 60000);
		const h = Math.floor(m / 60);
		const d = Math.floor(h / 24);
		if (m < 1) return 'just now';
		if (m < 60) return `${m}m ago`;
		if (h < 24) return `${h}h ago`;
		if (d === 1) return 'yesterday';
		return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
	}
</script>

<svelte:window onkeydown={onZenKey} onpointerdown={onWindowPointerDown} />

{#if !activeNote}
	<!-- Empty state -->
	<div class="flex flex-col items-center justify-center h-full gap-3 text-text-muted select-none">
		<svg width="40" height="40" viewBox="0 0 40 40" fill="none" class="opacity-20">
			<rect x="6" y="6" width="28" height="28" rx="3" stroke="currentColor" stroke-width="1.5"/>
			<path d="M12 14h16M12 19h12M12 24h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
		</svg>
		<!-- With no notes at all, "select a note" offers something impossible. -->
		<p class="text-sm">{hasAnyNotes ? 'Pick a note from the list' : 'Nothing here yet'}</p>
		<button
			class="empty-cta px-4 py-2 rounded text-xs bg-accent-notes text-on-accent font-semibold hover:opacity-90 transition-opacity"
			onclick={() => createNote()}
		>{hasAnyNotes ? 'New note' : 'Write your first note'}</button>
	</div>
{:else}
	<div
		class="note-shell flex flex-col h-full relative"
		class:zen={zenMode}
		style={colorConfig ? `background-color: ${colorConfig.bg};` : ''}
	>
		{#if zenMode}
			<button class="zen-exit" onclick={exitZen} title="Leave zen mode (Esc)">Done</button>
		{/if}
		<!-- Header -->
		<div class="note-chrome flex items-center gap-1 px-3 pt-3 pb-1.5 shrink-0">
			<!-- Title -->
			<input
				bind:this={titleEl}
				type="text"
				placeholder="Untitled"
				value={activeNote.title}
				oninput={handleTitleInput}
				onkeydown={handleTitleKeydown}
				disabled={isInTrash}
				class="title-input flex-1 bg-transparent outline-none text-base font-semibold text-text-primary placeholder-text-muted min-w-0 disabled:opacity-60 border-0 border-b border-transparent focus:border-text-faint"
			/>

			<!-- Pin -->
			<button
				class="head-btn p-1.5 rounded transition-colors shrink-0"
				class:text-accent-notes={activeNote.pinned}
				class:text-text-muted={!activeNote.pinned}
				class:hover:bg-bg-hover={true}
				onclick={() => activeNote && togglePin(activeNote.id)}
				title={activeNote.pinned ? 'Unpin' : 'Pin note'}
				disabled={isInTrash}
			>
				<svg width="13" height="13" viewBox="0 0 13 13" fill={activeNote.pinned ? 'currentColor' : 'none'}>
					<path d="M9.5 1.5L7 4l1 3.5-3.5 3.5L3 9 1 11M9.5 1.5L12 4M9.5 1.5l-3 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			</button>

			<!-- Color picker -->
			<div class="relative shrink-0" bind:this={colorMenuEl}>
				<button
					class="head-btn p-1.5 rounded hover:bg-bg-hover transition-colors"
					class:text-text-muted={!activeNote.color}
					style={colorConfig ? `color: color-mix(in srgb, ${colorConfig.accent} 55%, var(--color-text-primary));` : ''}
					onclick={() => { showColorPicker = !showColorPicker; showMoreMenu = false; }}
					title="Note color"
					disabled={isInTrash}
				>
					<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
						<circle cx="6.5" cy="6.5" r="5" stroke="currentColor" stroke-width="1.2"/>
						<path d="M6.5 3.5v6M3.5 6.5h6" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
					</svg>
				</button>
				{#if showColorPicker}
					<div class="absolute right-0 top-8 z-50 bg-bg-surface border border-border-default rounded-lg p-2 flex gap-1.5 shadow-lg">
						<button
							class="swatch w-5 h-5 rounded-full border border-border-default flex items-center justify-center hover:bg-bg-hover transition-colors"
							onclick={() => { setNoteColor(activeNote!.id, null); showColorPicker = false; }}
							title="No color"
						>
							<svg width="8" height="8" viewBox="0 0 8 8" fill="none">
								<path d="M1 1l6 6M7 1L1 7" stroke="var(--color-text-secondary)" stroke-width="1.2" stroke-linecap="round"/>
							</svg>
						</button>
						{#each NOTE_COLORS as c}
							<button
								class="swatch w-5 h-5 rounded-full transition-transform hover:scale-110"
								style="background-color: {c.accent};"
								class:ring-2={activeNote.color === c.key}
								class:ring-offset-1={activeNote.color === c.key}
								onclick={() => { setNoteColor(activeNote!.id, c.key); showColorPicker = false; }}
								title={c.key}
							></button>
						{/each}
					</div>
				{/if}
			</div>

			<!-- More menu -->
			<div class="relative shrink-0" bind:this={moreMenuEl}>
				<button
					class="head-btn p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
					onclick={() => { showMoreMenu = !showMoreMenu; showColorPicker = false; }}
					title="More options"
				>
					<svg width="13" height="13" viewBox="0 0 13 13" fill="currentColor">
						<circle cx="2" cy="6.5" r="1.2"/><circle cx="6.5" cy="6.5" r="1.2"/><circle cx="11" cy="6.5" r="1.2"/>
					</svg>
				</button>

				{#if showMoreMenu}
					<!-- svelte-ignore a11y_no_static_element_interactions -->
					<div
						class="absolute right-0 top-8 z-50 bg-bg-surface border border-border-default rounded-lg shadow-lg py-1 w-48 max-h-[70vh] overflow-y-auto"
						onmouseleave={() => { if (!showTemplates && !showFolderInput) showMoreMenu = false; }}
					>
						{#if isInTrash}
							<button class="menu-item menu-accent" onclick={() => { restoreNote(activeNote!.id); showMoreMenu = false; }}>
								↩ Restore note
							</button>
							<button class="menu-item menu-danger" onblur={resetConfirm} onclick={() => confirmThen('delete', () => permanentlyDeleteNote(activeNote!.id))}>
								{confirmAction === 'delete' ? 'Click again to delete' : 'Delete permanently'}
							</button>
							<div class="border-t border-border-subtle my-1"></div>
							<button class="menu-item menu-danger" onblur={resetConfirm} onclick={() => confirmThen('empty', emptyTrash)}>
								{confirmAction === 'empty' ? 'Click again to empty' : 'Empty trash'}
							</button>
						{:else}
							<!-- Templates -->
							<div class="relative">
								<button class="menu-item" onclick={() => showTemplates = !showTemplates}>
									<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.1"/><path d="M3 4h6M3 6h6M3 8h4" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
									Templates
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="ml-auto transition-transform" class:rotate-90={showTemplates}><path d="M4 2l4 3-4 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
								</button>
								{#if showTemplates}
									<!-- Inline: the menu is right-aligned, so a flyout runs off the screen. -->
									<div class="border-y border-border-subtle py-1">
										{#each NOTE_TEMPLATES as tpl}
											<button class="menu-item" onclick={() => handleTemplate(tpl)}>
												<span class="opacity-60 mr-1">{tpl.icon}</span>{tpl.name}
											</button>
										{/each}
									</div>
								{/if}
							</div>

							<!-- Folder -->
							<div class="relative">
								<button class="menu-item" onclick={() => showFolderInput = !showFolderInput}>
									<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 5h10v5a1 1 0 01-1 1H2a1 1 0 01-1-1V5zM1 5V4a1 1 0 011-1h3l1 1h4" stroke="currentColor" stroke-width="1.1"/></svg>
									{activeNote.folder ? `Folder: ${activeNote.folder}` : 'Move to folder'}
								</button>
								{#if showFolderInput}
									<div class="px-3 py-2 border-t border-border-subtle">
										<form onsubmit={handleFolderSubmit}>
											<input
												bind:value={folderInputVal}
												placeholder="Folder name..."
												class="w-full bg-bg-primary border border-border-subtle rounded px-2 py-1 text-xs text-text-primary outline-none focus:border-accent-notes"
												use:focusOnMount
											/>
											<div class="flex flex-wrap gap-1 mt-1.5">
												{#each folders as f}
													<button
														type="button"
														class="px-1.5 py-0.5 text-[10px] rounded bg-bg-hover text-text-muted hover:text-text-primary transition-colors"
														onclick={() => { if (notesUI.activeNoteId) setFolder(notesUI.activeNoteId, f); showFolderInput = false; showMoreMenu = false; }}
													>{f}</button>
												{/each}
												{#if activeNote.folder}
													<button
														type="button"
														class="px-1.5 py-0.5 text-[10px] rounded bg-bg-hover text-danger transition-colors"
														onclick={() => { if (notesUI.activeNoteId) setFolder(notesUI.activeNoteId, null); showFolderInput = false; showMoreMenu = false; }}
													>Remove</button>
												{/if}
											</div>
										</form>
									</div>
								{/if}
							</div>

							<div class="border-t border-border-subtle my-1"></div>

							<button class="menu-item" onclick={() => { exportNote(activeNote!, 'md'); showMoreMenu = false; }}>
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 5l3 3 3-3M2 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
								Export as .md
							</button>
							<button class="menu-item" onclick={() => { exportNote(activeNote!, 'txt'); showMoreMenu = false; }}>
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 1v7M3 5l3 3 3-3M2 10h8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/></svg>
								Export as .txt
							</button>
							<button class="menu-item" onclick={handleCopy}>
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="4" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.1"/><path d="M4 4V2.5A1.5 1.5 0 015.5 1H9.5A1.5 1.5 0 0111 2.5v4A1.5 1.5 0 019.5 8H8" stroke="currentColor" stroke-width="1.1"/></svg>
								{copyLabel}
							</button>

							<div class="border-t border-border-subtle my-1"></div>

							<button class="menu-item" onclick={() => { showVersionHistory = true; showMoreMenu = false; }}>
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M6 2v4l2.5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/><circle cx="6" cy="6" r="4.5" stroke="currentColor" stroke-width="1.1"/></svg>
								Version history
							</button>

							{#if isCenter}
								<button class="menu-item" onclick={handleZen}>
									<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1 4V2h2M9 2h2v2M1 8v2h2M9 10h2V8" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
									Zen mode
								</button>
							{/if}

							<div class="border-t border-border-subtle my-1"></div>

							<button class="menu-item menu-danger" onclick={() => { if (notesUI.activeNoteId) deleteNote(notesUI.activeNoteId); showMoreMenu = false; }}>
								<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M1.5 3h9M5 3V1.5h2V3M2.5 3l.5 7h6l.5-7" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
								Move to trash
							</button>
						{/if}
					</div>
				{/if}
			</div>
		</div>

		<!-- Folder badge -->
		{#if activeNote.folder}
			<div class="note-chrome px-3 pb-1 shrink-0">
				<span class="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-surface border border-border-subtle">
					📁 {activeNote.folder}
				</span>
			</div>
		{/if}

		<!-- Tags row -->
		<div class="note-chrome flex items-center flex-wrap gap-1 px-3 pb-1.5 shrink-0 min-h-7">
			{#each activeNote.tags as tag}
				<span style="background:var(--tag-{tagTone(tag)}-bg); color:var(--tag-{tagTone(tag)}-fg)" class="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-bg-surface border border-border-subtle text-[10px] text-text-muted group">
					#{tag}
					{#if !isInTrash}
						<button
							class="tag-x opacity-0 group-hover:opacity-100 focus-visible:opacity-100 [@media(hover:none)]:opacity-100 transition-opacity ml-0.5 hover:text-danger"
							onclick={() => notesUI.activeNoteId && removeTag(notesUI.activeNoteId, tag)}
							aria-label="Remove tag"
						>×</button>
					{/if}
				</span>
			{/each}
			{#if !isInTrash}
				<input
					bind:value={tagInput}
					onkeydown={handleTagKeydown}
					onblur={commitTagInput}
					type="text"
					placeholder={activeNote.tags.length === 0 ? '+ tag' : '+ tag'}
					class="tag-input bg-transparent text-[10px] text-text-muted placeholder-text-muted outline-none w-16 min-w-[48px] border-0 border-b border-transparent focus:border-text-faint"
				/>
			{/if}
		</div>

		<!-- Toolbar (hidden in trash) -->
		{#if !isInTrash}
			<div class="note-chrome toolbar flex items-center gap-0.5 px-2 pb-1.5 shrink-0 border-b border-border-subtle flex-wrap">
				{#each [
					{ id: 'bold',      label: 'B',   title: 'Bold (Ctrl+B)',    style: 'font-bold', },
					{ id: 'italic',    label: 'I',   title: 'Italic (Ctrl+I)',  style: 'italic', },
					{ id: 'strike',    label: 'S',   title: 'Strikethrough',    style: 'line-through', },
					{ id: 'sep1',      label: '',    title: '',                 style: '', },
					{ id: 'h1',        label: 'H1',  title: 'Heading 1',        style: '', },
					{ id: 'h2',        label: 'H2',  title: 'Heading 2',        style: '', },
					{ id: 'h3',        label: 'H3',  title: 'Heading 3',        style: '', },
					{ id: 'sep2',      label: '',    title: '',                 style: '', },
					{ id: 'code',      label: '`',   title: 'Inline code',      style: '', },
					{ id: 'codeblock', label: '{}',  title: 'Code block',       style: '', },
					{ id: 'quote',     label: '"',   title: 'Blockquote',       style: '', },
					{ id: 'sep3',      label: '',    title: '',                 style: '', },
					{ id: 'ul',        label: '•',   title: 'Bullet list',      style: '', },
					{ id: 'ol',        label: '1.',  title: 'Numbered list',    style: '', },
					{ id: 'check',     label: '☑',   title: 'Checklist',        style: '', },
					{ id: 'sep4',      label: '',    title: '',                 style: '', },
					{ id: 'link',      label: '⊞',   title: 'Link',             style: '', },
					{ id: 'hr',        label: '—',   title: 'Horizontal rule',  style: '', },
					{ id: 'table',     label: 'Table', title: 'Insert table',   style: '', },
				] as btn}
					{#if btn.id.startsWith('sep')}
						<div class="w-px h-4 bg-border-subtle mx-0.5 toolbar-sep"></div>
					{:else}
						{@const active = isActive(
							TOOLBAR_NODES[btn.id] ?? btn.id,
							btn.id === 'h1' ? { level: 1 } : btn.id === 'h2' ? { level: 2 } : btn.id === 'h3' ? { level: 3 } : undefined
						)}
						<button
							class="toolbar-btn px-1.5 py-1 rounded text-xs transition-colors leading-none {btn.style}"
							class:bg-bg-hover={active}
							class:text-accent-notes={active}
							aria-pressed={active}
							class:text-text-muted={!active}
							class:hover:text-text-primary={!active}
							class:hover:bg-bg-hover={!active}
							title={btn.title}
							onclick={() => handleToolbar(btn.id)}
						>{btn.label}</button>
					{/if}
				{/each}
				{#if isActive('table')}
					<div class="w-px h-4 bg-border-subtle mx-0.5 toolbar-sep"></div>
					{#each [
						{ id: 'rowAdd',   label: '+ Row', title: 'Add row below' },
						{ id: 'colAdd',   label: '+ Col', title: 'Add column right' },
						{ id: 'rowDel',   label: '− Row', title: 'Delete row' },
						{ id: 'colDel',   label: '− Col', title: 'Delete column' },
						{ id: 'tableDel', label: 'Delete table', title: 'Delete table' },
					] as btn}
						<button
							class="toolbar-btn px-1.5 py-1 rounded text-xs transition-colors leading-none text-text-muted hover:text-text-primary hover:bg-bg-hover"
							title={btn.title}
							onclick={() => handleToolbar(btn.id)}
						>{btn.label}</button>
					{/each}
				{/if}
			</div>
		{/if}

		<!-- Trash banner -->
		{#if isInTrash}
			<div class="trash-banner mx-3 mb-2 px-3 py-2 rounded bg-bg-surface border border-border-default text-xs text-text-muted flex items-center justify-between gap-2 shrink-0">
				<span>This note is in the trash.</span>
				<button
					class="restore-btn text-accent-notes hover:opacity-80 font-semibold shrink-0"
					onclick={() => notesUI.activeNoteId && restoreNote(notesUI.activeNoteId)}
				>Restore</button>
			</div>
		{/if}

		<!-- Editor body. The click target stays full width so clicking anywhere focuses
		     the editor; only the text column is capped to a readable measure. -->
		<div
			class="editor-scroll flex-1 overflow-y-auto min-h-0 px-3 py-2"
			onclick={closeMenus}
		>
			<div class="editor-measure" bind:this={editorEl}></div>
		</div>

		<!-- Status bar -->
		<div class="note-chrome flex items-center justify-between px-3 py-2 border-t border-border-subtle shrink-0">
			<div class="flex items-center gap-3">
				<span class="text-[10px] text-text-muted">{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
				<span class="text-[10px] text-text-muted hidden-narrow">{charCount} {charCount === 1 ? 'char' : 'chars'}</span>
				{#if wordCount > 0}
					<span class="text-[10px] text-text-muted hidden-narrow">{readTime} min read</span>
				{/if}
			</div>
			<div class="flex items-center gap-2">
				{#if activeNote.updatedAt}
					<span class="text-[10px] text-text-muted hidden-narrow">{relTime(activeNote.updatedAt)}</span>
				{/if}
				<div class="flex items-center gap-1">
					{#if notesUI.saveStatus === 'saving' || notesUI.saveStatus === 'offline'}
						<div class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div>
					{:else if notesUI.saveStatus === 'saved'}
						<div class="w-1.5 h-1.5 rounded-full bg-accent-notes opacity-60"></div>
					{:else}
						<div class="w-1.5 h-1.5 rounded-full bg-text-muted opacity-40"></div>
					{/if}
					<span class="text-[10px] text-text-muted">{notesUI.saveStatus === 'offline' ? 'waiting for connection' : notesUI.saveStatus}</span>
				</div>
			</div>
		</div>
	</div>

	<!-- Version history modal -->
	{#if showVersionHistory}
		<VersionHistoryModal onClose={() => showVersionHistory = false} />
	{/if}
{/if}

<style>
	/* TipTap editor content styles */
	/* Long measure is the classic readability failure in a full-width editor — the eye
	   loses the line on the return sweep. Cap the text, not the click target. */
	/* Title, tags, toolbar and body share one gutter so they start on the same line. */
	.note-shell { --note-gutter: max(0.75rem, calc((100% - 68ch) / 2)); }
	.note-shell :global(.note-chrome),
	.editor-scroll { padding-inline: var(--note-gutter); }
	.trash-banner { margin-inline: var(--note-gutter); }
	.editor-measure { width: 100%; }

	/* ── Zen mode ────────────────────────────────────────────────────────────
	   Everything that is not the writing surface steps back. */
	.note-shell.zen :global(.note-chrome) {
		display: none;
	}
	.note-shell.zen .editor-scroll {
		padding: 8vh 1.5rem 12vh;
	}
	.note-shell.zen .editor-measure {
		max-width: 62ch;
		margin: 0 auto;
	}
	.note-shell.zen {
		background: var(--color-bg-primary);
	}

	.zen-exit {
		position: absolute;
		top: 0.75rem;
		right: 0.9rem;
		z-index: 20;
		background: none;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-text-muted);
		font-family: inherit;
		font-size: 0.68rem;
		padding: 0.25rem 0.6rem;
		cursor: pointer;
		opacity: 0.55;
		transition: opacity 0.15s, color 0.15s;
	}
	.zen-exit:hover { opacity: 1; color: var(--color-text-primary); }

	:global(.tiptap-editor) {
		color: var(--color-text-primary);
		line-height: 1.75;
		font-size: 0.875rem;
		font-weight: 400;
		min-height: 100%;
		outline: none;
	}

	/* Placeholder */
	:global(.tiptap-editor p.is-editor-empty:first-child::before) {
		content: attr(data-placeholder);
		float: left;
		color: var(--color-text-muted);
		pointer-events: none;
		height: 0;
	}

	:global(.tiptap-editor h1) { font-size: 1.5rem; font-weight: 700; margin: 1.25rem 0 0.5rem; line-height: 1.3; }
	:global(.tiptap-editor h2) { font-size: 1.2rem; font-weight: 600; margin: 1rem 0 0.4rem; line-height: 1.3; }
	:global(.tiptap-editor h3) { font-size: 1rem;   font-weight: 600; margin: 0.75rem 0 0.3rem; }
	:global(.tiptap-editor p)  { margin: 0.25rem 0; }

	:global(.tiptap-editor ul) { padding-left: 1.4rem; list-style: disc; }
	:global(.tiptap-editor ol) { padding-left: 1.4rem; list-style: decimal; }
	:global(.tiptap-editor li) { margin: 0.15rem 0; }

	/* Task list */
	:global(.tiptap-editor ul[data-type="taskList"]) { list-style: none; padding-left: 0; }
	:global(.tiptap-editor ul[data-type="taskList"] > li) { display: flex; align-items: flex-start; gap: 0.5rem; margin: 0.2rem 0; }
	:global(.tiptap-editor ul[data-type="taskList"] > li > label) { display: flex; align-items: center; margin-top: 0.2rem; }
	:global(.tiptap-editor ul[data-type="taskList"] > li > label input[type="checkbox"]) {
		accent-color: var(--color-accent-notes);
		cursor: pointer;
		width: 13px;
		height: 13px;
	}
	:global(.tiptap-editor ul[data-type="taskList"] > li > div) { flex: 1; }
	:global(.tiptap-editor ul[data-type="taskList"] > li[data-checked="true"] > div) {
		text-decoration: line-through;
		opacity: 0.6;
	}

	:global(.tiptap-editor code), :global(.tiptap-editor pre) { font-family: var(--font-family-mono); }
	:global(.tiptap-editor code) { background: var(--color-bg-hover); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.85em; }
	:global(.tiptap-editor pre) { background: var(--color-bg-panel); padding: 1rem; border-radius: 5px; overflow-x: auto; margin: 0.75rem 0; border: 1px solid var(--color-border-subtle); }
	:global(.tiptap-editor pre code) { background: none; padding: 0; font-size: 0.82em; }
	:global(.tiptap-editor blockquote) { border-left: 3px solid var(--color-accent-notes); padding-left: 1rem; color: var(--color-text-secondary); margin: 0.75rem 0; }
	:global(.tiptap-editor a) { color: var(--color-accent-notes); text-decoration: underline; cursor: pointer; }
	:global(.tiptap-editor hr) { border: none; border-top: 1px solid var(--color-border-default); margin: 1rem 0; }
	:global(.tiptap-editor strong) { font-weight: 700; color: var(--color-text-primary); }
	:global(.tiptap-editor em) { font-style: italic; }
	:global(.tiptap-editor s) { text-decoration: line-through; }
	/* Wide tables scroll inside this wrapper, so the page and editor column stay put. */
	:global(.tiptap-editor .tableWrapper) { overflow-x: auto; margin: 0.75rem 0; }
	:global(.tiptap-editor table) { border-collapse: collapse; width: 100%; }
	:global(.tiptap-editor th), :global(.tiptap-editor td) { border: 1px solid var(--color-border-default); padding: 0.4rem 0.6rem; font-size: 0.82em; text-align: left; vertical-align: top; position: relative; }
	:global(.tiptap-editor th) { background: var(--color-bg-panel); font-weight: 600; }
	:global(.tiptap-editor th p), :global(.tiptap-editor td p) { margin: 0; }
	:global(.tiptap-editor .selectedCell) { background: color-mix(in srgb, var(--color-accent-notes) 18%, transparent); }

	/* Menu item */
	:global(.menu-item) {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		text-align: left;
		padding: 0.375rem 0.75rem;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		transition: background-color 0.1s;
		cursor: pointer;
	}
	:global(.menu-item:hover) { background-color: var(--color-bg-hover); }
	:global(.menu-item:focus-visible) { outline-offset: -2px; border-radius: 4px; }
	:global(.menu-item.menu-danger) { color: var(--color-danger); }
	:global(.menu-item.menu-accent) { color: var(--color-accent-notes); }

	@media (max-width: 768px) {
		.toolbar-btn { min-width: 32px; min-height: 36px; }
		.swatch { width: 32px; height: 32px; }
		.tag-input { min-height: 28px; }
		.tag-x { padding: 2px 6px; }
	}

	/* Phones: 40px targets without moving anything (see DESIGN.md). */
	@media (pointer: coarse) {
		.toolbar { row-gap: 4px; }
		.toolbar-btn { position: relative; min-width: 32px; min-height: 36px; }
		.toolbar-btn::after { content: ''; position: absolute; inset: -2px 0; }
		.head-btn, .swatch, .zen-exit, .restore-btn, .empty-cta { position: relative; }
		.head-btn::after { content: ''; position: absolute; inset: -10px 0 -5px; }
		.swatch { width: 32px; height: 32px; }
		.swatch::after { content: ''; position: absolute; inset: -4px -3px; }
		.zen-exit::after { content: ''; position: absolute; inset: -9px; }
		.restore-btn::after { content: ''; position: absolute; inset: -12px 0; }
		.empty-cta::after { content: ''; position: absolute; inset: -4px 0; }
		.title-input { padding-block: 10px 6px; margin-block: -10px -6px; }
		:global(.menu-item) { min-height: 40px; }
	}

	/* Toolbar narrow hiding */
	@container (max-width: 480px) {
		.hidden-narrow { display: none !important; }
	}
</style>
