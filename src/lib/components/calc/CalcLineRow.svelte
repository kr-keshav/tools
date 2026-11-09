<script lang="ts">
	import { onDestroy, onMount, tick, untrack } from 'svelte';
	import {
		calcUI,
		updateLine,
		deleteLine,
		togglePin,
		setNote,
		subSheetOf,
		linesOf,
		canBreakOut,
		breakIntoSubCalc,
		toggleExpanded,
		type CalcLine,
	} from '$lib/stores/calcState.svelte';
	import { formatNumber, prepareInput, prettyExpr } from '$lib/calc/engine';
	import { addTags, highlight, setLabel, splitLine, syntaxError, tagTone, toDisplay, toStored, type LineInfo } from '$lib/calc/tape';
	import { nextCascadeDelay, rise, takeFresh, wash } from '$lib/calc/motion';
	import CalcRollingValue from './CalcRollingValue.svelte';
	import { getCalcContext, type CalcField } from './calcContext';
	import CalcSubTape from './CalcSubTape.svelte';

	let {
		line,
		index,
		info,
		idIndex,
		names,
		depth = 0,
		hidden = false,
		onUse,
	}: {
		line: CalcLine;
		index: number;
		info: LineInfo;
		idIndex: Map<string, number>;
		/** Lower-cased variable names on this line's sheet, for highlighting. */
		names: Set<string>;
		/** 0 on a tab; 1+ inside a sub-calculation. */
		depth?: number;
		/** Filtered out by the active tag; kept mounted so it can fold away. */
		hidden?: boolean;
		/** Drop a reference to this line into the entry field. */
		onUse: (text: string) => void;
	} = $props();

	let editing = $state(false);
	let draft = $state('');
	let inputEl = $state<HTMLInputElement | null>(null);
	let copied = $state(false);
	let menuOpen = $state(false);
	let noteOpen = $state(false);
	let noteDraft = $state('');
	let noteEl = $state<HTMLTextAreaElement | null>(null);
	let rowEl = $state<HTMLDivElement | null>(null);
	let labelEditing = $state(false);
	let labelDraft = $state('');
	let labelEl = $state<HTMLInputElement | null>(null);
	let tagEditing = $state(false);
	let tagDraft = $state('');
	let tagEl = $state<HTMLInputElement | null>(null);
	let rootEl = $state<HTMLDivElement | null>(null);
	let rollDelay = $state(0);
	let lastValue = untrack(() => info.value);

	onMount(() => {
		if (takeFresh() && rootEl) rise(rootEl);
	});

	// A change arriving from elsewhere on the tape washes the row; the row being typed in
	// is already the focus, so its digits just roll.
	$effect.pre(() => {
		const value = info.value;
		untrack(() => {
			if (value === lastValue) return;
			lastValue = value;
			if (value === undefined || !rowEl) return;
			rollDelay = editing ? 0 : nextCascadeDelay();
			if (!editing) wash(rowEl, rollDelay);
		});
	});

	const segments = $derived(highlight(toDisplay(info.expr, idIndex), names));
	const refText = $derived(info.name ?? `@${index + 1}`);
	const subSheet = $derived(subSheetOf(line.id));
	const subCount = $derived(subSheet ? linesOf(subSheet.id).length : 0);
	const expanded = $derived(!!subSheet && !!calcUI.expanded[line.id]);
	const breakable = $derived(!subSheet && canBreakOut(line));

	const ctx = getCalcContext();
	const editField: CalcField = {
		get el() { return inputEl; },
		get value() { return draft; },
		set: setDraft,
		commit,
	};

	onDestroy(() => ctx.endEdit(editField));

	async function startEdit() {
		// The label has its own editor, so this field only holds what follows it
		draft = toDisplay(setLabel(line.input, ''), idIndex);
		editing = true;
		ctx.beginEdit(line.id, editField);
		await tick();
		inputEl?.focus();
		// Caret at the end: the next key carries the sum on instead of wiping the line
		inputEl?.setSelectionRange(draft.length, draft.length);
	}

	/** What the line would store for this text, with its saved label still on it. */
	function toInput(text: string): string {
		const body = toStored(prepareInput(text), linesOf(line.sheetId));
		const saved = splitLine(line.input).label;
		// A label typed into this field on purpose replaces the existing one
		return saved && !splitLine(body).label ? setLabel(body, saved) : body;
	}

	function setDraft(next: string) {
		draft = next;
		const text = next.trim();
		// Half-typed expressions like `25+` keep showing the last result that made sense
		if (!text) ctx.previewEdit(line.input);
		else if (!syntaxError(prepareInput(text))) ctx.previewEdit(toInput(text));
	}

	function stopEdit() {
		editing = false;
		ctx.endEdit(editField);
	}

	function commit() {
		if (!editing) return;
		const next = draft.trim();
		stopEdit();
		// Emptying the field (AC is one tap away) leaves the line alone; deleting is in the ⋯ menu
		if (next) updateLine(line.id, { input: toInput(next) });
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commit(); }
		if (e.key === 'Escape') { e.preventDefault(); stopEdit(); }
	}

	async function startLabel() {
		menuOpen = false;
		labelDraft = info.label ?? '';
		labelEditing = true;
		await tick();
		labelEl?.focus();
		labelEl?.select();
	}

	function commitLabel() {
		if (!labelEditing) return;
		labelEditing = false;
		updateLine(line.id, { input: setLabel(line.input, labelDraft) });
	}

	function handleLabelKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitLabel(); }
		if (e.key === 'Escape') { e.preventDefault(); labelEditing = false; }
	}

	async function startTag() {
		menuOpen = false;
		tagDraft = '';
		tagEditing = true;
		await tick();
		tagEl?.focus();
	}

	function commitTag() {
		if (!tagEditing) return;
		tagEditing = false;
		const next = addTags(line.input, tagDraft);
		if (next !== line.input) updateLine(line.id, { input: next });
	}

	function handleTagKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitTag(); }
		if (e.key === 'Escape') { e.preventDefault(); tagEditing = false; }
	}

	function toggleTag(tag: string) {
		// Tags filter the open tab; inside a sub-calc they're just labels
		if (depth > 0) return;
		calcUI.activeTag = calcUI.activeTag === tag ? null : tag;
	}

	async function copyResult() {
		if (info.value === undefined) return;
		try {
			await navigator.clipboard.writeText(String(info.value));
			copied = true;
			setTimeout(() => (copied = false), 1200);
		} catch { /* clipboard blocked — nothing useful to do */ }
	}

	async function openNote() {
		menuOpen = false;
		noteDraft = line.note ?? '';
		noteOpen = true;
		await tick();
		noteEl?.focus();
	}

	function commitNote() {
		if (!noteOpen) return;
		noteOpen = false;
		setNote(line.id, noteDraft);
	}

	function handleNoteKey(e: KeyboardEvent) {
		if (e.key === 'Escape') { e.preventDefault(); noteOpen = false; }
		if (e.key === 'Enter' && !e.shiftKey) { e.preventDefault(); commitNote(); }
	}

	function menuAction(fn: () => void) {
		menuOpen = false;
		fn();
	}

	/** Any click outside this row closes its menu — including opening another row's. */
	function handleWindowClick(e: MouseEvent) {
		if (menuOpen && !rowEl?.contains(e.target as Node)) menuOpen = false;
	}

	function handleWindowKey(e: KeyboardEvent) {
		if (menuOpen && e.key === 'Escape') menuOpen = false;
	}
