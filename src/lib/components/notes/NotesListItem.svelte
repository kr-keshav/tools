<script lang="ts">
	import {
		type Note,
		notesUI,
		selectNote,
		relativeTime,
		stripMarkdown,
		NOTE_COLORS,
	} from '$lib/stores/notesState.svelte';

	let { note }: { note: Note } = $props();

	const isActive = $derived(note.id === notesUI.activeNoteId);
	const preview = $derived(stripMarkdown(note.body).slice(0, 80));
	const colorAccent = $derived(NOTE_COLORS.find(c => c.key === note.color)?.accent ?? null);
</script>

<button
	class="w-full text-left px-3 py-2.5 rounded transition-colors duration-100 cursor-pointer overflow-hidden"
	class:bg-bg-hover={isActive}
	class:hover:bg-bg-hover={!isActive}
	style={colorAccent ? `border-left: 2px solid ${colorAccent}; padding-left: 10px;` : 'border-left: 2px solid transparent;'}
	onclick={() => selectNote(note.id)}
>
	<div class="flex items-start justify-between gap-1 mb-0.5">
		<span
			class="text-xs font-semibold truncate leading-5"
			class:text-text-primary={isActive}
			class:text-text-secondary={!isActive}
		>
			{note.title || 'Untitled'}
		</span>
		<div class="flex items-center gap-1 shrink-0">
			{#if note.pinned}
				<svg width="9" height="9" viewBox="0 0 12 12" fill="currentColor" class="text-accent-notes opacity-70">
					<path d="M9.5 1.5L7 4l1 3-3 3-1-2-2 2-1-1 2-2-2-1 3-3 3 1z"/>
				</svg>
			{/if}
			<span class="text-[10px] text-text-muted shrink-0">{relativeTime(note.updatedAt)}</span>
		</div>
	</div>
	{#if preview}
		<p class="text-[11px] text-text-muted leading-4 line-clamp-2">{preview}</p>
	{/if}
	{#if note.tags.length > 0}
		<div class="flex gap-1 mt-1.5 flex-wrap">
			{#each note.tags.slice(0, 3) as tag}
				<span class="text-[10px] px-1.5 py-0.5 rounded-full bg-bg-surface text-text-muted">#{tag}</span>
			{/each}
			{#if note.tags.length > 3}
				<span class="text-[10px] text-text-muted">+{note.tags.length - 3}</span>
			{/if}
		</div>
	{/if}
</button>
