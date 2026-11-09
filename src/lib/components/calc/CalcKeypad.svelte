<script module lang="ts">
	export type KeyAction = 'clear' | 'back' | 'equals' | 'sign' | 'recip';
</script>

<script lang="ts">
	import { calcUI, saveCalcPrefs } from '$lib/stores/calcState.svelte';
	import { ripple } from '$lib/calc/motion';

	let {
		onInsert,
		onAction,
		onScratch,
	}: {
		onInsert: (text: string) => void;
		onAction: (action: KeyAction) => void;
		onScratch: () => void;
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
		onpointerdown={(e) => { e.preventDefault(); ripple(e); }}
		onclick={() => press(key)}
	>{key.label}</button>
{/snippet}

<div class="keypad">
	<div class="bar">
		<div class="seg" role="group" aria-label="Keypad mode">
			<button onpointerdown={(e) => e.preventDefault()} class:on={calcUI.mode === 'basic'} onclick={() => setMode('basic')}>Basic</button>
			<button onpointerdown={(e) => e.preventDefault()} class:on={calcUI.mode === 'sci'} onclick={() => setMode('sci')}>Scientific</button>
		</div>
		<button
			class="angle"
			onpointerdown={(e) => e.preventDefault()}
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
			class="scratch-btn"
			onclick={onScratch}
			aria-label="Open disposable calculator"
			title="Disposable calculator, not saved"
		>
			<svg width="14" height="14" viewBox="0 0 14 14" fill="none" aria-hidden="true">
				<rect x="2.5" y="1.5" width="9" height="11" rx="2" stroke="currentColor" stroke-width="1.2"/>
				<path d="M5 4.5h4M5 7.5h.01M7 7.5h.01M9 7.5h.01M5 10h.01M7 10h.01M9 10h.01" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
			</svg>
		</button>
		<button
			class="fold-btn"
			onpointerdown={(e) => e.preventDefault()}
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
		background: var(--color-bg-surface);
		border-radius: 22px 22px 0 0;
		box-shadow: var(--shadow-card);
		padding: 0.625rem;
		transition: box-shadow 0.25s;
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
	/* .seg clips to its rounded corners, which would cut an outer ring */
	.seg button:focus-visible { outline-offset: -2px; }
	.seg button.on {
		color: var(--color-bg-surface);
		background: var(--color-text-primary);
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

	.scratch-btn {
		position: relative;
		margin-left: auto;
		display: flex;
		align-items: center;
		justify-content: center;
		width: 26px;
		height: 26px;
		background: none;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-text-secondary);
	}
	/* Reaches a 40px touch target without making the bar taller */
	.scratch-btn::after { content: ''; position: absolute; inset: -7px -2px; }
	/* Wide screens show the full button above the keypad instead */
	@media (min-width: 1024px) {
		.scratch-btn { display: none; }
		.fold-btn { margin-left: auto; }
	}

	.fold-btn {
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
		position: relative;
		overflow: hidden;
		background: var(--key-digit);
		border: none;
		border-radius: 12px;
		color: var(--color-text-primary);
		font-family: inherit;
		font-size: 1.05rem;
		font-weight: 700;
		touch-action: manipulation;
		user-select: none;
		transition: transform 120ms var(--ease-out), box-shadow 0.1s;
	}
	/* A tint works on every key colour in both themes; only with a real pointer, so it can't stick after a tap */
	@media (hover: hover) {
		.key:hover { box-shadow: inset 0 0 0 100px color-mix(in srgb, var(--color-text-primary) 7%, transparent); }
		/* The tint alone would take the quieter key labels below AA */
		.key.util:hover, .key.fn:hover { color: var(--color-text-primary); }
	}
	.key:active { transform: scale(0.93); }
	.key.wide { grid-column: span 2; }

	.key.util, .key.fn { background: var(--key-util); color: var(--color-text-secondary); font-size: 0.875rem; font-weight: 600; }
	.key.fn { font-size: 0.75rem; }
	.key.op { background: var(--color-accent-soft); color: var(--key-op-text); }
	.key.eq { background: var(--color-accent); color: var(--color-on-accent); font-size: 1.3rem; }

	/* The smallest phones need the bar tightened to fit every control */
	@media (max-width: 380px) {
		.bar { gap: 0.25rem; }
		.seg button { padding-inline: 0.4rem; }
		.sym { gap: 0.125rem; }
	}

	/* Phones: scientific keys stack above the basic pad instead of beside it */
	@media (max-width: 560px) {
		.keys.sci { grid-template-columns: 1fr; }
		.grid { grid-auto-rows: 48px; }
		.sci-grid { grid-template-columns: repeat(5, 1fr); grid-auto-rows: 36px; }
	}

	/* Short phones: Scientific would otherwise leave the tape a single sliver of a row */
	@media (max-width: 560px) and (max-height: 700px) {
		.keys.sci .basic-grid { grid-auto-rows: 36px; }
		.keys.sci .sci-grid { grid-auto-rows: 28px; }
		.keys.sci, .keys.sci .grid { gap: 0.25rem; }
	}

	/* 40px touch targets for the bar, without making it taller */
	@media (pointer: coarse) {
		.seg { overflow: visible; }
		.seg button:first-child { border-radius: 5px 0 0 5px; }
		.seg button:last-child { border-radius: 0 5px 5px 0; }
		.seg button, .angle, .sym button, .fold-btn { position: relative; }
		.seg button::after, .angle::after, .sym button::after, .fold-btn::after {
			content: '';
			position: absolute;
			left: 0;
			right: 0;
			top: 50%;
			height: 40px;
			transform: translateY(-50%);
		}
	}

	/* Large screens have room for a real keyboard; keep the pad compact */
	@media (min-width: 900px) {
		.grid { grid-auto-rows: 48px; }
		.key { border-radius: 14px; }
	}
</style>
