<script lang="ts">
	import {
		notesUI,
		getActiveNote,
		getVisibleNotes,
		createNote,
		deleteNote,
		undoDelete,
		togglePin,
		importNoteFromText,
		selectNote,
	} from '$lib/stores/notesState.svelte';

	const activeNote = $derived(getActiveNote());
	const visibleNotes = $derived(getVisibleNotes());
	import NotesSidebar from '$lib/components/notes/NotesSidebar.svelte';
	import NotesEditor from '$lib/components/notes/NotesEditor.svelte';
	import NotesListOverlay from '$lib/components/notes/NotesListOverlay.svelte';

	let overlayOpen = $state(false);
	let fileInputEl = $state<HTMLInputElement | null>(null);

	function handleImportClick() {
		fileInputEl?.click();
	}

	async function handleFileImport(e: Event) {
		const file = (e.target as HTMLInputElement).files?.[0];
		if (!file) return;
		const text = await file.text();
		const title = file.name.replace(/\.(md|txt)$/i, '');
		await importNoteFromText(title, text);
		if (fileInputEl) fileInputEl.value = '';
	}

	function handleKeydown(e: KeyboardEvent) {
		const ctrl = e.ctrlKey || e.metaKey;
		if (!ctrl) return;

		// New note — works from anywhere
		if (!e.shiftKey && e.key === 'n') {
			e.preventDefault();
			createNote();
			overlayOpen = false;
			return;
		}

		// Focus search — only when not in an editable field
		if (!e.shiftKey && e.key === 'f') {
			const target = e.target as HTMLElement;
			if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable) return;
			e.preventDefault();
			overlayOpen = false;
			notesUI.focusSearchTick++;
			return;
		}

		// Only apply navigation shortcuts when not focused in an editable field
		const target = e.target as HTMLElement;
		if (target.tagName === 'TEXTAREA' || target.tagName === 'INPUT' || target.isContentEditable) return;

		// Prev / next note
		if (e.key === '[') {
			e.preventDefault();
			const idx = visibleNotes.findIndex(n => n.id === notesUI.activeNoteId);
			if (idx > 0) selectNote(visibleNotes[idx - 1].id);
		}
		if (e.key === ']') {
			e.preventDefault();
			const idx = visibleNotes.findIndex(n => n.id === notesUI.activeNoteId);
			if (idx < visibleNotes.length - 1) selectNote(visibleNotes[idx + 1].id);
		}

		// Delete active note
		if (e.key === 'd') {
			e.preventDefault();
			if (notesUI.activeNoteId) deleteNote(notesUI.activeNoteId);
		}

		// Pin active note
		if (e.key === 'p' && !e.shiftKey) {
			e.preventDefault();
			if (notesUI.activeNoteId) togglePin(notesUI.activeNoteId);
		}
	}
</script>

<svelte:window onkeydown={handleKeydown} />

<!-- Hidden file input for import -->
<input
	bind:this={fileInputEl}
	type="file"
	accept=".md,.txt"
	class="hidden"
	onchange={handleFileImport}
/>

<div class="notes-wrap">
	<!-- Sidebar — wide mode only (CSS) -->
	<div class="notes-sidebar">
		<NotesSidebar onImportClick={handleImportClick} />
	</div>

	<!-- Main editor area -->
	<div class="notes-main">
		{#if notesUI.isLoading}
			<div class="flex items-center justify-center h-full text-text-muted text-xs">
				Loading...
			</div>
		{:else}
			<!-- Narrow mode header (overlay toggle + note title) -->
			<div class="narrow-header flex items-center gap-2 px-3 py-2 border-b border-border-subtle shrink-0">
				<button
					class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors shrink-0"
					onclick={() => overlayOpen = true}
					title="Notes list"
				>
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
						<path d="M1 3h12M1 7h12M1 11h12" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/>
					</svg>
				</button>
				<span class="text-xs text-text-secondary truncate">
					{activeNote?.title || 'Untitled'}
				</span>
			</div>

			<div class="flex-1 overflow-hidden relative">
				<NotesEditor />
			</div>
		{/if}
	</div>

	<!-- Narrow mode list overlay -->
	{#if overlayOpen}
		<NotesListOverlay
			onClose={() => overlayOpen = false}
			onImportClick={() => { overlayOpen = false; handleImportClick(); }}
		/>
	{/if}

	<!-- Undo delete toast -->
	{#if notesUI.undoNote}
		<div class="undo-toast">
			<span class="text-xs text-text-secondary">
				"<span class="text-text-primary">{notesUI.undoNote.title || 'Untitled'}</span>" moved to trash
			</span>
			<button
				class="text-xs font-semibold text-accent-notes hover:opacity-80 transition-opacity ml-3 shrink-0"
				onclick={undoDelete}
			>Undo</button>
		</div>
	{/if}
</div>

<style>
	.notes-wrap {
		container-type: inline-size;
		display: flex;
		height: 100%;
		overflow: hidden;
		position: relative;
	}

	/* Sidebar: hidden in narrow, shown in wide */
	.notes-sidebar {
		display: none;
		width: 220px;
		min-width: 220px;
		flex-shrink: 0;
		overflow: hidden;
	}

	/* Narrow header: shown in narrow, hidden in wide */
	.narrow-header {
		display: flex;
	}

	/* Main area */
	.notes-main {
		flex: 1;
		display: flex;
		flex-direction: column;
		overflow: hidden;
		min-width: 0;
	}

	/* Wide layout: sidebar visible, narrow header hidden */
	@container (min-width: 580px) {
		.notes-sidebar {
			display: flex;
			flex-direction: column;
		}
		.narrow-header {
			display: none;
		}
	}

	/* Undo toast */
	.undo-toast {
		position: absolute;
		bottom: 3rem;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		padding: 0.5rem 0.875rem;
		box-shadow: 0 4px 20px rgba(0, 0, 0, 0.4);
		z-index: 60;
		white-space: nowrap;
		animation: slideUp 0.2s ease;
	}

	@keyframes slideUp {
		from { opacity: 0; transform: translateX(-50%) translateY(8px); }
		to   { opacity: 1; transform: translateX(-50%) translateY(0); }
	}
</style>
