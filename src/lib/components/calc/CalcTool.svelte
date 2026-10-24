<script lang="ts">
	import { tick } from 'svelte';
	import {
		calcLines,
		calcSheets,
		calcUI,
		addLine,
		clearSheet,
		linesOf,
		undoDelete,
	} from '$lib/stores/calcState.svelte';
	import { prepareInput, formatNumber } from '$lib/calc/engine';
	import {
		evaluateSheets,
		evaluateTape,
		indexById,
		setLabel,
		summarizeTags,
		syntaxError,
		toDisplay,
		toStored,
	} from '$lib/calc/tape';
	import CalcLineRow from './CalcLineRow.svelte';
	import CalcKeypad, { type KeyAction } from './CalcKeypad.svelte';
	import CalcSheetTabs from './CalcSheetTabs.svelte';
	import { setCalcContext } from './calcContext';

	let draft = $state('');
	/** Optional label typed into its own field, so labelling never needs the `Label:` syntax. */
	let labelDraft = $state('');
	let entryError = $state<string | null>(null);
	let inputEl = $state<HTMLInputElement | null>(null);
	let tapeEl = $state<HTMLDivElement | null>(null);
	/** Caret position in the entry field, for completions. */
	let caret = $state(0);
	/** Position while stepping back through earlier lines with ↑ / ↓. */
	let historyIdx = $state<number | null>(null);
	let confirmClear = $state(false);
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;

	// Every sheet is re-evaluated through its dependency graph on every change, so editing
	// one line flows into every @ref, name, #tag and parent `sub` that reads it.
	const allResults = $derived(evaluateSheets(calcSheets, calcLines, calcUI.angle));
	setCalcContext({ get results() { return allResults; } });

	const sheetLines = $derived(linesOf(calcUI.activeSheetId));
	const results = $derived(allResults.get(calcUI.activeSheetId) ?? []);
	const idIndex = $derived(indexById(sheetLines));
	const names = $derived(new Set(results.flatMap((r) => (r.name ? [r.name.toLowerCase()] : []))));
	const tagStats = $derived(summarizeTags(results));

	const visible = $derived(
		sheetLines
			.map((line, i) => ({ line, i, info: results[i] ?? { expr: '', tags: [] } }))
			.filter(({ info }) => !calcUI.activeTag || info.tags.includes(calcUI.activeTag)),
	);
	const activeStats = $derived(tagStats.find((s) => s.tag === calcUI.activeTag));
	const pinned = $derived(visible.filter(({ line }) => line.pinned));

	// A filter for a tag that no longer exists would hide everything with no way back
	$effect(() => {
		if (calcUI.activeTag && !activeStats) calcUI.activeTag = null;
	});

	/** The draft evaluated as if it were already the next line on the tape. */
	const preview = $derived.by(() => {
		if (!draft.trim()) return null;
		const input = prepareInput(draft);
		if (syntaxError(input)) return null;
		const all = evaluateTape([...sheetLines, { id: '__draft__', input }], calcUI.angle);
		return all[all.length - 1];
	});

	// ── Completions ──────────────────────────────────────────────────────────

	const completion = $derived.by(() => {
		const m = /(#[a-z0-9_-]*|[a-z_][a-z0-9_]*)$/i.exec(draft.slice(0, caret));
		if (!m) return null;
		const word = m[1].toLowerCase();
		const pool = word.startsWith('#')
			? tagStats.map((s) => '#' + s.tag)
			: [...new Set(results.flatMap((r) => (r.name ? [r.name] : [])))];
		const options = pool
			.filter((o) => o.toLowerCase().startsWith(word) && o.toLowerCase() !== word)
			.slice(0, 6);
		return options.length ? { start: caret - word.length, options } : null;
	});

	async function accept(option: string) {
		if (!completion) return;
		const { start } = completion;
		draft = draft.slice(0, start) + option + draft.slice(caret);
		const pos = start + option.length;
		await tick();
		inputEl?.focus();
		inputEl?.setSelectionRange(pos, pos);
		caret = pos;
	}

	function syncCaret() {
		caret = inputEl?.selectionStart ?? draft.length;
	}

	$effect(() => {
		sheetLines.length;
		calcUI.activeSheetId;
		if (calcUI.activeTag) return;
		tick().then(() => {
			if (tapeEl) tapeEl.scrollTop = tapeEl.scrollHeight;
		});
	});

	// ── Entry ────────────────────────────────────────────────────────────────

	function setDraft(next: string) {
		draft = next;
		entryError = null;
		historyIdx = null;
	}

	function commit() {
		if (!draft.trim()) return;
		const input = prepareInput(draft);
		// Syntax mistakes stay in the field; a line that merely can't be evaluated yet —
		// say it uses a name defined later — goes on the tape and shows its error there.
		const err = syntaxError(input);
		if (err) {
			entryError = err;
			return;
		}
		addLine(toStored(labelDraft.trim() ? setLabel(input, labelDraft) : input, sheetLines));
		setDraft('');
		labelDraft = '';
		caret = 0;
	}

	/** Typed `*` and `/` become × and ÷ so the field reads like the keypad. */
	function handleInput(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const raw = el.value;
		const next = raw.replace(/×\*|\*\*/g, '^').replace(/\*/g, '×').replace(/\//g, '÷');
		if (next !== raw) {
			const pos = (el.selectionStart ?? raw.length) - (raw.length - next.length);
			el.value = next;
			el.setSelectionRange(pos, pos);
		}
		setDraft(next);
		syncCaret();
	}

	function recall(idx: number) {
		draft = toDisplay(sheetLines[idx].input, idIndex);
		historyIdx = idx;
		entryError = null;
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Tab' && completion) {
			e.preventDefault();
			accept(completion.options[0]);
		} else if (e.key === 'Enter') {
			e.preventDefault();
			commit();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			if (draft) setDraft('');
			else inputEl?.blur();
		} else if (e.key === 'ArrowUp' && sheetLines.length > 0) {
			e.preventDefault();
			recall(Math.max(0, (historyIdx ?? sheetLines.length) - 1));
		} else if (e.key === 'ArrowDown' && historyIdx !== null) {
			e.preventDefault();
			if (historyIdx + 1 >= sheetLines.length) setDraft('');
			else recall(historyIdx + 1);
		}
	}

	async function insert(text: string) {
		// An operator on an empty field continues from the last result, like a desk calculator
		if (!draft.trim() && /^[+×÷^-]$/.test(text) && sheetLines.length > 0) text = 'ans' + text;

		const el = inputEl;
		const focused = el && document.activeElement === el;
		const start = focused ? (el.selectionStart ?? draft.length) : draft.length;
		const end = focused ? (el.selectionEnd ?? draft.length) : draft.length;
		setDraft(draft.slice(0, start) + text + draft.slice(end));

		await tick();
		el?.focus();
		el?.setSelectionRange(start + text.length, start + text.length);
		caret = start + text.length;
	}

	async function backspace() {
		const el = inputEl;
		const focused = el && document.activeElement === el;
		let start = focused ? (el.selectionStart ?? draft.length) : draft.length;
		const end = focused ? (el.selectionEnd ?? draft.length) : draft.length;
		if (start === end) start = Math.max(0, start - 1);
		setDraft(draft.slice(0, start) + draft.slice(end));
		await tick();
		el?.setSelectionRange(start, start);
		caret = start;
	}

	function handleAction(action: KeyAction) {
		const hasPrev = sheetLines.length > 0;
		const s = draft.trim();
		switch (action) {
			case 'clear':  setDraft(''); break;
			case 'back':   backspace(); break;
			case 'equals': commit(); break;
			case 'sign': {
				const wrapped = /^-\((.*)\)$/.exec(s);
				if (wrapped) setDraft(wrapped[1]);
				else if (s) setDraft(`-(${s})`);
				else if (hasPrev) setDraft('-ans');
				break;
			}
			case 'recip':
				if (s) setDraft(`1÷(${s})`);
				else if (hasPrev) setDraft('1÷ans');
				break;
		}
		inputEl?.focus();
	}

	function handleLabelKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			// A label with no expression yet just moves on to the expression
			if (draft.trim()) commit();
			else inputEl?.focus();
		} else if (e.key === 'Escape') {
			e.preventDefault();
			labelDraft = '';
			inputEl?.focus();
		}
	}

	/** Start typing anywhere on the page and it lands in the entry field. */
	function handleWindowKey(e: KeyboardEvent) {
		if (e.metaKey || e.ctrlKey || e.altKey) return;
		const target = e.target as HTMLElement | null;
		if (target?.closest('input, textarea, [contenteditable="true"]')) return;
		if (e.key.length === 1 && /[\d.+\-*/^()%!a-z@#]/i.test(e.key)) inputEl?.focus();
	}

	// ── Tape actions ─────────────────────────────────────────────────────────

	function toggleTag(tag: string | null) {
		calcUI.activeTag = calcUI.activeTag === tag ? null : tag;
	}

	function handleClear() {
		if (!confirmClear) {
			confirmClear = true;
			if (confirmTimer) clearTimeout(confirmTimer);
			confirmTimer = setTimeout(() => (confirmClear = false), 3000);
			return;
		}
		confirmClear = false;
		clearSheet(calcUI.activeSheetId);
	}
</script>

<svelte:window onkeydown={handleWindowKey} />

<div class="calc">
	<section class="tape-col">
		<div class="toolbar">
			<CalcSheetTabs />
			{#if sheetLines.length > 0}
				<span class="count">{sheetLines.length} {sheetLines.length === 1 ? 'line' : 'lines'}</span>
				<button class="clear-btn" class:confirm={confirmClear} onclick={handleClear}>
					{confirmClear ? 'Click again to clear' : 'Clear'}
				</button>
			{/if}
		</div>

		{#if pinned.length > 0}
			<div class="pin-strip" aria-label="Pinned lines">
				{#each pinned as { line, i, info } (line.id)}
					<button
						class="pin"
						onclick={() => insert(info.name ?? `@${i + 1}`)}
						title="Insert {info.name ?? `@${i + 1}`}"
					>
						<span class="pin-name">{info.label ?? info.name ?? `@${i + 1}`}</span>
						<span class="pin-value" class:err={info.value === undefined}>
							{info.value !== undefined ? formatNumber(info.value) : 'error'}
						</span>
					</button>
				{/each}
			</div>
		{/if}

		{#if tagStats.length > 0}
			<div class="tag-strip" role="toolbar" aria-label="Filter by tag">
				<button class="chip" class:on={!calcUI.activeTag} onclick={() => toggleTag(null)}>All</button>
				{#each tagStats as s (s.tag)}
					<button
						class="chip tag"
						class:on={calcUI.activeTag === s.tag}
						onclick={() => toggleTag(s.tag)}
						title="{s.count} {s.count === 1 ? 'line' : 'lines'}{s.errors ? ` · ${s.errors} with errors` : ''} — use #{s.tag} in a calculation for this total"
					>
						<span class="chip-name">#{s.tag}</span>
						<span class="chip-total">{formatNumber(s.total)}</span>
						{#if s.errors}<span class="chip-warn" aria-label="has errors">!</span>{/if}
					</button>
				{/each}
			</div>
		{/if}

		<div class="tape" bind:this={tapeEl}>
			{#if sheetLines.length === 0}
				<div class="empty">
					<p class="empty-head">Every calculation stays on the tape — and stays live.</p>
					<ul>
						<li>Type an expression and press <kbd>Enter</kbd> · <code>+ 50</code> carries on from the last result</li>
						<li>Label a line: <code>Swiggy dinner: 450 + 380</code></li>
						<li>Name a line: <code>rent = 25000</code>, then use <code>rent × 12</code> anywhere</li>
						<li>Point at a line: <code>@2 + @3</code> — click any result to insert its reference</li>
						<li>Tag a line: <code>450 + 380 #food</code>, then <code>sum(#food)</code>, <code>avg(#food)</code>, <code>#food × 12</code></li>
						<li>Show your working: <code>GST: sub</code> opens a sub-calc under the line — its last line is the value</li>
						<li>Edit any line and everything that uses it recalculates · <kbd>↑</kbd> recalls earlier lines</li>
					</ul>
				</div>
			{:else}
				{#each visible as { line, i, info } (line.id)}
					<CalcLineRow {line} index={i} {info} {idIndex} {names} onUse={insert} />
				{/each}
			{/if}
		</div>

		{#if calcUI.activeTag && activeStats}
			<div class="filter-bar">
				<span class="filter-tag">#{activeStats.tag}</span>
				<span class="filter-meta">{activeStats.count} of {sheetLines.length} lines</span>
				<span class="filter-total">Σ {formatNumber(activeStats.total)}</span>
				<button class="filter-clear" onclick={() => toggleTag(null)}>Show all</button>
			</div>
		{/if}

		{#if calcUI.undoItem}
			<div class="toast" role="status">
				<span>{calcUI.undoItem.message}</span>
				<button onclick={undoDelete}>Undo</button>
			</div>
		{/if}

		{#if completion}
			<div class="completions" role="listbox" aria-label="Suggestions">
				{#each completion.options as option, i (option)}
					<button
						class="completion"
						class:first={i === 0}
						role="option"
						aria-selected={i === 0}
						onpointerdown={(e) => e.preventDefault()}
						onclick={() => accept(option)}
					>{option}</button>
				{/each}
				<span class="completion-hint"><kbd>Tab</kbd></span>
			</div>
		{/if}

		<div class="entry" class:has-error={entryError}>
			<input
				class="entry-label"
				bind:value={labelDraft}
				onkeydown={handleLabelKey}
				placeholder="Label"
				maxlength="60"
				spellcheck="false"
				autocomplete="off"
				aria-label="Label for the next line (optional)"
				title="Optional label — Tab to the expression, Enter to add"
			/>
			<span class="prompt" aria-hidden="true">›</span>
			<input
				bind:this={inputEl}
				value={draft}
				oninput={handleInput}
				onkeydown={handleKey}
				onkeyup={syncCaret}
				onclick={syncCaret}
				inputmode={calcUI.keypadOpen ? 'none' : 'text'}
				placeholder={sheetLines.length > 0 ? 'Next calculation…' : 'e.g. Rent: rent = 25000 #home'}
				spellcheck="false"
				autocomplete="off"
				autocapitalize="off"
				aria-label="Expression"
				aria-describedby="calc-entry-status"
			/>
			<span id="calc-entry-status" class="preview" class:err={entryError} class:soft={preview?.error}>
				{#if entryError}
					{entryError}
				{:else if preview?.value !== undefined}
					= {formatNumber(preview.value)}
				{:else if preview?.error}
					{preview.error}
				{/if}
			</span>
		</div>
	</section>

	<aside class="keypad-col">
		<CalcKeypad onInsert={insert} onAction={handleAction} />
	</aside>
</div>

<style>
	.calc {
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		width: 100%;
		max-width: 760px;
		margin: 0 auto;
	}

	.tape-col {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
	}

	.toolbar {
		display: flex;
		align-items: center;
		gap: 0.625rem;
		height: 36px;
		padding: 0 0.75rem;
		border-bottom: 1px solid var(--color-border-subtle);
		flex-shrink: 0;
	}
	.count { font-size: 0.65rem; color: var(--color-text-muted); flex-shrink: 0; margin-left: auto; }

	.clear-btn {
		flex-shrink: 0;
		background: none;
		border: 1px solid transparent;
		border-radius: 5px;
		padding: 0.2rem 0.5rem;
		font-family: inherit;
		font-size: 0.65rem;
		color: var(--color-text-muted);
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.clear-btn:hover { color: var(--color-text-primary); background: var(--color-bg-hover); }
	.clear-btn.confirm {
		color: #c96b6b;
		border-color: color-mix(in srgb, #c96b6b 40%, transparent);
	}

	.pin-strip {
		display: flex;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border-subtle);
		background: color-mix(in srgb, var(--color-accent-calc) 4%, transparent);
		overflow-x: auto;
		scrollbar-width: none;
		flex-shrink: 0;
	}
	.pin-strip::-webkit-scrollbar { display: none; }
	.pin {
		display: flex;
		align-items: baseline;
		gap: 0.5rem;
		flex-shrink: 0;
		background: var(--color-bg-surface);
		border: 1px solid color-mix(in srgb, var(--color-accent-calc) 25%, var(--color-border-subtle));
		border-radius: 7px;
		padding: 0.25rem 0.6rem;
		font-family: inherit;
		text-align: left;
		transition: border-color 0.1s;
	}
	.pin:hover { border-color: color-mix(in srgb, var(--color-accent-calc) 55%, transparent); }
	.pin-name {
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.65rem;
		color: var(--color-text-muted);
	}
	.pin-value {
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-primary);
		font-variant-numeric: tabular-nums;
	}
	.pin-value.err { font-size: 0.7rem; color: #c96b6b; }

	.tag-strip {
		display: flex;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border-subtle);
		overflow-x: auto;
		scrollbar-width: none;
		flex-shrink: 0;
	}
	.tag-strip::-webkit-scrollbar { display: none; }

	.chip {
		display: flex;
		align-items: center;
		gap: 0.4rem;
		flex-shrink: 0;
		background: none;
		border: 1px solid var(--color-border-default);
		border-radius: 12px;
		padding: 0.2rem 0.6rem;
		font-family: inherit;
		font-size: 0.65rem;
		color: var(--color-text-secondary);
		transition: color 0.1s, border-color 0.1s, background 0.1s;
	}
	.chip:hover { color: var(--color-text-primary); background: var(--color-bg-hover); }
	.chip.on {
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--color-accent-calc) 50%, transparent);
		background: color-mix(in srgb, var(--color-accent-calc) 12%, transparent);
	}
	.chip.tag .chip-name { color: var(--color-accent-notes); }
	.chip.tag.on {
		border-color: color-mix(in srgb, var(--color-accent-notes) 50%, transparent);
		background: color-mix(in srgb, var(--color-accent-notes) 12%, transparent);
	}
	.chip-total { font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
	.chip-warn { color: #c96b6b; font-weight: 600; }

	.tape {
		flex: 1;
		min-height: 0;
		overflow-y: auto;
		overscroll-behavior: contain;
	}

	.empty {
		padding: 2rem 1.25rem;
		color: var(--color-text-muted);
		font-size: 0.72rem;
		line-height: 2;
	}
	.empty-head {
		color: var(--color-text-secondary);
		font-size: 0.8rem;
		margin-bottom: 0.5rem;
	}
	.empty ul { list-style: none; padding: 0; margin: 0; }
	.empty li::before { content: '· '; color: var(--color-text-faint); }
	.empty code, .empty kbd, .completion-hint kbd {
		font-family: inherit;
		font-size: 0.68rem;
		color: var(--color-text-secondary);
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-subtle);
		border-radius: 4px;
		padding: 0.05rem 0.3rem;
	}

	.filter-bar {
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.5rem 0.75rem;
		border-top: 1px solid var(--color-border-subtle);
		background: var(--color-bg-panel);
		font-size: 0.7rem;
		flex-shrink: 0;
	}
	.filter-tag { color: var(--color-accent-notes); }
	.filter-meta { color: var(--color-text-muted); }
	.filter-total {
		margin-left: auto;
		font-size: 0.85rem;
		font-weight: 500;
		color: var(--color-text-primary);
		font-variant-numeric: tabular-nums;
	}
	.filter-clear {
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-decoration: underline;
		text-underline-offset: 2px;
		padding: 0;
	}
	.filter-clear:hover { color: var(--color-text-primary); }

	.toast {
		position: absolute;
		left: 50%;
		bottom: 64px;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.75rem;
		padding: 0.4rem 0.5rem 0.4rem 0.75rem;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		z-index: 10;
	}
	.toast button {
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.7rem;
		font-weight: 600;
		color: var(--color-accent-calc);
		padding: 0.2rem 0.375rem;
		border-radius: 4px;
	}
	.toast button:hover { background: var(--color-bg-hover); }

	.completions {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		padding: 0.375rem 0.75rem;
		border-top: 1px solid var(--color-border-subtle);
		background: var(--color-bg-panel);
		overflow-x: auto;
		scrollbar-width: none;
		flex-shrink: 0;
	}
	.completion {
		flex-shrink: 0;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-subtle);
		border-radius: 5px;
		padding: 0.15rem 0.5rem;
		font-family: inherit;
		font-size: 0.7rem;
		color: var(--color-text-secondary);
	}
	.completion:hover, .completion.first {
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--color-accent-calc) 45%, transparent);
	}
	.completion-hint { margin-left: auto; flex-shrink: 0; }
	@media (hover: none) {
		.completion-hint { display: none; }
	}

	.entry {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		padding: 0.625rem 0.75rem;
		border-top: 1px solid var(--color-border-default);
		background: var(--color-bg-primary);
		flex-shrink: 0;
	}
	.prompt { color: var(--color-accent-calc); font-size: 1.1rem; line-height: 1; }

	/* Doubled class so it outranks the `.entry input` rule for the expression field */
	.entry .entry-label {
		flex: 0 0 8rem;
		width: 8rem;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-subtle);
		border-radius: 6px;
		padding: 0.3rem 0.5rem;
		font-family: inherit;
		font-size: 0.75rem;
		color: var(--color-text-primary);
		outline: none;
		transition: border-color 0.15s;
	}
	.entry .entry-label::placeholder { color: var(--color-text-faint); }
	.entry .entry-label:focus { border-color: color-mix(in srgb, var(--color-accent-calc) 55%, transparent); }
	@media (max-width: 560px) {
		.entry .entry-label { flex-basis: 5.5rem; width: 5.5rem; }
	}

	.entry input {
		flex: 1;
		min-width: 0;
		background: none;
		border: none;
		outline: none;
		font-family: inherit;
		font-size: 1.15rem;
		color: var(--color-text-primary);
		caret-color: var(--color-accent-calc);
	}
	.entry input::placeholder { color: var(--color-text-faint); }

	.preview {
		flex-shrink: 0;
		max-width: 45%;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.95rem;
		color: var(--color-text-muted);
		font-variant-numeric: tabular-nums;
	}
	.preview.soft { font-size: 0.68rem; color: var(--color-text-faint); }
	.preview.err { font-size: 0.7rem; color: #c96b6b; }

	/* Wide screens: keypad sits beside the tape, which gets the full height */
	@media (min-width: 1024px) {
		.calc {
			flex-direction: row;
			max-width: 1180px;
			padding: 1rem;
			gap: 1rem;
		}
		.tape-col {
			border: 1px solid var(--color-border-subtle);
			border-radius: 10px;
			overflow: hidden;
		}
		.keypad-col {
			width: 400px;
			flex-shrink: 0;
			align-self: flex-end;
		}
		.keypad-col :global(.keypad) {
			border: 1px solid var(--color-border-subtle);
			border-radius: 10px;
		}
	}
</style>
