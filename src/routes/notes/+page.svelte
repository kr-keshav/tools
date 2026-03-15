<script lang="ts">
	import ToolLayout from '$lib/components/ToolLayout.svelte';
	import NotesTool from '$lib/components/tools/NotesTool.svelte';
</script>

<svelte:head>
	<title>Notes · WorkKit</title>
</svelte:head>

<ToolLayout centerTool="notes" leftTool="timer" rightTool="todo">
	<NotesTool />
</ToolLayout>
