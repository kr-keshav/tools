<script lang="ts">
	import { page } from '$app/stores';
	import { goto } from '$app/navigation';
	import { authState, signOut } from '$lib/stores/authState.svelte';
	import { panelState, toggleLeft, toggleRight, type ToolName } from '$lib/stores/panelState.svelte';
	import { themeState, toggleTheme } from '$lib/stores/themeState.svelte';
	import QRModal from './QRModal.svelte';

	let { leftTool, rightTool }: { leftTool?: ToolName; rightTool?: ToolName } = $props();

	let showQR = $state(false);
	let showUserMenu = $state(false);

	const accent: Record<ToolName, string> = {
		timer: 'var(--tag-0-fg)',
		notes: 'var(--tag-2-fg)',
		todo:  'var(--tag-1-fg)',
	};

	const uid = $derived(authState.user?.uid ?? '');
	const isAnon = $derived(authState.user?.isAnonymous ?? true);
	const userEmail = $derived(authState.user?.email ?? '');
	const viewUid = $derived($page.url.searchParams.get('view'));
	const isViewerMode = $derived(!!viewUid);
	const isCalcRoute = $derived($page.url.pathname === '/calc');

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
		<button class="logo" onclick={() => goto('/timer' + $page.url.search)} title="Go to Timer">
			<svg width="18" height="18" viewBox="0 0 18 18" fill="none">
				<rect width="18" height="18" rx="5" fill="var(--color-accent)" fill-opacity="0.15"/>
				<circle cx="9" cy="10" r="5" stroke="var(--color-accent)" stroke-width="1.3" fill="none"/>
				<line x1="9" y1="10" x2="9" y2="7" stroke="var(--color-accent)" stroke-width="1.3" stroke-linecap="round"/>
				<line x1="9" y1="10" x2="11.2" y2="11.5" stroke="var(--color-accent)" stroke-width="1.3" stroke-linecap="round"/>
				<line x1="7" y1="4" x2="11" y2="4" stroke="var(--color-accent)" stroke-width="1.3" stroke-linecap="round"/>
			</svg>
			<span class="logo-text"><span class="logo-work">Work</span><span class="logo-kit">Kit</span></span>
		</button>

		<!-- Panel toggles. The edge tabs are easy to miss and unusable on a phone, so the
		     two side tools get named buttons here. -->
		{#if leftTool && rightTool}
			<div class="panel-toggles">
				<button
					class="panel-toggle"
					class:on={panelState.leftOpen}
					style="--tool: {accent[leftTool]}"
					onclick={toggleLeft}
					aria-pressed={panelState.leftOpen}
					title="{panelState.leftOpen ? 'Hide' : 'Show'} {leftTool}"
				>
					<span class="dot"></span>{leftTool}
				</button>
				<button
					class="panel-toggle"
					class:on={panelState.rightOpen}
					style="--tool: {accent[rightTool]}"
					onclick={toggleRight}
					aria-pressed={panelState.rightOpen}
					title="{panelState.rightOpen ? 'Hide' : 'Show'} {rightTool}"
				>
					<span class="dot"></span>{rightTool}
				</button>
			</div>
		{/if}
	</div>

	<!-- Center: live sync banner -->
	{#if isViewerMode}
		<div class="viewer-banner">
			<svg width="11" height="11" viewBox="0 0 11 11" fill="none">
				<path d="M1.5 5.5A4 4 0 0 1 9 3M9.5 5.5A4 4 0 0 1 2 8" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
				<path d="M7.5 2.5L9 3l-.5 1.5M3.5 8.5L2 8l.5-1.5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round" stroke-linejoin="round"/>
			</svg>
			Live sync
			<button class="viewer-exit" onclick={() => goto('/timer')}>Exit</button>
		</div>
	{/if}

	<!-- Right: actions -->
	<div class="right">
		<!-- Calc is its own route outside the panel layout, so it gets a direct link -->
		{#if isCalcRoute}
			<button class="nav-btn" onclick={() => goto('/timer' + $page.url.search)} title="Back to Timer, Notes and Todo">
				<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
					<rect x="1" y="2" width="11" height="9" rx="1.5" stroke="currentColor" stroke-width="1.1"/>
					<line x1="4.5" y1="2" x2="4.5" y2="11" stroke="currentColor" stroke-width="1.1"/>
					<line x1="8.5" y1="2" x2="8.5" y2="11" stroke="currentColor" stroke-width="1.1"/>
				</svg>
				<span>Tools</span>
			</button>
		{:else}
			<button class="nav-btn calc" onclick={() => goto('/calc' + $page.url.search)} title="Calculator with full history">
				<svg width="13" height="13" viewBox="0 0 13 13" fill="none">
					<rect x="2" y="1" width="9" height="11" rx="1.5" stroke="currentColor" stroke-width="1.1"/>
					<rect x="3.75" y="2.75" width="5.5" height="2" rx="0.4" fill="currentColor" fill-opacity="0.5"/>
					<circle cx="4.5" cy="7.25" r="0.65" fill="currentColor"/>
					<circle cx="6.5" cy="7.25" r="0.65" fill="currentColor"/>
					<circle cx="8.5" cy="7.25" r="0.65" fill="currentColor"/>
					<circle cx="4.5" cy="9.75" r="0.65" fill="currentColor"/>
					<circle cx="6.5" cy="9.75" r="0.65" fill="currentColor"/>
					<circle cx="8.5" cy="9.75" r="0.65" fill="currentColor"/>
				</svg>
				<span>Calc</span>
			</button>
		{/if}

		<button
			class="theme-btn"
			onclick={toggleTheme}
			aria-label={themeState.theme === 'dark' ? 'Switch to light mode' : 'Switch to dark mode'}
			title={themeState.theme === 'dark' ? 'Light mode' : 'Dark mode'}
		>
			{#if themeState.theme === 'dark'}
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><circle cx="7" cy="7" r="2.6" stroke="currentColor" stroke-width="1.2"/><path d="M7 1v1.4M7 11.6V13M1 7h1.4M11.6 7H13M2.8 2.8l1 1M10.2 10.2l1 1M2.8 11.2l1-1M10.2 3.8l1-1" stroke="currentColor" stroke-width="1.2" stroke-linecap="round"/></svg>
			{:else}
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none"><path d="M11.8 8.6A5 5 0 0 1 5.4 2.2a5 5 0 1 0 6.4 6.4z" stroke="currentColor" stroke-width="1.2" stroke-linejoin="round"/></svg>
			{/if}
		</button>

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
		gap: 0.5rem;
		min-width: 0;
	}

	.panel-toggles {
		display: flex;
		align-items: center;
		gap: 0.25rem;
		padding-left: 0.5rem;
		border-left: 1px solid var(--color-border-subtle);
	}

	.panel-toggle {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--color-text-secondary);
		font-family: inherit;
		font-size: 0.7rem;
		text-transform: capitalize;
		cursor: pointer;
		padding: 0.3rem 0.5rem;
		height: 26px;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.panel-toggle:hover {
		color: var(--color-text-primary);
		background: var(--color-bg-hover);
	}
	.panel-toggle.on {
		color: var(--color-text-primary);
		border-color: color-mix(in srgb, var(--tool) 45%, transparent);
		background: color-mix(in srgb, var(--tool) 12%, transparent);
	}

	.dot {
		width: 6px;
		height: 6px;
		border-radius: 50%;
		background: var(--tool);
		opacity: 0.45;
		transition: opacity 0.15s;
		flex-shrink: 0;
	}
	.panel-toggle.on .dot,
	.panel-toggle:hover .dot { opacity: 1; }

	/* Phones: the QR label and logo wordmark give way so the tool toggles always fit. */
	@media (max-width: 570px) {
		.panel-toggle { padding: 0.3rem 0.4rem; }
		.qr-btn span, .signin-btn span { display: none; }
		.qr-btn, .signin-btn { padding: 0.3rem 0.5rem; }
	}
	@media (max-width: 410px) {
		.logo-text { display: none; }
	}
	/* Smallest phones: the names matter more than the dots and gaps */
	@media (max-width: 360px) {
		.panel-toggle .dot { display: none; }
		.panel-toggles { gap: 0; padding-left: 0.25rem; }
		.right { gap: 0.125rem; }
		.theme-btn { width: 26px; }
	}

	/* The bar is 40px tall, so taps get its full height without moving anything */
	@media (pointer: coarse) {
		.logo, .panel-toggle, .nav-btn, .theme-btn, .qr-btn, .signin-btn, .icon-btn { position: relative; }
		.logo::after, .panel-toggle::after, .nav-btn::after, .theme-btn::after,
		.qr-btn::after, .signin-btn::after, .icon-btn::after {
			content: '';
			position: absolute;
			inset: -7px -1px;
		}
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
	.theme-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 30px;
		height: 30px;
		background: none;
		border: none;
		border-radius: 8px;
		color: var(--color-text-muted);
		transition: color 0.15s, background 0.15s;
	}
	.theme-btn:hover { color: var(--color-text-primary); background: var(--color-bg-hover); }

	.logo-work {
		color: var(--color-text-primary);
	}
	.logo-kit {
		color: var(--color-accent);
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

	.nav-btn {
		display: flex;
		align-items: center;
		gap: 0.375rem;
		background: none;
		border: 1px solid transparent;
		border-radius: 6px;
		color: var(--color-text-secondary);
		font-family: inherit;
		font-size: 0.72rem;
		padding: 0.3rem 0.5rem;
		height: 28px;
		transition: color 0.15s, border-color 0.15s, background 0.15s;
	}
	.nav-btn:hover { color: var(--color-text-primary); background: var(--color-bg-hover); }
	.nav-btn.calc:hover {
		color: var(--color-accent-calc);
		border-color: color-mix(in srgb, var(--color-accent-calc) 40%, transparent);
		background: color-mix(in srgb, var(--color-accent-calc) 10%, transparent);
	}
	@media (max-width: 570px) {
		.nav-btn span { display: none; }
	}

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
