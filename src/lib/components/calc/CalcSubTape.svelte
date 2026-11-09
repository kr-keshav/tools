<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { calcUI, addLine, linesOf, subSheetOf } from '$lib/stores/calcState.svelte';
	import { formatNumber, prepareInput } from '$lib/calc/engine';
	import { evaluateTape, indexById, sheetResult, syntaxError, toStored, type LineInfo } from '$lib/calc/tape';
	import { getCalcContext, type CalcField } from './calcContext';
	import CalcLineRow from './CalcLineRow.svelte';
	import { markFresh } from '$lib/calc/motion';

	let { sheetId, depth }: { sheetId: string; depth: number } = $props();

	const ctx = getCalcContext();
	const EMPTY: LineInfo = { expr: '', tags: [] };

	const lines = $derived(linesOf(sheetId));
	const infos = $derived(ctx.results.get(sheetId) ?? []);
	const idIndex = $derived(indexById(lines));
	const names = $derived(new Set(infos.flatMap((r) => (r.name ? [r.name.toLowerCase()] : []))));

	let draft = $state('');
	let entryError = $state<string | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);

	const entryField: CalcField = {
		get el() { return inputEl; },
		get value() { return draft; },
		set: (next) => { draft = next; entryError = null; },
		commit,
	};

	onDestroy(() => ctx.endEdit(entryField));

	const preview = $derived.by(() => {
		if (!draft.trim()) return null;
		const input = prepareInput(draft);
		if (syntaxError(input)) return null;
		const all = evaluateTape([...lines, { id: '__draft__', input }], calcUI.angle, {
			sub: (lineId) => {
				const child = subSheetOf(lineId);
				return child ? sheetResult(ctx.results.get(child.id) ?? []) : undefined;
			},
		});
		return all[all.length - 1];
	});

	function commit() {
		if (!draft.trim()) return;
		const input = prepareInput(draft);
		const err = syntaxError(input);
		if (err) {
			entryError = err;
			return;
		}
		markFresh();
		addLine(toStored(input, lines), sheetId);
		draft = '';
		entryError = null;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commit(); }
		if (e.key === 'Escape') {
			e.preventDefault();
			if (draft) { draft = ''; entryError = null; }
			else inputEl?.blur();
		}
	}

	/** A result clicked inside this sub-calc belongs in this sub-calc's entry, not the main one. */
	async function insert(text: string) {
		// …unless a line is being edited, which is where the click was aimed
		if (ctx.hasTarget) return ctx.insert(text);
		const el = inputEl;
		const focused = el && document.activeElement === el;
		const start = focused ? (el.selectionStart ?? draft.length) : draft.length;
		const end = focused ? (el.selectionEnd ?? draft.length) : draft.length;
		draft = draft.slice(0, start) + text + draft.slice(end);
		await tick();
		el?.focus();
		el?.setSelectionRange(start + text.length, start + text.length);
	}
</script>

<div class="sub" style="--depth: {depth}">
	{#each lines as line, i (line.id)}
		<CalcLineRow {line} index={i} info={infos[i] ?? EMPTY} {idIndex} {names} {depth} onUse={insert} />
	{/each}

	<div class="sub-entry">
		<span class="plus" aria-hidden="true">+</span>
		<input
			bind:this={inputEl}
			bind:value={draft}
			oninput={() => (entryError = null)}
			onkeydown={handleKey}
			onfocus={() => ctx.target(entryField)}
			onblur={() => ctx.endEdit(entryField)}
			inputmode={calcUI.keypadOpen ? 'none' : 'text'}
			placeholder={lines.length ? 'Add a line — the last line is the result' : 'First line of the sub-calc, e.g. base = 27000'}
			spellcheck="false"
			autocomplete="off"
			autocapitalize="off"
			aria-label="Add to sub-calculation"
		/>
		<span class="preview" class:err={entryError}>
			{#if entryError}
				{entryError}
			{:else if preview?.value !== undefined}
				= {formatNumber(preview.value)}
			{/if}
		</span>
	</div>
</div>

<style>
	.sub {
		margin-left: calc(1.25rem + var(--depth) * 0.5rem);
		border-left: 2px solid color-mix(in srgb, var(--color-accent-calc) 35%, transparent);
		background: color-mix(in srgb, var(--color-accent-calc) 3%, transparent);
	}

	.sub-entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		min-height: 34px;
		padding: 0 0.75rem 0 0.75rem;
		border-bottom: 1px solid var(--color-border-subtle);
	}
	.plus { color: var(--color-text-faint); font-size: 0.8rem; width: 1rem; text-align: center; }

	.sub-entry input {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		outline: none;
		font-family: inherit;
		font-size: 0.75rem;
		color: var(--color-text-primary);
		caret-color: var(--color-accent-calc);
	}
	.sub-entry input::placeholder { color: var(--color-text-muted); }
	.sub-entry:focus-within { background: var(--color-bg-active); }

	.preview {
		flex-shrink: 0;
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.75rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.preview.err { font-size: 0.68rem; color: var(--color-danger); }
</style>
