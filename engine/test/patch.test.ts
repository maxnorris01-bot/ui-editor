import { describe, expect, it } from 'vitest';
import { addAttribute, appendDecls, applyPatches, attrInsertPoint, escapeForAttr, exportFiles } from '../src/patch';
import { parseInline, parseRules } from '../src/css';
import { parseMarkup } from '../src/markup';

describe('applyPatches', () => {
  it('applies from the end to the start', () => {
    expect(applyPatches('0123456789', [
      { file: 'f', start: 2, end: 4, text: 'AB' },
      { file: 'f', start: 8, end: 8, text: '!' },
    ])).toBe('01AB4567!89');
  });
  it('lets a delete and an insert share a start offset', () => {
    expect(applyPatches('abcdef', [
      { file: 'f', start: 1, end: 3, text: '' },
      { file: 'f', start: 1, end: 1, text: 'XY' },
    ])).toBe('aXYdef');
  });
  it('rejects overlapping patches', () => {
    expect(() => applyPatches('abcdef', [
      { file: 'f', start: 1, end: 4, text: '' },
      { file: 'f', start: 3, end: 5, text: 'x' },
    ])).toThrow(/overlapping/);
  });
  it('exportFiles patches only the named file', () => {
    const out = exportFiles({ a: 'one', b: 'two' }, [{ file: 'b', start: 0, end: 3, text: 'six' }]);
    expect(out).toEqual({ a: 'one', b: 'six' });
  });
});

describe('appendDecls', () => {
  const run = (css: string, pairs: [string, string][]) => {
    const rule = parseRules('f', css).rules[0]!;
    const p = appendDecls('f', rule, pairs, 'rule')!;
    return applyPatches(css, [p]);
  };
  it('single-line rule without trailing semicolon', () => {
    expect(run('.a { x:1; y:2 }', [['z', '3']])).toBe('.a { x:1; y:2; z:3 }');
  });
  it('single-line rule with trailing semicolon', () => {
    expect(run('.a { x: 1; y: 2; }', [['z', '3']])).toBe('.a { x: 1; y: 2; z: 3; }');
  });
  it('multi-line rule keeps indentation and a new line', () => {
    expect(run('.a {\n  x: 1;\n  y: 2;\n}', [['z', '3']])).toBe('.a {\n  x: 1;\n  y: 2;\n  z: 3;\n}');
  });
  it('multi-line rule without trailing semicolon', () => {
    expect(run('.a {\n  x: 1;\n  y: 2\n}', [['z', '3']])).toBe('.a {\n  x: 1;\n  y: 2;\n  z: 3\n}');
  });
  it('empty rule', () => {
    expect(run('.a {}', [['z', '3']])).toBe('.a { z: 3;}');
  });
  it('inline style mimics compact and spaced styles', () => {
    const html = '<p style="a:1;b:2">';
    const vs = html.indexOf('a:1');
    const c = parseInline('f', html, vs, html.indexOf('"', vs));
    expect(applyPatches(html, [appendDecls('f', c, [['c', '3']], 'inline', '"')!])).toBe('<p style="a:1;b:2;c:3">');
    const html2 = '<p style="a: 1; b: 2;">';
    const vs2 = html2.indexOf('a:');
    const c2 = parseInline('f', html2, vs2, html2.indexOf('"', vs2));
    expect(applyPatches(html2, [appendDecls('f', c2, [['c', '3']], 'inline', '"')!])).toBe('<p style="a: 1; b: 2; c: 3;">');
  });
  it('returns null when there is nothing to add', () => {
    const rule = parseRules('f', '.a{x:1}').rules[0]!;
    expect(appendDecls('f', rule, [], 'rule')).toBeNull();
  });
});

describe('attributes', () => {
  it('inserts before > and before />', () => {
    const src = '<p class=a>x</p><rect x="1" />';
    const m = parseMarkup('f', src, 'html');
    const p = m.elements.find((e) => e.ltag === 'p')!;
    expect(applyPatches(src, [addAttribute('f', src, p, 'style', 'a: b')])).toBe('<p class=a style="a: b">x</p><rect x="1" />');
    const s2 = '<svg><rect x="1" /></svg>';
    const m2 = parseMarkup('f', s2, 'svg');
    const r = m2.elements.find((e) => e.ltag === 'rect')!;
    expect(attrInsertPoint(s2, r)).toBe(s2.indexOf(' />'));
    expect(applyPatches(s2, [addAttribute('f', s2, r, 'transform', 'translate(1 2)')])).toBe('<svg><rect x="1" transform="translate(1 2)" /></svg>');
  });
  it('mimics upper-case tags and converts quotes in values', () => {
    const src = '<P CLASS=lead>x';
    const p = parseMarkup('f', src, 'html').elements.find((e) => e.ltag === 'p')!;
    expect(applyPatches(src, [addAttribute('f', src, p, 'style', 'font-family: "A B"')])).toBe(`<P CLASS=lead STYLE="font-family: 'A B'">x`);
    expect(escapeForAttr(`"a" 'b'`, "'")).toBe(`"a" "b"`);
  });
});
