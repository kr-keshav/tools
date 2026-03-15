<script lang="ts">
	import { browser } from '$app/environment';
	import QRCode from 'qrcode';

	let { uid, onClose }: { uid: string; onClose: () => void } = $props();

	let qrDataUrl = $state('');
	let copied = $state(false);

	const shareUrl = $derived(
		browser ? `${window.location.origin}?view=${uid}` : ''
	);

	$effect(() => {
		if (!shareUrl) return;
		QRCode.toDataURL(shareUrl, {
			width: 220,
			margin: 2,
			color: { dark: '#e0e0e0', light: '#141414' },
			errorCorrectionLevel: 'M',
		}).then((url) => {
			qrDataUrl = url;
		});
	});

	async function copyLink() {
		try {
			await navigator.clipboard.writeText(shareUrl);
			copied = true;
			setTimeout(() => { copied = false; }, 2000);
		} catch {
			// clipboard not available
		}
	}

	function handleBackdrop(e: MouseEvent) {
		if (e.target === e.currentTarget) onClose();
	}

	function handleKey(e: KeyboardEvent) {
		if (e.key === 'Escape') onClose();
	}
</script>

<svelte:window onkeydown={handleKey} />

<!-- Backdrop -->
<div
	class="backdrop"
	onclick={handleBackdrop}
	role="dialog"
	aria-modal="true"
	aria-label="Share via QR code"
>
	<div class="modal">
		<!-- Header -->
		<div class="modal-header">
			<div class="modal-title">
				<svg width="14" height="14" viewBox="0 0 14 14" fill="none">
					<rect x="0.5" y="0.5" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.1"/>
					<rect x="8.5" y="0.5" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.1"/>
					<rect x="0.5" y="8.5" width="5" height="5" rx="0.5" stroke="currentColor" stroke-width="1.1"/>
					<rect x="2" y="2" width="2" height="2" fill="currentColor"/>
					<rect x="10" y="2" width="2" height="2" fill="currentColor"/>
					<rect x="2" y="10" width="2" height="2" fill="currentColor"/>
					<path d="M8.5 8.5h2v2h-2zM10.5 10.5h2v2h-2zM12.5 8.5h1v1h-1zM8.5 12.5h1v1h-1z" fill="currentColor"/>
				</svg>
				Open on another device
			</div>
			<button class="close-btn" onclick={onClose} aria-label="Close">
				<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
					<path d="M1 1l10 10M11 1L1 11" stroke="currentColor" stroke-width="1.4" stroke-linecap="round"/>
				</svg>
			</button>
		</div>

		<!-- QR code -->
		<div class="qr-container">
			{#if qrDataUrl}
				<img src={qrDataUrl} alt="QR code" class="qr-img" />
			{:else}
				<div class="qr-placeholder">
					<div class="spinner"></div>
				</div>
			{/if}
		</div>

		<!-- Instructions -->
		<p class="instructions">
			Scan to open your workspace on any device — no login needed. Timer state syncs in real time.
		</p>

		<!-- URL copy -->
		<div class="url-row">
			<span class="url-text">{shareUrl}</span>
			<button class="copy-btn" onclick={copyLink}>
				{#if copied}
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
						<path d="M2 6l3 3 5-5" stroke="currentColor" stroke-width="1.4" stroke-linecap="round" stroke-linejoin="round"/>
					</svg>
					Copied
				{:else}
					<svg width="12" height="12" viewBox="0 0 12 12" fill="none">
						<rect x="3.5" y="1.5" width="7" height="7" rx="1" stroke="currentColor" stroke-width="1.1"/>
						<path d="M1.5 4.5v5a1 1 0 0 0 1 1h5" stroke="currentColor" stroke-width="1.1" stroke-linecap="round"/>
					</svg>
					Copy link
				{/if}
			</button>
		</div>

		<!-- Security note -->
		<p class="security-note">
			Anyone with this link can view your workspace. Treat it like a private URL.
		</p>
	</div>
</div>

<style>
	.backdrop {
		position: fixed;
		inset: 0;
		background: rgba(0, 0, 0, 0.6);
		display: flex;
		align-items: center;
		justify-content: center;
		z-index: 500;
		padding: 1rem;
	}

	.modal {
		background: var(--color-bg-surface);
		border: 1px solid var(--color-border-default);
		border-radius: 14px;
		padding: 1.25rem;
		width: 100%;
		max-width: 300px;
		display: flex;
		flex-direction: column;
		align-items: center;
		gap: 0.875rem;
		box-shadow: 0 16px 48px rgba(0, 0, 0, 0.5);
	}

	.modal-header {
		width: 100%;
		display: flex;
		align-items: center;
		justify-content: space-between;
	}

	.modal-title {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		font-size: 0.78rem;
		font-weight: 600;
		color: var(--color-text-primary);
	}

	.close-btn {
		display: flex;
		align-items: center;
		justify-content: center;
		width: 24px;
		height: 24px;
		background: none;
		border: none;
		color: var(--color-text-muted);
		cursor: pointer;
		border-radius: 4px;
		transition: color 0.15s, background 0.15s;
		flex-shrink: 0;
	}
	.close-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-bg-hover);
	}

	.qr-container {
		width: 220px;
		height: 220px;
		border-radius: 10px;
		overflow: hidden;
		background: #141414;
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.qr-img {
		width: 220px;
		height: 220px;
		display: block;
	}

	.qr-placeholder {
		display: flex;
		align-items: center;
		justify-content: center;
	}

	.spinner {
		width: 20px;
		height: 20px;
		border: 2px solid var(--color-border-default);
		border-top-color: var(--color-text-muted);
		border-radius: 50%;
		animation: spin 0.7s linear infinite;
	}

	.instructions {
		font-size: 0.72rem;
		color: var(--color-text-secondary);
		text-align: center;
		margin: 0;
		line-height: 1.5;
	}

	.url-row {
		display: flex;
		align-items: center;
		gap: 0.5rem;
		width: 100%;
		background: var(--color-bg-base);
		border: 1px solid var(--color-border-subtle);
		border-radius: 6px;
		padding: 0.4rem 0.5rem;
	}

	.url-text {
		flex: 1;
		font-size: 0.65rem;
		color: var(--color-text-muted);
		overflow: hidden;
		text-overflow: ellipsis;
		white-space: nowrap;
		font-family: monospace;
	}

	.copy-btn {
		display: flex;
		align-items: center;
		gap: 0.3rem;
		background: none;
		border: none;
		font-family: inherit;
		font-size: 0.7rem;
		color: var(--color-text-secondary);
		cursor: pointer;
		padding: 0.15rem 0.375rem;
		border-radius: 4px;
		transition: color 0.15s, background 0.15s;
		white-space: nowrap;
		flex-shrink: 0;
	}
	.copy-btn:hover {
		color: var(--color-text-primary);
		background: var(--color-bg-hover);
	}

	.security-note {
		font-size: 0.65rem;
		color: var(--color-text-muted);
		text-align: center;
		margin: 0;
		opacity: 0.7;
		line-height: 1.5;
	}

	@keyframes spin {
		to { transform: rotate(360deg); }
	}
</style>
