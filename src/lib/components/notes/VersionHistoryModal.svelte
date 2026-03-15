<script lang="ts">
	import { onMount } from 'svelte';
	import { notesUI, getVersions, restoreVersion, relativeTime, type NoteVersion } from '$lib/stores/notesState.svelte';

	let { onClose }: { onClose: () => void } = $props();

	let versions = $state<NoteVersion[]>([]);
	let selectedVersion = $state<NoteVersion | null>(null);
	let loading = $state(true);

	onMount(async () => {
		if (!notesUI.activeNoteId) return;
		versions = await getVersions(notesUI.activeNoteId);
		selectedVersion = versions[0] ?? null;
		loading = false;
	});

	async function handleRestore() {
		if (!notesUI.activeNoteId || !selectedVersion) return;
		await restoreVersion(notesUI.activeNoteId, selectedVersion);
		onClose();
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}
</script>

<!-- Backdrop -->
<div
	class="absolute inset-0 z-50 flex items-center justify-center"
	style="background: rgba(0,0,0,0.6);"
	onclick={handleBackdrop}
	role="dialog"
	aria-modal="true"
	aria-label="Version History"
>
	<!-- Modal -->
	<div class="bg-bg-panel border border-border-default rounded-lg w-[480px] max-w-[90vw] max-h-[70vh] flex flex-col shadow-2xl">
		<!-- Header -->
		<div class="flex items-center justify-between px-4 py-3 border-b border-border-default">
			<span class="text-xs font-semibold tracking-widest uppercase text-text-secondary">Version History</span>
			<button
				class="p-1 rounded text-text-muted hover:text-text-primary hover:bg-bg-hover transition-colors"
				onclick={onClose}
				aria-label="Close"
			>
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<path d="M2 2l10 10M12 2L2 12" stroke="currentColor" stroke-width="1.5" stroke-linecap="round"/>
				</svg>
			</button>
		</div>

		{#if loading}
			<div class="flex-1 flex items-center justify-center text-text-muted text-xs">Loading...</div>
		{:else if versions.length === 0}
			<div class="flex-1 flex items-center justify-center text-text-muted text-xs">No versions saved yet.</div>
		{:else}
			<div class="flex flex-1 min-h-0">
				<!-- Version list -->
				<div class="w-44 border-r border-border-default flex flex-col overflow-y-auto">
					{#each versions as v}
						<button
							class="text-left px-3 py-2.5 text-xs transition-colors border-b border-border-subtle"
							class:bg-bg-hover={selectedVersion?.id === v.id}
							class:text-text-primary={selectedVersion?.id === v.id}
							class:text-text-muted={selectedVersion?.id !== v.id}
							class:hover:bg-bg-hover={selectedVersion?.id !== v.id}
							onclick={() => selectedVersion = v}
						>
							<div class="font-medium">{relativeTime(v.savedAt)}</div>
							<div class="text-[10px] opacity-60 mt-0.5">
								{new Date(v.savedAt).toLocaleTimeString('en-US', { hour: '2-digit', minute: '2-digit' })}
							</div>
						</button>
					{/each}
				</div>

				<!-- Preview -->
				<div class="flex-1 flex flex-col min-w-0">
					<div class="flex-1 overflow-y-auto p-3">
						{#if selectedVersion}
							{#if selectedVersion.title}
								<div class="text-sm font-semibold text-text-primary mb-2">{selectedVersion.title}</div>
							{/if}
							<pre class="text-xs text-text-secondary whitespace-pre-wrap font-mono leading-5">{selectedVersion.body || '(empty)'}</pre>
						{/if}
					</div>
					<div class="px-3 py-2.5 border-t border-border-default flex justify-end">
						<button
							class="px-3 py-1.5 text-xs rounded bg-accent-notes text-bg-primary font-semibold hover:opacity-90 transition-opacity"
							onclick={handleRestore}
						>
							Restore this version
						</button>
					</div>
				</div>
			</div>
		{/if}
	</div>
</div>
