<script lang="ts">
	import { onDestroy, tick } from 'svelte';
	import { calcUI } from '$lib/stores/calcState.svelte';
	import { formatNumber, prepareInput } from '$lib/calc/engine';
	import { evaluateTape, syntaxError } from '$lib/calc/tape';
	import type { CalcField } from './calcContext';

	// Lives only in this component: nothing here reaches the tape or Firestore.
	let {
		onTarget,
		onRelease,
	}: {
		/** The keypad should type here. */
		onTarget: (field: CalcField) => void;
		onRelease: (field: CalcField) => void;
	} = $props();

	let open = $state(false);
	let value = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);

	const field: CalcField = {
		get el() { return inputEl; },
		get value() { return value; },
		set: (next) => (value = next),
		commit,
	};

	onDestroy(() => onRelease(field));

	const result = $derived.by(() => {
		if (!value.trim()) return null;
		const input = prepareInput(value);
		if (syntaxError(input)) return null;
		return evaluateTape([{ id: 'scratch', input }], calcUI.angle)[0];
	});

	/** Phones open this from the keypad bar, which has no room for a row of its own. */
	export async function show() {
		open = true;
		await tick();
		inputEl?.focus();
	}

	function discard() {
		onRelease(field);
		open = false;
		value = '';
	}

	/** `=` swaps the sum for its answer, so the next key carries on from it. */
	function commit() {
		if (result?.value !== undefined) value = String(result.value);
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commit(); }
		if (e.key === 'Escape') { e.preventDefault(); value = ''; }
	}
</script>

<div class="scratch">
	{#if open}
		<div class="card">
			<div class="head">
				<span>Disposable — not saved</span>
				<button class="close" onclick={discard} aria-label="Discard calculator" title="Discard">
					<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
				</button>
			</div>
			<input
				bind:this={inputEl}
				bind:value
				onkeydown={handleKey}
				onfocus={() => onTarget(field)}
				onblur={() => onRelease(field)}
				inputmode={calcUI.keypadOpen ? 'none' : 'text'}
				placeholder="Quick sum, not saved"
				spellcheck="false"
				autocomplete="off"
				autocapitalize="off"
				aria-label="Disposable calculator"
			/>
			<div class="result" class:soft={result?.error}>
				{#if result?.value !== undefined}
					= {formatNumber(result.value)}
				{:else if result?.error}
					{result.error}
				{/if}
			</div>
		</div>
	{:else}
		<button class="add" onclick={show}>+ Disposable calculator</button>
	{/if}
</div>

<style>
	.add {
		width: 100%;
		background: none;
		border: 1.5px dashed var(--color-border-default);
		border-radius: 14px;
		padding: 0.625rem;
		font-family: inherit;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		transition: color 0.1s, border-color 0.1s;
	}
	.add:hover { color: var(--color-text-primary); border-color: var(--color-text-muted); }

	.card {
		background: var(--color-bg-surface);
		border-radius: 16px;
		box-shadow: var(--shadow-card);
		padding: 0.5rem 0.875rem 0.625rem;
		animation: pop 420ms var(--ease-spring) backwards;
	}
	.card:focus-within { box-shadow: 0 0 0 1.5px var(--color-accent), var(--shadow-card); }
	@keyframes pop {
		from { transform: scale(0.85) translateY(10px); opacity: 0; }
	}

	.head {
		display: flex;
		align-items: center;
		justify-content: space-between;
		font-size: 0.62rem;
		color: var(--color-text-muted);
	}
	.close {
		display: flex;
		background: none;
		border: none;
		border-radius: 4px;
		padding: 0.25rem;
		color: var(--color-text-muted);
	}
	.close:hover { color: var(--color-text-primary); background: var(--color-bg-hover); }

	input {
		width: 100%;
		margin-top: 0.25rem;
		background: none;
		border: none;
		outline: none;
		font-family: inherit;
		font-size: 1.15rem;
		color: var(--color-text-primary);
		caret-color: var(--color-accent-calc);
	}
	input::placeholder { color: var(--color-text-faint); }

	.result {
		min-height: 1.4rem;
		text-align: right;
		font-size: 0.95rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}
	.result.soft { font-size: 0.68rem; color: var(--color-text-faint); }

	/* Stacked above the docked keypad, where every row takes height from the tape */
	@media (max-width: 1023.98px) {
		.add { display: none; }

		.card {
			display: grid;
			grid-template-columns: minmax(0, 1fr) auto auto;
			align-items: center;
			gap: 0.25rem;
			margin: 0 0.625rem 0.5rem;
			padding: 0 0.25rem 0 0.875rem;
		}
		.head { display: contents; }
		.head span { display: none; }
		input { grid-area: 1 / 1; margin: 0; padding: 0.625rem 0; }
		.result { grid-area: 1 / 2; min-height: 0; max-width: 40vw; }
		.close {
			grid-area: 1 / 3;
			width: 40px;
			height: 40px;
			align-items: center;
			justify-content: center;
		}
	}
</style>
