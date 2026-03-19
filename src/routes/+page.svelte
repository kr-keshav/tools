<script lang="ts">
	import { goto } from '$app/navigation';
	import { onMount } from 'svelte';

	onMount(() => {
		goto('/timer' + window.location.search, { replaceState: true });
	});
</script>
