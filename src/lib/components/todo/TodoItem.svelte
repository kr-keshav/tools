<script lang="ts">
	import { tick } from 'svelte';
	import { tagTone } from '$lib/calc/tape';
	import {
		todoUI,
		toggleTask,
		updateTask,
		deleteTask,
		moveTask,
		addSubtask,
		toggleSubtask,
		deleteSubtask,
		formatDueDate,
	} from '$lib/stores/todoState.svelte';
	import type { Task } from '$lib/stores/todoState.svelte';

	let { task }: { task: Task } = $props();

	const isExpanded = $derived(todoUI.expandedTaskId === task.id);
	const isFocused = $derived(todoUI.focusedTaskId === task.id);

	const PRIORITY_COLORS = ['transparent', 'var(--tag-0-fg)', 'var(--tag-1-fg)', 'var(--color-danger)'];
	const PRIORITY_LABELS = ['none', 'low', 'medium', 'high'];

	let editingTitle = $state(false);
	let titleDraft = $state('');
	let subtaskDraft = $state('');
	let tagDraft = $state('');

	const dueDateDisplay = $derived(task.dueDate ? formatDueDate(task.dueDate) : null);
	const subtasksDone = $derived(task.subtasks.filter((s) => s.completed).length);
	const subtaskPct = $derived(task.subtasks.length > 0 ? (subtasksDone / task.subtasks.length) * 100 : 0);

	function startEditTitle() {
		titleDraft = task.title;
		editingTitle = true;
	}

	function commitTitle() {
		// Esc already left edit mode; the blur from removing the input must not save.
		if (!editingTitle) return;
		const t = titleDraft.trim();
		if (t && t !== task.title) updateTask(task.id, { title: t });
		editingTitle = false;
	}

	function handleTitleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
		if (e.key === 'Escape') { e.stopPropagation(); editingTitle = false; }
	}

	function handleTagKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			const tag = tagDraft.trim().replace(/,/g, '').replace(/^#+/, '').toLowerCase();
			if (tag && !task.tags.includes(tag)) updateTask(task.id, { tags: [...task.tags, tag] });
			tagDraft = '';
		}
		if (e.key === 'Escape') tagDraft = '';
	}

	function removeTag(tag: string) {
		updateTask(task.id, { tags: task.tags.filter((t) => t !== tag) });
	}

	function handleSubtaskKey(e: KeyboardEvent) {
		if (e.key === 'Enter') {
			e.preventDefault();
			const t = subtaskDraft.trim();
			if (t) { addSubtask(task.id, t); subtaskDraft = ''; }
		}
		if (e.key === 'Escape') subtaskDraft = '';
	}

	// A date input reports a valid value after each typed segment (year 0005 on the way to
	// 2026), and committing moves the task to another section and remounts this panel. So
	// typed dates wait for Enter or blur; picks from the calendar still commit straight away.
	let dateTyping = false;

	function commitDate(input: HTMLInputElement, refocus: HTMLElement | null) {
		dateTyping = false;
		const val = input.value;
		if (input.validity.badInput || (val && Number(val.slice(0, 4)) < 1000)) {
			input.value = task.dueDate ?? '';
			return;
		}
		if (val === (task.dueDate ?? '')) return;
		const id = task.id;
		const label = refocus?.getAttribute('aria-label');
		updateTask(id, { dueDate: val || undefined });
		if (!label) return;
		tick().then(() => {
			document.querySelector<HTMLElement>(`[data-task-panel="${id}"] [aria-label="${label}"]`)?.focus();
		});
	}

	function handleDateKey(e: KeyboardEvent) {
		const input = e.currentTarget as HTMLInputElement;
		if (e.key === 'Enter') {
			e.preventDefault();
			commitDate(input, input);
		} else if (e.key === 'Escape') {
			input.value = task.dueDate ?? '';
			dateTyping = false;
		} else if (e.key !== 'Tab' && e.key !== 'Shift') {
			dateTyping = true;
		}
	}

	function focusEl(el: HTMLElement) {
		el.focus();
	}

	function cyclePriority(e: MouseEvent) {
		e.stopPropagation();
		updateTask(task.id, { priority: ((task.priority + 1) % 4) as 0 | 1 | 2 | 3 });
	}

	// ── Drag and drop ────────────────────────────────────────────
	let nativeDropIndicator = $state<'before' | 'after' | null>(null);
	const dropIndicator = $derived(
		todoUI.touchDropTarget?.id === task.id ? todoUI.touchDropTarget.position : nativeDropIndicator
	);
	const isDragging = $derived(todoUI.draggedTaskId === task.id);

	function handleDragStart(e: DragEvent) {
		// On a touchscreen laptop a long press can also raise a native drag.
		if (touchDragging || pressTimer) { e.preventDefault(); return; }
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', task.id);
		todoUI.draggedTaskId = task.id;
	}

	function handleDragEnd() {
		todoUI.draggedTaskId = null;
		nativeDropIndicator = null;
	}

	function handleDragOver(e: DragEvent) {
		if (!todoUI.draggedTaskId || todoUI.draggedTaskId === task.id) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		nativeDropIndicator = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
	}

	function handleDragLeave(e: DragEvent) {
		const related = e.relatedTarget as Node | null;
		if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
			nativeDropIndicator = null;
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const draggedId = todoUI.draggedTaskId;
		if (draggedId && draggedId !== task.id && dropIndicator) {
			moveTask(draggedId, task.id, dropIndicator);
		}
		nativeDropIndicator = null;
		todoUI.draggedTaskId = null;
	}

	// ── Touch reorder ────────────────────────────────────────────
	// Native drag does not work on phones. A long press lifts the row so that a plain
	// swipe still scrolls and a tap still expands.
	const LONG_PRESS_MS = 300;
	const MOVE_TOLERANCE = 10;
	const EDGE = 48;
	const coarsePointer = typeof matchMedia !== 'undefined' && matchMedia('(pointer: coarse)').matches;

	let pressTimer: ReturnType<typeof setTimeout> | null = null;
	let pressPointer: number | null = null;
	let pressX = 0;
	let pressY = 0;
	let touchDragging = false;
	let skipNextClick = false;
	let dragFrame = 0;
	let fingerX = 0;
	let fingerY = 0;
	let dragList: HTMLElement | null = null;

	function clearPress() {
		if (pressTimer) { clearTimeout(pressTimer); pressTimer = null; }
	}

	function handleRowPointerDown(e: PointerEvent) {
		skipNextClick = false;
		if (e.pointerType !== 'touch' || !e.isPrimary) return;
		if ((e.target as HTMLElement).closest('button, input, textarea, a')) return;
		const row = e.currentTarget as HTMLElement;
		pressPointer = e.pointerId;
		pressX = fingerX = e.clientX;
		pressY = fingerY = e.clientY;
		pressTimer = setTimeout(() => {
			pressTimer = null;
			touchDragging = true;
			skipNextClick = true;
			todoUI.draggedTaskId = task.id;
			dragList = row.closest<HTMLElement>('[aria-label="Task list"]');
			try { row.setPointerCapture(e.pointerId); } catch {}
			navigator.vibrate?.(10);
			dragFrame = requestAnimationFrame(autoScroll);
		}, LONG_PRESS_MS);
	}

	function updateTouchTarget() {
		const hit = document.elementFromPoint(fingerX, fingerY);
		const li = hit?.closest<HTMLElement>('[data-drop-id]');
		// The small gaps between rows keep the last target so the line does not flicker.
		if (!hit?.closest('ul')) { todoUI.touchDropTarget = null; return; }
		if (!li) return;
		const id = li.dataset.dropId!;
		if (id === task.id) { todoUI.touchDropTarget = null; return; }
		const rect = li.getBoundingClientRect();
		todoUI.touchDropTarget = { id, position: fingerY < rect.top + rect.height / 2 ? 'before' : 'after' };
	}

	// The page cannot scroll during a drag, so holding near an edge scrolls the list.
	function autoScroll() {
		if (!touchDragging) return;
		if (dragList) {
			const box = dragList.getBoundingClientRect();
			const delta = fingerY < box.top + EDGE ? -6 : fingerY > box.bottom - EDGE ? 6 : 0;
			if (delta) { dragList.scrollTop += delta; updateTouchTarget(); }
		}
		dragFrame = requestAnimationFrame(autoScroll);
	}

	function handleRowPointerMove(e: PointerEvent) {
		if (e.pointerId !== pressPointer) return;
		fingerX = e.clientX;
		fingerY = e.clientY;
		if (pressTimer) {
			if (Math.hypot(e.clientX - pressX, e.clientY - pressY) > MOVE_TOLERANCE) {
				clearPress();
				pressPointer = null;
			}
			return;
		}
		if (touchDragging) updateTouchTarget();
	}

	function endTouchDrag(commit: boolean) {
		clearPress();
		pressPointer = null;
		if (!touchDragging) return;
		touchDragging = false;
		cancelAnimationFrame(dragFrame);
		const target = todoUI.touchDropTarget;
		todoUI.touchDropTarget = null;
		todoUI.draggedTaskId = null;
		if (commit && target) moveTask(task.id, target.id, target.position);
	}

	/** Must be non-passive, and attached before the touch starts, to stop the scroll. */
	function blockScrollWhileDragging(node: HTMLElement) {
		const onMove = (e: TouchEvent) => { if (touchDragging && e.cancelable) e.preventDefault(); };
		node.addEventListener('touchmove', onMove, { passive: false });
		return { destroy() { node.removeEventListener('touchmove', onMove); endTouchDrag(false); } };
	}

	// Moves focus off a task that is about to leave the list; the add field catches the last one.
	function completeAndKeepFocus(row: HTMLElement) {
		const rows = [...document.querySelectorAll<HTMLElement>('[data-task-row]')];
		const idx = rows.indexOf(row);
		const next = rows[idx + 1] ?? rows[idx - 1] ?? document.querySelector<HTMLElement>('[aria-label="New task title"]');
		toggleTask(task.id);
		tick().then(() => next?.focus());
	}

	function handleItemKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;
		if (e.ctrlKey || e.metaKey || e.altKey) return;
		// Enter and Space on the checkbox or chevron belong to that button.
		if ((e.key === 'Enter' || e.key === ' ') && target !== e.currentTarget) return;

		// P and Alt+arrows are handled once, by the window handler in TodoTool.
		if (e.key === 'Enter' || e.key.toLowerCase() === 'e') {
			e.preventDefault();
			todoUI.expandedTaskId = isExpanded ? null : task.id;
		} else if (e.key === ' ') {
			e.preventDefault();
			completeAndKeepFocus(e.currentTarget as HTMLElement);
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey) {
			e.preventDefault();
			deleteTask(task.id);
		}
	}
