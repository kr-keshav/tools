<script lang="ts">
	import { toggleLeft, toggleRight, type ToolName } from '$lib/stores/panelState.svelte';

	let { side, tool }: { side: 'left' | 'right'; tool: ToolName } = $props();

	function open() {
		if (side === 'left') toggleLeft();
		else toggleRight();
	}

	const hoverColor: Record<ToolName, string> = {
		timer: 'hover:text-accent-timer hover:border-accent-timer',
		notes: 'hover:text-accent-notes hover:border-accent-notes',
		todo: 'hover:text-accent-todo hover:border-accent-todo',
	};
</script>

<button
	class="fixed top-1/2 -translate-y-1/2 z-50 bg-bg-surface border border-border-default text-text-muted
	       font-mono text-[0.65rem] font-semibold tracking-widest uppercase
	       [writing-mode:vertical-rl] px-2 py-4 cursor-pointer
	       transition-all duration-150 hover:bg-bg-hover
	       {hoverColor[tool]}
	       {side === 'left'
		       ? 'left-0 border-l-0 rounded-r'
		       : 'right-0 border-r-0 rounded-l rotate-180'}"
	onclick={open}
	title="Open {tool}"
>
	{tool}
</button>
