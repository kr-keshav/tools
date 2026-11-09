<script lang="ts">
	import { page } from '$app/stores';
	const missing = $derived($page.status === 404);
</script>

<svelte:head><title>{missing ? 'Page not found' : 'Something went wrong'} · WorkKit</title></svelte:head>

<div class="page">
	<div class="card">
		<p class="status">{$page.status}</p>
		<h1>{missing ? "We can't find that page" : 'Something went wrong'}</h1>
		<p class="body">{missing ? 'The link may be old or mistyped.' : 'Please try again in a moment.'}</p>
		<a href="/timer">Back to WorkKit</a>
	</div>
</div>

<style>
	.page {
		display: flex;
		align-items: center;
		justify-content: center;
		min-height: 100dvh;
		padding: 1rem;
		background: var(--color-bg-primary);
	}
	.card {
		width: 100%;
		max-width: 380px;
		padding: 2rem 1.75rem;
		text-align: center;
		background: var(--color-bg-surface);
		border-radius: 20px;
		box-shadow: var(--shadow-card);
	}
	.status { font-size: 0.8rem; font-weight: 700; color: var(--color-accent); }
	h1 { margin-top: 0.5rem; font-size: 1.1rem; font-weight: 800; color: var(--color-text-primary); }
	.body { margin-top: 0.5rem; font-size: 0.8rem; color: var(--color-text-secondary); }
	a {
		display: inline-block;
		margin-top: 1.25rem;
		padding: 0.625rem 1.25rem;
		border-radius: 14px;
		background: var(--color-accent);
		color: var(--color-on-accent);
		font-size: 0.8rem;
		font-weight: 700;
		text-decoration: none;
	}
</style>
