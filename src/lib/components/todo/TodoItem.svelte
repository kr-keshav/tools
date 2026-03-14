<script lang="ts">
	import {
		todoUI,
		toggleTask,
		updateTask,
		deleteTask,
		reorderTask,
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

	const PRIORITY_COLORS = ['transparent', '#6c8ebf', '#c9a84c', '#b5866b'];
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
		const t = titleDraft.trim();
		if (t && t !== task.title) updateTask(task.id, { title: t });
		editingTitle = false;
	}

	function handleTitleKey(e: KeyboardEvent) {
		if (e.key === 'Enter') { e.preventDefault(); commitTitle(); }
		if (e.key === 'Escape') { editingTitle = false; }
	}

	function handleTagKey(e: KeyboardEvent) {
		if (e.key === 'Enter' || e.key === ',') {
			e.preventDefault();
			const tag = tagDraft.trim().replace(/,/g, '').toLowerCase();
			if (tag && !task.tags.includes(tag)) updateTask(task.id, { tags: [...task.tags, tag] });
			tagDraft = '';
		}
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
	}

	function focusEl(el: HTMLElement) {
		el.focus();
	}

	function cyclePriority(e: MouseEvent) {
		e.stopPropagation();
		updateTask(task.id, { priority: ((task.priority + 1) % 4) as 0 | 1 | 2 | 3 });
	}

	// ── Drag and drop ────────────────────────────────────────────
	let dropIndicator = $state<'before' | 'after' | null>(null);
	const isDragging = $derived(todoUI.draggedTaskId === task.id);

	function handleDragStart(e: DragEvent) {
		if (!e.dataTransfer) return;
		e.dataTransfer.effectAllowed = 'move';
		e.dataTransfer.setData('text/plain', task.id);
		todoUI.draggedTaskId = task.id;
	}

	function handleDragEnd() {
		todoUI.draggedTaskId = null;
		dropIndicator = null;
	}

	function handleDragOver(e: DragEvent) {
		if (!todoUI.draggedTaskId || todoUI.draggedTaskId === task.id) return;
		e.preventDefault();
		if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
		const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
		dropIndicator = e.clientY < rect.top + rect.height / 2 ? 'before' : 'after';
	}

	function handleDragLeave(e: DragEvent) {
		const related = e.relatedTarget as Node | null;
		if (!related || !(e.currentTarget as HTMLElement).contains(related)) {
			dropIndicator = null;
		}
	}

	function handleDrop(e: DragEvent) {
		e.preventDefault();
		const draggedId = todoUI.draggedTaskId;
		if (draggedId && draggedId !== task.id && dropIndicator) {
			moveTask(draggedId, task.id, dropIndicator);
		}
		dropIndicator = null;
		todoUI.draggedTaskId = null;
	}

	function handleItemKey(e: KeyboardEvent) {
		const target = e.target as HTMLElement;
		if (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA') return;

		if (e.key === 'Enter' || e.key === 'e') {
			e.preventDefault();
			todoUI.expandedTaskId = isExpanded ? null : task.id;
		} else if (e.key === ' ') {
			e.preventDefault();
			toggleTask(task.id);
		} else if (e.key === 'p') {
			e.preventDefault();
			updateTask(task.id, { priority: ((task.priority + 1) % 4) as 0 | 1 | 2 | 3 });
		} else if ((e.key === 'Delete' || e.key === 'Backspace') && e.shiftKey) {
			e.preventDefault();
			deleteTask(task.id);
		} else if (e.altKey && e.key === 'ArrowUp') {
			e.preventDefault();
			reorderTask(task.id, 'up');
		} else if (e.altKey && e.key === 'ArrowDown') {
			e.preventDefault();
			reorderTask(task.id, 'down');
		}
	}
</script>

<li
	role="listitem"
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
			class="flex items-center gap-2 px-2 py-2.5 min-h-[44px]
			       transition-colors duration-100 select-none group/row
			       {isFocused && !isExpanded ? 'bg-bg-hover rounded-md' : ''}
			       {!isExpanded ? 'hover:bg-bg-hover rounded-md' : 'rounded-t-lg'}
			       {isDragging ? 'cursor-grabbing' : 'cursor-grab'}"
			tabindex="0"
			role="button"
			aria-expanded={isExpanded}
			aria-label="{task.title}, priority {PRIORITY_LABELS[task.priority]}"
			draggable="true"
			ondragstart={handleDragStart}
			ondragend={handleDragEnd}
			onkeydown={handleItemKey}
		>
			<!-- Drag handle: 2×3 dot grid -->
			<div
				class="grid grid-cols-2 gap-[3px] shrink-0 opacity-0 group-hover/row:opacity-25
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
				class="w-5 h-5 min-w-5 flex items-center justify-center shrink-0 rounded"
				aria-label="Priority: {PRIORITY_LABELS[task.priority]}. Tap to change."
				title="Priority: {PRIORITY_LABELS[task.priority]}"
				tabindex="-1"
			>
				<span
					class="w-[7px] h-[7px] rounded-full transition-all duration-200
					       {task.priority > 0 ? 'scale-100 opacity-100' : 'scale-0 opacity-0'}"
					style="background-color: {PRIORITY_COLORS[task.priority]}"
				></span>
			</button>

			<!-- Custom checkbox -->
			<button
				onclick={(e) => { e.stopPropagation(); toggleTask(task.id); }}
				class="w-[18px] h-[18px] min-w-[18px] rounded-[4px] border-[1.5px] flex items-center
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
				class="flex-1 text-[0.82rem] font-mono truncate transition-all duration-150 leading-snug
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
					<span class="text-[0.6rem] font-mono text-text-muted">{subtasksDone}/{task.subtasks.length}</span>
				</div>
			{/if}

			<!-- Due date pill -->
			{#if dueDateDisplay}
				<span
					class="text-[0.62rem] font-mono px-1.5 py-[3px] rounded-full border shrink-0 whitespace-nowrap
					       {dueDateDisplay.status === 'overdue'
						       ? 'bg-[#c77171]/10 text-[#c77171] border-[#c77171]/25'
						       : dueDateDisplay.status === 'today'
							       ? 'bg-accent-todo/10 text-accent-todo border-accent-todo/25'
							       : 'bg-bg-surface text-text-muted border-border-default'}"
					aria-label="Due: {dueDateDisplay.label}{dueDateDisplay.status === 'overdue' ? ', overdue' : ''}"
				>
					{dueDateDisplay.label}
				</span>
			{/if}

			<!-- Tag pills (max 2) -->
			{#each task.tags.slice(0, 2) as tag}
				<span
					class="text-[0.62rem] font-mono px-1.5 py-[3px] rounded border
					       bg-bg-surface border-border-default text-text-muted shrink-0 whitespace-nowrap"
				>
					{tag}
				</span>
			{/each}
			{#if task.tags.length > 2}
				<span class="text-[0.6rem] text-text-muted shrink-0">+{task.tags.length - 2}</span>
			{/if}

			<!-- Expand chevron (SVG, rotates) -->
			<button
				onclick={(e) => { e.stopPropagation(); todoUI.expandedTaskId = isExpanded ? null : task.id; }}
				class="w-6 h-6 flex items-center justify-center text-text-muted/40
				       hover:text-text-muted transition-colors shrink-0 rounded"
				aria-label={isExpanded ? 'Collapse task' : 'Expand task'}
				tabindex="-1"
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
			<div class="px-4 pb-4 pt-2 flex flex-col gap-3 border-t border-border-subtle/60 bg-bg-primary/30 rounded-b-lg">
				<!-- Editable title -->
				{#if editingTitle}
					<input
						class="bg-transparent border-none outline-none text-[0.82rem] font-mono text-text-primary
						       border-b border-accent-todo pb-0.5 w-full mt-1"
						bind:value={titleDraft}
						onblur={commitTitle}
						onkeydown={handleTitleKey}
						use:focusEl
					/>
				{:else}
					<button
						class="text-left text-[0.82rem] font-mono text-text-secondary hover:text-text-primary
						       mt-1 transition-colors w-full leading-snug"
						onclick={startEditTitle}
						title="Click to edit title"
					>
						{task.title}
					</button>
				{/if}

				<!-- Notes textarea -->
				<textarea
					class="bg-bg-surface/50 border border-border-subtle rounded-md px-2.5 py-2
					       outline-none resize-none text-xs font-mono text-text-primary
					       placeholder-text-muted w-full leading-relaxed focus:border-border-default
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
							class="bg-transparent border-none outline-none text-[0.7rem] font-mono
							       text-text-secondary focus:text-text-primary cursor-pointer"
							value={task.dueDate ?? ''}
							onchange={(e) => {
								const val = (e.target as HTMLInputElement).value;
								updateTask(task.id, { dueDate: val || undefined });
							}}
						/>
						{#if task.dueDate}
							<button
								onclick={() => updateTask(task.id, { dueDate: undefined })}
								class="text-text-muted/40 hover:text-text-muted text-xs transition-colors"
								aria-label="Clear due date"
							>×</button>
						{/if}
					</label>

					<!-- Priority dots -->
					<div class="flex items-center gap-2 ml-auto" role="group" aria-label="Priority">
						<span class="text-[0.6rem] uppercase tracking-wider text-text-muted">Priority</span>
						{#each [0, 1, 2, 3] as p}
							<button
								class="w-3 h-3 rounded-full border-[1.5px] transition-all duration-150
								       hover:scale-110"
								style="
									background-color: {task.priority === p && p > 0 ? PRIORITY_COLORS[p] : 'transparent'};
									border-color: {PRIORITY_COLORS[p] === 'transparent' ? '#2a2a2a' : PRIORITY_COLORS[p]};
									opacity: {task.priority === p ? 1 : 0.4};
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
							class="flex items-center gap-1 text-[0.65rem] font-mono px-2 py-[3px]
							       rounded-full border border-border-default bg-bg-surface text-text-muted"
						>
							#{tag}
							<button
								onclick={() => removeTag(tag)}
								class="hover:text-text-primary leading-none transition-colors text-[0.7rem]"
								aria-label="Remove tag {tag}"
							>×</button>
						</span>
					{/each}
					<input
						bind:value={tagDraft}
						onkeydown={handleTagKey}
						class="bg-transparent border-none outline-none text-[0.65rem] font-mono
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
									class="w-[15px] h-[15px] min-w-[15px] rounded-[3px] border-[1.5px] flex items-center
									       justify-center transition-all duration-150 shrink-0
									       {sub.completed
										       ? 'bg-accent-todo border-accent-todo'
										       : 'bg-transparent border-border-default hover:border-text-muted'}"
									aria-label={sub.completed ? 'Mark subtask incomplete' : 'Mark subtask complete'}
								>
									{#if sub.completed}
										<svg width="8" height="8" viewBox="0 0 8 8" fill="none" aria-hidden="true">
											<path d="M1.5 4l1.8 1.8 3.2-3.6" stroke="white" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
										</svg>
									{/if}
								</button>
								<span
									class="text-[0.78rem] font-mono flex-1 leading-snug
									       {sub.completed ? 'line-through text-text-muted decoration-text-muted/50' : 'text-text-secondary'}"
								>
									{sub.title}
								</span>
								<button
									onclick={() => deleteSubtask(task.id, sub.id)}
									class="text-text-muted/30 hover:text-text-muted text-xs transition-colors w-5 h-5
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
					class="bg-transparent border-none outline-none text-[0.78rem] font-mono
					       text-text-secondary placeholder-text-muted border-b border-border-subtle pb-0.5"
					placeholder="+ subtask  (Enter to add)"
				/>

				<!-- Delete task -->
				<div class="flex justify-end pt-0.5">
					<button
						onclick={() => deleteTask(task.id)}
						class="text-[0.65rem] font-mono text-text-muted/40 hover:text-[#c77171] transition-colors"
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
