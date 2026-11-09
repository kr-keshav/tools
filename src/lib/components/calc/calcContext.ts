import { getContext, setContext } from 'svelte';
import type { LineInfo } from '$lib/calc/tape';

// Every sheet is evaluated once at the top (CalcTool); nested sub-tapes read from here
// instead of re-running the evaluation for their own slice.
const KEY = Symbol('calc');

/** A text field the keypad can type into. */
export interface CalcField {
	readonly el: HTMLInputElement | null;
	readonly value: string;
	set: (next: string) => void;
	commit: () => void;
}

export interface CalcContext {
	readonly results: Map<string, LineInfo[]>;
	/** Point the keypad at a line being edited. */
	beginEdit: (lineId: string, field: CalcField) => void;
	/** Evaluate the tape as if the line being edited already held this input. */
	previewEdit: (input: string) => void;
	/** Hand the keypad back to the main entry, if `field` still holds it. */
	endEdit: (field: CalcField) => void;
}

export const setCalcContext = (ctx: CalcContext) => setContext(KEY, ctx);
export const getCalcContext = () => getContext<CalcContext>(KEY);
