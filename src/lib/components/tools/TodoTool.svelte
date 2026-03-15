<script lang="ts">
	import { tick } from 'svelte';
	import {
		tasks,
		todoUI,
		addTask,
		updateTask,
		reorderTask,
		undo,
		exportTasks,
		groupActiveTasks,
		extractDueDate,
	} from '$lib/stores/todoState.svelte';
	import TodoSection from '$lib/components/todo/TodoSection.svelte';
	import TodoCompletedSection from '$lib/components/todo/TodoCompletedSection.svelte';
	import TodoShortcutOverlay from '$lib/components/todo/TodoShortcutOverlay.svelte';
	import TodoTabBar from '$lib/components/todo/TodoTabBar.svelte';

	let showShortcuts = $state(false);
	let showFilter = $state(false);

	let addInputEl: HTMLInputElement | null = null;
	let filterInputEl = $state<HTMLInputElement | null>(null);
	let addDraft = $state('');

	// ── Derived views (all scoped to active tab) ───────────────────
	const tabTasks = $derived(tasks.filter((t) => t.tabId === todoUI.activeTabId));
	const allTags = $derived([...new Set(tabTasks.flatMap((t) => t.tags))].sort());
	const activeTasks = $derived(tabTasks.filter((t) => !t.completed));
	const completedTasks = $derived(
		tabTasks.filter((t) => t.completed).sort((a, b) => (b.completedAt ?? 0) - (a.completedAt ?? 0))
	);

	const filteredActive = $derived.by(() => {
		let result = tabTasks.filter((t) => !t.completed);

		const lower = todoUI.filterText.toLowerCase().trim();
		if (lower) {
			if (lower.startsWith('#')) {
				const tag = lower.slice(1);
				result = result.filter((t) => t.tags.some((tg) => tg.toLowerCase().includes(tag)));
			} else if (lower.startsWith('p:')) {
				const map: Record<string, number> = { high: 3, med: 2, medium: 2, low: 1, none: 0 };
				const p = map[lower.slice(2)];
				if (p !== undefined) result = result.filter((t) => t.priority === p);
			} else if (lower === 'due:today') {
				const today = new Date().toISOString().slice(0, 10);
				result = result.filter((t) => t.dueDate === today);
			} else if (lower === 'due:overdue') {
				const today = new Date().toISOString().slice(0, 10);
				result = result.filter((t) => t.dueDate && t.dueDate < today);
			} else {
				result = result.filter((t) => t.title.toLowerCase().includes(lower));
			}
		}

		if (todoUI.activeTags.length > 0) {
			result = result.filter((t) => todoUI.activeTags.every((tag) => t.tags.includes(tag)));
		}

		return result;
	});

	const sections = $derived(groupActiveTasks(filteredActive));
	const hasAnyTasks = $derived(activeTasks.length > 0 || completedTasks.length > 0);
	const isFiltered = $derived(todoUI.filterText.length > 0 || todoUI.activeTags.length > 0);

	// ── Mount ─────────────────────────────────────────────────────
	// ── Add task ─────────────────────────────────────────────────
	function submitAdd() {
		const raw = addDraft.trim();
		if (!raw) return;
		const { title, dueDate } = extractDueDate(raw);
		addTask(title, dueDate);
		addDraft = '';
	}

	// ── Tag filter toggle ─────────────────────────────────────────
	function toggleTagFilter(tag: string) {
		const idx = todoUI.activeTags.indexOf(tag);
		if (idx !== -1) todoUI.activeTags.splice(idx, 1);
		else todoUI.activeTags.push(tag);
	}

	// ── Global keyboard handler ───────────────────────────────────
	function handleGlobalKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		const isInput = target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable;

		if (e.key === 'Escape') {
			if (showShortcuts) { showShortcuts = false; return; }
			if (showFilter) { showFilter = false; todoUI.filterText = ''; return; }
			if (todoUI.expandedTaskId) { todoUI.expandedTaskId = null; return; }
			return;
		}

		if ((e.ctrlKey || e.metaKey) && e.key === 'z' && todoUI.undoItem) {
			e.preventDefault();
			undo();
			return;
		}

		if (isInput) return;

		if (e.key === '?') {
			showShortcuts = !showShortcuts;
			return;
		}
		if (e.key === 'n') {
			e.preventDefault();
			addInputEl?.focus();
			return;
		}
		if (e.key === '/') {
			e.preventDefault();
			showFilter = true;
			tick().then(() => filterInputEl?.focus());
			return;
		}

		// Task-level fallback shortcuts
		if (todoUI.focusedTaskId) {
			if (e.key === 'p') {
				e.preventDefault();
				const task = tasks.find((t) => t.id === todoUI.focusedTaskId);
				if (task) updateTask(todoUI.focusedTaskId, { priority: ((task.priority + 1) % 4) as 0 | 1 | 2 | 3 });
			} else if (e.altKey && e.key === 'ArrowUp') {
				e.preventDefault();
				reorderTask(todoUI.focusedTaskId, 'up');
			} else if (e.altKey && e.key === 'ArrowDown') {
				e.preventDefault();
				reorderTask(todoUI.focusedTaskId, 'down');
			}
		}
	}
</script>

<svelte:window onkeydown={handleGlobalKey} />

