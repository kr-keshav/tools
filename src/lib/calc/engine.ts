// Expression engine for the calculator tape. Hand-written rather than eval() or mathjs so
// the grammar stays ours: line references (@3) and tag sets (#food) are first-class.
// Sheet-level concerns — names, tags as labels, recalculation order — live in tape.ts.
//
// Precedence, loosest first:
//   additive   a + b, a - b        (a + b% means a + a·b/100, like a desk calculator)
//   product    a * b, a / b, 2pi   (juxtaposition is implicit multiplication)
//   unary      -a                  (so -2^2 = -4)
//   power      a ^ b               (right-associative)
//   postfix    a!, a%
//   primary    number, name, @ref, #tag, f(args), (expr)

export type AngleMode = 'deg' | 'rad';

export class CalcError extends Error {
	constructor(message: string) {
		super(message);
		this.name = 'CalcError';
	}
}

type Token =
	| { t: 'num'; v: number }
	| { t: 'id'; v: string }
	| { t: 'ref'; id?: string; n?: number }
	| { t: 'tag'; v: string }
	| { t: 'op'; v: string };

/** A line reference: `@{id}` as stored, or `@3` as typed and not yet encoded. */
export type RefTarget = { id?: string; n?: number };

export type Node =
	| { k: 'num'; v: number }
	| { k: 'name'; v: string }
	| { k: 'ref'; target: RefTarget }
	| { k: 'tag'; v: string }
	| { k: 'neg'; a: Node }
	| { k: 'bin'; op: string; a: Node; b: Node }
	| { k: 'pct'; a: Node }
	| { k: 'fact'; a: Node }
	| { k: 'call'; name: string; args: Node[] };

/** How an expression reaches the rest of the tape. */
export interface EvalCtx {
	angle: AngleMode;
	ans(): number;
	ref(target: RefTarget): number;
	/** Undefined when nothing on the tape has that name. */
	name(v: string): number | undefined;
	tag(v: string): number[];
	/** Result of this line's own sub-calculation, read as `sub`. */
	sub(): number;
}

// ── Tokenizer ──────────────────────────────────────────────────────────────

const SYMBOLS: Record<string, string> = { '×': '*', '·': '*', '÷': '/', '−': '-', '√': 'sqrt', 'π': 'pi' };

export const TAG_RE = /#[a-z0-9_][a-z0-9_-]*/i;

