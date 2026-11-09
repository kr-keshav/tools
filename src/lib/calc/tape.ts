// Sheet-level evaluation: a tape is a list of lines that can name themselves
// (`rent = 25000`), label themselves (`450 #food`), and refer to each other (`@3`, `rent`,
// `sum(#food)`). Lines are evaluated through their dependency graph rather than top to
// bottom, so a line may use a name defined further down — and a cycle is reported, not hung.

import {
	CalcError,
	clean,
	evaluateNode,
	isReservedName,
	LABEL_RE,
	parse,
	splitTrailingTags,
	TAG_RE,
	walk,
	type AngleMode,
	type Node,
	type RefTarget,
} from './engine';

export interface TapeLine {
	id: string;
	input: string;
}

export interface LineInfo {
	/** Free-text description: `Swiggy dinner: 450 + 380`. Display only — never referenced. */
	label?: string;
	/** As typed, so `Rent = …` keeps its capital; lookups are case-insensitive. */
	name?: string;
	/** The expression alone — no `name =` prefix, no label tags. */
	expr: string;
	tags: string[];
	value?: number;
	error?: string;
}

const ASSIGN_RE = /^\s*([a-z_][a-z0-9_]*)\s*=\s*(.*)$/i;

export function splitLine(input: string): Pick<LineInfo, 'label' | 'name' | 'expr' | 'tags'> {
	const { expr: whole, tags } = splitTrailingTags(input);
	const labelled = LABEL_RE.exec(whole);
	const label = labelled?.[1];
	const body = labelled ? labelled[2] : whole;
	const m = ASSIGN_RE.exec(body);
	if (m) return { label, name: m[1], expr: m[2].trim(), tags };
	return { label, expr: body.trim(), tags };
}

/** Rebuild a line's input from its parts; the inverse of splitLine. */
export function joinLine({ label, name, expr, tags }: Pick<LineInfo, 'label' | 'name' | 'expr' | 'tags'>): string {
	const head = (label ? `${label}: ` : '') + (name ? `${name} = ` : '');
	return head + expr + tags.map((t) => ` #${t}`).join('');
}

/** Apply `fn` to the expression only, leaving label, name and tags where they are. */
export function mapExpr(input: string, fn: (expr: string) => string): string {
	const parts = splitLine(input);
	return parts.expr ? joinLine({ ...parts, expr: fn(parts.expr) }) : input;
}

/** ± for an expression: `5` ↔ `-(5)`. Only unwraps when the outer parens are a real pair. */
export function negateExpr(expr: string): string {
	const inner = /^-\((.*)\)$/.exec(expr)?.[1];
	if (inner === undefined) return `-(${expr})`;
	let depth = 0;
	for (const ch of inner) {
		if (ch === '(') depth++;
		else if (ch === ')' && --depth < 0) return `-(${expr})`;
	}
	return inner;
}

