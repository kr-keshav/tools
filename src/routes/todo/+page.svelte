<script lang="ts">
	import ToolLayout from '$lib/components/ToolLayout.svelte';
	import TodoTool from '$lib/components/tools/TodoTool.svelte';
</script>

<svelte:head>
	<title>Todo · WorkKit</title>
</svelte:head>

<ToolLayout centerTool="todo" leftTool="timer" rightTool="notes">
	<TodoTool />
</ToolLayout>
