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
			? 'text-[#c77171]'
			: accent === 'today'
				? 'text-accent-todo'
				: 'text-text-muted'
	);
</script>

<div>
	<button
		class="flex items-center gap-2 w-full py-1 mb-1 text-left transition-colors group"
		onclick={() => (collapsed = !collapsed)}
		aria-expanded={!collapsed}
	>
		<span class="text-[0.62rem] uppercase tracking-widest font-mono {labelClass} transition-colors">
			{title}
		</span>
		<span class="text-[0.62rem] text-text-muted/50">{tasks.length}</span>
		<span class="ml-auto text-[0.55rem] text-text-muted/30 group-hover:text-text-muted/60 transition-colors">
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
