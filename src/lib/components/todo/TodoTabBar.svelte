<script lang="ts">
	import { tick } from 'svelte';
	import { tabs, todoUI, addTab, renameTab, deleteTab } from '$lib/stores/todoState.svelte';

	let renamingId = $state<string | null>(null);
	let renameDraft = $state('');
	let renameInputEl = $state<HTMLInputElement | null>(null);

	function startRename(id: string, currentName: string) {
		renamingId = id;
		renameDraft = currentName;
		tick().then(() => {
			renameInputEl?.select();
		});
	}

	function commitRename() {
		if (renamingId) renameTab(renamingId, renameDraft);
		renamingId = null;
	}

	function handleRenameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
		if (e.key === 'Escape') { renamingId = null; }
	}

	async function handleAddTab() {
		const tab = await addTab();
		startRename(tab.id, tab.name);
	}

	function handleTabClick(id: string) {
		if (todoUI.activeTabId === id && renamingId !== id) {
			// Second click on active tab → rename
			const tab = tabs.find((t) => t.id === id);
			if (tab) startRename(id, tab.name);
		} else {
			todoUI.activeTabId = id;
			renamingId = null;
		}
	}
</script>

<div class="flex items-end gap-0 overflow-x-auto border-b border-border-subtle" role="tablist" aria-label="Task tabs">
	{#each tabs as tab (tab.id)}
		<div
			class="relative flex items-center gap-1 shrink-0 group/tab"
			role="tab"
			aria-selected={todoUI.activeTabId === tab.id}
		>
			{#if renamingId === tab.id}
				<!-- Inline rename input -->
				<input
					bind:this={renameInputEl}
					bind:value={renameDraft}
					onblur={commitRename}
					onkeydown={handleRenameKey}
					class="w-24 bg-transparent border-none outline-none text-[0.72rem] font-mono
					       text-text-primary border-b border-accent-todo pb-[5px] px-2 pt-[5px]"
					maxlength="24"
					spellcheck="false"
					autocomplete="off"
					aria-label="Rename tab"
				/>
			{:else}
				<button
					onclick={() => handleTabClick(tab.id)}
					class="relative px-3 pt-[5px] pb-[6px] text-[0.72rem] font-mono transition-colors duration-100
					       whitespace-nowrap
					       {todoUI.activeTabId === tab.id
						       ? 'text-text-primary'
						       : 'text-text-muted hover:text-text-secondary'}"
					title="Click to select · Double-click to rename"
					ondblclick={() => startRename(tab.id, tab.name)}
				>
					{tab.name}
					<!-- Active underline -->
					{#if todoUI.activeTabId === tab.id}
						<span class="absolute bottom-0 left-2 right-2 h-[1.5px] rounded-full bg-accent-todo"></span>
					{/if}
				</button>

				<!-- Delete button (only when multiple tabs exist) -->
				{#if tabs.length > 1}
					<button
						onclick={() => deleteTab(tab.id)}
						class="text-[0.75rem] text-text-secondary hover:text-[#c77171]
						       transition-colors w-5 h-5 flex items-center justify-center rounded shrink-0 -ml-1"
						aria-label="Delete tab {tab.name}"
					>×</button>
				{/if}
			{/if}
		</div>
	{/each}

	<!-- Add tab button -->
	<button
		onclick={handleAddTab}
		class="px-3 pt-[5px] pb-[6px] text-base text-text-muted/50 hover:text-text-muted
		       transition-colors shrink-0 leading-none"
		aria-label="Add new tab"
		title="New tab"
	>+</button>
</div>