// Text before the first colon, as long as it holds a letter or emoji in any script and no
// @, # or = — so a future range like `sum(@1:@5)` never looks like a label.
export const LABEL_RE = /^\s*([^:@#=]*[\p{L}\p{Extended_Pictographic}\p{Regional_Indicator}][^:@#=]*?)\s*:\s*(.*)$/iu;

function tokenize(src: string): Token[] {
	const out: Token[] = [];
	let i = 0;
	// One entry per open paren: true if it opened a function call, where a comma separates arguments
	const parens: boolean[] = [];
	while (i < src.length) {
		const ch = src[i];
		if (/\s/.test(ch)) { i++; continue; }
		const rest = src.slice(i);

		const sym = SYMBOLS[ch];
		if (sym) {
			out.push(/[a-z]/.test(sym) ? { t: 'id', v: sym } : { t: 'op', v: sym });
			i++;
			continue;
		}

		if (ch === '@') {
			const stored = /^@\{([0-9a-z-]+)\}/i.exec(rest);
			const typed = /^@(\d+)/.exec(rest);
			if (stored) { out.push({ t: 'ref', id: stored[1] }); i += stored[0].length; continue; }
			if (typed) { out.push({ t: 'ref', n: parseInt(typed[1], 10) }); i += typed[0].length; continue; }
			if (rest.startsWith('@?')) throw new CalcError('Referenced line was deleted');
			throw new CalcError('@ needs a line number, like @3');
		}

		if (ch === '#') {
			const tag = new RegExp('^' + TAG_RE.source, 'i').exec(rest);
			if (!tag) throw new CalcError('# needs a tag name, like #food');
			out.push({ t: 'tag', v: tag[0].slice(1).toLowerCase() });
			i += tag[0].length;
			continue;
		}

		// Exponent only when digits follow, so `2e` stays "2 times e"
		// `1,000` is a thousands separator, except inside f(...) where `max(1,000)` is two arguments
		const grouped = parens.includes(true) ? null : /^[1-9]\d{0,2}(?:,\d{3})+(?!\d)(?:\.\d*)?(?:e[+-]?\d+)?/i.exec(rest);
		const num = grouped ?? /^(\d+\.?\d*|\.\d+)(e[+-]?\d+)?/i.exec(rest);
		if (num) {
			// `1.2.3` and `1..2` would otherwise read as implicit multiplication
			if (src[i + num[0].length] === '.') throw new CalcError('Malformed number');
			out.push({ t: 'num', v: parseFloat(num[0].replace(/,/g, '')) });
			i += num[0].length;
			continue;
		}

		const id = /^[a-z_][a-z0-9_]*/i.exec(rest);
		if (id) {
			out.push({ t: 'id', v: id[0].toLowerCase() });
			i += id[0].length;
			continue;
		}

		if (src.startsWith('**', i)) { out.push({ t: 'op', v: '^' }); i += 2; continue; }
		if ('+-*/^%!(),'.includes(ch)) {
			if (ch === '(') {
				const prev = out[out.length - 1];
				parens.push(prev?.t === 'id' && prev.v in FUNCTIONS);
			} else if (ch === ')') {
				parens.pop();
			}
			out.push({ t: 'op', v: ch });
			i++;
			continue;
		}

		throw new CalcError(`Unexpected "${ch}"`);
	}
	return out;
}

// ── Parser ─────────────────────────────────────────────────────────────────

const FUNCTIONS: Record<string, { arity: [number, number] }> = {
	sin: { arity: [1, 1] }, cos: { arity: [1, 1] }, tan: { arity: [1, 1] },
	asin: { arity: [1, 1] }, acos: { arity: [1, 1] }, atan: { arity: [1, 1] },
	sqrt: { arity: [1, 1] }, cbrt: { arity: [1, 1] },
	ln: { arity: [1, 1] }, log: { arity: [1, 2] }, log2: { arity: [1, 1] }, exp: { arity: [1, 1] },
	abs: { arity: [1, 1] }, floor: { arity: [1, 1] }, ceil: { arity: [1, 1] },
	round: { arity: [1, 2] },
	// Aggregates: a #tag argument spreads into every value carrying that tag
	sum: { arity: [1, Infinity] }, avg: { arity: [1, Infinity] }, count: { arity: [1, Infinity] },
	min: { arity: [1, Infinity] }, max: { arity: [1, Infinity] },
};

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };

/** Names a variable can't take, because the grammar already means something by them. */
export function isReservedName(name: string): boolean {
	const n = name.toLowerCase();
	return n === 'ans' || n === 'sub' || n in CONSTANTS || n in FUNCTIONS;
}

class Parser {
	private pos = 0;
	private tokens: Token[];
	constructor(tokens: Token[]) { this.tokens = tokens; }

	parse(): Node {
		const node = this.additive();
		const left = this.peek();
		if (left) {
			throw new CalcError(left.t === 'op' && left.v === ')' ? 'Unmatched ")"' : 'Unexpected input');
		}
		return node;
	}

	private peek(): Token | undefined { return this.tokens[this.pos]; }

	private isOp(v: string): boolean {
		const tok = this.peek();
		return tok?.t === 'op' && tok.v === v;
	}

	private additive(): Node {
		let node = this.product();
		while (this.isOp('+') || this.isOp('-')) {
			const op = (this.tokens[this.pos++] as { v: string }).v;
			node = { k: 'bin', op, a: node, b: this.product() };
		}
		return node;
	}

	private product(): Node {
		let node = this.unary();
		for (;;) {
			if (this.isOp('*') || this.isOp('/')) {
				const op = (this.tokens[this.pos++] as { v: string }).v;
				node = { k: 'bin', op, a: node, b: this.unary() };
			} else if (this.startsOperand()) {
				// `2pi` and `3(4)` are fine, but `1 000` is a mistyped number, not 1 × 0
				if (this.peek()?.t === 'num' && this.tokens[this.pos - 1]?.t === 'num') {
					throw new CalcError('Missing operator between numbers');
				}
				node = { k: 'bin', op: '*', a: node, b: this.unary() };
			} else {
				return node;
			}
		}
	}

	private startsOperand(): boolean {
		const tok = this.peek();
		return !!tok && (tok.t !== 'op' || tok.v === '(');
	}

	private unary(): Node {
		if (this.isOp('-')) { this.pos++; return { k: 'neg', a: this.unary() }; }
		if (this.isOp('+')) { this.pos++; return this.unary(); }
		return this.power();
	}

	private power(): Node {
		const base = this.postfix();
		if (this.isOp('^')) {
			this.pos++;
			return { k: 'bin', op: '^', a: base, b: this.unary() };
		}
		return base;
	}

	private postfix(): Node {
		let node = this.primary();
		for (;;) {
			if (this.isOp('!')) { this.pos++; node = { k: 'fact', a: node }; }
			else if (this.isOp('%')) { this.pos++; node = { k: 'pct', a: node }; }
			else return node;
		}
	}

	private primary(): Node {
		const tok = this.tokens[this.pos++];
		if (!tok) throw new CalcError('Incomplete expression');

		if (tok.t === 'num') return { k: 'num', v: tok.v };
		if (tok.t === 'ref') return { k: 'ref', target: { id: tok.id, n: tok.n } };
		if (tok.t === 'tag') return { k: 'tag', v: tok.v };

		if (tok.t === 'id') {
			if (!(tok.v in FUNCTIONS)) return { k: 'name', v: tok.v };
			// `√9` and `sin 30` work without parentheses
			if (!this.isOp('(')) return { k: 'call', name: tok.v, args: [this.postfix()] };
			this.pos++;
			const args: Node[] = [];
			if (!this.isOp(')')) {
				args.push(this.additive());
				while (this.isOp(',')) { this.pos++; args.push(this.additive()); }
			}
			this.expect(')');
			const [lo, hi] = FUNCTIONS[tok.v].arity;
			if (args.length < lo || args.length > hi) {
				throw new CalcError(`${tok.v}() takes ${lo === hi ? lo : `${lo}–${hi === Infinity ? 'any' : hi}`} argument${hi === 1 ? '' : 's'}`);
			}
			return { k: 'call', name: tok.v, args };
		}

		if (tok.v === '(') {
			const inner = this.additive();
			this.expect(')');
			return inner;
		}

		throw new CalcError(`Unexpected "${tok.v}"`);
	}

	private expect(v: string) {
		if (!this.isOp(v)) throw new CalcError(v === ')' ? 'Missing ")"' : `Expected "${v}"`);
		this.pos++;
	}
}

/** Throws CalcError on a syntax problem; names and references are only checked on evaluation. */
export function parse(input: string): Node {
	const tokens = tokenize(input);
	if (tokens.length === 0) throw new CalcError('Empty expression');
	return new Parser(tokens).parse();
}

// ── Evaluator ──────────────────────────────────────────────────────────────

function factorial(n: number): number {
	if (!Number.isInteger(n) || n < 0) throw new CalcError('Factorial needs a whole number ≥ 0');
	if (n > 170) throw new CalcError('Result is too large');
	let r = 1;
	for (let i = 2; i <= n; i++) r *= i;
	return r;
}

function trig(name: string, x: number, angle: AngleMode): number {
	if (angle === 'deg') {
		// Exact answers at the multiples people actually type: sin(180) is 0, not 1.2e-16
		const m = ((x % 360) + 360) % 360;
		if (name === 'sin' && m % 180 === 0) return 0;
		if (name === 'cos' && m % 180 === 90) return 0;
		if (name === 'tan' && m % 180 === 0) return 0;
		if (name === 'tan' && m % 180 === 90) throw new CalcError('tan is undefined here');
		x = (x * Math.PI) / 180;
	}
	const r = name === 'sin' ? Math.sin(x) : name === 'cos' ? Math.cos(x) : Math.tan(x);
	// Same in radians: sin(π) is 0, not 1.2e-16. Tiny inputs have genuinely tiny answers.
	return Math.abs(x) >= 1 && Math.abs(r) < 1e-14 ? 0 : r;
}

function evalNode(node: Node, ctx: EvalCtx): number {
	switch (node.k) {
		case 'num':
			return node.v;

		case 'name': {
			if (node.v === 'ans') return ctx.ans();
			if (node.v === 'sub') return ctx.sub();
			if (node.v in CONSTANTS) return CONSTANTS[node.v];
			const v = ctx.name(node.v);
			if (v === undefined) throw new CalcError(`Unknown name "${node.v}"`);
			return v;
		}

		case 'ref':
			return ctx.ref(node.target);

		// A bare #tag is the total of its lines: `#food * 12`
		case 'tag':
			return ctx.tag(node.v).reduce((s, x) => s + x, 0);

		case 'neg':
			return -evalNode(node.a, ctx);

		case 'pct':
			return evalNode(node.a, ctx) / 100;

		case 'fact':
			return factorial(evalNode(node.a, ctx));

		case 'bin': {
			const a = evalNode(node.a, ctx);
			// 200 + 10% → 220: a trailing percent on + / − is a share of the left side
			if ((node.op === '+' || node.op === '-') && node.b.k === 'pct') {
				const share = (a * evalNode(node.b.a, ctx)) / 100;
				return node.op === '+' ? a + share : a - share;
			}
			const b = evalNode(node.b, ctx);
			switch (node.op) {
				case '+': return a + b;
				case '-': return a - b;
				case '*': return a * b;
				case '/':
					if (b === 0) throw new CalcError('Division by zero');
					return a / b;
				case '^': return Math.pow(a, b);
			}
			throw new CalcError(`Unknown operator "${node.op}"`);
		}

		case 'call': {
			const args = node.args.flatMap((n) => (n.k === 'tag' ? ctx.tag(n.v) : [evalNode(n, ctx)]));
			const [x] = args;
			const toAngle = (r: number) => (ctx.angle === 'deg' ? (r * 180) / Math.PI : r);
			switch (node.name) {
				case 'sin': case 'cos': case 'tan': return trig(node.name, x, ctx.angle);
				case 'asin': return toAngle(Math.asin(x));
				case 'acos': return toAngle(Math.acos(x));
				case 'atan': return toAngle(Math.atan(x));
				case 'sqrt':
					if (x < 0) throw new CalcError('Square root of a negative number');
					return Math.sqrt(x);
				case 'cbrt': return Math.cbrt(x);
				case 'ln':
					if (x <= 0) throw new CalcError('ln needs a positive number');
					return Math.log(x);
				case 'log':
					if (x <= 0) throw new CalcError('log needs a positive number');
					return args.length === 2 ? Math.log(x) / Math.log(args[1]) : Math.log10(x);
				case 'log2':
					if (x <= 0) throw new CalcError('log2 needs a positive number');
					return Math.log2(x);
				case 'exp': return Math.exp(x);
				case 'abs': return Math.abs(x);
				case 'floor': return Math.floor(x);
				case 'ceil': return Math.ceil(x);
				case 'round': {
					const f = 10 ** (args[1] ?? 0);
					return Math.round(x * f) / f;
				}
				case 'sum': return args.reduce((s, v) => s + v, 0);
				case 'count': return args.length;
				case 'avg':
					if (args.length === 0) throw new CalcError('avg() has no values');
					return args.reduce((s, v) => s + v, 0) / args.length;
				case 'min':
				case 'max':
					if (args.length === 0) throw new CalcError(`${node.name}() has no values`);
					return node.name === 'min' ? Math.min(...args) : Math.max(...args);
			}
			throw new CalcError(`Unknown function "${node.name}"`);
		}
	}
}

/** Trim binary float noise: 0.1 + 0.2 → 0.3, 1.1 * 3 → 3.3. Whole numbers are already exact. */
export function clean(x: number): number {
	return x === 0 || Number.isSafeInteger(x) ? x : Number(x.toPrecision(15));
}

export function evaluateNode(node: Node, ctx: EvalCtx): number {
	const value = evalNode(node, ctx);
	if (Number.isNaN(value)) throw new CalcError('Not a number');
	if (!Number.isFinite(value)) throw new CalcError('Result is too large');
	return clean(value);
}

/** Evaluate a standalone expression — no tape, so references and tags are errors. */
export function evaluate(input: string, scope: { ans?: number; angle: AngleMode }): number {
	return evaluateNode(parse(input), {
		angle: scope.angle,
		ans() {
			if (scope.ans === undefined) throw new CalcError('No previous result');
			return scope.ans;
		},
		ref() { throw new CalcError('References need a tape'); },
		name() { return undefined; },
		tag(v) { throw new CalcError(`No lines tagged #${v}`); },
		sub() { throw new CalcError('This line has no sub-calculation'); },
	});
}

/** Every node in the tree, for dependency collection. */
export function walk(node: Node, visit: (n: Node) => void) {
	visit(node);
	switch (node.k) {
		case 'neg': case 'pct': case 'fact': walk(node.a, visit); break;
		case 'bin': walk(node.a, visit); walk(node.b, visit); break;
		case 'call': node.args.forEach((a) => walk(a, visit)); break;
	}
}

// ── Input helpers ──────────────────────────────────────────────────────────

/**
 * Starting a line with an operator continues from the previous result, adding-machine
 * style: `+ 50` becomes `ans + 50`. A leading minus is left alone so `-5` stays a number.
 */
export function withChaining(input: string): string {
	const s = input.trim();
	const body = LABEL_RE.exec(s)?.[2] ?? s;
	return /^[+*/^×÷]/.test(body) ? `${s.slice(0, s.length - body.length)}ans ${body}` : s;
}

/**
 * Split `450 + 380 #food #swiggy` into the expression and its label tags. A trailing
 * `#tag` is a label only when an operand comes before it — in `100 + #food` it's a value.
 */
export function splitTrailingTags(text: string): { expr: string; tags: string[] } {
	let expr = text.trimEnd();
	const tags: string[] = [];
	for (;;) {
		// `5#food` tags the line too, rather than multiplying 5 by the #food total
		const m = new RegExp(`(?:\\s|(?<=[\\d)]))(${TAG_RE.source})$`, 'i').exec(expr);
		if (!m) break;
		const before = expr.slice(0, m.index).trimEnd();
		if (!/[\w)%!}.π]$/.test(before)) break;
		tags.unshift(m[1].slice(1).toLowerCase());
		expr = before;
	}
	return { expr, tags };
}

