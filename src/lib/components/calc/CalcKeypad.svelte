<script module lang="ts">
	export type KeyAction = 'clear' | 'back' | 'equals' | 'sign' | 'recip';
</script>

<script lang="ts">
	import { calcUI, saveCalcPrefs } from '$lib/stores/calcState.svelte';

	let {
		onInsert,
		onAction,
	}: {
		onInsert: (text: string) => void;
		onAction: (action: KeyAction) => void;
	} = $props();

	type Key = { label: string; insert?: string; action?: KeyAction; kind?: 'op' | 'fn' | 'eq' | 'util'; wide?: boolean; title?: string };

	const BASIC: Key[] = [
		{ label: 'AC', action: 'clear', kind: 'util', title: 'Clear input (Esc)' },
		{ label: '⌫', action: 'back', kind: 'util', title: 'Backspace' },
		{ label: '(', insert: '(', kind: 'util' },
		{ label: ')', insert: ')', kind: 'util' },
		{ label: '÷', insert: '÷', kind: 'op' },

		{ label: '7', insert: '7' }, { label: '8', insert: '8' }, { label: '9', insert: '9' },
		{ label: '%', insert: '%', kind: 'util', title: '200 + 10% = 220' },
		{ label: '×', insert: '×', kind: 'op' },

		{ label: '4', insert: '4' }, { label: '5', insert: '5' }, { label: '6', insert: '6' },
		{ label: 'xʸ', insert: '^', kind: 'util', title: 'Power' },
		{ label: '−', insert: '-', kind: 'op' },

		{ label: '1', insert: '1' }, { label: '2', insert: '2' }, { label: '3', insert: '3' },
		{ label: 'ans', insert: 'ans', kind: 'util', title: 'Previous result' },
		{ label: '+', insert: '+', kind: 'op' },

		{ label: '±', action: 'sign', kind: 'util', title: 'Negate' },
		{ label: '0', insert: '0' },
		{ label: '.', insert: '.' },
		{ label: '=', action: 'equals', kind: 'eq', wide: true, title: 'Add to tape (Enter)' },
	];

	const SCI: Key[] = [
		{ label: 'sin', insert: 'sin(', kind: 'fn' },
		{ label: 'cos', insert: 'cos(', kind: 'fn' },
		{ label: 'tan', insert: 'tan(', kind: 'fn' },

		{ label: 'sin⁻¹', insert: 'asin(', kind: 'fn' },
		{ label: 'cos⁻¹', insert: 'acos(', kind: 'fn' },
		{ label: 'tan⁻¹', insert: 'atan(', kind: 'fn' },

		{ label: 'ln', insert: 'ln(', kind: 'fn' },
		{ label: 'log', insert: 'log(', kind: 'fn', title: 'log(x) is base 10 · log(x, b) for base b' },
		{ label: '√', insert: '√(', kind: 'fn' },

		{ label: 'x²', insert: '^2', kind: 'fn' },
		{ label: 'x³', insert: '^3', kind: 'fn' },
		{ label: 'x!', insert: '!', kind: 'fn' },

		{ label: 'π', insert: 'π', kind: 'fn' },
		{ label: 'e', insert: 'e', kind: 'fn' },
		{ label: '1/x', action: 'recip', kind: 'fn' },
	];

	function press(key: Key) {
		if (key.insert !== undefined) onInsert(key.insert);
		else if (key.action) onAction(key.action);
	}

	function setMode(mode: 'basic' | 'sci') {
		calcUI.mode = mode;
		saveCalcPrefs();
	}

	function toggleAngle() {
		calcUI.angle = calcUI.angle === 'deg' ? 'rad' : 'deg';
		saveCalcPrefs();
	}

	function toggleOpen() {
		calcUI.keypadOpen = !calcUI.keypadOpen;
		saveCalcPrefs();
	}
</script>

