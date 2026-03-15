export let panelState = $state({ leftOpen: false, rightOpen: false, swapped: false });
export const toolRoutes = { timer: '/timer', notes: '/notes', todo: '/todo' };
export type ToolName = keyof typeof toolRoutes;

export function toggleLeft()  { panelState.leftOpen  = !panelState.leftOpen; }
export function toggleRight() { panelState.rightOpen = !panelState.rightOpen; }
export function closeLeft()   { panelState.leftOpen  = false; }
export function closeRight()  { panelState.rightOpen = false; }

export function swapSides() {
	const wasLeftOpen = panelState.leftOpen;
	panelState.leftOpen  = panelState.rightOpen;
	panelState.rightOpen = wasLeftOpen;
	panelState.swapped   = !panelState.swapped;
}
