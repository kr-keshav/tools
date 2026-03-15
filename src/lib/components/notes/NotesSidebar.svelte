<script lang="ts">
	import {
		notesUI,
		notes,
		getVisibleNotes,
		getLiveNotes,
		getTrashedNotes,
		getFolders,
		getAllTags,
		createNote,
	} from '$lib/stores/notesState.svelte';
	import NotesListItem from './NotesListItem.svelte';

	let { onImportClick }: { onImportClick: () => void } = $props();

	let searchEl = $state<HTMLInputElement | null>(null);
	let showSort = $state(false);

	const visibleNotes = $derived(getVisibleNotes());
	const liveNotes = $derived(getLiveNotes());
	const trashedNotes = $derived(getTrashedNotes());
	const folders = $derived(getFolders());
	const allTags = $derived(getAllTags());

	$effect(() => {
		if (notesUI.focusSearchTick > 0) searchEl?.focus();
	});
</script>

<div class="notes-sidebar flex flex-col h-full border-r border-border-default bg-bg-panel min-w-0 overflow-hidden">
	<!-- Top actions -->
	<div class="flex items-center gap-1 px-2 pt-2 pb-1.5 shrink-0">
		<button
			class="flex-1 flex items-center justify-center gap-1.5 py-1.5 rounded text-xs text-accent-notes hover:bg-bg-hover transition-colors font-semibold"
			onclick={() => createNote()}
			title="New note (Ctrl+N)"
		>
			<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
				<path d="M6 1v10M1 6h10" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
			</svg>
			New
		</button>
		<!-- Sort -->
		<div class="relative">
			<button
				class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
				onclick={() => showSort = !showSort}
				title="Sort"
			>
				<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
					<path d="M1 3h11M3 6.5h7M5 10h3" stroke="currentColor" stroke-width="1.25" stroke-linecap="round"/>
				</svg>
			</button>
			{#if showSort}
				<!-- svelte-ignore a11y_no_static_element_interactions -->
				<div
					class="absolute right-0 top-8 z-50 bg-bg-surface border border-border-default rounded-lg shadow-lg py-1 w-40"
					onmouseleave={() => showSort = false}
				>
					{#each [['updatedAt','Last modified'],['createdAt','Date created'],['title','Title A–Z']] as [val, label]}
						<button
							class="w-full text-left px-3 py-1.5 text-xs transition-colors"
							class:text-accent-notes={notesUI.sortBy === val}
							class:text-text-secondary={notesUI.sortBy !== val}
							class:hover:bg-bg-hover={true}
							onclick={() => { notesUI.sortBy = val as typeof notesUI.sortBy; showSort = false; }}
						>{label}</button>
					{/each}
				</div>
			{/if}
		</div>
		<!-- Import -->
		<button
			class="p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
			onclick={onImportClick}
			title="Import .md or .txt file"
		>
			<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
				<path d="M6.5 1v8M3 6l3.5 3.5L10 6M2 11h9" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
	</div>

	<!-- Search -->
	<div class="px-2 pb-2 shrink-0">
		<div class="flex items-center gap-1.5 px-2 py-1.5 rounded bg-bg-surface border border-border-subtle">
			<svg width="11" height="11" viewBox="0 0 11 11" fill="none" class="text-text-muted shrink-0">
				<circle cx="4.5" cy="4.5" r="3.5" stroke="currentColor" stroke-width="1.2"/>
				<path d="M7.5 7.5l2 2" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
			</svg>
			<input
				bind:this={searchEl}
				value={notesUI.searchQuery}
				oninput={(e) => { notesUI.searchQuery = (e.currentTarget as HTMLInputElement).value; }}
				type="text"
				placeholder="Search notes..."
				class="flex-1 bg-transparent text-xs text-text-primary placeholder-text-muted outline-none min-w-0"
			/>
			{#if notesUI.searchQuery}
				<button class="text-text-muted hover:text-text-primary" onclick={() => { notesUI.searchQuery = ''; }}>
					<svg width="10" height="10" viewBox="0 0 10 10" fill="none">
						<path d="M1 1l8 8M9 1L1 9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
					</svg>
				</button>
			{/if}
		</div>
	</div>

	<!-- Folder nav -->
	<div class="px-2 pb-1 shrink-0">
		<button
			class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors"
			class:bg-bg-hover={notesUI.selectedFolder === null && notesUI.selectedTag === null}
			class:text-text-primary={notesUI.selectedFolder === null && notesUI.selectedTag === null}
			class:text-text-muted={!(notesUI.selectedFolder === null && notesUI.selectedTag === null)}
			onclick={() => { notesUI.selectedFolder = null; notesUI.selectedTag = null; }}
		>
			<svg width="11" height="11" viewBox="0 0 11 11" fill="none">
				<rect x="1" y="2.5" width="9" height="7" rx="1" stroke="currentColor" stroke-width="1.1"/>
				<path d="M1 4.5h9M1 4.5V3a1 1 0 011-1h2.5l1 1H9" stroke="currentColor" stroke-width="1.1"/>
			</svg>
			<span>All Notes</span>
			<span class="ml-auto text-[10px] opacity-60">{liveNotes.length}</span>
		</button>

		{#each folders as folder}
			<button
				class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors"
				class:bg-bg-hover={notesUI.selectedFolder === folder && notesUI.selectedTag === null}
				class:text-text-primary={notesUI.selectedFolder === folder && notesUI.selectedTag === null}
				class:text-text-muted={!(notesUI.selectedFolder === folder && notesUI.selectedTag === null)}
				onclick={() => { notesUI.selectedFolder = folder; notesUI.selectedTag = null; }}
			>
				<svg width="11" height="11" viewBox="0 0 11 11" fill="none">
					<path d="M1 4h9v4.5a1 1 0 01-1 1H2a1 1 0 01-1-1V4zM1 4V3a1 1 0 011-1h2.5l1 1H9" stroke="currentColor" stroke-width="1.1"/>
				</svg>
				<span class="truncate">{folder}</span>
				<span class="ml-auto text-[10px] opacity-60">{liveNotes.filter(n => n.folder === folder).length}</span>
			</button>
		{/each}

		<button
			class="w-full flex items-center gap-2 px-2 py-1.5 rounded text-xs transition-colors"
			class:bg-bg-hover={notesUI.selectedFolder === '__trash__'}
			class:text-text-primary={notesUI.selectedFolder === '__trash__'}
			class:text-text-muted={notesUI.selectedFolder !== '__trash__'}
			onclick={() => { notesUI.selectedFolder = '__trash__'; notesUI.selectedTag = null; }}
		>
			<svg width="11" height="11" viewBox="0 0 11 11" fill="none">
				<path d="M1.5 3h8M4 3V1.5h3V3M2.5 3l.5 7h5l.5-7" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
			</svg>
			<span>Trash</span>
			<span class="ml-auto text-[10px] opacity-60">{trashedNotes.length}</span>
		</button>
	</div>

	<!-- Tags -->
	{#if allTags.length > 0}
		<div class="px-2 pb-2 shrink-0">
			<div class="text-[10px] uppercase tracking-widest text-text-muted px-1 mb-1">Tags</div>
			<div class="flex flex-wrap gap-1">
				{#each allTags as tag}
					<button
						class="px-2 py-0.5 rounded-full text-[10px] transition-colors"
						class:bg-accent-notes={notesUI.selectedTag === tag}
						class:text-bg-primary={notesUI.selectedTag === tag}
						class:bg-bg-surface={notesUI.selectedTag !== tag}
						class:text-text-muted={notesUI.selectedTag !== tag}
						class:hover:bg-bg-hover={notesUI.selectedTag !== tag}
						onclick={() => { notesUI.selectedTag = notesUI.selectedTag === tag ? null : tag; }}
					>#{tag}</button>
				{/each}
			</div>
		</div>
	{/if}

	<div class="border-t border-border-subtle mx-2 shrink-0"></div>

	<div class="px-3 py-1.5 shrink-0">
		<span class="text-[10px] text-text-muted">
			{visibleNotes.length} {visibleNotes.length === 1 ? 'note' : 'notes'}
			{#if notesUI.searchQuery} · "{notesUI.searchQuery}"{/if}
		</span>
	</div>

	<!-- Notes list -->
	<div class="flex-1 overflow-y-auto px-1 pb-2">
		{#if visibleNotes.length === 0}
			<div class="flex flex-col items-center justify-center py-8 gap-2 text-text-muted">
				<svg width="28" height="28" viewBox="0 0 28 28" fill="none" class="opacity-30">
					<rect x="4" y="4" width="20" height="20" rx="2" stroke="currentColor" stroke-width="1.5"/>
					<path d="M8 10h12M8 14h8M8 18h6" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
				<span class="text-xs">
					{#if notesUI.searchQuery}No results{:else if notesUI.selectedFolder === '__trash__'}Trash is empty{:else}No notes yet{/if}
				</span>
			</div>
		{:else}
			{#each visibleNotes as note (note.id)}
				<NotesListItem {note} />
			{/each}
		{/if}
	</div>
</div>