{#snippet keyButton(key: Key)}
	<!-- pointerdown is cancelled so the input keeps focus and its caret position -->
	<button
		class="key {key.kind ?? 'digit'}"
		class:wide={key.wide}
		title={key.title}
		onpointerdown={(e) => e.preventDefault()}
		onclick={() => press(key)}
	>{key.label}</button>
{/snippet}

<div class="keypad">
	<div class="bar">
		<div class="seg" role="group" aria-label="Keypad mode">
			<button class:on={calcUI.mode === 'basic'} onclick={() => setMode('basic')}>Basic</button>
			<button class:on={calcUI.mode === 'sci'} onclick={() => setMode('sci')}>Scientific</button>
		</div>
		<button
			class="angle"
			onclick={toggleAngle}
			title="Angle unit for sin, cos, tan — click to switch"
		>{calcUI.angle === 'deg' ? 'DEG' : 'RAD'}</button>
		<!-- With the keypad open the phone keyboard is suppressed, so the tape's own
		     syntax needs keys too. Typing a name still means folding the keypad. -->
		<div class="sym">
			<button onpointerdown={(e) => e.preventDefault()} onclick={() => onInsert('@')} title="Reference a line: @3">@</button>
			<button onpointerdown={(e) => e.preventDefault()} onclick={() => onInsert(' #')} title="Tag this line, or total a tag: #food">#</button>
			<button onpointerdown={(e) => e.preventDefault()} onclick={() => onInsert(',')} title="Separate arguments: max(3, 5)">,</button>
		</div>
		<button
			class="fold-btn"
			onclick={toggleOpen}
			aria-expanded={calcUI.keypadOpen}
			title={calcUI.keypadOpen ? 'Hide keypad' : 'Show keypad'}
		>
			<svg width="12" height="12" viewBox="0 0 12 12" fill="none" class:flip={!calcUI.keypadOpen}>
				<path d="M3 4.5L6 7.5L9 4.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
		</button>
	</div>

	{#if calcUI.keypadOpen}
		<div class="keys" class:sci={calcUI.mode === 'sci'}>
			{#if calcUI.mode === 'sci'}
				<div class="grid sci-grid">
					{#each SCI as key (key.label)}{@render keyButton(key)}{/each}
				</div>
			{/if}
			<div class="grid basic-grid">
				{#each BASIC as key (key.label)}{@render keyButton(key)}{/each}
			</div>
		</div>
	{/if}
</div>

<style>
	.keypad {
		border-top: 1px solid var(--color-border-subtle);
		background: var(--color-bg-panel);
		padding: 0.5rem 0.75rem 0.75rem;
	}

	.bar {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 0.5rem;
	}

	.seg {
		display: flex;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		overflow: hidden;
	}
	.seg button {
		background: none;
		border: none;
		color: var(--color-text-muted);
		font-family: inherit;
		font-size: 0.68rem;
		padding: 0.25rem 0.625rem;
		transition: color 0.15s, background 0.15s;
	}
	.seg button:hover { color: var(--color-text-primary); }
	.seg button.on {
		color: var(--color-text-primary);
		background: color-mix(in srgb, var(--color-accent-calc) 18%, transparent);
	}

	.angle {
		background: none;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-text-secondary);
		font-family: inherit;
		font-size: 0.65rem;
		letter-spacing: 0.05em;
		padding: 0.25rem 0.5rem;
		transition: color 0.15s, border-color 0.15s;
	}
	.angle:hover { color: var(--color-text-primary); border-color: var(--color-text-muted); }

	.sym { display: flex; gap: 0.25rem; }
	.sym button {
		width: 26px;
		height: 24px;
		background: none;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-text-secondary);
		font-family: inherit;
		font-size: 0.75rem;
		transition: color 0.15s, border-color 0.15s;
	}
	.sym button:hover { color: var(--color-text-primary); border-color: var(--color-text-muted); }

	.fold-btn {
		margin-left: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: none;
		border: none;
		border-radius: 6px;
		color: var(--color-text-muted);
		transition: color 0.15s, background 0.15s;
	}
	.fold-btn:hover { color: var(--color-text-primary); background: var(--color-bg-hover); }
	.fold-btn svg { transition: transform 0.15s; }
	.fold-btn svg.flip { transform: rotate(180deg); }

	.keys {
		display: grid;
		grid-template-columns: 1fr;
		gap: 0.375rem;
	}
	.keys.sci { grid-template-columns: 3fr 5fr; }

	.grid {
		display: grid;
		gap: 0.375rem;
		grid-auto-rows: 44px;
	}
	.basic-grid { grid-template-columns: repeat(5, 1fr); }
	.sci-grid   { grid-template-columns: repeat(3, 1fr); }

	.key {
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-subtle);
		border-radius: 8px;
		color: var(--color-text-primary);
		font-family: inherit;
		font-size: 0.95rem;
		touch-action: manipulation;
		user-select: none;
		transition: background 0.1s, border-color 0.1s;
	}
	.key:hover { background: var(--color-bg-hover); border-color: var(--color-border-default); }
	.key:active { transform: translateY(1px); }
	.key.wide { grid-column: span 2; }

	.key.util { color: var(--color-text-secondary); font-size: 0.85rem; }
	.key.fn   { color: var(--color-text-secondary); font-size: 0.75rem; background: var(--color-bg-panel); }
	.key.op   { color: var(--color-accent-calc); font-size: 1.05rem; }
	.key.eq {
		background: color-mix(in srgb, var(--color-accent-calc) 22%, var(--color-bg-surface));
		border-color: color-mix(in srgb, var(--color-accent-calc) 40%, transparent);
		color: var(--color-text-primary);
		font-size: 1.05rem;
	}
	.key.eq:hover { background: color-mix(in srgb, var(--color-accent-calc) 32%, var(--color-bg-surface)); }

	/* Phones: scientific keys stack above the basic pad instead of beside it */
	@media (max-width: 560px) {
		.keys.sci { grid-template-columns: 1fr; }
		.grid { grid-auto-rows: 48px; }
		.sci-grid { grid-template-columns: repeat(5, 1fr); grid-auto-rows: 36px; }
	}

	/* Large screens have room for a real keyboard; keep the pad compact */
	@media (min-width: 900px) {
		.grid { grid-auto-rows: 40px; }
	}
</style>