/** The keypad inserts `sin(` and `√(`; close whatever is still open rather than erroring. */
export function closeParens(input: string): string {
	// Close before any label tags, so `sin(30 #trig` becomes `sin(30) #trig`
	const { expr } = splitTrailingTags(input);
	let depth = 0;
	for (const ch of expr) {
		if (ch === '(') depth++;
		else if (ch === ')') depth = Math.max(0, depth - 1);
	}
	return depth ? expr + ')'.repeat(depth) + input.trimEnd().slice(expr.length) : input;
}

/** What gets evaluated and stored for a line typed into the entry field. */
export function prepareInput(raw: string): string {
	return closeParens(withChaining(raw));
}

// ── Display ────────────────────────────────────────────────────────────────

export function formatNumber(x: number): string {
	const abs = Math.abs(x);
	if (abs !== 0 && (abs >= 1e15 || abs < 1e-6)) {
		return x.toExponential().replace(/\.?0+e/, 'e');
	}
	return x.toLocaleString('en-US', { maximumFractionDigits: 10 });
}

/** Display form of an expression: typographic operators, same text otherwise. */
export function prettyExpr(input: string): string {
	return input
		.replace(/\*/g, '×')
		.replace(/\//g, '÷')
		.replace(/\bsqrt\b/g, '√')
		.replace(/\bpi\b/g, 'π');
}
