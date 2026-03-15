<script lang="ts">
	import { onMount } from 'svelte';
	import { browser } from '$app/environment';
	import { page } from '$app/state';
	import { Editor } from '@tiptap/core';
	import StarterKit from '@tiptap/starter-kit';
	import { Markdown } from 'tiptap-markdown';
	import Placeholder from '@tiptap/extension-placeholder';
	import TaskList from '@tiptap/extension-task-list';
	import TaskItem from '@tiptap/extension-task-item';
	import Link from '@tiptap/extension-link';
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
	} from '$lib/stores/notesState.svelte';
	import { closeLeft, closeRight } from '$lib/stores/panelState.svelte';
	import VersionHistoryModal from './VersionHistoryModal.svelte';

	const activeNote = $derived(getActiveNote());
	const folders = $derived(getFolders());

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

	const isCenter = $derived(page.url.pathname === '/notes');
	const isInTrash = $derived(!!activeNote?.deletedAt);
	const colorConfig = $derived(NOTE_COLORS.find(c => c.key === activeNote?.color) ?? null);

	const wordCount = $derived.by(() => {
		const body = activeNote?.body ?? '';
		return body.trim() === '' ? 0 : body.trim().split(/\s+/).length;
	});
	const charCount = $derived((activeNote?.body ?? '').length);
	const readTime = $derived(Math.max(1, Math.ceil(wordCount / 200)));

	// ── Editor lifecycle ───────────────────────────────────────────────────

	let prevNoteId: string | null = null;

	onMount(() => {
		if (!browser || !editorEl) return;
		const initial = getActiveNote();
		prevNoteId = notesUI.activeNoteId;

		editor = new Editor({
			element: editorEl,
			extensions: [
				StarterKit,
				Markdown.configure({ html: false, transformPastedText: true, transformCopiedText: true }),
				Placeholder.configure({ placeholder: 'Start writing…' }),
				TaskList,
				TaskItem.configure({ nested: true }),
				Link.configure({ openOnClick: false }),
			],
			content: initial?.body ?? '',
			editable: !initial?.deletedAt,
			editorProps: {
				attributes: { class: 'tiptap-editor focus:outline-none' },
			},
			onTransaction: () => { editorTick++; },
			onUpdate: ({ editor: e }) => {
				if (updatingContent) return;
				updateActiveNoteField('body', e.storage.markdown.getMarkdown());
			},
		});

		return () => { editor?.destroy(); editor = null; };
	});

	// Update editor when active note changes
	$effect(() => {
		const id = notesUI.activeNoteId;
		void getActiveNote(); // track dependency
		if (!editor || id === prevNoteId) return;
		prevNoteId = id;
		const note = getActiveNote();
		updatingContent = true;
		editor.commands.setContent(note?.body ?? '');
		editor.setEditable(!note?.deletedAt);
		updatingContent = false;
		tagInput = '';
		showMoreMenu = false;
		showColorPicker = false;
		showFolderInput = false;
		if (!note?.title && !note?.body) setTimeout(() => titleEl?.focus(), 50);
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

	function handleToolbar(id: string) {
		if (!editor) return;
		const c = editor.chain().focus();
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
				if (url === '') { c.unsetLink().run(); break; }
				c.setLink({ href: url }).run();
				break;
			}
			case 'hr': c.setHorizontalRule().run(); break;
		}
	}

	// ── Tags ───────────────────────────────────────────────────────────────

	function handleTagKeydown(e: KeyboardEvent) {
		if ((e.key === 'Enter' || e.key === ',') && tagInput.trim()) {
			e.preventDefault();
			if (notesUI.activeNoteId) addTag(notesUI.activeNoteId, tagInput.trim());
			tagInput = '';
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
		folderInputVal = '';
	}

	// ── Copy ───────────────────────────────────────────────────────────────

	async function handleCopy() {
		if (!activeNote) return;
		await navigator.clipboard.writeText(`${activeNote.title}\n\n${activeNote.body}`);
		copyLabel = 'Copied!';
		setTimeout(() => copyLabel = 'Copy', 2000);
		showMoreMenu = false;
	}

	// ── Zen mode ───────────────────────────────────────────────────────────

	function handleZen() {
		closeLeft();
		closeRight();
		showMoreMenu = false;
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

{#if !activeNote}
	<!-- Empty state -->
	<div class="flex flex-col items-center justify-center h-full gap-3 text-text-muted select-none">
		<svg width="40" height="40" viewBox="0 0 40 40" fill="none" class="opacity-20">
			<rect x="6" y="6" width="28" height="28" rx="3" stroke="currentColor" stroke-width="1.5"/>
			<path d="M12 14h16M12 19h12M12 24h8" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
		</svg>
		<p class="text-sm">Select a note or create one</p>
		<button
			class="px-4 py-2 rounded text-xs bg-accent-notes text-bg-primary font-semibold hover:opacity-90 transition-opacity"
			onclick={() => createNote()}
		>New note</button>
	</div>
{:else}
	<div
		class="flex flex-col h-full relative"
		style={colorConfig ? `background-color: ${colorConfig.bg};` : ''}
	>
		<!-- Header -->
		<div class="flex items-center gap-1 px-3 pt-3 pb-1.5 shrink-0">
			<!-- Title -->
			<input
				bind:this={titleEl}
				type="text"
				placeholder="Untitled"
				value={activeNote.title}
				oninput={handleTitleInput}
				onkeydown={handleTitleKeydown}
				disabled={isInTrash}
				class="flex-1 bg-transparent border-none outline-none font-mono text-base font-semibold text-text-primary placeholder-text-muted min-w-0 disabled:opacity-60"
			/>

			<!-- Pin -->
			<button
				class="p-1.5 rounded transition-colors shrink-0"
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
			<div class="relative shrink-0">
				<button
					class="p-1.5 rounded hover:bg-bg-hover transition-colors"
					class:text-text-muted={!activeNote.color}
					style={colorConfig ? `color: ${colorConfig.accent};` : ''}
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
							class="w-5 h-5 rounded-full border border-border-default flex items-center justify-center hover:bg-bg-hover transition-colors"
							onclick={() => { setNoteColor(activeNote!.id, null); showColorPicker = false; }}
							title="No color"
						>
							<svg width="8" height="8" viewBox="0 0 8 8" fill="none">
								<path d="M1 1l6 6M7 1L1 7" stroke="#888" stroke-width="1.2" stroke-linecap="round"/>
							</svg>
						</button>
						{#each NOTE_COLORS as c}
							<button
								class="w-5 h-5 rounded-full transition-transform hover:scale-110"
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
			<div class="relative shrink-0">
				<button
					class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
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
						class="absolute right-0 top-8 z-50 bg-bg-surface border border-border-default rounded-lg shadow-lg py-1 w-48"
						onmouseleave={() => { if (!showTemplates && !showFolderInput) showMoreMenu = false; }}
					>
						{#if isInTrash}
							<button class="menu-item text-accent-notes" onclick={() => { restoreNote(activeNote!.id); showMoreMenu = false; }}>
								↩ Restore note
							</button>
							<button class="menu-item text-red-400" onclick={() => { permanentlyDeleteNote(activeNote!.id); showMoreMenu = false; }}>
								Delete permanently
							</button>
							<div class="border-t border-border-subtle my-1"></div>
							<button class="menu-item text-red-400" onclick={() => { emptyTrash(); showMoreMenu = false; }}>
								Empty trash
							</button>
						{:else}
							<!-- Templates -->
							<div class="relative">
								<button class="menu-item" onclick={() => showTemplates = !showTemplates}>
									<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="1" y="1" width="10" height="10" rx="1.5" stroke="currentColor" stroke-width="1.1"/><path d="M3 4h6M3 6h6M3 8h4" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
									Templates
									<svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="ml-auto"><path d="M4 2l4 3-4 3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
								</button>
								{#if showTemplates}
									<div class="absolute left-full top-0 ml-1 bg-bg-surface border border-border-default rounded-lg shadow-lg py-1 w-44">
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
												autofocus
											/>
											<div class="flex gap-1 mt-1.5">
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
														class="px-1.5 py-0.5 text-[10px] rounded bg-bg-hover text-red-400 transition-colors"
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

							<button class="menu-item text-red-400 hover:bg-red-900/20" onclick={() => { if (notesUI.activeNoteId) deleteNote(notesUI.activeNoteId); showMoreMenu = false; }}>
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
			<div class="px-3 pb-1 shrink-0">
				<span class="text-[10px] text-text-muted px-1.5 py-0.5 rounded bg-bg-surface border border-border-subtle">
					📁 {activeNote.folder}
				</span>
			</div>
		{/if}

		<!-- Tags row -->
		<div class="flex items-center flex-wrap gap-1 px-3 pb-1.5 shrink-0 min-h-7">
			{#each activeNote.tags as tag}
				<span class="flex items-center gap-0.5 px-2 py-0.5 rounded-full bg-bg-surface border border-border-subtle text-[10px] text-text-muted group">
					#{tag}
					{#if !isInTrash}
						<button
							class="opacity-0 group-hover:opacity-100 transition-opacity ml-0.5 hover:text-red-400"
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
					type="text"
					placeholder={activeNote.tags.length === 0 ? '+ tag' : '+ tag'}
					class="bg-transparent text-[10px] text-text-muted placeholder-text-muted outline-none w-16 min-w-[48px]"
				/>
			{/if}
		</div>

		<!-- Toolbar (hidden in trash) -->
		{#if !isInTrash}
			<div class="toolbar flex items-center gap-0.5 px-2 pb-1.5 shrink-0 border-b border-border-subtle flex-wrap">
				{#each [
					{ id: 'bold',      label: 'B',   title: 'Bold (Ctrl+B)',    style: 'font-bold',         wide: false },
					{ id: 'italic',    label: 'I',   title: 'Italic (Ctrl+I)',  style: 'italic',            wide: false },
					{ id: 'strike',    label: 'S',   title: 'Strikethrough',    style: 'line-through',      wide: true  },
					{ id: 'sep1',      label: '',    title: '',                 style: '',                  wide: false },
					{ id: 'h1',        label: 'H1',  title: 'Heading 1',        style: '',                  wide: false },
					{ id: 'h2',        label: 'H2',  title: 'Heading 2',        style: '',                  wide: false },
					{ id: 'h3',        label: 'H3',  title: 'Heading 3',        style: '',                  wide: true  },
					{ id: 'sep2',      label: '',    title: '',                 style: '',                  wide: false },
					{ id: 'code',      label: '`',   title: 'Inline code',      style: '',                  wide: false },
					{ id: 'codeblock', label: '{}',  title: 'Code block',       style: '',                  wide: true  },
					{ id: 'quote',     label: '"',   title: 'Blockquote',       style: '',                  wide: true  },
					{ id: 'sep3',      label: '',    title: '',                 style: '',                  wide: false },
					{ id: 'ul',        label: '•',   title: 'Bullet list',      style: '',                  wide: false },
					{ id: 'ol',        label: '1.',  title: 'Numbered list',    style: '',                  wide: true  },
					{ id: 'check',     label: '☑',   title: 'Checklist',        style: '',                  wide: false },
					{ id: 'sep4',      label: '',    title: '',                 style: '',                  wide: false },
					{ id: 'link',      label: '⊞',   title: 'Link',             style: '',                  wide: true  },
					{ id: 'hr',        label: '—',   title: 'Horizontal rule',  style: '',                  wide: true  },
				] as btn}
					{#if btn.id.startsWith('sep')}
						<div class="w-px h-4 bg-border-subtle mx-0.5 toolbar-sep" class:wide-only={btn.wide}></div>
					{:else}
						{@const active = isActive(
							btn.id === 'h1' ? 'heading' : btn.id === 'h2' ? 'heading' : btn.id === 'h3' ? 'heading' :
							btn.id === 'codeblock' ? 'codeBlock' : btn.id === 'check' ? 'taskList' : btn.id,
							btn.id === 'h1' ? { level: 1 } : btn.id === 'h2' ? { level: 2 } : btn.id === 'h3' ? { level: 3 } : undefined
						)}
						<button
							class="toolbar-btn px-1.5 py-1 rounded text-xs transition-colors font-mono leading-none {btn.style}"
							class:wide-only={btn.wide}
							class:bg-bg-hover={active}
							class:text-text-primary={active}
							class:text-text-muted={!active}
							class:hover:text-text-primary={!active}
							class:hover:bg-bg-hover={!active}
							title={btn.title}
							onclick={() => handleToolbar(btn.id)}
						>{btn.label}</button>
					{/if}
				{/each}
			</div>
		{/if}

		<!-- Trash banner -->
		{#if isInTrash}
			<div class="mx-3 mb-2 px-3 py-2 rounded bg-bg-surface border border-border-default text-xs text-text-muted flex items-center justify-between gap-2 shrink-0">
				<span>This note is in the trash.</span>
				<button
					class="text-accent-notes hover:opacity-80 font-semibold shrink-0"
					onclick={() => notesUI.activeNoteId && restoreNote(notesUI.activeNoteId)}
				>Restore</button>
			</div>
		{/if}

		<!-- Editor body -->
		<div
			class="flex-1 overflow-y-auto min-h-0 px-3 py-2"
			onclick={() => { showMoreMenu = false; showColorPicker = false; }}
		>
			<div bind:this={editorEl}></div>
		</div>

		<!-- Status bar -->
		<div class="flex items-center justify-between px-3 py-2 border-t border-border-subtle shrink-0">
			<div class="flex items-center gap-3">
				<span class="text-[10px] text-text-muted">{wordCount} {wordCount === 1 ? 'word' : 'words'}</span>
				<span class="text-[10px] text-text-muted hidden-narrow">{charCount} chars</span>
				<span class="text-[10px] text-text-muted hidden-narrow">{readTime} min read</span>
			</div>
			<div class="flex items-center gap-2">
				{#if activeNote.updatedAt}
					<span class="text-[10px] text-text-muted hidden-narrow">{relTime(activeNote.updatedAt)}</span>
				{/if}
				<div class="flex items-center gap-1">
					{#if notesUI.saveStatus === 'saving'}
						<div class="w-1.5 h-1.5 rounded-full bg-amber-400 animate-pulse"></div>
					{:else if notesUI.saveStatus === 'saved'}
						<div class="w-1.5 h-1.5 rounded-full bg-accent-notes opacity-60"></div>
					{:else}
						<div class="w-1.5 h-1.5 rounded-full bg-text-muted opacity-40"></div>
					{/if}
					<span class="text-[10px] text-text-muted">{notesUI.saveStatus}</span>
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
	:global(.tiptap-editor) {
		color: var(--color-text-primary);
		line-height: 1.75;
		font-size: 0.875rem;
		font-family: var(--font-family-mono);
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
	:global(.tiptap-editor li[data-type="taskItem"]) { display: flex; align-items: flex-start; gap: 0.5rem; margin: 0.2rem 0; }
	:global(.tiptap-editor li[data-type="taskItem"] > label) { display: flex; align-items: center; margin-top: 0.2rem; }
	:global(.tiptap-editor li[data-type="taskItem"] > label input[type="checkbox"]) {
		accent-color: var(--color-accent-notes);
		cursor: pointer;
		width: 13px;
		height: 13px;
	}
	:global(.tiptap-editor li[data-type="taskItem"] > div) { flex: 1; }
	:global(.tiptap-editor li[data-type="taskItem"][data-checked="true"] > div) {
		text-decoration: line-through;
		opacity: 0.6;
	}

	:global(.tiptap-editor code) { background: rgba(255,255,255,0.08); padding: 0.1em 0.35em; border-radius: 3px; font-size: 0.85em; }
	:global(.tiptap-editor pre) { background: rgba(255,255,255,0.04); padding: 1rem; border-radius: 5px; overflow-x: auto; margin: 0.75rem 0; border: 1px solid var(--color-border-subtle); }
	:global(.tiptap-editor pre code) { background: none; padding: 0; font-size: 0.82em; }
	:global(.tiptap-editor blockquote) { border-left: 3px solid var(--color-accent-notes); padding-left: 1rem; color: var(--color-text-secondary); margin: 0.75rem 0; }
	:global(.tiptap-editor a) { color: var(--color-accent-notes); text-decoration: underline; cursor: pointer; }
	:global(.tiptap-editor hr) { border: none; border-top: 1px solid var(--color-border-default); margin: 1rem 0; }
	:global(.tiptap-editor strong) { font-weight: 700; color: var(--color-text-primary); }
	:global(.tiptap-editor em) { font-style: italic; }
	:global(.tiptap-editor s) { text-decoration: line-through; }
	:global(.tiptap-editor table) { border-collapse: collapse; width: 100%; margin: 0.75rem 0; }
	:global(.tiptap-editor th), :global(.tiptap-editor td) { border: 1px solid var(--color-border-default); padding: 0.4rem 0.6rem; font-size: 0.82em; }
	:global(.tiptap-editor th) { background: rgba(255,255,255,0.04); font-weight: 600; }

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

	/* Toolbar narrow hiding */
	@container (max-width: 480px) {
		.wide-only { display: none !important; }
		.hidden-narrow { display: none !important; }
	}
</style>
