<script lang="ts">
	import ToolLayout from '$lib/components/ToolLayout.svelte';
	import NotesTool from '$lib/components/tools/NotesTool.svelte';
</script>

<ToolLayout centerTool="notes" leftTool="timer" rightTool="todo">
	<NotesTool />
</ToolLayout>
