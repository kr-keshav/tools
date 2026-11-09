<script lang="ts">
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
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
	class="panel {side}"
	class:open={isOpen}
	inert={!isOpen}
>
	<div
		class="flex flex-col h-full bg-bg-panel overflow-hidden"
		class:border-r={side === 'left'}
		class:border-l={side === 'right'}
		style="width: var(--panel-w); min-width: var(--panel-w); border-color: var(--color-border-default);"
	>
		<!-- Header -->
		<div
			class="flex items-center justify-between h-12 min-h-12 px-3.5 border-b border-l-3 {accentClass[tool]}"
			style="border-bottom-color: var(--color-border-default)"
		>
			<span class="text-[0.7rem] font-semibold tracking-widest uppercase text-text-secondary">
				{tool}
			</span>
			<div class="flex gap-1">
				<!-- Focus button -->
				<button
					class="flex items-center justify-center p-1.5 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors duration-150 cursor-pointer"
					onclick={() => goto(toolRoutes[tool] + $page.url.search)}
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
	.panel {
		--panel-w: clamp(260px, 26vw, 400px);
		flex-shrink: 0;
		height: 100%;
		overflow: hidden;
		width: 0;
		transition: width 220ms cubic-bezier(0.4, 0, 1, 1);
	}

	.panel.open {
		width: var(--panel-w);
		transition: width 280ms cubic-bezier(0, 0, 0.2, 1);
	}

	/* Mobile: panel floats above the main content instead of pushing it. */
	@media (max-width: 768px) {
		.panel {
			--panel-w: min(86vw, 340px);
			position: absolute;
			top: 0;
			bottom: 0;
			height: auto;
			width: var(--panel-w);
			z-index: 60;
			transition: transform 220ms cubic-bezier(0.4, 0, 1, 1);
		}

		.panel.left {
			left: 0;
			transform: translateX(-100%);
		}

		.panel.right {
			right: 0;
			transform: translateX(100%);
		}

		.panel.open {
			width: var(--panel-w);
			/* Only while open: a closed panel's shadow would show along the screen edge */
			box-shadow: var(--shadow-card);
			transform: translateX(0);
			transition: transform 280ms cubic-bezier(0, 0, 0.2, 1);
		}
	}
</style>
