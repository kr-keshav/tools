import { describe, expect, it } from 'vitest';
import {
	addTags,
	evaluateSheets,
	evaluateTape,
	highlight,
	indexById,
	joinLine,
	mapExpr,
	negateExpr,
	setLabel,
	splitLine,
	tagTone,
	typeOperators,
	summarizeTags,
	syntaxError,
	toDisplay,
	toStored,
	type TapeLine,
} from './tape';

const tape = (...inputs: string[]): TapeLine[] => inputs.map((input, i) => ({ id: `id${i}`, input }));
const run = (...inputs: string[]) => evaluateTape(tape(...inputs), 'deg');
const values = (...inputs: string[]) => run(...inputs).map((r) => r.value ?? r.error);

describe('splitLine', () => {
	it('separates name, expression and tags', () => {
		expect(splitLine('Rent = 25000 #home')).toEqual({ name: 'Rent', expr: '25000', tags: ['home'] });
		expect(splitLine('450 + 380')).toEqual({ expr: '450 + 380', tags: [] });
	});

	it('takes a free-text label before a colon', () => {
		expect(splitLine('Swiggy dinner: 450 + 380 #food')).toEqual({
			label: 'Swiggy dinner', expr: '450 + 380', tags: ['food'],
		});
		expect(splitLine('Rent: rent = 25000')).toEqual({ label: 'Rent', name: 'rent', expr: '25000', tags: [] });
		expect(splitLine('Q3 2026 (est): 100').label).toBe('Q3 2026 (est)');
		expect(splitLine('sum(@1:@5)').label).toBeUndefined();
		expect(splitLine('@1:@5').label).toBeUndefined();
	});
});

describe('line parts', () => {
	it('accepts labels in any script, and emoji, but not bare numbers', () => {
		expect(splitLine('दूध: 40')).toEqual({ label: 'दूध', expr: '40', tags: [] });
		expect(splitLine('🍕: 40').label).toBe('🍕');
		expect(splitLine('🇮🇳: 40').label).toBe('🇮🇳');
		expect(setLabel('40', 'दूध')).toBe('दूध: 40');
		expect(setLabel('40', '🍕')).toBe('🍕: 40');
		expect(setLabel('40', '2026')).toBe('40');
	});

	it('joinLine rebuilds what splitLine took apart', () => {
		for (const input of ['Rent: rent = 25000 #home', '450+380 #food', 'x = 5', 'Tea: 40']) {
			expect(joinLine(splitLine(input))).toBe(input);
		}
	});

	it('mapExpr touches only the expression', () => {
		expect(mapExpr('Base: x = 5 #a #b', negateExpr)).toBe('Base: x = -(5) #a #b');
		expect(mapExpr('450+380 #food', (e) => `1÷(${e})`)).toBe('1÷(450+380) #food');
		expect(mapExpr('Rent: ', negateExpr)).toBe('Rent: ');
	});

	it('negateExpr toggles, and leaves separate groups alone', () => {
		expect(negateExpr('-(5+1)')).toBe('5+1');
		expect(negateExpr('-(1)+(2)')).toBe('-(-(1)+(2))');
	});

	it('typeOperators converts the expression but not the label', () => {
		expect(typeOperators('5*2/3')).toBe('5×2÷3');
		expect(typeOperators('2**3')).toBe('2^3');
		expect(typeOperators('Swiggy/Zomato: 5*2')).toBe('Swiggy/Zomato: 5×2');
	});
});

describe('tagTone', () => {
	it('gives a tag the same colour slot every time', () => {
		expect(tagTone('food')).toBe(tagTone('food'));
		for (const tag of ['home', 'bills', 'food', 'tax', 'car']) {
			expect(tagTone(tag)).toBeGreaterThanOrEqual(0);
			expect(tagTone(tag)).toBeLessThan(5);
		}
	});
});

describe('addTags', () => {
	it('appends tags in any of the accepted spellings', () => {
		expect(addTags('450 + 380', 'food')).toBe('450 + 380 #food');
		expect(addTags('450', '#Food, bills')).toBe('450 #food #bills');
		expect(splitLine(addTags('Swiggy: x = 5 #a', 'b')).tags).toEqual(['a', 'b']);
	});

	it('skips repeated and invalid tags', () => {
		expect(addTags('450 #food', 'FOOD')).toBe('450 #food');
		expect(addTags('450', 'a.b')).toBe('450');
		expect(addTags('450', '   ')).toBe('450');
	});
});

