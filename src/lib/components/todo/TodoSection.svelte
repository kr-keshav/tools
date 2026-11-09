<script lang="ts">
	import TodoItem from './TodoItem.svelte';
	import type { Task } from '$lib/stores/todoState.svelte';

	let { title, tasks, accent = 'default' }: {
		title: string;
		tasks: Task[];
		accent?: 'overdue' | 'today' | 'default';
	} = $props();

	let collapsed = $state(false);

	const labelClass = $derived(
		accent === 'overdue'
			? 'text-danger'
			: accent === 'today'
				? 'text-accent-todo'
				: 'text-text-muted'
	);
</script>

<div>
	<button
		style="--hit:-12px 0 -4px"
		class="hit flex items-center gap-2 w-full py-1 mb-1 text-left transition-colors group focus-visible:-outline-offset-2"
		onclick={() => (collapsed = !collapsed)}
		aria-expanded={!collapsed}
	>
		<span class="text-[0.62rem] uppercase tracking-widest {labelClass} transition-colors">
			{title}
		</span>
		<span class="text-[0.62rem] text-text-muted">{tasks.length}</span>
		<span class="ml-auto text-[0.55rem] text-text-muted group-hover:text-text-secondary transition-colors">
			{collapsed ? '▸' : '▾'}
		</span>
	</button>

	{#if !collapsed}
		<ul role="list" class="flex flex-col gap-1">
			{#each tasks as task (task.id)}
				<TodoItem {task} />
			{/each}
		</ul>
	{/if}
</div>

<style>
	/* Grow the tap area on touch screens without changing how the control looks. */
	@media (pointer: coarse) {
		.hit { position: relative; }
		.hit::after { content: ''; position: absolute; inset: var(--hit); }
	}
</style>
