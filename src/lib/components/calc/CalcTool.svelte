<script lang="ts">
	import { tick } from 'svelte';
	import {
		calcLines,
		calcSheets,
		calcUI,
		addLine,
		clearSheet,
		linesOf,
		subSheetOf,
		undoDelete,
		saveCalcPrefs,
	} from '$lib/stores/calcState.svelte';
	import { prepareInput, formatNumber } from '$lib/calc/engine';
	import {
		evaluateSheets,
		evaluateTape,
		indexById,
		mapExpr,
		negateExpr,
		setLabel,
		sheetResult,
		splitLine,
		summarizeTags,
		syntaxError,
		tagTone,
		toDisplay,
		toStored,
		typeOperators,
	} from '$lib/calc/tape';
	import CalcLineRow from './CalcLineRow.svelte';
	import CalcKeypad, { type KeyAction } from './CalcKeypad.svelte';
	import CalcSheetTabs from './CalcSheetTabs.svelte';
	import CalcScratch from './CalcScratch.svelte';
	import CalcRollingValue from './CalcRollingValue.svelte';
	import { bumpOn, markFresh } from '$lib/calc/motion';
	import { setCalcContext, type CalcField } from './calcContext';

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
	/** What was being typed before ↑, restored by ↓ past the newest line. */
	let historyDraft = '';
	let confirmClear = $state(false);
	let confirmTimer: ReturnType<typeof setTimeout> | null = null;
	/** The line's field while one is being edited; the keypad types there instead of the entry. */
	let editField = $state.raw<CalcField | null>(null);
	let scratch = $state<ReturnType<typeof CalcScratch> | null>(null);
	let liveEdit = $state.raw<{ id: string; input: string } | null>(null);
	const entryField: CalcField = {
		get el() { return inputEl; },
		get value() { return draft; },
		set: (next) => setDraft(next),
		commit: () => commit(),
	};

	// Every sheet is re-evaluated through its dependency graph on every change, so editing
	// one line flows into every @ref, name, #tag and parent `sub` that reads it.
	// A line being edited counts with its unsaved text, so the tape reacts as you type.
	const allResults = $derived(
		evaluateSheets(
			calcSheets,
			liveEdit ? calcLines.map((l) => (l.id === liveEdit!.id ? { ...l, input: liveEdit!.input } : l)) : calcLines,
			calcUI.angle,
		),
	);
	setCalcContext({
		get results() { return allResults; },
		beginEdit(id, field) {
			editField = field;
			liveEdit = { id, input: calcLines.find((l) => l.id === id)?.input ?? '' };
		},
		target(field) {
			editField = field;
		},
		get hasTarget() { return editField !== null; },
		insert: (text) => insert(text),
		previewEdit(input) {
			if (liveEdit) liveEdit = { id: liveEdit.id, input };
		},
		endEdit(field) {
			if (editField !== field) return;
			editField = null;
			liveEdit = null;
		},
	});

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
		const all = evaluateTape([...sheetLines, { id: '__draft__', input }], calcUI.angle, {
			sub: (lineId) => {
				const child = subSheetOf(lineId);
				return child ? sheetResult(allResults.get(child.id) ?? []) : undefined;
			},
		});
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
		markFresh();
		// A line the active filter would hide must not vanish as it's added
		if (calcUI.activeTag && !splitLine(input).tags.includes(calcUI.activeTag)) calcUI.activeTag = null;
		addLine(toStored(labelDraft.trim() ? setLabel(input, labelDraft) : input, sheetLines));
		setDraft('');
		labelDraft = '';
		caret = 0;
	}

	/** Typed `*` and `/` become × and ÷ so the field reads like the keypad. */
	function handleInput(e: Event) {
		const el = e.currentTarget as HTMLInputElement;
		const raw = el.value;
		const next = typeOperators(raw);
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
			if (historyIdx === null) historyDraft = draft;
			recall(Math.max(0, (historyIdx ?? sheetLines.length) - 1));
		} else if (e.key === 'ArrowDown' && historyIdx !== null) {
			e.preventDefault();
			if (historyIdx + 1 >= sheetLines.length) setDraft(historyDraft);
			else recall(historyIdx + 1);
		}
	}

	async function insert(text: string) {
		const field = editField ?? entryField;
		const isEntry = field === entryField;
		// An operator on an empty field continues from the last result, like a desk calculator
		if (isEntry && !draft.trim() && /^[+×÷^-]$/.test(text) && sheetLines.length > 0) text = 'ans' + text;

		const el = field.el;
		const value = field.value;
		const focused = el && document.activeElement === el;
		const start = focused ? (el.selectionStart ?? value.length) : value.length;
		const end = focused ? (el.selectionEnd ?? value.length) : value.length;
		field.set(value.slice(0, start) + text + value.slice(end));

		await tick();
		el?.focus();
		el?.setSelectionRange(start + text.length, start + text.length);
		if (isEntry) caret = start + text.length;
	}

	async function backspace() {
		const field = editField ?? entryField;
		const el = field.el;
		const value = field.value;
		const focused = el && document.activeElement === el;
		let start = focused ? (el.selectionStart ?? value.length) : value.length;
		const end = focused ? (el.selectionEnd ?? value.length) : value.length;
		if (start === end) start = Math.max(0, start - 1);
		field.set(value.slice(0, start) + value.slice(end));
		await tick();
		el?.setSelectionRange(start, start);
		if (field === entryField) caret = start;
	}

	function handleAction(action: KeyAction) {
		const field = editField ?? entryField;
		// `ans` shortcuts on an empty field are for new lines only
		const hasPrev = field === entryField && sheetLines.length > 0;
		const s = field.value.trim();
		switch (action) {
			case 'clear':  field.set(''); break;
			case 'back':   backspace(); break;
			case 'equals': field.commit(); break;
			case 'sign': {
				if (s) field.set(mapExpr(s, negateExpr));
				else if (hasPrev) field.set('-ans');
				break;
			}
			case 'recip':
				if (s) field.set(mapExpr(s, (expr) => `1÷(${expr})`));
				else if (hasPrev) field.set('1÷ans');
				break;
		}
		// After `=` on a line, editField is clear again and focus returns to the entry
		(editField ?? entryField).el?.focus();
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
			<span class="toolbar-gap"></span>
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
						use:bumpOn={info.value}
						onclick={() => insert(info.name ?? `@${i + 1}`)}
						title="Insert {info.name ?? `@${i + 1}`}"
					>
						<span class="pin-name">{info.label ?? info.name ?? `@${i + 1}`}</span>
						<span class="pin-value" class:err={info.value === undefined}>
							<CalcRollingValue text={info.value !== undefined ? formatNumber(info.value) : 'error'} delay={240} />
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
						style:--tag-fg="var(--tag-{tagTone(s.tag)}-fg)"
						use:bumpOn={s.total}
						class:on={calcUI.activeTag === s.tag}
						onclick={() => toggleTag(s.tag)}
						title="{s.count} {s.count === 1 ? 'line' : 'lines'}{s.errors ? ` · ${s.errors} with errors` : ''} — use #{s.tag} in a calculation for this total"
					>
						<span class="chip-name">#{s.tag}</span>
						<span class="chip-total"><CalcRollingValue text={formatNumber(s.total)} delay={120} /></span>
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
				{#each sheetLines as line, i (line.id)}
					{@const info = results[i] ?? { expr: '', tags: [] }}
					<CalcLineRow
						{line}
						index={i}
						{info}
						{idIndex}
						{names}
						hidden={!!calcUI.activeTag && !info.tags.includes(calcUI.activeTag)}
						onUse={insert}
					/>
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

	<aside class="keypad-col" class:editing={editField !== null}>
		<CalcScratch
			bind:this={scratch}
			onTarget={(field) => (editField = field)}
			onRelease={(field) => { if (editField === field) editField = null; }}
		/>
		<CalcKeypad onInsert={insert} onAction={handleAction} onScratch={() => scratch?.show()} />
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
	.tape-col, .keypad-col { animation: rise 600ms var(--ease-out) backwards; }
	.keypad-col { animation-delay: 80ms; }
	@keyframes rise {
		from { transform: translateY(26px); opacity: 0; }
	}

	.tape-col {
		position: relative;
		flex: 1;
		min-height: 0;
		display: flex;
		flex-direction: column;
		background: var(--color-bg-surface);
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
	.toolbar-gap { flex: 1; }
	.count { font-size: 0.65rem; color: var(--color-text-muted); flex-shrink: 0; }

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
		color: var(--color-danger);
		border-color: color-mix(in srgb, var(--color-danger) 40%, transparent);
	}

	.pin-strip {
		display: flex;
		gap: 0.375rem;
		padding: 0.5rem 0.75rem;
		border-bottom: 1px solid var(--color-border-subtle);
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
		background: var(--color-accent);
		border: none;
		border-radius: 13px;
		padding: 0.4rem 0.8rem;
		font-family: inherit;
		text-align: left;
		transition: filter 0.1s;
	}
	.pin:hover { filter: brightness(1.08); }
	.pin-name {
		max-width: 12rem;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-size: 0.65rem;
		font-weight: 600;
		color: var(--color-on-accent);
		opacity: 0.8;
	}
	.pin-value {
		font-size: 1.05rem;
		font-weight: 800;
		color: var(--color-on-accent);
		font-variant-numeric: tabular-nums;
	}
	.pin-value.err { font-size: 0.7rem; }

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
		font-size: 0.66rem;
		font-weight: 600;
		color: var(--color-text-secondary);
		transition: color 0.2s, border-color 0.2s, background 0.2s;
	}
	.chip:focus-visible, .pin:focus-visible, .completion:focus-visible { outline-offset: -2px; }
	.chip.on {
		color: var(--color-bg-surface);
		border-color: var(--color-text-primary);
		background: var(--color-text-primary);
	}
	@media (hover: hover) {
		.chip:not(.on):hover { color: var(--color-text-primary); background: var(--color-bg-hover); }
		.chip.on:hover { background: color-mix(in srgb, var(--color-text-primary) 82%, var(--color-bg-surface)); }
	}
	.chip.tag .chip-name { color: var(--tag-fg); }
	.chip.tag.on .chip-name, .chip.on .chip-total { color: var(--color-bg-surface); }
	.chip-total { font-variant-numeric: tabular-nums; color: var(--color-text-primary); }
	.chip-warn { color: var(--color-danger); font-weight: 600; }

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
	.filter-tag { color: var(--color-accent-calc); }
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
		background: var(--color-bg-panel);
		flex-shrink: 0;
	}
	.entry:focus-within { background: var(--color-bg-active); }
	.prompt { color: var(--color-accent-calc); font-size: 1.1rem; line-height: 1; }

	/* Doubled class so it outranks the `.entry input` rule for the expression field */
	.entry .entry-label {
		flex: 0 0 8rem;
		width: 8rem;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-subtle);
		border-radius: 9px;
		padding: 0.3rem 0.5rem;
		font-family: inherit;
		font-size: 0.75rem;
		color: var(--color-text-primary);
		outline: none;
		transition: border-color 0.15s;
	}
	.entry .entry-label::placeholder { color: var(--color-text-muted); }
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
		font-size: 1.1rem;
		font-weight: 600;
		color: var(--color-text-primary);
		caret-color: var(--color-accent-calc);
	}
	.entry input::placeholder { color: var(--color-text-muted); }
	/* The field's only focus cue besides the row tint: an underline, never an outer box */
	.entry input:focus { box-shadow: inset 0 -2px 0 var(--color-accent-calc); }

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
	.preview.soft { font-size: 0.68rem; color: var(--color-text-muted); }
	.preview.err { font-size: 0.7rem; color: var(--color-danger); }

	/* The smallest phones: a long answer must not squeeze the field being typed in */
	@media (max-width: 380px) {
		.entry .entry-label { flex-basis: 4rem; width: 4rem; }
		.preview { max-width: 30%; }
	}

	/* 40px touch targets, without moving anything */
	@media (pointer: coarse) {
		.clear-btn, .filter-clear, .toast button { position: relative; }
		.clear-btn::after, .filter-clear::after, .toast button::after, .chip::after {
			content: '';
			position: absolute;
			left: 0;
			right: 0;
			top: 50%;
			height: 40px;
			transform: translateY(-50%);
		}
		.chip { position: relative; }
		.entry input:not(.entry-label) { padding-block: 9px; margin-block: -9px; }
	}

	/* The keypad is typing into a line on the tape, not the entry */
	.keypad-col.editing :global(.keypad) {
		box-shadow: 0 0 0 1.5px var(--color-accent), var(--shadow-card);
	}

	/* Wide screens: keypad sits beside the tape, which gets the full height */
	@media (min-width: 1024px) {
		.calc {
			flex-direction: row;
			max-width: 1180px;
			padding: 1rem;
			gap: 1rem;
		}
		.tape-col {
			border-radius: 20px;
			box-shadow: var(--shadow-card);
			overflow: hidden;
		}
		.keypad-col {
			width: 340px;
			flex-shrink: 0;
			display: flex;
			flex-direction: column;
			justify-content: flex-end;
			gap: 0.75rem;
		}
		.keypad-col :global(.keypad) {
			border-radius: 20px;
			padding: 0.875rem;
		}
	}
</style>
