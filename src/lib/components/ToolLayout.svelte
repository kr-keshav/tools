<script lang="ts">
	import { onMount } from 'svelte';
	import type { Snippet } from 'svelte';
	import {
		panelState,
		closeLeft,
		closeRight,
		closeBoth,
		swapSides,
		type ToolName,
	} from '$lib/stores/panelState.svelte';
	import { timerTabTitle } from '$lib/stores/timerState.svelte';
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

	const pageName = $derived(centerTool.charAt(0).toUpperCase() + centerTool.slice(1));
	// The timer keeps running whichever tool is centred, so the title is owned here
	// rather than per route — that way it counts down from any page.
	const tabTitle = $derived(timerTabTitle(pageName));

	onMount(() => {
		closeLeft();
		closeRight();

		// Phones overlay the panels, so two open at once would stack
		const overlay = window.matchMedia('(max-width: 768px)');
		const keepOne = () => {
			if (overlay.matches && panelState.leftOpen && panelState.rightOpen) closeLeft();
		};
		overlay.addEventListener('change', keepOne);
		return () => overlay.removeEventListener('change', keepOne);
	});

	// Phones show a panel over the content, so Esc should dismiss it
	function closeOnEscape(e: KeyboardEvent) {
		if (e.key === 'Escape' && window.matchMedia('(max-width: 768px)').matches) closeBoth();
	}
</script>

<svelte:window onkeydown={closeOnEscape} />

<svelte:head><title>{tabTitle}</title></svelte:head>

<div class="shell">
	<AppHeader leftTool={actualLeft} rightTool={actualRight} />

	<div class="panels">
		<SidePanel side="left" tool={actualLeft} />
		<main class:gutter-left={!panelState.leftOpen} class:gutter-right={!panelState.rightOpen} class="content flex-1 min-w-0 flex flex-col overflow-hidden h-full">
			<div class="content-card flex-1 min-h-0 flex flex-col overflow-hidden bg-bg-surface">
				{@render children()}
			</div>
		</main>
		<SidePanel side="right" tool={actualRight} />

		<!-- Mobile-only scrim: tap outside an open panel to dismiss it -->
		{#if panelState.leftOpen || panelState.rightOpen}
			<button class="scrim" onclick={closeBoth} aria-label="Close panel" tabindex="-1"></button>
		{/if}

		<!-- Edge tabs are desktop-only: on a phone they sit on top of the content at the
		     vertical centre and steal taps meant for it. The header buttons cover mobile. -->
		<div class="edge-tabs">
			{#if !panelState.leftOpen}
				<PanelToggleButton side="left" tool={actualLeft} />
			{/if}
			{#if !panelState.rightOpen}
				<PanelToggleButton side="right" tool={actualRight} />
			{/if}

			<!-- Swap sides — only meaningful when both panels can be seen at once -->
			<button
				class="swap-btn fixed bottom-3 left-1/2 -translate-x-1/2 z-50
				       p-2 bg-bg-surface border border-border-default rounded-full
				       text-text-muted hover:text-text-primary hover:bg-bg-hover
				       transition-all duration-150 shadow-lg"
				onclick={swapSides}
				title="Swap side panels — put {actualRight} on the left"
				aria-label="Swap side panels"
			>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
					<path d="M1 4h10M8 1.5L10.5 4 8 6.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
					<path d="M11 8H1M4 5.5L1.5 8 4 10.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
				</svg>
			</button>
		</div>
	</div>
</div>

<style>
	.shell {
		display: flex;
		flex-direction: column;
		height: 100vh;
		height: 100dvh;
		width: 100vw;
		overflow: hidden;
	}

	.panels {
		display: flex;
		flex: 1;
		overflow: hidden;
		position: relative;
	}

	.content { padding: 1rem; }
	/* Room for the edge tabs, so they sit beside the card instead of on top of it */
	.content.gutter-left { padding-left: 3.25rem; }
	.content.gutter-right { padding-right: 3.25rem; }
	.content-card {
		border-radius: 20px;
		box-shadow: var(--shadow-card);
		animation: content-rise 600ms var(--ease-out) backwards;
	}
	@keyframes content-rise {
		from { transform: translateY(26px); opacity: 0; }
	}

	/* Desktop pushes the content aside, so there is nothing to dismiss. */
	.scrim {
		display: none;
	}

	@media (max-width: 768px) {
		/* Phones use the full width: no gutter, radius or shadow */
		.content, .content.gutter-left, .content.gutter-right { padding: 0; }
		.content-card { border-radius: 0; box-shadow: none; }

		.edge-tabs {
			display: none;
		}

		.scrim {
			display: block;
			position: absolute;
			inset: 0;
			z-index: 55;
			background: rgba(0, 0, 0, 0.5);
			border: none;
			padding: 0;
			cursor: default;
			animation: scrim-in 200ms ease-out;
		}
	}

	@keyframes scrim-in {
		from { opacity: 0; }
		to   { opacity: 1; }
	}
</style>
