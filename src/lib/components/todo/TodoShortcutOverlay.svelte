<script lang="ts">
	let { onclose }: { onclose: () => void } = $props();

	const shortcuts = [
		{ key: 'N', action: 'New task' },
		{ key: 'Space', action: 'Toggle complete (focused task)' },
		{ key: 'E', action: 'Expand / collapse focused task' },
		{ key: 'P', action: 'Cycle priority (focused task)' },
		{ key: 'Alt + ↑ / ↓', action: 'Reorder focused task' },
		{ key: 'Shift + Delete', action: 'Delete focused task' },
		{ key: '/', action: 'Focus filter / search' },
		{ key: 'Ctrl + Z', action: 'Undo last action' },
		{ key: '?', action: 'Toggle this help' },
		{ key: 'Esc', action: 'Close overlay / clear filter' },
	];

	const filterHints = [
		{ example: 'buy milk', desc: 'Search by title' },
		{ example: '#work', desc: 'Filter by tag' },
		{ example: 'p:high', desc: 'Filter by priority (low / med / high)' },
		{ example: 'due:today', desc: 'Tasks due today' },
		{ example: 'due:overdue', desc: 'Overdue tasks' },
	];
</script>

<!-- Backdrop -->
<div
	class="absolute inset-0 bg-bg-primary/80 backdrop-blur-sm z-50 flex items-center justify-center"
	onclick={onclose}
	onkeydown={(e) => e.key === 'Escape' && onclose()}
	role="dialog"
	aria-modal="true"
	aria-label="Keyboard shortcuts"
	tabindex="-1"
>
	<div
		class="bg-bg-panel border border-border-default rounded-md p-5 max-w-sm w-full mx-4 shadow-xl"
		onclick={(e) => e.stopPropagation()}
		onkeydown={(e) => e.stopPropagation()}
		role="none"
	>
		<div class="flex items-center justify-between mb-4">
			<span class="text-xs font-mono text-text-secondary uppercase tracking-widest">Shortcuts</span>
			<button
				class="text-text-muted hover:text-text-primary text-xs transition-colors"
				onclick={onclose}
				aria-label="Close shortcuts"
			>✕</button>
		</div>

		<table class="w-full mb-4">
			<tbody>
				{#each shortcuts as { key, action }}
					<tr class="border-b border-border-subtle last:border-0">
						<td class="py-1.5 pr-4 text-right">
							<kbd class="text-[0.65rem] font-mono text-text-secondary bg-bg-surface px-1.5 py-0.5 rounded border border-border-default whitespace-nowrap">
								{key}
							</kbd>
						</td>
						<td class="py-1.5 text-[0.72rem] font-mono text-text-muted">
							{action}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<div class="border-t border-border-subtle pt-3">
			<p class="text-[0.62rem] uppercase tracking-widest text-text-muted/50 mb-2">Filter syntax</p>
			{#each filterHints as { example, desc }}
				<div class="flex items-center gap-3 py-0.5">
					<code class="text-[0.65rem] font-mono text-accent-todo w-24 shrink-0">{example}</code>
					<span class="text-[0.7rem] font-mono text-text-muted">{desc}</span>
				</div>
			{/each}
		</div>

		<p class="text-[0.62rem] font-mono text-text-muted/30 mt-4 text-center">
			Also: type "buy milk tomorrow" to auto-set due date
		</p>
	</div>
</div>
