<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { authState, signOut } from '$lib/stores/authState.svelte';
	import QRModal from './QRModal.svelte';

	let showQR = $state(false);
	let showUserMenu = $state(false);

	const uid = $derived(authState.user?.uid ?? '');
	const isAnon = $derived(authState.user?.isAnonymous ?? true);
	const userEmail = $derived(authState.user?.email ?? '');
	const viewUid = $derived($page.url.searchParams.get('view'));
	const isViewerMode = $derived(!!viewUid);

	function handleSignOut() {
		showUserMenu = false;
		signOut().then(() => goto('/timer'));
	}

	function handleClickOutside() {
		if (showUserMenu) showUserMenu = false;
	}
</script>

<svelte:window onclick={handleClickOutside} />

<header class="header">
	<!-- Left: logo -->
	<div class="left">
		<button class="logo" onclick={() => goto('/timer')} title="Go to Timer">
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<rect width="18" height="18" rx="5" fill="#6c8ebf" fill-opacity="0.15"/>
				<circle cx="9" cy="10" r="5" stroke="#6c8ebf" stroke-width="1.3" fill="none"/>
				<line x1="9" y1="10" x2="9" y2="7" stroke="#6c8ebf" stroke-width="1.3" stroke-linecap="round"/>
				<line x1="9" y1="10" x2="11.2" y2="11.5" stroke="#6c8ebf" stroke-width="1.3" stroke-linecap="round"/>
				<line x1="7" y1="4" x2="11" y2="4" stroke="#6c8ebf" stroke-width="1.3" stroke-linecap="round"/>
			</svg>
			<span class="logo-text"><span class="logo-work">Work</span><span class="logo-kit">Kit</span></span>
		</button>
	</div>

	<!-- Center: viewer mode banner -->
	{#if isViewerMode}
		<div class="viewer-banner">
			<svg width="11" height="11" viewBox="0 0 11 11" fill="none">
				<ellipse cx="5.5" cy="5.5" rx="5" ry="3" stroke="currentColor" stroke-width="1"/>
				<circle cx="5.5" cy="5.5" r="1.5" fill="currentColor"/>
			</svg>
			Shared view · read only
			<button class="viewer-exit" onclick={() => goto('/timer')}>Exit</button>
		</div>
	{/if}

	<!-- Right: actions -->
	<div class="right">
		<!-- QR button — only show in non-viewer mode -->
		{#if !isViewerMode}
			<button
				class="qr-btn"
				onclick={() => showQR = true}
				title="Open on another device — scan QR, no login needed"
				disabled={!uid}
			>
				<svg width="13" height="13" viewBox="0 0 15 15" fill="none">
					<rect x="1" y="1" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
					<rect x="9" y="1" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
					<rect x="1" y="9" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.2"/>
					<rect x="2.5" y="2.5" width="2" height="2" fill="currentColor"/>
					<rect x="10.5" y="2.5" width="2" height="2" fill="currentColor"/>
					<rect x="2.5" y="10.5" width="2" height="2" fill="currentColor"/>
					<path d="M9 9h2v2H9zM11 11h2v2h-2zM13 9h1v1h-1zM9 13h1v1H9z" fill="currentColor"/>
				</svg>
				<span>Open on phone</span>
			</button>
		{/if}

		<!-- User button -->
		<div class="user-wrap">
			{#if isAnon}
				<button
					class="signin-btn"
					onclick={() => goto('/login')}
					title="Sign in to save your data across all devices"
				>
					<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
						<circle cx="6.5" cy="4" r="2.5" stroke="currentColor" stroke-width="1.2"/>
						<path d="M1 12c0-3.038 2.462-5.5 5.5-5.5S12 8.962 12 12" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
					</svg>
					<span>Sign in</span>
				</button>
			{:else}
				<button
					class="icon-btn"
					onclick={(e) => { e.stopPropagation(); showUserMenu = !showUserMenu; }}
					title={userEmail}
				>
					<div class="avatar">
						{userEmail.charAt(0).toUpperCase() || '?'}
					</div>
				</button>
				{#if showUserMenu}
					<div class="user-menu" role="menu">
						<div class="user-menu-info">
							<span class="user-menu-email">{userEmail}</span>
						</div>
						<button class="user-menu-item" onclick={handleSignOut} role="menuitem">
							<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
								<path d="M4.5 6H11M8.5 3.5L11 6l-2.5 2.5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round" stroke-linejoin="round"/>
								<path d="M7 1.5H2a.5.5 0 0 0-.5.5v8a.5.5 0 0 0 .5.5h5" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/>
							</svg>
							Sign out
						</button>
					</div>
				{/if}
			{/if}
		</div>
	</div>
</header>

{#if showQR && uid}
	<QRModal {uid} onClose={() => showQR = false} />
{/if}

<style>
	.header {
		height: 40px;
		min-height: 40px;
		display: flex;
		align-items: center;
		justify-content: space-between;
		padding: 0 1rem;
		background: var(--color-bg-panel);
		border-bottom: 1px solid var(--color-border-subtle);
		position: relative;
		z-index: 100;
	}

	.left {
		display: flex;
		align-items: center;
	}

	.logo {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		background: none;
		border: none;
		color: var(--color-text-secondary);
		font-family: inherit;
		font-size: 0.75rem;
		font-weight: 600;
		cursor: pointer;
		padding: 0.25rem 0.5rem;
		border-radius: 4px;
		transition: color 0.15s;
		letter-spacing: -0.01em;
	}
	.logo:hover { color: var(--color-text-primary); }

	.logo-text {
		font-size: 0.82rem;
		font-weight: 600;
		letter-spacing: -0.02em;
	}
	.logo-work {
		color: var(--color-text-primary);
	}
	.logo-kit {
		color: #6c8ebf;
	}

	.viewer-banner {
		position: absolute;
		left: 50%;
		transform: translateX(-50%);
		display: flex;
		align-items: center;
		gap: 0.375rem;
		font-size: 0.7rem;
		color: var(--color-text-muted);
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-default);
		border-radius: 20px;
		padding: 0.2rem 0.625rem;
	}

	.viewer-exit {
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		text-decoration: underline;
		text-underline-offset: 2px;
		padding: 0;
		margin-left: 0.25rem;
	}
	.viewer-exit:hover { color: var(--color-text-primary); }

	.right {
		display: flex;
		align-items: center;
		gap: 0.375rem;
	}

	.qr-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		background: none;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-text-secondary);
		font-family: inherit;
		font-size: 0.72rem;
		cursor: pointer;
		padding: 0.3rem 0.625rem;
		height: 28px;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.qr-btn:hover:not(:disabled) {
		color: var(--color-text-primary);
		border-color: var(--color-text-muted);
		background: var(--color-bg-hover);
	}
	.qr-btn:disabled { opacity: 0.4; cursor: not-allowed; }

	.icon-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 28px;
		height: 28px;
		background: none;
		border: none;
		border-radius: 6px;
		color: var(--color-text-muted);
		cursor: pointer;
		transition: color 0.15s, background 0.15s;
	}
	.icon-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-bg-hover);
	}

	.signin-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		background: none;
		border: 1px solid var(--color-border-default);
		border-radius: 6px;
		color: var(--color-text-secondary);
		font-family: inherit;
		font-size: 0.72rem;
		cursor: pointer;
		padding: 0.3rem 0.625rem;
		height: 28px;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.signin-btn:hover {
		color: var(--color-text-primary);
		border-color: var(--color-text-muted);
		background: var(--color-bg-hover);
	}

	.avatar {
		width: 22px;
		height: 22px;
		border-radius: 50%;
		background: var(--color-border-default);
		color: var(--color-text-secondary);
		font-size: 0.65rem;
		font-weight: 600;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.user-wrap {
		position: relative;
	}

	.user-menu {
		position: absolute;
		top: calc(100% + 6px);
		right: 0;
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-default);
		border-radius: 8px;
		padding: 0.375rem;
		min-width: 180px;
		box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
		z-index: 200;
	}

	.user-menu-info {
		padding: 0.375rem 0.5rem 0.5rem;
		border-bottom: 1px solid var(--color-border-subtle);
		margin-bottom: 0.25rem;
	}

	.user-menu-email {
		font-size: 0.7rem;
		color: var(--color-text-muted);
		display: block;
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
	}

	.user-menu-item {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		background: none;
		border: none;
		border-radius: 5px;
		padding: 0.4rem 0.5rem;
		font-family: inherit;
		font-size: 0.75rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		text-align: left;
		transition: background 0.1s, color 0.1s;
	}
	.user-menu-item:hover {
		background: var(--color-bg-hover);
		color: var(--color-text-primary);
	}
</style>
