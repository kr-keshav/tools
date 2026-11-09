export let panelState = $state({ leftOpen: false, rightOpen: false, swapped: false });
export const toolRoutes = { timer: '/timer', notes: '/notes', todo: '/todo' };
export type ToolName = keyof typeof toolRoutes;

/** Below this width panels overlay the content, so only one can be open at a time. */
function isOverlayViewport() {
	return typeof window !== 'undefined' && window.matchMedia('(max-width: 768px)').matches;
}

export function toggleLeft() {
	panelState.leftOpen = !panelState.leftOpen;
	if (panelState.leftOpen && isOverlayViewport()) panelState.rightOpen = false;
}
export function toggleRight() {
	panelState.rightOpen = !panelState.rightOpen;
	if (panelState.rightOpen && isOverlayViewport()) panelState.leftOpen = false;
}
export function closeLeft()   { panelState.leftOpen  = false; }
export function closeRight()  { panelState.rightOpen = false; }
export function closeBoth()   { panelState.leftOpen  = false; panelState.rightOpen = false; }

export function swapSides() {
	const wasLeftOpen = panelState.leftOpen;
	panelState.leftOpen  = panelState.rightOpen;
	panelState.rightOpen = wasLeftOpen;
	panelState.swapped   = !panelState.swapped;
}
