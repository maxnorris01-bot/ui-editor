import { describe, expect, it } from 'vitest';
import { specificity as s } from '../src';

describe('specificity', () => {
  it('orders ids over classes over types', () => {
    expect(s('#a')).toBeGreaterThan(s('.a.b.c'));
    expect(s('.a')).toBeGreaterThan(s('div p span'));
    expect(s('div')).toBeGreaterThan(s('*'));
  });
  it('counts attributes and pseudo-classes like classes, pseudo-elements like types', () => {
    expect(s('a[href]')).toBe(s('a.x'));
    expect(s('a:hover')).toBe(s('a.x'));
    expect(s('p::before')).toBe(s('p span'));
  });
  it('ignores :where and counts :not arguments', () => {
    expect(s(':where(#a) p')).toBe(s('p'));
    expect(s('p:not(.x)')).toBe(s('p.x'));
  });
  it('ignores combinators and escaped or quoted text', () => {
    expect(s('ul > li + li ~ li')).toBe(s('ul li li li'));
    expect(s('a[title="#x .y"]')).toBe(s('a[title]'));
  });
});
