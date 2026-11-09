import { describe, expect, it } from 'vitest';
import { createModel, describe as describeEl, parse, select, sources } from '../src';
import { exportText } from '../src';

describe('parse', () => {
  it('parses css, html and svg', () => {
    expect(parse('a{b:c}', 'css').rules).toHaveLength(1);
    expect(parse('<p>x</p>', 'html').elements.length).toBeGreaterThan(1);
    expect(parse('<svg><rect/></svg>', 'svg').elements.map((e) => e.tag)).toEqual(['svg', 'rect']);
  });
  it('round-trips with zero patches byte-for-byte', () => {
    const src = '<P class=a>x\t&amp;\n<!-- c -->\n<SCRIPT>if (a<b) {}</SCRIPT>';
    expect(exportText(src, [])).toBe(src);
  });
});

describe('createModel', () => {
  const html =
    '<!doctype html><html><head><link rel="stylesheet" href="a.css"><style>p{color:red}</style><link rel=stylesheet href=missing.css></head><body><p id=x>t</p></body></html>';
  const m = createModel(html, 'html', { 'a.css': 'h1{margin:0} h2{margin:1px}' });
  it('orders sheets in document order and numbers rules across them', () => {
    expect(m.sheets.map((s) => s.file)).toEqual(['a.css', 'document.html']);
    expect(m.sheets.flatMap((s) => s.rules.map((r) => [r.selector, r.order]))).toEqual([
      ['h1', 0],
      ['h2', 1],
      ['p', 2],
    ]);
  });
  it('records stylesheets that were referenced but not supplied', () => {
    expect(m.missingStylesheets).toEqual(['missing.css']);
  });
  it('lists every file by key', () => {
    expect(Object.keys(sources(m))).toEqual(['document.html', 'a.css']);
  });
});

describe('describe/select', () => {
  const m = createModel('<html><body><div><p>a</p><p id="t">b</p><span>c</span></div></body></html>', 'html');
  it('round-trips every element', () => {
    for (const el of m.primary.elements) {
      expect(select(m, describeEl(m, el.index))).toBe(el.index);
    }
  });
  it('counts same-tag siblings', () => {
    const p2 = m.primary.elements.find((e) => e.attrs.some((a) => a.value === 't'))!;
    expect(describeEl(m, p2.index)).toBe('/html[1]/body[1]/div[1]/p[2]');
  });
  it('returns -1 for paths that do not resolve', () => {
    expect(select(m, '/html[1]/body[1]/table[1]')).toBe(-1);
    expect(select(m, 'nonsense')).toBe(-1);
  });
});
