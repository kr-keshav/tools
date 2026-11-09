<script lang="ts">
	import ToolLayout from '$lib/components/ToolLayout.svelte';
	import TimerTool from '$lib/components/tools/TimerTool.svelte';
</script>

<ToolLayout centerTool="timer" leftTool="notes" rightTool="todo">
	<TimerTool />
</ToolLayout>
