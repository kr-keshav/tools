<script lang="ts">
	let title = $state('');
	let body = $state('');

	const wordCount = $derived(
		body.trim() === '' ? 0 : body.trim().split(/\s+/).length
	);
</script>

<div class="flex flex-col h-full p-6">
	<input
		class="w-full bg-transparent border-none outline-none font-mono text-xl font-semibold
		       text-text-primary placeholder-text-muted pb-3 border-b border-border-subtle mb-4"
		type="text"
		placeholder="Untitled note"
		bind:value={title}
	/>
	<textarea
		class="flex-1 w-full bg-transparent border-none outline-none resize-none
		       font-mono text-sm leading-7 text-text-primary placeholder-text-muted"
		placeholder="Start writing..."
		bind:value={body}
	></textarea>
	<div class="pt-3 border-t border-border-subtle">
		<span class="text-xs text-text-muted">
			{wordCount} {wordCount === 1 ? 'word' : 'words'}
		</span>
	</div>
</div>