describe('setLabel', () => {
	it('adds, replaces and removes the label prefix', () => {
		expect(setLabel('450 + 380 #food', 'Swiggy')).toBe('Swiggy: 450 + 380 #food');
		expect(setLabel('Swiggy: 450 #food', 'Zomato (Fri)')).toBe('Zomato (Fri): 450 #food');
		expect(setLabel('Swiggy: rent = 5', '')).toBe('rent = 5');
		expect(setLabel('5', 'a#b: c')).toBe('a b c: 5');
		expect(setLabel('5', '2026')).toBe('5');
	});

	it('round-trips through splitLine', () => {
		const input = setLabel('x = 2 × 3 #t', 'Dinner (Fri)');
		expect(splitLine(input)).toEqual({ label: 'Dinner (Fri)', name: 'x', expr: '2 × 3', tags: ['t'] });
	});
});

describe('syntaxError', () => {
	it('rejects reserved names and empty assignments', () => {
		expect(syntaxError('pi = 3')).toBe('"pi" is a reserved name');
		expect(syntaxError('sum = 3')).toBe('"sum" is a reserved name');
		expect(syntaxError('x =')).toBe('Nothing after "x ="');
		expect(syntaxError('2 +')).toBe('Incomplete expression');
		expect(syntaxError('unknown * 2')).toBeNull();
	});
});

describe('evaluateTape', () => {
	it('evaluates labelled lines like any other', () => {
		const r = run('Swiggy: 450 #food', 'Zomato order: 380 #food', 'Food total: sum(#food)');
		expect(r.map((x) => x.value)).toEqual([450, 380, 830]);
		expect(r[1].label).toBe('Zomato order');
	});

	it('chains ans through the previous line', () => {
		expect(values('10', 'ans + 5', 'ans * 2')).toEqual([10, 15, 30]);
	});

	it('resolves line references by number', () => {
		expect(values('100', '200', '@1 + @2')).toEqual([100, 200, 300]);
		expect(values('@5')).toEqual(['There is no line 5']);
	});

	it('resolves stored id references', () => {
		const lines = tape('7', '@{id0} * 3');
		expect(evaluateTape(lines, 'deg').map((r) => r.value)).toEqual([7, 21]);
	});

	it('reports a reference to a deleted line', () => {
		expect(values('@{gone} + 1')).toEqual(['Referenced line was deleted']);
	});

	it('uses names defined anywhere on the tape, case-insensitively', () => {
		expect(values('total = rent + food', 'Rent = 25000', 'food = 6000')).toEqual([31000, 25000, 6000]);
		expect(run('rent = 5')[0].name).toBe('rent');
	});

	it('flags a duplicate name instead of shadowing', () => {
		expect(values('x = 1', 'x = 2', 'x')).toEqual([1, '"x" is already defined on line 1', 1]);
	});

	it('aggregates tag sets', () => {
		const r = values(
			'450 #food',
			'380 #food',
			'25000 #home',
			'sum(#food)',
			'avg(#food)',
			'count(#food)',
			'#food * 12',
			'max(#food, 1000)',
		);
		expect(r).toEqual([450, 380, 25000, 830, 415, 2, 9960, 1000]);
	});

	it('excludes a line from its own tag set', () => {
		expect(values('100 #food', '200 #food', 'sum(#food) #food')).toEqual([100, 200, 300]);
	});

	it('errors on an unknown tag', () => {
		expect(values('sum(#nope)')).toEqual(['No lines tagged #nope']);
	});

	it('detects cycles without hanging, and blames dependants separately', () => {
		expect(values('@2 + 1', '@1 + 1', '@1 * 2')).toEqual([
			'Circular reference',
			'Circular reference',
			'Line 1 has an error',
		]);
		expect(values('a = b', 'b = a')).toEqual(['Circular reference', 'Circular reference']);
		expect(values('x = x + 1')).toEqual(['Circular reference']);
	});

	it('propagates an error to lines that depend on it', () => {
		expect(values('1/0', 'ans + 1', 'y = 1/0', 'y * 2', '5 #t', '1/0 #t', 'sum(#t)')).toEqual([
			'Division by zero',
			'Line 1 has an error',
			'Division by zero',
			'"y" has an error',
			5,
			'Division by zero',
			'Line 6 (#t) has an error',
		]);
	});

	it('keeps evaluating a long ans chain', () => {
		const long = Array.from({ length: 3000 }, (_, i) => (i === 0 ? '1' : 'ans + 1'));
		const r = run(...long);
		expect(r[r.length - 1].value).toBe(3000);
	});
});

