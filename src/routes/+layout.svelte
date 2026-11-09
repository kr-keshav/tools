<script lang="ts">
	import '../app.css';
	import { browser } from '$app/environment';
	import { goto } from '$app/navigation';
	import { page } from '$app/stores';
	import { authState, ensureAnonymousAuth } from '$lib/stores/authState.svelte';
	import { loadNotes, unloadNotes } from '$lib/stores/notesState.svelte';
	import { loadTasks, unloadTasks } from '$lib/stores/todoState.svelte';
	import { setupTimerSync, unloadTimerState } from '$lib/stores/timerState.svelte';
	import { loadCalc, unloadCalc } from '$lib/stores/calcState.svelte';
	import { themeState } from '$lib/stores/themeState.svelte';
	import { reportWriteError, syncNotice } from '$lib/stores/syncNotice.svelte';

	let { children } = $props();

	let prevDataUid = $state<string | null>(null);
	let offline = $state(browser && !navigator.onLine);

	const isViewer = $derived($page.url.searchParams.get('view') !== null);
	const toolIcon = $derived(['timer', 'notes', 'todo', 'calc'].find((t) => $page.url.pathname.startsWith(`/${t}`)));

	// Most saves are fire-and-forget, so a refusal from the server surfaces here
	function onUnhandledRejection(e: PromiseRejectionEvent) {
		reportWriteError(e.reason);
	}

	$effect(() => {
		if (!browser || authState.loading) return;

		const viewUid: string | null = $page.url.searchParams.get('view');
		const isLoginPage = $page.url.pathname === '/login';

		if (!authState.user) {
			// Auto anonymous auth — no redirect to login. A failure waits for Retry.
			if (!authState.failed) ensureAnonymousAuth();
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
				unloadCalc();
			}

			// Load data for target user — bidirectional sync, last-write-wins
			loadNotes(targetUid);
			loadTasks(targetUid);
			setupTimerSync(targetUid);
			loadCalc(targetUid);

			prevDataUid = targetUid;
		}
	});
</script>

<svelte:window
	ononline={() => (offline = false)}
	onoffline={() => (offline = true)}
	onunhandledrejection={onUnhandledRejection}
/>

<svelte:head>
	<link rel="icon" href={toolIcon ? `/favicon-${toolIcon}.svg` : '/favicon.svg'} type="image/svg+xml" />
	<meta name="description" content="WorkKit: a timer, notes, tasks and a live calculator in one calm workspace." />
	<meta name="theme-color" content={themeState.theme === 'dark' ? '#111214' : '#eceff7'} />
	<link rel="preconnect" href="https://fonts.googleapis.com" />
	<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin="" />
	<link
		href="https://fonts.googleapis.com/css2?family=JetBrains+Mono:wght@400;500;600&family=Manrope:wght@400;500;600;700;800&display=swap"
		rel="stylesheet"
	/>
</svelte:head>

{#if authState.loading}
	<div class="loading-screen">
		<div class="spinner"></div>
	</div>
{:else if authState.failed && !authState.user}
	<div class="loading-screen">
		<div class="session-error" role="alert">
			<p class="session-title">We couldn't start your session</p>
			<p class="session-body">Check your connection and try again. Nothing has been lost.</p>
			<button class="session-retry" onclick={ensureAnonymousAuth}>Try again</button>
		</div>
	</div>
{:else}
	{@render children()}
{/if}

{#if syncNotice.writeRejected}
	<div class="notice" role="alert">
		<span>{isViewer ? "This shared link can't save changes. Your edits here aren't being kept." : "Your last change couldn't be saved. Reload and try again."}</span>
		<button class="notice-close" onclick={() => (syncNotice.writeRejected = false)} aria-label="Dismiss">
			<svg width="10" height="10" viewBox="0 0 10 10" fill="none"><path d="M2 2l6 6M8 2l-6 6" stroke="currentColor" stroke-width="1.3" stroke-linecap="round"/></svg>
		</button>
	</div>
{:else if offline}
	<div class="notice" role="status">
		<span>You're offline. Keep this tab open and your changes will sync when you reconnect.</span>
	</div>
{/if}

<style>
	.loading-screen {
		display: flex;
		align-items: center;
		justify-content: center;
		height: 100vh;
		background: var(--color-bg-primary);
	}

	.session-error {
		max-width: 320px;
		padding: 2rem 1.75rem;
		text-align: center;
		background: var(--color-bg-surface);
		border-radius: 20px;
		box-shadow: var(--shadow-card);
	}
	.session-title { font-size: 0.95rem; font-weight: 700; color: var(--color-text-primary); }
	.session-body { margin-top: 0.5rem; font-size: 0.8rem; color: var(--color-text-secondary); }
	.session-retry {
		margin-top: 1.25rem;
		padding: 0.625rem 1.25rem;
		border: none;
		border-radius: 14px;
		background: var(--color-accent);
		color: var(--color-on-accent);
		font: inherit;
		font-size: 0.8rem;
		font-weight: 700;
	}

	.notice {
		position: fixed;
		z-index: 200;
		top: 48px;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: max-content;
		max-width: calc(100vw - 2rem);
		padding: 0.625rem 0.875rem;
		font-size: 0.75rem;
		font-weight: 600;
		color: var(--color-text-primary);
		background: var(--color-bg-surface);
		border-radius: 14px;
		box-shadow: var(--shadow-card);
	}
	.notice-close {
		display: flex;
		align-items: center;
		justify-content: center;
		flex-shrink: 0;
		width: 28px;
		height: 28px;
		margin: -0.25rem -0.375rem -0.25rem 0;
		border: none;
		border-radius: 8px;
		background: none;
		color: var(--color-text-muted);
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