</script>

<svelte:window onclick={handleWindowClick} onkeydown={handleWindowKey} />

<div class="line" class:pinned={line.pinned} class:hide={hidden} inert={hidden} bind:this={rootEl}>
	<div class="clip">
	<div
		class="row"
		style:--wash={info.tags[0] ? `var(--tag-${tagTone(info.tags[0])}-fg)` : 'var(--color-accent)'}
		bind:this={rowEl}
		class:error={info.error !== undefined} class:editing
		class:menu-open={menuOpen}
	>
		<span class="idx">{index + 1}</span>

		<div class="expr">
			{#if subSheet}
				<button
					class="sub-toggle"
					class:open={expanded}
					onclick={() => toggleExpanded(line.id)}
					aria-expanded={expanded}
					title={expanded ? 'Hide sub-calc' : 'Show sub-calc'}
				>
					<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M3.5 2l3 3-3 3" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
					<span>{subCount}</span>
				</button>
			{/if}
			{#if labelEditing}
				<input
					class="label-input"
					bind:this={labelEl}
					bind:value={labelDraft}
					onkeydown={handleLabelKey}
					onblur={commitLabel}
					placeholder="Label"
					maxlength="60"
					spellcheck="false"
					autocomplete="off"
					aria-label="Label for line {index + 1}"
				/>
			{:else if info.label}
				<button class="label" onclick={startLabel} title="Edit label">{info.label}</button>
			{/if}
			{#if editing}
				<input
					class="expr-input"
					bind:this={inputEl}
					value={draft}
					oninput={(e) => setDraft(e.currentTarget.value)}
					onkeydown={handleKey}
					onblur={commit}
					inputmode={calcUI.keypadOpen ? 'none' : 'text'}
					spellcheck="false"
					autocomplete="off"
					autocapitalize="off"
					aria-label="Edit line {index + 1}"
				/>
			{:else}
				<button class="expr-btn" onclick={startEdit} title="Edit — lines that use this one recalculate">
					{#if info.name}<span class="def">{info.name}</span><span class="eq">=</span>{/if}{#each segments as seg, i (i)}{#if seg.kind === 'text'}{prettyExpr(seg.text)}{:else}<span class="seg-{seg.kind}">{seg.text}</span>{/if}{/each}
				</button>
				{#if line.note && !noteOpen}
					<button class="note-dot" onclick={openNote} title={line.note} aria-label="Edit note">
						<svg width="11" height="11" viewBox="0 0 11 11" fill="none"><path d="M2 1.5h7v6l-2 2H2z" stroke="currentColor" stroke-width="1"/><path d="M4 4h3M4 6h2" stroke="currentColor" stroke-width="1" stroke-linecap="round"/></svg>
					</button>
				{/if}
				{#if info.tags.length > 0}
					<span class="tags">
						{#each info.tags as tag (tag)}
							<button
								class="tag"
								style:--tag-bg="var(--tag-{tagTone(tag)}-bg)"
								style:--tag-fg="var(--tag-{tagTone(tag)}-fg)"
								class:on={depth === 0 && calcUI.activeTag === tag}
								onclick={() => toggleTag(tag)}
								title={depth > 0 ? `#${tag}` : calcUI.activeTag === tag ? 'Show all lines' : `Show only #${tag}`}
							>#{tag}</button>
						{/each}
					</span>
				{/if}
				{#if tagEditing}
					<input
						class="tag-input"
						bind:this={tagEl}
						bind:value={tagDraft}
						onkeydown={handleTagKey}
						onblur={commitTag}
						placeholder="#tag"
						maxlength="60"
						spellcheck="false"
						autocomplete="off"
						autocapitalize="off"
						aria-label="Add tags to line {index + 1}"
					/>
				{/if}
				<!-- Trails the expression so revealing it on hover doesn't shift anything -->
				{#if !info.label && !labelEditing}
					<button class="add-label" onclick={startLabel} title="Add a label">+ label</button>
				{/if}
			{/if}
		</div>

		<div class="result">
			{#if info.value !== undefined}
				<button
					class="value"
					onclick={() => onUse(refText)}
					title="Insert {refText} — a live link that updates when this line changes"
				><CalcRollingValue text={formatNumber(info.value)} delay={rollDelay} /></button>
			{:else}
				<span class="err" title={info.error}>{info.error}</span>
			{/if}
		</div>

		<div class="actions">
			<button
				class="act"
				onclick={copyResult}
				disabled={info.value === undefined}
				title={copied ? 'Copied' : 'Copy result'}
				aria-label="Copy result"
			>
				{#if copied}
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><path d="M2.5 6.5l2.5 2.5 4.5-5.5" stroke="currentColor" stroke-width="1.3" stroke-linecap="round" stroke-linejoin="round"/></svg>
				{:else}
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><rect x="4" y="4" width="6.5" height="6.5" rx="1" stroke="currentColor" stroke-width="1.1"/><path d="M8 4V2.5a1 1 0 0 0-1-1H2.5a1 1 0 0 0-1 1V7a1 1 0 0 0 1 1H4" stroke="currentColor" stroke-width="1.1"/></svg>
				{/if}
			</button>
			<button
				class="act"
				onclick={() => (menuOpen = !menuOpen)}
				aria-haspopup="menu"
				aria-expanded={menuOpen}
				aria-label="More actions"
				title="More"
			>
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none"><circle cx="2.5" cy="6" r="1" fill="currentColor"/><circle cx="6" cy="6" r="1" fill="currentColor"/><circle cx="9.5" cy="6" r="1" fill="currentColor"/></svg>
			</button>
		</div>

		{#if menuOpen}
			<div class="menu" role="menu">
				<button role="menuitem" onclick={startLabel}>{info.label ? 'Edit label' : 'Add label'}</button>
				<button role="menuitem" onclick={startTag}>Add tag</button>
				{#if depth === 0}
					<button role="menuitem" onclick={() => menuAction(() => togglePin(line.id))}>
						{line.pinned ? 'Unpin' : 'Pin to top'}
					</button>
				{/if}
				<button role="menuitem" onclick={openNote}>{line.note ? 'Edit note' : 'Add note'}</button>
				{#if breakable}
					<button role="menuitem" onclick={() => menuAction(() => breakIntoSubCalc(line.id))} title="Move this line's working into an expandable sub-calc">
						Break into sub-calc
					</button>
				{/if}
				<button role="menuitem" onclick={() => menuAction(() => onUse(refText))}>Insert {refText}</button>
				<button role="menuitem" class="danger" onclick={() => menuAction(() => deleteLine(line.id))}>
					{subSheet ? 'Delete line and sub-calc' : 'Delete'}
				</button>
			</div>
		{/if}
	</div>

	{#if noteOpen}
		<div class="note-edit">
			<textarea
				bind:this={noteEl}
				bind:value={noteDraft}
				onblur={commitNote}
				onkeydown={handleNoteKey}
				rows="2"
				placeholder="Note — what this number is, where it came from…"
				aria-label="Note for line {index + 1}"
			></textarea>
		</div>
	{:else if line.note}
		<button class="note" onclick={openNote} title="Edit note">{line.note}</button>
	{/if}

	{#if expanded && subSheet}
		<CalcSubTape sheetId={subSheet.id} depth={depth + 1} />
	{/if}
	</div>
</div>

<style>
	.line {
		display: grid;
		grid-template-rows: 1fr;
		border-bottom: 1px solid var(--color-border-subtle);
		transition: grid-template-rows 320ms var(--ease-out), opacity 250ms;
	}
	.line.hide { grid-template-rows: 0fr; opacity: 0; border-bottom-color: transparent; }
	.clip { min-height: 0; animation: unclip 320ms; }
	.line.hide .clip { overflow: hidden; }
	/* Only clip while folding: at rest the ⋯ menu has to escape the row */
	@keyframes unclip { from, to { overflow: hidden; } }
	.line:last-child { border-bottom: none; }
	.line.pinned > .clip > .row .idx { color: var(--color-accent-calc); }

	.row {
		position: relative;
		display: grid;
		grid-template-columns: 2rem minmax(0, 1fr) auto 3.5rem;
		align-items: center;
		gap: 0.5rem;
		min-height: 40px;
		padding: 0 0.5rem 0 0.25rem;
		transition: background 0.1s;
	}
	.row:hover, .row.menu-open { background: var(--color-bg-panel); }
	.row.editing { background: var(--color-bg-active); }

	.idx {
		font-size: 0.65rem;
		color: var(--color-text-faint);
		text-align: right;
		font-variant-numeric: tabular-nums;
	}

	.expr {
		min-width: 0;
		display: flex;
		align-items: center;
		gap: 0.5rem;
	}

	.sub-toggle {
		display: flex;
		align-items: center;
		gap: 0.2rem;
		flex-shrink: 0;
		background: color-mix(in srgb, var(--color-accent-calc) 10%, transparent);
		border: 1px solid color-mix(in srgb, var(--color-accent-calc) 30%, transparent);
		border-radius: 4px;
		padding: 0.1rem 0.3rem;
		font-family: inherit;
		font-size: 0.6rem;
		color: var(--color-accent-calc);
		transition: background 0.1s;
	}
	.sub-toggle:hover { background: color-mix(in srgb, var(--color-accent-calc) 20%, transparent); }
	.sub-toggle svg { transition: transform 0.15s; }
	.sub-toggle.open svg { transform: rotate(90deg); }

	.expr-btn {
		min-width: 0;
		flex: 0 1 auto;
		background: none;
		border: none;
		padding: 0.5rem 0;
		text-align: left;
		font-family: inherit;
		font-size: 0.8rem;
		color: var(--color-text-secondary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: text;
	}
	.expr-btn:hover { color: var(--color-text-primary); }

	.label {
		flex-shrink: 1;
		min-width: 0;
		max-width: 50%;
		margin-right: -0.125rem;
		background: none;
		border: none;
		padding: 0.5rem 0;
		font-family: inherit;
		font-size: 0.85rem;
		font-weight: 700;
		color: var(--color-text-primary);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
		cursor: text;
	}
	.label:hover { text-decoration: underline dotted var(--color-text-muted); text-underline-offset: 3px; }

	.label-input {
		width: 11rem !important;
		flex-shrink: 0;
	}

	.add-label {
		flex-shrink: 0;
		background: none;
		border: 1px dashed var(--color-border-default);
		border-radius: 4px;
		padding: 0.05rem 0.4rem;
		font-family: inherit;
		font-size: 0.6rem;
		color: var(--color-text-muted);
		opacity: 0;
		transition: opacity 0.1s, color 0.1s, border-color 0.1s;
	}
	.row:hover .add-label, .add-label:focus-visible { opacity: 1; }
	.add-label:hover { color: var(--color-text-primary); border-color: var(--color-text-muted); }
	/* Touch screens get "Add label" in the ⋯ menu instead of a hover-only button */
	@media (hover: none) {
		.add-label { display: none; }
	}
	.def { color: var(--color-text-primary); font-weight: 700; }
	.eq  { color: var(--color-text-faint); margin: 0 0.45em; }
	.seg-var { color: var(--color-text-primary); }
	.seg-ref { color: var(--color-accent-calc); }
	.seg-tag { color: var(--color-accent-calc); }
	.seg-bad { color: var(--color-danger); }

	.note-dot {
		display: flex;
		flex-shrink: 0;
		background: none;
		border: none;
		padding: 0;
		color: var(--color-text-muted);
	}
	.note-dot:hover { color: var(--color-text-primary); }

	.tags {
		display: flex;
		gap: 0.25rem;
		flex-shrink: 0;
	}
	.tag {
		background: var(--tag-bg);
		border: none;
		border-radius: 10px;
		padding: 0.1rem 0.5rem;
		font-family: inherit;
		font-size: 0.66rem;
		font-weight: 600;
		color: var(--tag-fg);
		transition: filter 0.1s;
	}
	.tag:hover, .tag.on { filter: brightness(0.94); }

	.expr input {
		width: 100%;
		background: var(--color-bg-surface);
		border: 1.5px solid var(--color-border-default);
		border-radius: 9px;
		padding: 0.3rem 0.5rem;
		font-family: inherit;
		font-size: 0.8rem;
		color: var(--color-text-primary);
		outline: none;
	}
	.expr input:focus { border-color: var(--color-accent); }
	.expr .expr-input { flex: 1; min-width: 0; caret-color: var(--color-accent-calc); }
	.expr .tag-input { flex: 0 1 8rem; width: 8rem; min-width: 0; }

	/* The line being edited is the calculator's display for now */
	.row.editing .idx, .row.editing .value { color: var(--color-accent); }

	.result {
		text-align: right;
		min-width: 0;
		max-width: 24ch;
	}

	.value {
		background: none;
		border: none;
		padding: 0.25rem 0.375rem;
		border-radius: 4px;
		font-family: inherit;
		font-size: 0.95rem;
		font-weight: 700;
		color: var(--color-text-primary);
		font-variant-numeric: tabular-nums;
		white-space: nowrap;
		transition: background 0.1s, color 0.1s;
	}
	.value:hover {
		background: color-mix(in srgb, var(--color-accent-calc) 15%, transparent);
		color: var(--color-accent-calc);
	}

	.err {
		display: block;
		font-size: 0.7rem;
		color: var(--color-danger);
		white-space: nowrap;
		overflow: hidden;
		text-overflow: ellipsis;
	}

	.actions {
		display: flex;
		justify-content: flex-end;
		gap: 0.125rem;
		opacity: 0;
		transition: opacity 0.1s;
	}
	.row:hover .actions, .row:focus-within .actions, .row.menu-open .actions { opacity: 1; }

	/* No hover on touch screens — keep the actions visible */
	@media (hover: none) {
		.actions { opacity: 1; }
	}

	.act {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: none;
		border: none;
		border-radius: 4px;
		color: var(--color-text-muted);
		transition: color 0.1s, background 0.1s;
	}
	.act:hover:not(:disabled) { color: var(--color-text-primary); background: var(--color-bg-hover); }
	.act:disabled { opacity: 0.3; cursor: default; }

	.menu {
		position: absolute;
		top: calc(100% - 4px);
		right: 0.5rem;
		z-index: 20;
		min-width: 190px;
		padding: 0.3rem;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-default);
		border-radius: 14px;
		box-shadow: var(--shadow-card);
		animation: pop 420ms var(--ease-spring) backwards;
		transform-origin: top right;
	}
	@keyframes pop {
		from { transform: scale(0.85); opacity: 0; }
	}
	.menu button {
		display: block;
		width: 100%;
		background: none;
		border: none;
		border-radius: 5px;
		padding: 0.4rem 0.55rem;
		text-align: left;
		font-family: inherit;
		font-size: 0.72rem;
		color: var(--color-text-secondary);
		transition: background 0.1s, color 0.1s;
	}
	.menu button:hover { background: var(--color-bg-hover); color: var(--color-text-primary); }
	.menu button.danger:hover { color: var(--color-danger); }

	.note {
		display: block;
		width: 100%;
		background: none;
		border: none;
		padding: 0 0.75rem 0.5rem 2.75rem;
		margin-top: -0.25rem;
		text-align: left;
		font-family: inherit;
		font-size: 0.68rem;
		line-height: 1.5;
		color: var(--color-text-muted);
		white-space: pre-wrap;
		cursor: text;
	}
	.note:hover { color: var(--color-text-secondary); }

	.note-edit { padding: 0 0.75rem 0.5rem 2.75rem; }
	.note-edit textarea {
		width: 100%;
		resize: vertical;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-default);
		border-radius: 5px;
		padding: 0.375rem 0.5rem;
		font-family: inherit;
		font-size: 0.7rem;
		line-height: 1.5;
		color: var(--color-text-primary);
		outline: none;
	}
	.note-edit textarea:focus { border-color: color-mix(in srgb, var(--color-accent-calc) 60%, transparent); }

	/* Phones: tags drop under the expression so the result keeps its width */
	@media (max-width: 560px) {
		.expr { flex-wrap: wrap; row-gap: 0; }
		.tags { padding-bottom: 0.375rem; }
	}
</style>