</script>

<li
	role="listitem"
	data-drop-id={task.id}
	ondragover={handleDragOver}
	ondragleave={handleDragLeave}
	ondrop={handleDrop}
	class="relative"
>
	<!-- Drop indicator: before -->
	{#if dropIndicator === 'before'}
		<div class="absolute top-0 left-2 right-2 h-[2px] rounded-full bg-accent-todo z-10 pointer-events-none"></div>
	{/if}

	<!-- Outer card wrapper — becomes a raised card when expanded -->
	<div
		class="relative transition-all duration-150
		       {isDragging ? 'opacity-40' : task.completed ? 'opacity-55' : ''}
		       {isExpanded
			       ? 'rounded-lg ring-1 ring-border-default bg-bg-surface/30'
			       : 'rounded-md'}"
		onfocusin={() => { todoUI.focusedTaskId = task.id; }}
		onfocusout={(e) => {
			if (!e.currentTarget.contains(e.relatedTarget as Node)) todoUI.focusedTaskId = null;
		}}
	>
		<!-- Collapsed row -->
		<div
			class="flex items-center gap-2 max-sm:gap-1.5 px-2 py-2.5 min-h-[44px]
			       transition-colors duration-100 select-none [-webkit-touch-callout:none] group/row focus-visible:-outline-offset-2
			       {isFocused && !isExpanded ? 'bg-bg-hover rounded-md' : ''}
			       {!isExpanded ? 'hover:bg-bg-hover rounded-md' : 'rounded-t-lg'}
			       {isDragging ? 'cursor-grabbing' : 'cursor-grab'}"
			data-task-row={task.id}
			tabindex="0"
			role="button"
			aria-expanded={isExpanded}
			aria-label="{task.title}, priority {PRIORITY_LABELS[task.priority]}"
			draggable={!coarsePointer}
			use:blockScrollWhileDragging
			onclick={() => {
				if (skipNextClick) { skipNextClick = false; return; }
				todoUI.expandedTaskId = isExpanded ? null : task.id;
			}}
			onpointerdown={handleRowPointerDown}
			onpointermove={handleRowPointerMove}
			onpointerup={() => endTouchDrag(true)}
			onpointercancel={() => endTouchDrag(false)}
			oncontextmenu={(e) => { if (pressTimer || touchDragging) e.preventDefault(); }}
			ondragstart={handleDragStart}
			ondragend={handleDragEnd}
			onkeydown={handleItemKey}
		>
			<!-- Drag handle: 2×3 dot grid -->
			<div
				class="grid max-sm:hidden grid-cols-2 gap-[3px] shrink-0 opacity-0 group-hover/row:opacity-25
				       transition-opacity duration-100 px-0.5 -mr-1.5"
				aria-hidden="true"
			>
				{#each Array(6) as _}
					<span class="w-[2.5px] h-[2.5px] rounded-full bg-current block"></span>
				{/each}
			</div>

			<!-- Priority dot (tappable, cycles priority) -->
			<button
				onclick={cyclePriority}
				class="hit w-5 h-5 min-w-5 flex items-center justify-center shrink-0 rounded"
				style="--hit:-12px -3px -12px -8px"
				aria-label="Priority: {PRIORITY_LABELS[task.priority]}. Tap to change."
				title="Priority: {PRIORITY_LABELS[task.priority]}"
			>
				<span
					class="w-[7px] h-[7px] rounded-full transition-all duration-200
					       {task.priority > 0 ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}"
					style="background-color: {PRIORITY_COLORS[task.priority]}"
				></span>
			</button>

			<!-- Custom checkbox -->
			<button
				onclick={(e) => {
					e.stopPropagation();
					// detail 0 is a keyboard press: the button is about to disappear with the row.
					if (e.detail === 0) completeAndKeepFocus(e.currentTarget.closest('[data-task-row]') as HTMLElement);
					else toggleTask(task.id);
				}}
				style="--hit:-13px -8px -13px -3px"
				class="hit w-[18px] h-[18px] min-w-[18px] rounded-[4px] border-[1.5px] flex items-center
				       justify-center transition-all duration-150 shrink-0
				       {task.completed
					       ? 'bg-accent-todo border-accent-todo'
					       : 'bg-transparent border-border-default hover:border-text-muted'}"
				aria-label={task.completed ? 'Mark incomplete' : 'Mark complete'}
			>
				{#if task.completed}
					<svg width="10" height="10" viewBox="0 0 10 10" fill="none" aria-hidden="true">
						<path
							d="M2 5.2l2.2 2.2 4-4.4"
							stroke="white"
							stroke-width="1.6"
							stroke-linecap="round"
							stroke-linejoin="round"
						/>
					</svg>
				{/if}
			</button>

			<!-- Title -->
			<span
				class="flex-1 min-w-0 text-[0.82rem] truncate transition-all duration-150 leading-snug
				       {task.completed
					       ? 'line-through text-text-muted decoration-text-muted/50'
					       : 'text-text-primary'}"
			>
				{task.title}
			</span>

			<!-- Subtask mini progress bar -->
			{#if task.subtasks.length > 0}
				<div class="flex items-center gap-1.5 shrink-0">
					<div class="w-10 h-[3px] rounded-full bg-border-default overflow-hidden">
						<div
							class="h-full rounded-full bg-accent-todo/70 transition-all duration-300"
							style="width: {subtaskPct}%"
						></div>
					</div>
					<span class="text-[0.6rem] text-text-muted">{subtasksDone}/{task.subtasks.length}</span>
				</div>
			{/if}

			<!-- Due date pill -->
			{#if dueDateDisplay}
				<span
					class="text-[0.62rem] px-1.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap
					       {dueDateDisplay.status === 'overdue'
						       ? 'bg-danger/10 text-danger border-danger/25'
						       : dueDateDisplay.status === 'today'
							       ? 'bg-accent-todo/10 text-accent-todo border-accent-todo/25'
							       : 'bg-bg-surface text-text-muted border-border-default'}"
					aria-label="Due: {dueDateDisplay.label}{dueDateDisplay.status === 'overdue' ? ', overdue' : ''}"
				>
					{dueDateDisplay.label}
				</span>
			{/if}

			<!-- Tag pills (max 2) -->
			{#each task.tags.slice(0, 2) as tag, i}
				<span
					class="text-[0.62rem] font-semibold px-1.5 py-[3px] rounded-[10px] shrink-0 whitespace-nowrap
					       max-w-[5rem] max-sm:max-w-[3rem] truncate {i > 0 ? 'max-sm:hidden' : ''}"
					style="background:var(--tag-{tagTone(tag)}-bg); color:var(--tag-{tagTone(tag)}-fg)"
				>
					{tag}
				</span>
			{/each}
			{#if task.tags.length > 1}
				<span class="text-[0.6rem] text-text-muted shrink-0 sm:hidden">+{task.tags.length - 1}</span>
			{/if}
			{#if task.tags.length > 2}
				<span class="text-[0.6rem] text-text-muted shrink-0 max-sm:hidden">+{task.tags.length - 2}</span>
			{/if}

			<!-- Expand chevron (SVG, rotates) -->
			<button
				onclick={(e) => { e.stopPropagation(); todoUI.expandedTaskId = isExpanded ? null : task.id; }}
				style="--hit:-10px -8px -10px -3px"
				class="hit w-6 h-6 flex items-center justify-center text-text-muted
				       hover:text-text-secondary transition-colors shrink-0 rounded"
				aria-label={isExpanded ? 'Collapse task' : 'Expand task'}
			>
				<svg
					width="12" height="12" viewBox="0 0 12 12" fill="none"
					class="transition-transform duration-200 {isExpanded ? 'rotate-180' : 'rotate-0'}"
					aria-hidden="true"
				>
					<path
						d="M2.5 4.5l3.5 3.5 3.5-3.5"
						stroke="currentColor"
						stroke-width="1.4"
						stroke-linecap="round"
						stroke-linejoin="round"
					/>
				</svg>
			</button>
		</div>

		<!-- Expanded panel -->
		{#if isExpanded}
			<div data-task-panel={task.id} class="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-border-subtle/60 bg-bg-primary/30 rounded-b-lg">
				<!-- Editable title -->
				{#if editingTitle}
					<input
						class="bg-transparent outline-none text-[0.82rem] text-text-primary
						       border-b border-accent-todo pb-0.5 w-full mt-1"
						bind:value={titleDraft}
						onblur={commitTitle}
						onkeydown={handleTitleKey}
						use:focusEl
					/>
				{:else}
					<button
						class="text-left text-[0.82rem] text-text-secondary hover:text-text-primary
						       mt-1 transition-colors w-full leading-snug [overflow-wrap:anywhere]"
						onclick={startEditTitle}
						title="Click to edit title"
					>
						{task.title}
					</button>
				{/if}

				<!-- Notes textarea -->
				<textarea
					class="bg-bg-surface/50 border border-border-subtle rounded-md px-2.5 py-2
					       outline-none resize-none text-xs text-text-primary
					       placeholder-text-muted w-full leading-relaxed focus:bg-bg-hover
					       transition-colors duration-150"
					placeholder="Add notes…"
					rows="3"
					value={task.notes}
					oninput={(e) => updateTask(task.id, { notes: (e.target as HTMLTextAreaElement).value })}
				></textarea>

				<!-- Due date + Priority row -->
				<div class="flex items-center gap-4 flex-wrap">
					<!-- Due date -->
					<label class="flex items-center gap-1.5 cursor-pointer">
						<span class="text-[0.6rem] uppercase tracking-wider text-text-muted">Due</span>
						<input
							type="date"
							class="bg-transparent outline-none text-[0.7rem] border-b border-transparent
							       text-text-secondary focus:text-text-primary focus:border-accent-todo cursor-pointer"
							aria-label="Due date"
							value={task.dueDate ?? ''}
							onpointerdown={() => { dateTyping = false; }}
							onkeydown={handleDateKey}
							onchange={(e) => { if (!dateTyping) commitDate(e.currentTarget, null); }}
							onblur={(e) => { if (dateTyping) commitDate(e.currentTarget, e.relatedTarget as HTMLElement | null); }}
						/>
						{#if task.dueDate}
							<button
								onclick={() => updateTask(task.id, { dueDate: undefined })}
								style="--hit:-12px -8px -12px -2px"
								class="hit text-text-muted hover:text-text-secondary text-xs transition-colors"
								aria-label="Clear due date"
							>×</button>
						{/if}
					</label>

					<!-- Priority dots -->
					<div class="flex items-center gap-2 ml-auto" role="group" aria-label="Priority">
						<span class="text-[0.6rem] uppercase tracking-wider text-text-muted">Priority</span>
						{#each [0, 1, 2, 3] as p}
							<button
								class="hit w-3 h-3 rounded-full border-[1.5px] transition-all duration-150
								       hover:scale-110"
								style="
									background-color: {task.priority === p && p > 0 ? PRIORITY_COLORS[p] : 'transparent'};
									border-color: {PRIORITY_COLORS[p] === 'transparent' ? 'var(--color-border-default)' : PRIORITY_COLORS[p]};
									opacity: {task.priority === p ? 1 : 0.4};
									--hit: -14px -4px;
								"
								onclick={() => updateTask(task.id, { priority: p as 0 | 1 | 2 | 3 })}
								aria-label="Set priority: {PRIORITY_LABELS[p]}"
								aria-pressed={task.priority === p}
							></button>
						{/each}
					</div>
				</div>

				<!-- Tags -->
				<div class="flex flex-wrap items-center gap-1.5">
					{#each task.tags as tag}
						<span
							class="flex items-center gap-1 text-[0.65rem] px-2 py-[3px] max-w-full
							       rounded-full border border-border-default bg-bg-surface text-text-muted"
						>
							<span class="truncate">#{tag}</span>
							<button
								onclick={() => removeTag(tag)}
								style="--hit:-6px -6px -6px -4px"
								class="hit hover:text-text-primary leading-none transition-colors text-[0.7rem]"
								aria-label="Remove tag {tag}"
							>×</button>
						</span>
					{/each}
					<input
						bind:value={tagDraft}
						onkeydown={handleTagKey}
						class="bg-transparent outline-none text-[0.65rem] border-b border-transparent focus:border-accent-todo
						       text-text-secondary placeholder-text-muted w-20"
						placeholder="+ tag"
					/>
				</div>

				<!-- Subtasks -->
				{#if task.subtasks.length > 0}
					<ul role="list" class="flex flex-col gap-2">
						{#each task.subtasks as sub (sub.id)}
							<li class="flex items-center gap-2">
								<!-- Subtask custom checkbox -->
								<button
									onclick={() => toggleSubtask(task.id, sub.id)}
									style="--hit:-6px -4px"
									class="hit w-[15px] h-[15px] min-w-[15px] rounded-[3px] border-[1.5px] flex items-center
									       justify-center transition-all duration-150 shrink-0
									       {sub.completed
										       ? 'bg-accent-todo border-accent-todo'
										       : 'bg-transparent border-border-default hover:border-text-muted'}"
									aria-label={sub.completed ? 'Mark subtask incomplete' : 'Mark subtask complete'}
								>
									{#if sub.completed}
										<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
											<path d="M1.5 4l1.8 1.8 3.2-3.6" stroke="var(--color-on-accent)" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
										</svg>
									{/if}
								</button>
								<span
									class="text-[0.78rem] flex-1 min-w-0 leading-snug [overflow-wrap:anywhere]
									       {sub.completed ? 'line-through text-text-muted decoration-text-muted/50' : 'text-text-secondary'}"
								>
									{sub.title}
								</span>
								<button
									onclick={() => deleteSubtask(task.id, sub.id)}
									style="--hit:-4px -6px"
									class="hit text-text-muted hover:text-text-secondary text-xs transition-colors w-5 h-5
									       flex items-center justify-center rounded shrink-0"
									aria-label="Delete subtask"
								>×</button>
							</li>
						{/each}
					</ul>
				{/if}

				<!-- Add subtask input -->
				<input
					bind:value={subtaskDraft}
					onkeydown={handleSubtaskKey}
					class="bg-transparent outline-none text-[0.78rem] focus:border-accent-todo transition-colors
					       text-text-secondary placeholder-text-muted border-b border-border-subtle pb-0.5"
					placeholder="+ subtask  (Enter to add)"
				/>

				<!-- Delete task -->
				<div class="flex justify-end pt-0.5">
					<button
						onclick={() => deleteTask(task.id)}
						style="--hit:-12px -8px"
						class="hit text-[0.65rem] text-text-muted hover:text-danger transition-colors"
						aria-label="Delete task"
					>
						Delete task
					</button>
				</div>
			</div>
		{/if}
	</div>

	<!-- Drop indicator: after -->
	{#if dropIndicator === 'after'}
		<div class="absolute bottom-0 left-2 right-2 h-[2px] rounded-full bg-accent-todo z-10 pointer-events-none"></div>
	{/if}
</li>

<style>
	/* Grow the tap area on touch screens without changing how the control looks. */
	@media (pointer: coarse) {
		.hit { position: relative; }
		.hit::after { content: ''; position: absolute; inset: var(--hit); }
	}
</style>
