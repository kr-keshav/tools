import { getContext, setContext } from 'svelte';
import type { LineInfo } from '$lib/calc/tape';

// Every sheet is evaluated once at the top (CalcTool); nested sub-tapes read from here
// instead of re-running the evaluation for their own slice.
const KEY = Symbol('calc');

export interface CalcContext {
	readonly results: Map<string, LineInfo[]>;
}

export const setCalcContext = (ctx: CalcContext) => setContext(KEY, ctx);
export const getCalcContext = () => getContext<CalcContext>(KEY);