describe('reference encoding', () => {
	const lines = tape('1', '2', '3');

	it('round-trips @n through stored ids', () => {
		const stored = toStored('@1 + @3 * @9', lines);
		expect(stored).toBe('@{id0} + @{id2} * @9');
		expect(toDisplay(stored, indexById(lines))).toBe('@1 + @3 * @9');
	});

	it('follows a line when lines above it are deleted', () => {
		const stored = toStored('@3', lines);
		expect(toDisplay(stored, indexById(lines.slice(1)))).toBe('@2');
		expect(toDisplay(stored, indexById(lines.slice(0, 2)))).toBe('@?');
	});
});

describe('summarizeTags', () => {
	it('totals by tag in order of first appearance', () => {
		expect(summarizeTags(run('0.1 #a', '0.2 #a #b', '1/0 #b'))).toEqual([
			{ tag: 'a', total: 0.3, count: 2, errors: 0 },
			{ tag: 'b', total: 0.2, count: 2, errors: 1 },
		]);
	});
});

describe('summarizeTags self-reference', () => {
	it('does not count a line that totals its own tag', () => {
		const [a] = summarizeTags(run('100 #a', '200 #a', 'sum(#a) #a'));
		expect(a.total).toBe(300);
		expect(a.count).toBe(3);
	});
});

describe('highlight', () => {
	it('marks references, tags and known names', () => {
		expect(highlight('rent + @2 * sum(#food) + @?', new Set(['rent']))).toEqual([
			{ text: 'rent', kind: 'var' },
			{ text: ' + ', kind: 'text' },
			{ text: '@2', kind: 'ref' },
			{ text: ' * sum(', kind: 'text' },
			{ text: '#food', kind: 'tag' },
			{ text: ') + ', kind: 'text' },
			{ text: '@?', kind: 'bad' },
		]);
	});
});

describe('evaluateSheets', () => {
	const line = (id: string, sheetId: string, order: number, input: string) => ({ id, sheetId, order, input });

	it('feeds a sub-calculation result into its parent line', () => {
		const sheets = [{ id: 'main' }, { id: 'gst', parentLineId: 'l2' }];
		const lines = [
			line('l1', 'main', 0, '1000'),
			line('l2', 'main', 1, 'GST: sub #tax'),
			line('l3', 'main', 2, '@1 + @2'),
			line('g2', 'gst', 1, 'ans * 18%'),
			line('g1', 'gst', 0, 'base = 27000'),
		];
		const r = evaluateSheets(sheets, lines, 'deg');
		expect(r.get('gst')!.map((x) => x.value)).toEqual([27000, 4860]);
		expect(r.get('main')!.map((x) => x.value)).toEqual([1000, 4860, 5860]);
	});

	it('keeps sheets isolated', () => {
		const sheets = [{ id: 'a' }, { id: 'b', parentLineId: 'a1' }];
		const lines = [line('a0', 'a', 0, 'rent = 5'), line('a1', 'a', 1, 'sub'), line('b0', 'b', 0, 'rent * 2')];
		const r = evaluateSheets(sheets, lines, 'deg');
		expect(r.get('b')![0].error).toBe('Unknown name "rent"');
		expect(r.get('a')![1].error).toBe('Sub-calculation has an error');
	});

	it('nests, and reports empty or missing sub-calculations', () => {
		const sheets = [{ id: 'm' }, { id: 's1', parentLineId: 'm0' }, { id: 's2', parentLineId: 'x0' }, { id: 'e', parentLineId: 'm1' }];
		const lines = [
			line('m0', 'm', 0, 'sub * 2'),
			line('m1', 'm', 1, 'sub'),
			line('m2', 'm', 2, 'sub'),
			line('x0', 's1', 0, 'sub + 1'),
			line('y0', 's2', 0, '41'),
		];
		const r = evaluateSheets(sheets, lines, 'deg').get('m')!;
		expect(r.map((x) => x.value ?? x.error)).toEqual([84, 'Sub-calculation is empty', 'This line has no sub-calculation']);
	});

	it('survives a sheet nested inside itself', () => {
		const sheets = [{ id: 's', parentLineId: 'l' }];
		const r = evaluateSheets(sheets, [line('l', 's', 0, 'sub')], 'deg');
		expect(r.get('s')![0].error).toBe('Sub-calculation is empty');
	});
});
