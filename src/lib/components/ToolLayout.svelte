<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import {
		panelState,
		closeLeft,
		closeRight,
		type ToolName,
	} from '$lib/stores/panelState.svelte';
	import SidePanel from './SidePanel.svelte';
	import PanelToggleButton from './PanelToggleButton.svelte';

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

	const gridCols = $derived(() => {
		const l = panelState.leftOpen;
		const r = panelState.rightOpen;
		if (l && r) return '1fr 1fr 1fr';
		if (l) return '1fr 2fr 0px';
		if (r) return '0px 2fr 1fr';
		return '0px 1fr 0px';
	});

	onMount(() => {
		closeLeft();
		closeRight();
	});
</script>

<div
	class="grid h-screen w-screen overflow-hidden [transition:grid-template-columns_300ms_cubic-bezier(0.4,0,0.2,1)]"
	style="grid-template-columns: {gridCols()}"
>
	<SidePanel side="left" tool={leftTool} />
	<main class="flex min-w-0 flex-col overflow-hidden bg-bg-primary h-full">
		{@render children()}
	</main>
	<SidePanel side="right" tool={rightTool} />

	{#if !panelState.leftOpen}
		<PanelToggleButton side="left" tool={leftTool} />
	{/if}
	{#if !panelState.rightOpen}
		<PanelToggleButton side="right" tool={rightTool} />
	{/if}
</div>
