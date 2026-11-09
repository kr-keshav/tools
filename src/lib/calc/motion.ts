// Ripple motion from DESIGN.md. CSS covers what it can; these are the moments that need
// to start from a value change. Web Animations ignore the global reduced-motion rule, so
// everything here goes through `play`.

const SPRING = 'cubic-bezier(0.2, 1.5, 0.35, 1)';
const OUT = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

function play(el: Element, frames: PropertyIndexedKeyframes | Keyframe[], options: KeyframeAnimationOptions) {
	if (matchMedia('(prefers-reduced-motion: reduce)').matches) return;
	el.animate(frames, options);
}

/** Starts a circle at the pointer; the `.rip` style in app.css removes it visually. */
export function ripple(e: PointerEvent) {
	const button = e.currentTarget as HTMLElement;
	const box = button.getBoundingClientRect();
	const circle = document.createElement('span');
	circle.className = 'rip';
	circle.style.left = `${e.clientX - box.left}px`;
	circle.style.top = `${e.clientY - box.top}px`;
	button.append(circle);
	circle.addEventListener('animationend', () => circle.remove());
}

let cascade = 0;
let cascadeReset = false;

/** Rows updated in one pass ask in tape order, so the change visibly travels down it. */
export function nextCascadeDelay(): number {
	if (!cascadeReset) {
		cascadeReset = true;
		setTimeout(() => {
			cascade = 0;
			cascadeReset = false;
		});
	}
	return 70 * cascade++;
}

/** Flash a row in its `--wash` colour. */
export function wash(el: Element, delay: number) {
	play(
		el,
		{ backgroundColor: ['color-mix(in srgb, var(--wash) 26%, transparent)', 'transparent'] },
		{ duration: 800, delay, easing: OUT },
	);
}

export function rise(el: Element) {
	play(
		el,
		{ transform: ['translateY(26px)', 'none'], opacity: [0, 1] },
		{ duration: 550, easing: SPRING },
	);
}

/** Svelte action: a small bump whenever `value` changes. */
export function bumpOn(node: HTMLElement, value: unknown) {
	let last = value;
	return {
		update(next: unknown) {
			if (next === last) return;
			last = next;
			play(
				node,
				[{ transform: 'scale(1)' }, { transform: 'scale(1.09)', offset: 0.4 }, { transform: 'scale(1)' }],
				{ duration: 500, delay: 180, easing: SPRING },
			);
		},
	};
}

let fresh = false;

/** The next row to mount was just added by the user, not loaded. */
export function markFresh() {
	fresh = true;
}

export function takeFresh(): boolean {
	const was = fresh;
	fresh = false;
	return was;
}