<div class="flex flex-col h-full relative" aria-label="Todo" role="region">

	<!-- ── Tab bar ────────────────────────────────────────────────── -->
	<div class="px-4 pt-4">
		<TodoTabBar />
	</div>

	<div class="flex flex-col flex-1 p-4 pt-3 gap-3 overflow-hidden">

		<!-- ── Top bar ────────────────────────────────────────────── -->
		<div class="flex items-center gap-2 min-h-[1.5rem]">
			{#if showFilter}
				<input
					bind:this={filterInputEl}
					bind:value={todoUI.filterText}
					class="flex-1 bg-transparent border-none outline-none text-xs font-mono
					       text-text-primary placeholder-text-muted border-b border-accent-todo pb-1
					       transition-colors duration-150"
					placeholder="Search or #tag or p:high or due:today…"
					autocomplete="off"
					spellcheck="false"
					onblur={() => { if (!todoUI.filterText) showFilter = false; }}
				/>
				<button
					onclick={() => { todoUI.filterText = ''; showFilter = false; }}
					class="text-text-muted hover:text-text-primary text-xs transition-colors shrink-0"
					aria-label="Clear filter"
				>✕</button>
			{:else}
				<span class="text-xs font-mono text-text-muted flex-1">
					{activeTasks.length} task{activeTasks.length !== 1 ? 's' : ''}
					{#if isFiltered}
						<span class="text-accent-todo/70"> · filtered</span>
					{/if}
				</span>

				<button
					onclick={() => { showFilter = true; tick().then(() => filterInputEl?.focus()); }}
					class="text-text-muted/50 hover:text-text-muted transition-colors"
					aria-label="Filter tasks"
					title="Filter (/)"
				>
					<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
						<circle cx="5.5" cy="5.5" r="4" stroke="currentColor" stroke-width="1.2"/>
						<line x1="8.7" y1="8.7" x2="12" y2="12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
					</svg>
				</button>

				<button
					onclick={exportTasks}
					class="text-text-muted/50 hover:text-text-muted transition-colors"
					aria-label="Export tasks as JSON"
					title="Export JSON"
				>
					<svg width="13" height="13" viewBox="0 0 13 13" fill="none" aria-hidden="true">
						<path d="M6.5 2v7M3.5 6.5l3 3 3-3" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
						<path d="M2 10.5h9" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
					</svg>
				</button>

				<button
					onclick={() => (showShortcuts = true)}
					class="text-text-muted/50 hover:text-text-muted text-xs font-mono transition-colors"
					title="Keyboard shortcuts (?)"
					aria-label="Show keyboard shortcuts"
				>?</button>
			{/if}
		</div>

		<!-- ── Tag filter bar ───────────────────────────────────────── -->
		{#if allTags.length > 0}
			<div class="flex flex-wrap gap-1" role="group" aria-label="Tag filters">
				{#each allTags as tag}
					<button
						onclick={() => toggleTagFilter(tag)}
						class="text-[0.62rem] font-mono px-1.5 py-0.5 rounded border transition-colors duration-100
						       {todoUI.activeTags.includes(tag)
							       ? 'border-accent-todo text-accent-todo'
							       : 'border-border-default text-text-muted hover:text-text-secondary'}"
						aria-pressed={todoUI.activeTags.includes(tag)}
					>
						#{tag}
					</button>
				{/each}
			</div>
		{/if}

		<!-- ── Add input ─────────────────────────────────────────────── -->
		<form
			onsubmit={(e) => { e.preventDefault(); submitAdd(); }}
			class="flex items-center"
		>
			<input
				bind:this={addInputEl}
				bind:value={addDraft}
				class="flex-1 bg-transparent border-none outline-none text-[0.8rem] font-mono
				       text-text-primary placeholder-text-muted border-b border-border-default
				       focus:border-accent-todo pb-1.5 transition-colors duration-150"
				placeholder="Add a task… or 'buy milk tomorrow'"
				autocomplete="off"
				spellcheck="false"
				aria-label="New task title"
			/>
		</form>

		<!-- ── Task sections ─────────────────────────────────────────── -->
		<div
			class="flex-1 overflow-y-auto flex flex-col gap-3 pr-0.5"
			role="region"
			aria-label="Task list"
		>
			{#if sections.overdue.length > 0}
				<TodoSection title="Overdue" tasks={sections.overdue} accent="overdue" />
			{/if}

			{#if sections.today.length > 0}
				<TodoSection title="Today" tasks={sections.today} accent="today" />
			{/if}

			{#if sections.upcoming.length > 0}
				<TodoSection title="Upcoming" tasks={sections.upcoming} />
			{/if}

			{#if sections.noDate.length > 0}
				<TodoSection title="Tasks" tasks={sections.noDate} />
			{/if}

			{#if !hasAnyTasks}
				<div class="flex-1 flex items-center justify-center text-xs font-mono text-text-muted py-12">
					All clear — press N to add a task
				</div>
			{:else if filteredActive.length === 0 && isFiltered}
				<div class="flex items-center justify-center text-xs font-mono text-text-muted py-8">
					No tasks match the filter
				</div>
			{/if}

			<TodoCompletedSection tasks={completedTasks} />
		</div>

		<!-- ── Undo toast ─────────────────────────────────────────────── -->
		{#if todoUI.undoItem}
			<div
				class="flex items-center gap-2 px-3 py-2 rounded border border-border-default bg-bg-surface text-xs font-mono"
				role="status"
				aria-live="polite"
			>
				<span class="text-text-secondary flex-1 truncate">
					"{todoUI.undoItem.task.title}" {todoUI.undoItem.type === 'complete' ? 'completed' : 'deleted'}
				</span>
				<button
					onclick={undo}
					class="text-accent-todo hover:opacity-80 shrink-0 transition-opacity"
				>Undo</button>
			</div>
		{/if}

	</div>

	<!-- ── Shortcuts overlay ─────────────────────────────────────── -->
	{#if showShortcuts}
		<TodoShortcutOverlay onclose={() => (showShortcuts = false)} />
	{/if}
</div>
