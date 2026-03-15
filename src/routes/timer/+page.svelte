<script lang="ts">
	import ToolLayout from '$lib/components/ToolLayout.svelte';
	import TimerTool from '$lib/components/tools/TimerTool.svelte';
</script>

<svelte:head>
	<title>Timer · WorkKit</title>
</svelte:head>

<ToolLayout centerTool="timer" leftTool="notes" rightTool="todo">
	<TimerTool />
</ToolLayout>
