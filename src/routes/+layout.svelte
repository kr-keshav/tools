<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authState, ensureAnonymousAuth } from '$lib/stores/authState.svelte';
	import { loadNotes, unloadNotes } from '$lib/stores/notesState.svelte';
	import { loadTasks, unloadTasks } from '$lib/stores/todoState.svelte';
	import { setupTimerSync, unloadTimerState } from '$lib/stores/timerState.svelte';

	let { children } = $props();

	let prevDataUid = $state<string | null>(null);

	$effect(() => {
		if (!browser || authState.loading) return;

		const viewUid: string | null = $page.url.searchParams.get('view');
		const isLoginPage = $page.url.pathname === '/login';

		if (!authState.user) {
			// Auto anonymous auth — no redirect to login
			ensureAnonymousAuth();
			return;
		}

		// Redirect away from login page if already signed in (real account)
		if (isLoginPage && !authState.user.isAnonymous) {
			goto('/timer');
			return;
		}

		// Determine which UID's data to load
		const targetUid = viewUid ?? authState.user.uid;

		if (targetUid !== prevDataUid) {
			// Clean up previous data
			if (prevDataUid !== null) {
				unloadNotes();
				unloadTasks();
				unloadTimerState();
			}

			// Load data for target user — bidirectional sync, last-write-wins
			loadNotes(targetUid);
			loadTasks(targetUid);
			setupTimerSync(targetUid);

			prevDataUid = targetUid;
		}
	});
</script>

<svelte:head>
	<link rel="icon" href="/favicon.svg" type="image/svg+xml" />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{#if authState.loading}
	<div class="loading-screen">
		<div class="spinner"></div>
	</div>
{:else}
	{@render children()}
{/if}

<style>
	.loading-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100vh;
		background: var(--color-bg-base);
	}

	.spinner {
		width: 24px;
		height: 24px;
		border: 2px solid var(--color-border-default);
		border-top-color: var(--color-text-muted);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
