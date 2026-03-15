<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import {
		panelState,
		closeLeft,
		closeRight,
		swapSides,
		type ToolName,
	} from '$lib/stores/panelState.svelte';
	import SidePanel from './SidePanel.svelte';
	import PanelToggleButton from './PanelToggleButton.svelte';
	import AppHeader from './AppHeader.svelte';

	let {
		centerTool,
		leftTool,
		rightTool,
		children,
	}: {
		centerTool: ToolName;
		leftTool: ToolName;
		rightTool: ToolName;
		children: Snippet;
	} = $props();

	const actualLeft  = $derived(panelState.swapped ? rightTool : leftTool);
	const actualRight = $derived(panelState.swapped ? leftTool  : rightTool);

	onMount(() => {
		closeLeft();
		closeRight();
	});
</script>

<div class="shell">
	<AppHeader />

	<div class="panels">
		<SidePanel side="left" tool={actualLeft} />
		<main class="flex-1 min-w-0 flex flex-col overflow-hidden bg-bg-primary h-full">
			{@render children()}
		</main>
		<SidePanel side="right" tool={actualRight} />

		{#if !panelState.leftOpen}
			<PanelToggleButton side="left" tool={actualLeft} />
		{/if}
		{#if !panelState.rightOpen}
			<PanelToggleButton side="right" tool={actualRight} />
		{/if}

		<!-- Swap button: always visible at bottom center -->
		<button
			class="fixed bottom-3 left-1/2 -translate-x-1/2 z-50
			       p-2 bg-bg-surface border border-border-default rounded-full
			       text-text-muted hover:text-text-primary hover:bg-bg-hover
			       transition-all duration-150 shadow-lg"
			onclick={swapSides}
			title="Swap side panels"
		>
			<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
				<path d="M1 4h10M8 1.5L10.5 4 8 6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
				<path d="M11 8H1M4 5.5L1.5 8 4 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
	</div>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		width: 100vw;
		overflow: hidden;
	}

	.panels {
		display: flex;
		flex: 1;
		overflow: hidden;
		position: relative;
	}
</style>
