<script lang="ts">
	import { toggleTask, deleteTask } from '$lib/stores/todoState.svelte';
	import type { Task } from '$lib/stores/todoState.svelte';
	import { formatDueDate } from '$lib/stores/todoState.svelte';

	let { tasks }: { tasks: Task[] } = $props();

	let expanded = $state(false);
</script>

{#if tasks.length > 0}
	<div class="mt-2 border-t border-border-subtle pt-3">
		<button
			class="flex items-center gap-2 w-full py-1 text-left group"
			onclick={() => (expanded = !expanded)}
			aria-expanded={expanded}
		>
			<span class="text-[0.62rem] uppercase tracking-widest font-mono text-text-muted/50 transition-colors group-hover:text-text-muted">
				Completed
			</span>
			<span class="text-[0.62rem] text-text-muted/40">{tasks.length}</span>
			<span class="ml-auto text-[0.55rem] text-text-muted/30 group-hover:text-text-muted/60 transition-colors">
				{expanded ? '▾' : '▸'}
			</span>
		</button>

		{#if expanded}
			<ul role="list" class="flex flex-col gap-0.5 mt-1">
				{#each tasks as task (task.id)}
					{@const due = task.dueDate ? formatDueDate(task.dueDate) : null}
					<li class="flex items-center gap-2 px-2 py-1.5 rounded-sm hover:bg-bg-hover/50 group/item transition-colors">
						<!-- Restore checkbox -->
						<input
							type="checkbox"
							class="w-3.5 h-3.5 min-w-[14px] rounded-sm cursor-pointer"
							style="accent-color: #b5866b"
							checked={true}
							onchange={() => toggleTask(task.id)}
							aria-label="Restore task"
						/>

						<!-- Title -->
						<span class="flex-1 text-[0.78rem] font-mono text-text-muted line-through truncate">
							{task.title}
						</span>

						<!-- Due date if any -->
						{#if due}
							<span class="text-[0.65rem] text-text-muted/50 shrink-0">{due.label}</span>
						{/if}

						<!-- Delete permanently -->
						<button
							onclick={() => deleteTask(task.id, false)}
							class="text-[0.65rem] text-text-muted/20 hover:text-[#c77171] opacity-0 group-hover/item:opacity-100 transition-all shrink-0"
							aria-label="Delete permanently"
						>×</button>
					</li>
				{/each}
			</ul>
		{/if}
	</div>
{/if}
