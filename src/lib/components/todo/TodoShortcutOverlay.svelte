<script lang="ts">
	import { onMount } from 'svelte';

	let { onclose }: { onclose: () => void } = $props();

	let closeBtn = $state<HTMLButtonElement | null>(null);
	let dialogEl = $state<HTMLElement | null>(null);

	// Move focus in on open and hand it back on close; Tab stays inside.
	onMount(() => {
		const previous = document.activeElement as HTMLElement | null;
		dialogEl?.focus({ preventScroll: true });
		return () => previous?.focus?.({ preventScroll: true });
	});

	function trapTab(e: KeyboardEvent) {
		if (e.key !== 'Tab') return;
		e.preventDefault();
		closeBtn?.focus();
	}

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
		{ key: 'Esc', action: 'Cancel edit / close overlay / clear filter' },
	];

	const filterHints = [
		{ example: 'buy milk', desc: 'Search by title' },
		{ example: '#work', desc: 'Filter by tag' },
		{ example: 'p:high', desc: 'Filter by priority (low / med / high)' },
		{ example: 'due:today', desc: 'Tasks due today' },
		{ example: 'due:overdue', desc: 'Overdue tasks' },
	];

	const addHints = [
		{ example: 'tomorrow', desc: 'Due date, at the end or after by / due / on' },
		{ example: '#work', desc: 'Add a tag' },
		{ example: 'p:high', desc: 'Set priority (low / med / high)' },
		{ example: '!p1', desc: 'Set priority (!p1 high to !p3 low)' },
	];
</script>

<!-- Backdrop -->
<div
	bind:this={dialogEl}
	class="absolute inset-0 bg-bg-primary/80 backdrop-blur-sm z-50 flex items-center justify-center outline-none"
	onclick={onclose}
	onkeydown={trapTab}
	role="dialog"
	aria-modal="true"
	aria-label="Keyboard shortcuts"
	tabindex="-1"
>
	<div
		class="bg-bg-panel border border-border-default rounded-md p-5 max-w-sm w-full mx-4 shadow-xl max-h-[calc(100%-2rem)] overflow-y-auto"
		onclick={(e) => e.stopPropagation()}
		role="none"
	>
		<div class="flex items-center justify-between mb-4">
			<span class="text-xs text-text-secondary uppercase tracking-widest">Shortcuts</span>
			<button
				bind:this={closeBtn}
				class="hit text-text-muted hover:text-text-primary text-xs transition-colors"
				style="--hit:-12px -8px"
				onclick={onclose}
				aria-label="Close shortcuts"
			>✕</button>
		</div>

		<table class="w-full mb-4">
			<tbody>
				{#each shortcuts as { key, action }}
					<tr class="border-b border-border-subtle last:border-0">
						<td class="py-1.5 pr-4 text-right">
							<kbd class="text-[0.65rem] text-text-secondary bg-bg-surface px-1.5 py-0.5 rounded border border-border-default whitespace-nowrap">
								{key}
							</kbd>
						</td>
						<td class="py-1.5 text-[0.72rem] text-text-muted">
							{action}
						</td>
					</tr>
				{/each}
			</tbody>
		</table>

		<div class="border-t border-border-subtle pt-3">
			<p class="text-[0.62rem] uppercase tracking-widest text-text-muted mb-2">Filter syntax</p>
			{#each filterHints as { example, desc }}
				<div class="flex items-center gap-3 py-0.5">
					<code class="text-[0.65rem] text-accent-todo w-24 shrink-0">{example}</code>
					<span class="text-[0.7rem] text-text-muted">{desc}</span>
				</div>
			{/each}
		</div>

		<div class="border-t border-border-subtle pt-3 mt-3">
			<p class="text-[0.62rem] uppercase tracking-widest text-text-muted mb-2">When adding a task</p>
			{#each addHints as { example, desc }}
				<div class="flex items-center gap-3 py-0.5">
					<code class="text-[0.65rem] text-accent-todo w-24 shrink-0">{example}</code>
					<span class="text-[0.7rem] text-text-muted">{desc}</span>
				</div>
			{/each}
		</div>
	</div>
</div>

<style>
	/* Grow the tap area on touch screens without changing how the control looks. */
	@media (pointer: coarse) {
		.hit { position: relative; }
		.hit::after { content: ''; position: absolute; inset: var(--hit); }
	}
</style>
