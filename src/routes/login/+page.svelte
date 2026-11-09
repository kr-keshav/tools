<script lang="ts">
	import { goto } from '$app/navigation';
	import { signInWithGoogle, AnonymousDataConflictError } from '$lib/stores/authState.svelte';

	let error = $state('');
	let loading = $state(false);
	// Shown when the Google account already exists and signing in would strand whatever
	// was written on this device anonymously.
	let showConflict = $state(false);

	async function handleGoogle(discardLocal = false) {
		error = '';
		showConflict = false;
		loading = true;
		try {
			await signInWithGoogle(discardLocal);
			goto('/timer');
		} catch (e: unknown) {
			if (e instanceof AnonymousDataConflictError) {
				showConflict = true;
			} else {
				const code = (e as { code?: string })?.code ?? '';
				if (code === 'auth/popup-blocked') {
					error = 'Your browser blocked the sign-in window. Allow pop-ups for this site and try again.';
				} else if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
					error = 'Sign in failed. Please try again.';
				}
			}
		} finally {
			loading = false;
		}
	}
</script>

<svelte:head><title>Sign in · WorkKit</title></svelte:head>

<div class="page">
	<div class="card">
		<!-- Sign-in is where people check they are on the right site before handing over an
		     identity, so the wordmark belongs here as much as anywhere in the app. -->
		<div class="brand">
			<svg width="20" height="20" viewBox="0 0 18 18" fill="none">
				<rect width="18" height="18" rx="5" fill="var(--color-accent)" fill-opacity="0.15"/>
				<circle cx="9" cy="10" r="5" stroke="var(--color-accent)" stroke-width="1.3" fill="none"/>
				<line x1="9" y1="10" x2="9" y2="7" stroke="var(--color-accent)" stroke-width="1.3" stroke-linecap="round"/>
				<line x1="9" y1="10" x2="11.2" y2="11.5" stroke="var(--color-accent)" stroke-width="1.3" stroke-linecap="round"/>
				<line x1="7" y1="4" x2="11" y2="4" stroke="var(--color-accent)" stroke-width="1.3" stroke-linecap="round"/>
			</svg>
			<span class="brand-text"><span class="brand-work">Work</span><span class="brand-kit">Kit</span></span>
		</div>

		<h1 class="title">Keep your work</h1>
		<p class="subtitle">Sign in and your notes, tasks and timer follow you to every device. Anything you have written on this device comes with you.</p>

		{#if error}
			<p class="error">{error}</p>
		{/if}

		{#if showConflict}
			<div class="conflict">
				<p class="conflict-title">That account already exists</p>
				<p class="conflict-body">
					Signing into it leaves behind whatever you have written on this device — it stays
					under the temporary session and won't appear in your account.
				</p>
				<div class="conflict-actions">
					<button class="conflict-go" onclick={() => handleGoogle(true)} disabled={loading}>
						Sign in anyway
					</button>
					<button class="conflict-stay" onclick={() => { showConflict = false; goto('/timer'); }}>
						Keep working here
					</button>
				</div>
			</div>
		{/if}

		<button class="btn-google" onclick={() => handleGoogle()} disabled={loading}>
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
		background: var(--color-bg-primary);
		padding: 1rem;
	}

	.card {
		width: 100%;
		max-width: 380px;
		padding: 2rem 1.75rem;
		background: var(--color-bg-surface);
		border-radius: 20px;
		box-shadow: var(--shadow-card);
		animation: login-rise 600ms var(--ease-out) backwards;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0;
	}

	@keyframes login-rise {
		from { transform: translateY(26px); opacity: 0; }
	}

	.brand {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		margin-bottom: 1.5rem;
	}
	.brand-text {
		font-size: 0.95rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.brand-work { color: var(--color-text-primary); }
	.brand-kit  { color: var(--color-accent); }

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
		color: var(--color-danger);
		margin: 0 0 0.75rem;
		text-align: center;
	}

	.conflict {
		width: 100%;
		border: 1px solid color-mix(in srgb, var(--tag-1-fg) 35%, transparent);
		background: var(--tag-1-bg);
		border-radius: 8px;
		padding: 0.75rem 0.875rem;
		margin-bottom: 0.875rem;
		text-align: left;
	}
	.conflict-title {
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--tag-1-fg);
		margin: 0 0 0.35rem;
	}
	.conflict-body {
		font-size: 0.72rem;
		line-height: 1.5;
		color: var(--color-text-secondary);
		margin: 0 0 0.75rem;
	}
	.conflict-actions {
		display: flex;
		gap: 0.5rem;
	}
	.conflict-go, .conflict-stay {
		flex: 1;
		font-family: inherit;
		font-size: 0.72rem;
		border-radius: 6px;
		padding: 0.4rem 0.5rem;
		cursor: pointer;
		transition: background 0.15s, border-color 0.15s, color 0.15s;
	}
	.conflict-go {
		background: none;
		border: 1px solid var(--color-text-muted);
		color: var(--color-text-secondary);
	}
	.conflict-go:hover:not(:disabled) { color: var(--color-text-primary); border-color: var(--color-text-muted); }
	.conflict-stay {
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-default);
		color: var(--color-text-primary);
		font-weight: 500;
	}
	.conflict-stay:hover { background: var(--color-bg-hover); }

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
