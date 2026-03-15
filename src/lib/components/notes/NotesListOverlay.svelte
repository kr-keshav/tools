<script lang="ts">
	import {
		notesUI,
		getVisibleNotes,
		getLiveNotes,
		getTrashedNotes,
		getFolders,
		getAllTags,
		createNote,
	} from '$lib/stores/notesState.svelte';
	import NotesListItem from './NotesListItem.svelte';

	let { onClose, onImportClick }: { onClose: () => void; onImportClick: () => void } = $props();

	const visibleNotes = $derived(getVisibleNotes());
	const liveNotes = $derived(getLiveNotes());
	const trashedNotes = $derived(getTrashedNotes());
	const folders = $derived(getFolders());
	const allTags = $derived(getAllTags());
</script>

<div class="absolute inset-0 z-40 flex">
	<!-- Sidebar panel -->
	<div class="w-64 max-w-[80%] flex flex-col h-full bg-bg-panel border-r border-border-default overflow-hidden">
		<div class="flex items-center justify-between px-3 py-2.5 border-b border-border-subtle shrink-0">
			<span class="text-[10px] uppercase tracking-widest text-text-muted font-semibold">Notes</span>
			<button
				class="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
				onclick={onClose}
				aria-label="Close"
			>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
					<path d="M2 2l8 8M10 2L2 10" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
				</svg>
			</button>
		</div>

		<div class="px-2 pt-2 shrink-0">
			<button
				class="w-full flex items-center justify-center gap-1.5 py-1.5 rounded text-xs text-accent-notes hover:bg-bg-hover transition-colors font-semibold border border-border-subtle"
				onclick={() => { createNote(); onClose(); }}
			>
				<svg width="11" height="11" viewBox="0 0 11 11" fill="none">
					<path d="M5.5 1v9M1 5.5h9" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
				</svg>
				New note
			</button>
		</div>

		<div class="px-2 pt-2 pb-1.5 shrink-0">
			<div class="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface border border-border-subtle">
				<svg width="10" height="10" viewBox="0 0 10 10" fill="none" class="text-text-muted shrink-0">
					<circle cx="4" cy="4" r="3" stroke="currentColor" stroke-width="1.2"/>
					<path d="M7 7l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
				</svg>
				<input
					value={notesUI.searchQuery}
					oninput={(e) => { notesUI.searchQuery = (e.currentTarget as HTMLInputElement).value; }}
					type="text"
					placeholder="Search..."
					class="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted outline-none min-w-0"
				/>
			</div>
		</div>

		<div class="px-2 shrink-0">
			<button
				class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors"
				class:bg-bg-hover={notesUI.selectedFolder === null && notesUI.selectedTag === null}
				class:text-text-primary={notesUI.selectedFolder === null && notesUI.selectedTag === null}
				class:text-text-muted={!(notesUI.selectedFolder === null && notesUI.selectedTag === null)}
				onclick={() => { notesUI.selectedFolder = null; notesUI.selectedTag = null; }}
			>All Notes <span class="ml-auto text-[10px] opacity-60">{liveNotes.length}</span></button>

			{#each folders as folder}
				<button
					class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors truncate"
					class:bg-bg-hover={notesUI.selectedFolder === folder}
					class:text-text-primary={notesUI.selectedFolder === folder}
					class:text-text-muted={notesUI.selectedFolder !== folder}
					onclick={() => { notesUI.selectedFolder = folder; notesUI.selectedTag = null; }}
				>{folder} <span class="ml-auto text-[10px] opacity-60">{liveNotes.filter(n => n.folder === folder).length}</span></button>
			{/each}

			<button
				class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors"
				class:bg-bg-hover={notesUI.selectedFolder === '__trash__'}
				class:text-text-primary={notesUI.selectedFolder === '__trash__'}
				class:text-text-muted={notesUI.selectedFolder !== '__trash__'}
				onclick={() => { notesUI.selectedFolder = '__trash__'; notesUI.selectedTag = null; }}
			>Trash <span class="ml-auto text-[10px] opacity-60">{trashedNotes.length}</span></button>
		</div>

		{#if allTags.length > 0}
			<div class="px-2 py-1.5 shrink-0 flex flex-wrap gap-1">
				{#each allTags as tag}
					<button
						class="px-2 py-0.5 rounded-full text-[10px] transition-colors"
						class:bg-accent-notes={notesUI.selectedTag === tag}
						class:text-bg-primary={notesUI.selectedTag === tag}
						class:bg-bg-surface={notesUI.selectedTag !== tag}
						class:text-text-muted={notesUI.selectedTag !== tag}
						onclick={() => { notesUI.selectedTag = notesUI.selectedTag === tag ? null : tag; }}
					>#{tag}</button>
				{/each}
			</div>
		{/if}

		<div class="border-t border-border-subtle mx-2 shrink-0"></div>

		<div class="flex-1 overflow-y-auto px-1 py-1">
			{#if visibleNotes.length === 0}
				<div class="flex items-center justify-center py-6 text-text-muted text-xs">
					{notesUI.searchQuery ? 'No results' : notesUI.selectedFolder === '__trash__' ? 'Trash is empty' : 'No notes yet'}
				</div>
			{:else}
				{#each visibleNotes as note (note.id)}
					<div onclick={onClose} role="presentation">
						<NotesListItem {note} />
					</div>
				{/each}
			{/if}
		</div>
	</div>

	<div
		class="flex-1 cursor-pointer"
		style="background: rgba(0,0,0,0.5);"
		onclick={onClose}
		role="presentation"
	></div>
</div>