/** Typed `*` and `/` become × and ÷, but a label's text stays exactly as typed. */
export function typeOperators(raw: string): string {
	const next = raw.replace(/×\*|\*\*/g, '^').replace(/\*/g, '×').replace(/\//g, '÷');
	const label = LABEL_RE.exec(next);
	if (!label) return next;
	const cut = next.length - label[2].length;
	return next.slice(0, cut).replace(/×/g, '*').replace(/÷/g, '/') + next.slice(cut);
}

/** Strip what would stop text reading back as a label; null if nothing usable is left. */
export function cleanLabel(label: string): string | null {
	const s = label.replace(/[:@#=]/g, ' ').replace(/\s+/g, ' ').trim();
	return /[\p{L}\p{Extended_Pictographic}\p{Regional_Indicator}]/u.test(s) ? s : null;
}

/** Set, replace or (with an empty label) remove the `Label:` prefix of a line's input. */
export function setLabel(input: string, label: string): string {
	const m = LABEL_RE.exec(input);
	const rest = (m ? m[2] : input).trim();
	const clean = cleanLabel(label);
	return clean ? `${clean}: ${rest}` : rest;
}

/** Which of the five tag colours a tag gets. Stable, so a tag looks the same everywhere. */
export function tagTone(tag: string): number {
	let hash = 0;
	for (const ch of tag) hash = (hash * 31 + ch.charCodeAt(0)) >>> 0;
	return hash % 5;
}

/** Append tags typed as `food`, `#food` or `food, bills` — skipping invalid and repeated ones. */
export function addTags(input: string, raw: string): string {
	const seen = new Set(splitLine(input).tags);
	const tagRe = new RegExp(`^${TAG_RE.source}$`, 'i');
	const added: string[] = [];
	for (const word of raw.toLowerCase().split(/[\s,#]+/)) {
		if (!word || seen.has(word) || !tagRe.test('#' + word)) continue;
		seen.add(word);
		added.push('#' + word);
	}
	return added.length ? `${input.trimEnd()} ${added.join(' ')}` : input;
}

function message(e: unknown): string {
	return e instanceof CalcError ? e.message : 'Invalid expression';
}

/** Syntax check for the entry field — evaluation errors are allowed onto the tape. */
export function syntaxError(input: string): string | null {
	const { name, expr } = splitLine(input);
	if (name !== undefined && isReservedName(name)) return `"${name}" is a reserved name`;
	if (!expr) return name !== undefined ? `Nothing after "${name} ="` : 'Empty expression';
	try {
		parse(expr);
		return null;
	} catch (e) {
		return message(e);
	}
}

// ── Evaluation ─────────────────────────────────────────────────────────────

export interface SheetResult {
	value?: number;
	error?: string;
}

export interface TapeOptions {
	/** The sub-calculation result for a line, or undefined when it has none. */
	sub?: (lineId: string) => SheetResult | undefined;
}

export function evaluateTape(lines: TapeLine[], angle: AngleMode, opts: TapeOptions = {}): LineInfo[] {
	const n = lines.length;

	const parsed = lines.map((line) => {
		const split = splitLine(line.input);
		const err = syntaxError(line.input);
		return { ...split, ast: err ? undefined : parse(split.expr), err: err ?? undefined };
	});

	const idIndex = new Map(lines.map((l, i) => [l.id, i]));

	// First definition of a name wins; later ones are flagged rather than silently shadowing
	const nameIndex = new Map<string, number>();
	parsed.forEach((p, i) => {
		if (p.name === undefined || p.err) return;
		const key = p.name.toLowerCase();
		const prev = nameIndex.get(key);
		if (prev !== undefined) p.err = `"${p.name}" is already defined on line ${prev + 1}`;
		else nameIndex.set(key, i);
	});

	const tagIndex = new Map<string, number[]>();
	parsed.forEach((p, i) => p.tags.forEach((t) => {
		const list = tagIndex.get(t);
		if (list) list.push(i);
		else tagIndex.set(t, [i]);
	}));

	function refIndex(target: RefTarget): number {
		if (target.id !== undefined) {
			const i = idIndex.get(target.id);
			if (i === undefined) throw new CalcError('Referenced line was deleted');
			return i;
		}
		const i = (target.n ?? 0) - 1;
		if (i < 0 || i >= n) throw new CalcError(`There is no line ${target.n}`);
		return i;
	}

	/** A line's tag set never includes the line itself — `sum(#food) #food` is fine. */
	const tagMembers = (tag: string, self: number) => (tagIndex.get(tag) ?? []).filter((j) => j !== self);

	// Static dependencies: everything an expression *could* read. Over-approximating is
	// safe — it can only report a cycle that a different branch would have hit anyway.
	const deps = parsed.map((p, i) => {
		const out = new Set<number>();
		if (!p.ast) return out;
		walk(p.ast, (node: Node) => {
			if (node.k === 'name') {
				if (node.v === 'ans') { if (i > 0) out.add(i - 1); }
				else {
					const j = nameIndex.get(node.v);
					if (j !== undefined) out.add(j);
				}
			} else if (node.k === 'ref') {
				try { out.add(refIndex(node.target)); } catch { /* reported on evaluation */ }
			} else if (node.k === 'tag') {
				tagMembers(node.v, i).forEach((j) => out.add(j));
			}
		});
		return out;
	});

	const inCycle = findCycles(deps);
	const results: (LineInfo | undefined)[] = new Array(n);

	function valueOf(j: number, label: string): number {
		const r = resolve(j);
		if (r.value === undefined) throw new CalcError(`${label} has an error`);
		return r.value;
	}

	function resolve(i: number): LineInfo {
		const cached = results[i];
		if (cached) return cached;

		const p = parsed[i];
		const info: LineInfo = { label: p.label, name: p.name, expr: p.expr, tags: p.tags };

		if (p.err) info.error = p.err;
		else if (inCycle[i]) info.error = 'Circular reference';
		else {
			try {
				info.value = evaluateNode(p.ast!, {
					angle,
					ans: () => (i === 0 ? 0 : valueOf(i - 1, `Line ${i}`)),
					ref: (target) => {
						const j = refIndex(target);
						return valueOf(j, `Line ${j + 1}`);
					},
					name: (v) => {
						const j = nameIndex.get(v);
						return j === undefined ? undefined : valueOf(j, `"${parsed[j].name}"`);
					},
					tag: (v) => {
						const members = tagMembers(v, i);
						if (members.length === 0) throw new CalcError(`No lines tagged #${v}`);
						return members.map((j) => valueOf(j, `Line ${j + 1} (#${v})`));
					},
					sub: () => {
						const r = opts.sub?.(lines[i].id);
						if (!r) throw new CalcError('This line has no sub-calculation');
						if (r.value === undefined) throw new CalcError(r.error ?? 'Sub-calculation has an error');
						return r.value;
					},
				});
			} catch (e) {
				info.error = message(e);
			}
		}

		results[i] = info;
		return info;
	}

	return lines.map((_, i) => resolve(i));
}

/**
 * Whether an expression can move into a sub-calculation and mean the same thing there —
 * a sub-sheet can't see its parent's lines, names or tags.
 */
export function isSelfContained(expr: string): boolean {
	try {
		let ok = true;
		walk(parse(expr), (node) => {
			if (node.k === 'ref' || node.k === 'tag') ok = false;
			// Constants are fine; ans, sub and user names all read the surrounding sheet
			if (node.k === 'name' && (!isReservedName(node.v) || node.v === 'ans' || node.v === 'sub')) ok = false;
		});
		return ok;
	} catch {
		return false;
	}
}

/** Whether a line reads its own sub-calculation, so one should exist for it. */
export function usesSub(input: string): boolean {
	try {
		let found = false;
		walk(parse(splitLine(input).expr), (node) => {
			if (node.k === 'name' && node.v === 'sub') found = true;
		});
		return found;
	} catch {
		return false;
	}
}

// ── Sheets ─────────────────────────────────────────────────────────────────

export interface SheetRef {
	id: string;
	/** Set on a sub-calculation: the line whose `sub` this sheet feeds. */
	parentLineId?: string;
}

export interface SheetLine extends TapeLine {
	sheetId: string;
	order: number;
}

/** A sub-calculation's answer is its last line, like reading the bottom of a tape. */
export function sheetResult(infos: LineInfo[]): SheetResult {
	const last = infos[infos.length - 1];
	if (!last) return { error: 'Sub-calculation is empty' };
	return last.value !== undefined ? { value: last.value } : { error: 'Sub-calculation has an error' };
}

/**
 * Evaluate every sheet, children before the lines that read them. Sheets are isolated
 * from each other — the only channel between them is a parent line's `sub` — so a
 * sheet's references and names never leak into its parent or siblings.
 */
export function evaluateSheets(sheets: SheetRef[], lines: SheetLine[], angle: AngleMode): Map<string, LineInfo[]> {
	const bySheet = new Map<string, SheetLine[]>();
	for (const line of lines) {
		const list = bySheet.get(line.sheetId);
		if (list) list.push(line);
		else bySheet.set(line.sheetId, [line]);
	}
	for (const list of bySheet.values()) list.sort((a, b) => a.order - b.order);

	const subOf = new Map(sheets.flatMap((s) => (s.parentLineId ? [[s.parentLineId, s.id] as const] : [])));
	const out = new Map<string, LineInfo[]>();
	// Only reachable through corrupt data (a sheet nested inside itself), but never loop
	const visiting = new Set<string>();

	function evalSheet(id: string): LineInfo[] {
		const cached = out.get(id);
		if (cached) return cached;
		if (visiting.has(id)) return [];
		visiting.add(id);
		const infos = evaluateTape(bySheet.get(id) ?? [], angle, {
			sub: (lineId) => {
				const child = subOf.get(lineId);
				return child === undefined ? undefined : sheetResult(evalSheet(child));
			},
		});
		visiting.delete(id);
		out.set(id, infos);
		return infos;
	}

	for (const s of sheets) evalSheet(s.id);
	for (const id of bySheet.keys()) evalSheet(id);
	return out;
}

/** Tarjan's SCC: a line is circular if it sits in a component of 2+ lines or reads itself. */
function findCycles(deps: Set<number>[]): boolean[] {
	const n = deps.length;
	const index = new Array<number>(n).fill(-1);
	const low = new Array<number>(n).fill(0);
	const onStack = new Array<boolean>(n).fill(false);
	const stack: number[] = [];
	const cyclic = new Array<boolean>(n).fill(false);
	let counter = 0;

	function strongConnect(v: number) {
		index[v] = low[v] = counter++;
		stack.push(v);
		onStack[v] = true;
		for (const w of deps[v]) {
			if (index[w] === -1) {
				strongConnect(w);
				low[v] = Math.min(low[v], low[w]);
			} else if (onStack[w]) {
				low[v] = Math.min(low[v], index[w]);
			}
		}
		if (low[v] !== index[v]) return;
		const component: number[] = [];
		let w: number;
		do {
			w = stack.pop()!;
			onStack[w] = false;
			component.push(w);
		} while (w !== v);
		if (component.length > 1 || deps[v].has(v)) component.forEach((c) => (cyclic[c] = true));
	}

	for (let v = 0; v < n; v++) if (index[v] === -1) strongConnect(v);
	return cyclic;
}

// ── References: stored by id, shown by position ─────────────────────────────

/** `@3` → `@{id}`, so inserting or deleting lines never repoints a reference. */
export function toStored(text: string, lines: TapeLine[]): string {
	return text.replace(/@(\d+)/g, (raw, num: string) => {
		const line = lines[parseInt(num, 10) - 1];
		return line ? `@{${line.id}}` : raw;
	});
}

/** `@{id}` → `@3` at the line's current position, or `@?` once it's been deleted. */
export function toDisplay(text: string, idIndex: Map<string, number>): string {
	return text.replace(/@\{([0-9a-z-]+)\}/gi, (_, id: string) => {
		const i = idIndex.get(id);
		return i === undefined ? '@?' : `@${i + 1}`;
	});
}

export function indexById(lines: TapeLine[]): Map<string, number> {
	return new Map(lines.map((l, i) => [l.id, i]));
}

// ── Tags ───────────────────────────────────────────────────────────────────

export interface TagSummary {
	tag: string;
	total: number;
	count: number;
	errors: number;
}

function readsTag(expr: string, tag: string): boolean {
	try {
		let found = false;
		walk(parse(expr), (node) => {
			if (node.k === 'tag' && node.v === tag) found = true;
		});
		return found;
	} catch {
		return false;
	}
}

/** Per-tag totals in order of first appearance on the tape. */
export function summarizeTags(infos: LineInfo[]): TagSummary[] {
	const byTag = new Map<string, TagSummary>();
	for (const info of infos) {
		for (const tag of info.tags) {
			let s = byTag.get(tag);
			if (!s) byTag.set(tag, (s = { tag, total: 0, count: 0, errors: 0 }));
			s.count++;
			if (info.value === undefined) s.errors++;
			// `sum(#a) #a` totals the other #a lines, so counting it too would double them
			else if (!readsTag(info.expr, tag)) s.total += info.value;
		}
	}
	for (const s of byTag.values()) s.total = clean(s.total);
	return [...byTag.values()];
}

// ── Highlighting ───────────────────────────────────────────────────────────

export type Segment = { text: string; kind: 'text' | 'ref' | 'tag' | 'var' | 'bad' };

/** Split a display-form expression so references, tags and known names can be coloured. */
export function highlight(expr: string, names: Set<string>): Segment[] {
	const out: Segment[] = [];
	const re = /@\d+|@\?|#[a-z0-9_][a-z0-9_-]*|[a-z_][a-z0-9_]*/gi;
	let last = 0;
	for (const m of expr.matchAll(re)) {
		const tok = m[0];
		const kind: Segment['kind'] =
			tok === '@?' ? 'bad'
			: tok[0] === '@' ? 'ref'
			: tok[0] === '#' ? 'tag'
			: names.has(tok.toLowerCase()) ? 'var'
			: 'text';
		if (kind === 'text') continue;
		if (m.index > last) out.push({ text: expr.slice(last, m.index), kind: 'text' });
		out.push({ text: tok, kind });
		last = m.index + tok.length;
	}
	if (last < expr.length) out.push({ text: expr.slice(last), kind: 'text' });
	return out;
}
