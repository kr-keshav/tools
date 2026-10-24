import { describe, expect, it } from 'vitest';
import { closeParens, evaluate, formatNumber, splitTrailingTags, withChaining } from './engine';

const ev = (input: string) => evaluate(input, { ans: 10, angle: 'deg' });

describe('evaluate', () => {
	it.each([
		['0.1+0.2', 0.3],
		['1.1*3', 3.3],
		['2+3*4', 14],
		['(2+3)*4', 20],
		['-2^2', -4],
		['2^3^2', 512],
		['2^-1', 0.5],
		['2**10', 1024],
		['12×3÷4−1', 8],
		['1e3+1', 1001],
	])('arithmetic: %s = %d', (input, want) => expect(ev(input)).toBeCloseTo(want, 10));

	it.each([
		['200+10%', 220],
		['200-10%', 180],
		['50*10%', 5],
	])('percent: %s = %d', (input, want) => expect(ev(input)).toBeCloseTo(want, 10));

	it.each([
		['2pi', 2 * Math.PI],
		['3(4)', 12],
		['2e', 2 * Math.E],
	])('implicit multiplication: %s', (input, want) => expect(ev(input)).toBeCloseTo(want, 10));

	it.each([
		['sin(30)', 0.5],
		['sin 90', 1],
		['sin(180)', 0],
		['cos(90)', 0],
		['asin(1)', 90],
		['√9', 3],
		['5!', 120],
		['3!!', 720],
		['log(1000)', 3],
		['log(8,2)', 3],
		['ln(e)', 1],
		['round(3.14159,2)', 3.14],
		['max(1,5,3)', 5],
		['sum(1,2,3)', 6],
		['avg(2,4)', 3],
		['count(7,8,9)', 3],
		['ans*2', 20],
	])('functions: %s', (input, want) => expect(ev(input)).toBeCloseTo(want, 10));

	it('radians mode', () => {
		expect(evaluate('sin(pi/2)', { angle: 'rad' })).toBeCloseTo(1, 10);
	});

	it.each([
		['1/0', 'Division by zero'],
		['tan(90)', 'tan is undefined here'],
		['(1+2', 'Missing ")"'],
		['1+2)', 'Unmatched ")"'],
		['foo', 'Unknown name "foo"'],
		['2+', 'Incomplete expression'],
		['sqrt(-1)', 'Square root of a negative number'],
		['(-1)^0.5', 'Not a number'],
		['', 'Empty expression'],
		['2.5!', 'Factorial needs a whole number ≥ 0'],
	])('error: %s', (input, msg) => expect(() => ev(input)).toThrow(msg));
});

describe('input helpers', () => {
	it('chains a leading operator onto ans, but not a minus', () => {
		expect(withChaining('+ 5')).toBe('ans + 5');
		expect(withChaining('×2')).toBe('ans ×2');
		expect(withChaining('-5')).toBe('-5');
	});

	it('closes open parens before label tags', () => {
		expect(closeParens('sin(30')).toBe('sin(30)');
		expect(closeParens('sin(30 #trig')).toBe('sin(30) #trig');
		expect(closeParens('max(3, #food')).toBe('max(3, #food)');
		expect(closeParens('1+2')).toBe('1+2');
	});

	it('splits label tags off only when an operand precedes them', () => {
		expect(splitTrailingTags('450 + 380 #Food #swiggy')).toEqual({ expr: '450 + 380', tags: ['food', 'swiggy'] });
		expect(splitTrailingTags('100 + #food')).toEqual({ expr: '100 + #food', tags: [] });
		expect(splitTrailingTags('#food')).toEqual({ expr: '#food', tags: [] });
		expect(splitTrailingTags('sum(#food) #total')).toEqual({ expr: 'sum(#food)', tags: ['total'] });
		expect(splitTrailingTags('x = 5 #home')).toEqual({ expr: 'x = 5', tags: ['home'] });
	});

	it('formats numbers', () => {
		expect(formatNumber(1234567.891)).toBe('1,234,567.891');
		expect(formatNumber(1e20)).toBe('1e+20');
		expect(formatNumber(1.5e-12)).toBe('1.5e-12');
		expect(formatNumber(-0.3)).toBe('-0.3');
	});
});
