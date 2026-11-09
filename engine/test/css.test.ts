import { describe, expect, it } from 'vitest';
import { parseInline, parseRules } from '../src/css';

describe('parseRules', () => {
  const css = 'a { color:red; margin : 0 }\n/* c */ b{\n  x: 1 !important;\n}';
  it('reports exact value ranges and exclusive ends', () => {
    const { rules } = parseRules('f.css', css);
    expect(rules).toHaveLength(2);
    const a = rules[0]!;
    expect(css.slice(a.start, a.end)).toBe('a { color:red; margin : 0 }');
    const [color, margin] = a.decls;
    expect(css.slice(color!.valueStart, color!.valueEnd)).toBe('red');
    expect(color!.hasSemicolon).toBe(true);
    expect(css.slice(color!.start, color!.end)).toBe('color:red;');
    expect(css.slice(margin!.valueStart, margin!.valueEnd)).toBe('0');
    expect(margin!.hasSemicolon).toBe(false);
    expect(css[a.bodyEnd]).toBe('}');
  });
  it('keeps !important out of the value range', () => {
    const b = parseRules('f.css', css).rules[1]!;
    const x = b.decls[0]!;
    expect(x.important).toBe(true);
    expect(css.slice(x.valueStart, x.valueEnd)).toBe('1');
    expect(css.slice(x.valueEnd, x.contentEnd)).toBe(' !important');
  });
  it('flags conditional rules and skips keyframes and font-face', () => {
    const t = '@media (min-width:1px){ p { color: red } } @keyframes k { from { top:0 } } @font-face { font-family: X } q { top: 1px }';
    const { rules } = parseRules('f.css', t);
    expect(rules.map((r) => [r.selector, r.conditional])).toEqual([
      ['p', true],
      ['q', false],
    ]);
  });
  it('handles a base offset and limit (style element content)', () => {
    const doc = '<style>p{color:red}</style>';
    const { rules } = parseRules('d.html', doc, 7, 0, doc.indexOf('</style>'));
    const d = rules[0]!.decls[0]!;
    expect(doc.slice(d.valueStart, d.valueEnd)).toBe('red');
  });
  it('numbers rules across sheets from startOrder', () => {
    expect(parseRules('f', 'a{b:c} d{e:f}', 0, 5).rules.map((r) => r.order)).toEqual([5, 6]);
  });
});

describe('parseInline', () => {
  it('finds declarations inside an attribute value', () => {
    const html = '<p style="margin:0 0 6px 0;font-size:32px;color:#222">x</p>';
    const vs = html.indexOf('margin');
    const ve = html.indexOf('"', vs);
    const { decls } = parseInline('d.html', html, vs, ve);
    expect(decls.map((d) => d.prop)).toEqual(['margin', 'font-size', 'color']);
    const fs = decls[1]!;
    expect(html.slice(fs.valueStart, fs.valueEnd)).toBe('32px');
    expect(decls[2]!.hasSemicolon).toBe(false);
  });
  it('copes with an empty style value', () => {
    const html = '<p style="">x</p>';
    const vs = html.indexOf('"') + 1;
    expect(parseInline('d.html', html, vs, vs).decls).toEqual([]);
  });
});
