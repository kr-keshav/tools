<script lang="ts">
	let { text, delay = 0 }: { text: string; delay?: number } = $props();

	// Compared from the right so 999 → 1,000 lines the units up
	let last = '';
	let generation = 0;

	const chars = $derived.by(() => {
		const first = last === '';
		const shift = text.length - last.length;
		const pass = ++generation;
		const out = [...text].map((char, i) => {
			const fromEnd = text.length - i;
			const changed = !first && last[i - shift] !== char;
			return { char, changed, key: changed ? `${pass}:${fromEnd}` : `same:${fromEnd}` };
		});
		last = text;
		return out;
	});
</script>

{#each chars as { char, changed, key }, i (key)}<span class:roll={changed} style:--delay="{delay + i * 18}ms">{char}</span>{/each}

<style>
	.roll {
		display: inline-block;
		animation: roll 460ms var(--ease-spring) var(--delay) backwards;
	}
	@keyframes roll {
		from {
			transform: translateY(70%);
			opacity: 0;
		}
	}
</style>
