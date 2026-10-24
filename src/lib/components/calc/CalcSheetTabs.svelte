<script lang="ts">
	import { tick } from 'svelte';
	import {
		calcUI,
		topSheets,
		addSheet,
		renameSheet,
		deleteSheet,
		setActiveSheet,
	} from '$lib/stores/calcState.svelte';

	let renamingId = $state<string | null>(null);
	let renameDraft = $state('');
	let renameInputEl = $state<HTMLInputElement | null>(null);

	const sheets = $derived(topSheets());

	async function startRename(id: string, name: string) {
		renamingId = id;
		renameDraft = name;
		await tick();
		renameInputEl?.focus();
		renameInputEl?.select();
	}

	function commitRename() {
		if (renamingId) renameSheet(renamingId, renameDraft);
		renamingId = null;
	}

	function handleRenameKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitRename(); }
		if (e.key === 'Escape') { e.preventDefault(); renamingId = null; }
	}

	function handleClick(id: string, name: string) {
		// Second click on the open sheet renames it, same as Todo tabs
		if (calcUI.activeSheetId === id) startRename(id, name);
		else setActiveSheet(id);
	}

	async function handleAdd() {
		const sheet = await addSheet();
		startRename(sheet.id, sheet.name);
	}
</script>

<div class="tabs" role="tablist" aria-label="Sheets">
	{#each sheets as sheet (sheet.id)}
		<div class="tab" class:on={calcUI.activeSheetId === sheet.id}>
			{#if renamingId === sheet.id}
				<input
					bind:this={renameInputEl}
					bind:value={renameDraft}
					onblur={commitRename}
					onkeydown={handleRenameKey}
					maxlength="32"
					spellcheck="false"
					autocomplete="off"
					aria-label="Rename sheet"
				/>
			{:else}
				<button
					class="tab-btn"
					role="tab"
					aria-selected={calcUI.activeSheetId === sheet.id}
					onclick={() => handleClick(sheet.id, sheet.name)}
					title={calcUI.activeSheetId === sheet.id ? 'Click to rename' : sheet.name}
				>{sheet.name}</button>
				{#if sheets.length > 1}
					<button
						class="tab-del"
						onclick={() => deleteSheet(sheet.id)}
						aria-label="Delete sheet {sheet.name}"
						title="Delete sheet (undo available)"
					>×</button>
				{/if}
			{/if}
		</div>
	{/each}
	<button class="tab-add" onclick={handleAdd} aria-label="New sheet" title="New sheet">+</button>
</div>

<style>
	.tabs {
		display: flex;
		align-items: stretch;
		min-width: 0;
		height: 100%;
		overflow-x: auto;
		scrollbar-width: none;
	}
	.tabs::-webkit-scrollbar { display: none; }

	.tab {
		position: relative;
		display: flex;
		align-items: center;
		flex-shrink: 0;
	}
	.tab.on::after {
		content: '';
		position: absolute;
		left: 0.5rem;
		right: 0.5rem;
		bottom: 0;
		height: 1.5px;
		border-radius: 1px;
		background: var(--color-accent-calc);
	}

	.tab-btn {
		background: none;
		border: none;
		padding: 0 0.625rem;
		height: 100%;
		font-family: inherit;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		white-space: nowrap;
		transition: color 0.1s;
	}
	.tab-btn:hover { color: var(--color-text-secondary); }
	.tab.on .tab-btn { color: var(--color-text-primary); }

	.tab-del {
		width: 18px;
		height: 18px;
		margin-left: -0.375rem;
		margin-right: 0.125rem;
		display: flex;
		align-items: center;
		justify-content: center;
		background: none;
		border: none;
		border-radius: 4px;
		font-size: 0.75rem;
		color: var(--color-text-faint);
		opacity: 0;
		transition: opacity 0.1s, color 0.1s;
	}
	.tab:hover .tab-del, .tab.on .tab-del, .tab-del:focus-visible { opacity: 1; }
	.tab-del:hover { color: #c96b6b; }
	@media (hover: none) {
		.tab.on .tab-del { opacity: 1; }
	}

	.tab input {
		width: 8rem;
		margin: 0 0.375rem;
		background: none;
		border: none;
		border-bottom: 1px solid var(--color-accent-calc);
		outline: none;
		padding: 0.2rem 0.25rem;
		font-family: inherit;
		font-size: 0.72rem;
		color: var(--color-text-primary);
	}

	.tab-add {
		flex-shrink: 0;
		background: none;
		border: none;
		padding: 0 0.625rem;
		font-size: 0.95rem;
		line-height: 1;
		color: var(--color-text-faint);
		transition: color 0.1s;
	}
	.tab-add:hover { color: var(--color-text-secondary); }
</style>
