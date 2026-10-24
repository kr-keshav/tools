<script lang="ts">
	import AppHeader from '$lib/components/AppHeader.svelte';
	import CalcTool from '$lib/components/calc/CalcTool.svelte';
</script>

<svelte:head>
	<title>Calc · WorkKit</title>
	<link rel="icon" href="/favicon-calc.svg" type="image/svg+xml" />
</svelte:head>

<!-- Standalone route: no side panels, the tape gets the whole screen -->
<div class="shell">
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
