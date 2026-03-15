<script lang="ts">
	import { goto } from '$app/navigation';
	import { signInWithGoogle } from '$lib/stores/authState.svelte';

	let error = $state('');
	let loading = $state(false);

	async function handleGoogle() {
		error = '';
		loading = true;
		try {
			await signInWithGoogle();
			goto('/timer');
		} catch (e: unknown) {
			const code = (e as { code?: string })?.code ?? '';
			if (code !== 'auth/popup-closed-by-user') {
				error = 'Sign in failed. Please try again.';
			}
		} finally {
			loading = false;
		}
	}
</script>

<div class="page">
	<div class="card">
		<div class="logo">
			<svg width="28" height="28" viewBox="0 0 28 28" fill="none">
				<rect width="28" height="28" rx="8" fill="var(--color-bg-surface)"/>
				<circle cx="14" cy="10" r="3" stroke="var(--color-text-muted)" stroke-width="1.3"/>
				<path d="M7 22c0-3.866 3.134-7 7-7s7 3.134 7 7" stroke="var(--color-text-muted)" stroke-width="1.3" stroke-linecap="round"/>
			</svg>
		</div>

		<h1 class="title">Save your data</h1>
		<p class="subtitle">Sign in to sync your notes, tasks, and timer across all your devices.</p>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		<button class="btn-google" onclick={handleGoogle} disabled={loading}>
			{#if loading}
				<span class="spinner"></span>
			{:else}
				<svg width="16" height="16" viewBox="0 0 24 24" fill="none">
					<path d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92c-.26 1.37-1.04 2.53-2.21 3.31v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.09z" fill="#4285F4"/>
					<path d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z" fill="#34A853"/>
					<path d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l3.66-2.84z" fill="#FBBC05"/>
					<path d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z" fill="#EA4335"/>
				</svg>
				Continue with Google
			{/if}
		</button>

		<button class="skip-btn" onclick={() => goto('/timer')}>
			Continue without signing in
		</button>
	</div>
</div>

<style>
	.page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100vh;
		background: var(--color-bg-base);
		padding: 1rem;
	}

	.card {
		width: 100%;
		max-width: 320px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
	}

	.logo { margin-bottom: 1.25rem; }

	.title {
		font-size: 1.125rem;
		font-weight: 600;
		color: var(--color-text-primary);
		margin: 0 0 0.375rem;
		letter-spacing: -0.01em;
	}

	.subtitle {
		font-size: 0.75rem;
		color: var(--color-text-muted);
		margin: 0 0 1.75rem;
		text-align: center;
		line-height: 1.5;
	}

	.error {
		font-size: 0.75rem;
		color: #e07070;
		margin: 0 0 0.75rem;
		text-align: center;
	}

	.btn-google {
		width: 100%;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		padding: 0.625rem 1rem;
		font-size: 0.8125rem;
		font-family: inherit;
		color: var(--color-text-primary);
		cursor: pointer;
		display: flex;
		align-items: center;
		justify-content: center;
		gap: 0.625rem;
		height: 42px;
		transition: background 0.15s, border-color 0.15s;
		font-weight: 500;
	}
	.btn-google:hover:not(:disabled) {
		background: var(--color-bg-hover);
		border-color: var(--color-text-muted);
	}
	.btn-google:disabled { opacity: 0.5; cursor: not-allowed; }

	.spinner {
		width: 16px;
		height: 16px;
		border: 2px solid var(--color-border-default);
		border-top-color: var(--color-text-muted);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	.skip-btn {
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.72rem;
		color: var(--color-text-muted);
		cursor: pointer;
		margin-top: 1rem;
		padding: 0.25rem 0.5rem;
		transition: color 0.15s;
	}
	.skip-btn:hover { color: var(--color-text-secondary); }

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
