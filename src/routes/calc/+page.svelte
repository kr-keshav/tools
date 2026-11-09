<script lang="ts">
	import AppHeader from '$lib/components/AppHeader.svelte';
	import CalcTool from '$lib/components/calc/CalcTool.svelte';
	import { calcUI } from '$lib/stores/calcState.svelte';
</script>

<svelte:head>
	<title>Calc · WorkKit</title>
	<link rel="icon" href="/favicon-calc.svg" type="image/svg+xml" />
	<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Manrope:wght@400;500;600;700;800&display=swap" />
</svelte:head>

<!-- Standalone route: no side panels, the tape gets the whole screen -->
<div class="shell ripple" data-theme={calcUI.theme}>
	<AppHeader />
	<main>
		<CalcTool />
	</main>
</div>

<style>
	.shell {
		height: 100dvh;
		display: flex;
		flex-direction: column;
		background: var(--color-bg-primary);
	}
	main {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}
</style>
