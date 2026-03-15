<script lang="ts">
	import { goto } from '$app/navigation';
	import {
		panelState,
		toolRoutes,
		toggleLeft,
		toggleRight,
		type ToolName,
	} from '$lib/stores/panelState.svelte';
	import TimerTool from './tools/TimerTool.svelte';
	import NotesTool from './tools/NotesTool.svelte';
	import TodoTool from './tools/TodoTool.svelte';

	let { side, tool }: { side: 'left' | 'right'; tool: ToolName } = $props();

	const isOpen = $derived(side === 'left' ? panelState.leftOpen : panelState.rightOpen);

	function collapse() {
		if (side === 'left') toggleLeft();
		else toggleRight();
	}

	const accentClass: Record<ToolName, string> = {
		timer: 'border-l-accent-timer',
		notes: 'border-l-accent-notes',
		todo: 'border-l-accent-todo',
	};
</script>

<aside
	class="flex-shrink-0 h-full overflow-hidden"
	style="
		width: {isOpen ? 'var(--panel-w)' : '0px'};
		transition: width {isOpen
			? '280ms cubic-bezier(0.0, 0.0, 0.2, 1)'
			: '220ms cubic-bezier(0.4, 0.0, 1, 1)'};
	"
>
	<div
		class="flex flex-col h-full bg-bg-panel overflow-hidden"
		class:border-r={side === 'left'}
		class:border-l={side === 'right'}
		style="width: var(--panel-w); min-width: var(--panel-w); border-color: #2a2a2a;"
	>
		<!-- Header -->
		<div
			class="flex items-center justify-between h-12 min-h-12 px-3.5 border-b border-l-3 {accentClass[tool]}"
			style="border-bottom-color: #2a2a2a"
		>
			<span class="text-[0.7rem] font-semibold tracking-widest uppercase text-text-secondary">
				{tool}
			</span>
			<div class="flex gap-1">
				<!-- Focus button -->
				<button
					class="flex items-center justify-center p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150 cursor-pointer"
					onclick={() => goto(toolRoutes[tool])}
					title="Focus {tool}"
				>
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
						<path d="M9 1h4v4M13 1L8 6M5 13H1V9M1 13l5-5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
				</button>
				<!-- Collapse button -->
				<button
					class="flex items-center justify-center p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150 cursor-pointer"
					onclick={collapse}
					title="Collapse"
				>
					<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
						{#if side === 'left'}
							<path d="M9 2L4 7l5 5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
						{:else}
							<path d="M5 2l5 5-5 5" stroke="currentColor" stroke-width="1.25" stroke-linecap="round" stroke-linejoin="round"/>
						{/if}
					</svg>
				</button>
			</div>
		</div>

		<!-- Body -->
		<div class="flex-1 overflow-hidden">
			{#if tool === 'timer'}
				<TimerTool />
			{:else if tool === 'notes'}
				<NotesTool />
			{:else if tool === 'todo'}
				<TodoTool />
			{/if}
		</div>
	</div>
</aside>

<style>
	aside {
		--panel-w: clamp(260px, 26vw, 400px);
	}
</style>
