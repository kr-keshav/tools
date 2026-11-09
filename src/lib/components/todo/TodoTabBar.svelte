<script lang="ts">
	import { tick } from 'svelte';
	import { tasks, tabs, todoUI, addTab, renameTab, deleteTab } from '$lib/stores/todoState.svelte';

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
		if (e.key === 'Escape') { e.stopPropagation(); renamingId = null; }
	}

	function handleAddTab() {
		const tab = addTab();
		startRename(tab.id, tab.name);
	}

	function handleTabClick(e: MouseEvent, id: string) {
		// A mouse renames by double-click. Touch has no reliable double-tap, and a keyboard
		// has no double-click, so there a repeat activation on the active tab renames.
		const pointer = (e as PointerEvent).pointerType ?? (matchMedia('(pointer: fine)').matches ? 'mouse' : '');
		if (todoUI.activeTabId === id && renamingId !== id) {
			if (pointer === 'mouse') { disarmDelete(); return; }
			const tab = tabs.find((t) => t.id === id);
			if (tab) startRename(id, tab.name);
		} else {
			todoUI.activeTabId = id;
			renamingId = null;
		}
		disarmDelete();
	}

	let scrollerEl = $state<HTMLElement | null>(null);

	// Keep the selected tab inside the strip when it changes or a new one is added.
	$effect(() => {
		void todoUI.activeTabId;
		void tabs.length;
		const tab = scrollerEl?.querySelector<HTMLElement>('[aria-selected="true"]');
		if (!scrollerEl || !tab) return;
		const strip = scrollerEl.getBoundingClientRect();
		const box = tab.getBoundingClientRect();
		if (box.left < strip.left) scrollerEl.scrollLeft -= strip.left - box.left;
		else if (box.right > strip.right) scrollerEl.scrollLeft += box.right - strip.right;
	});

	// Deleting a tab takes its tasks with it and there is no undo, so tabs that hold
	// tasks need a second click.
	let confirmDeleteId = $state<string | null>(null);
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;

	function disarmDelete() {
		confirmDeleteId = null;
		if (confirmTimer) { clearTimeout(confirmTimer); confirmTimer = null; }
	}

	function handleDeleteClick(e: MouseEvent, id: string) {
		// A double-click is one gesture, not a confirmation.
		if (e.detail > 1) return;
		if (confirmDeleteId !== id && tasks.some((t) => t.tabId === id)) {
			disarmDelete();
			confirmDeleteId = id;
			confirmTimer = setTimeout(disarmDelete, 3000);
			return;
		}
		disarmDelete();
		deleteTab(id);
	}
</script>

<div class="flex items-end border-b border-border-subtle">
<!-- The + sits outside the scroller so it stays reachable with many tabs. -->
<div bind:this={scrollerEl} class="flex items-end gap-0 overflow-x-auto min-w-0 max-sm:min-h-10" role="tablist" aria-label="Task tabs">
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
					class="w-24 bg-transparent outline-none text-[0.72rem]
					       text-text-primary border-b border-accent-todo pb-[5px] px-2 pt-[5px]"
					maxlength="24"
					spellcheck="false"
					autocomplete="off"
					aria-label="Rename tab"
				/>
			{:else}
				<button
					onclick={(e) => handleTabClick(e, tab.id)}
					style="--hit:-11px 0 0"
					class="hit relative px-3 pt-[5px] pb-[6px] text-[0.72rem] transition-colors duration-100
					       whitespace-nowrap focus-visible:-outline-offset-2
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
						onclick={(e) => handleDeleteClick(e, tab.id)}
						onblur={disarmDelete}
						style="--hit:-15px 0 -4px"
						class="hit text-[0.75rem] hover:text-danger focus-visible:-outline-offset-2
						       transition-colors h-5 flex items-center justify-center rounded shrink-0 -ml-1 whitespace-nowrap
						       {confirmDeleteId === tab.id ? 'text-danger px-1' : 'text-text-secondary w-5'}"
						aria-label={confirmDeleteId === tab.id ? `Click again to delete tab ${tab.name} and its tasks` : `Delete tab ${tab.name}`}
					>{confirmDeleteId === tab.id ? 'Click again to delete' : '×'}</button>
				{/if}
			{/if}
		</div>
	{/each}
</div>

	<!-- Add tab button -->
	<button
		onclick={handleAddTab}
		class="px-3 pt-[5px] pb-[6px] text-base text-text-muted hover:text-text-secondary
		       transition-colors shrink-0 leading-none focus-visible:-outline-offset-2 max-sm:min-w-10 max-sm:min-h-10"
		aria-label="Add new tab"
		title="New tab"
	>+</button>
</div>

<style>
	/* Grow the tap area on touch screens without changing how the control looks. */
	@media (pointer: coarse) {
		.hit { position: relative; }
		.hit::after { content: ''; position: absolute; inset: var(--hit); }
	}
</style>
