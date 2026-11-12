import { describe, expect, it } from 'vitest';
import { JSDOM } from 'jsdom';
import { applyDomOps, commit, createModel, domProbe, previewSource, retag, tagDocument } from '../src';
import type { Preview } from '../src';
import { env } from './helpers';

describe('previewSource', () => {
  it('inlines a supplied stylesheet in place of its <link> and keeps element indexes aligned', () => {
    const html = '<html><head><link rel="stylesheet" href="a.css"></head><body><p>x</p></body></html>';
    const m = createModel(html, 'html', { 'a.css': 'p{color:red}' });
    const text = previewSource(m);
    expect(text).toBe('<html><head><style>p{color:red}</style></head><body><p>x</p></body></html>');
    const doc = new JSDOM(text).window.document;
    expect(tagDocument(m, doc)).toHaveLength(m.primary.elements.length);
  });
  it('returns SVG source unchanged', () => {
    const m = createModel('<svg><rect/></svg>', 'svg');
    expect(previewSource(m)).toBe('<svg><rect/></svg>');
  });
});

describe('tagDocument', () => {
  it('pairs elements by pre-order index, implied elements included', () => {
    const e = env('<table><tr><td id="c">x</td></tr></table>');
    const names = e.elements.map((x) => x.localName);
    expect(names).toEqual(['html', 'head', 'body', 'table', 'tbody', 'tr', 'td']);
    expect(e.elements[e.at('#c')]!.id).toBe('c');
  });
  it('throws when the document and the source disagree', () => {
    const m = createModel('<p>a</p><p>b</p>', 'html');
    const doc = new JSDOM('<p>a</p>').window.document;
    expect(() => tagDocument(m, doc)).toThrow(/count differs/);
  });
  it('matches the preview for SVG documents', () => {
    const e = env('<svg xmlns="http://www.w3.org/2000/svg"><g><rect id="r"/></g></svg>', 'svg');
    expect(e.elements.map((x) => x.localName)).toEqual(['svg', 'g', 'rect']);
  });
});

describe('domProbe', () => {
  it('returns indexes for matching selectors and empty for invalid ones', () => {
    const e = env('<p class="a">1</p><p class="a">2</p>');
    expect(e.probe.matches('.a')).toHaveLength(2);
    expect(e.probe.matches('p:::')).toEqual([]);
    expect(e.probe.matches('.none')).toEqual([]);
  });
  it('reads computed style', () => {
    const e = env('<p id="a" style="color: red">1</p>');
    expect(e.probe.computed(e.at('#a'), 'color')).toMatch(/red|rgb\(255, 0, 0\)/);
  });
  it('has no screen matrix where the DOM implementation has none', () => {
    const e = env('<p id="a">1</p>');
    expect(e.probe.screenMatrix(e.at('#a'))).toBeNull();
  });
});

describe('applyDomOps', () => {
  const mk = (src: string): { e: ReturnType<typeof env>; preview: Preview } => {
    const e = env(src);
    const preview = { doc: e.doc, elements: e.elements, probe: e.probe, model: e.model, iframe: null as never, setWidth() {}, dispose() {} } as Preview;
    return { e, preview };
  };
  it('applies style and attribute operations', () => {
    const { e, preview } = mk('<p id="a">x</p>');
    applyDomOps(preview, [
      { type: 'style', index: e.at('#a'), props: [['color', 'blue']] },
      { type: 'attr', index: e.at('#a'), name: 'title', value: 't' },
    ]);
    expect(e.doc.querySelector('#a')!.getAttribute('style')).toContain('blue');
    expect(e.doc.querySelector('#a')!.getAttribute('title')).toBe('t');
  });
  it('replaces children for a reorder so the preview equals the exported text, then retags', () => {
    const src = '<html><body>\n<ul id="l">\n  <li id="a">A</li>\n  <li id="b">B</li>\n</ul>\n</body></html>';
    const { e, preview } = mk(src);
    const r = e.run({ op: 'reorder', target: e.at('#b'), placement: 'before', sibling: e.at('#a') });
    if (!r.ok) throw new Error('refused');
    applyDomOps(preview, r.dom);
    expect(Array.from(e.doc.querySelectorAll('li')).map((x) => x.id)).toEqual(['b', 'a']);
    const { model } = commit(e.model, r.patches);
    retag(preview, model);
    expect(preview.elements).toHaveLength(model.primary.elements.length);
    expect(domProbe(e.doc, preview.elements).matches('#a')).toHaveLength(1);
  });
  it('throws on an unknown element', () => {
    const { preview } = mk('<p>x</p>');
    expect(() => applyDomOps(preview, [{ type: 'attr', index: 999, name: 'a', value: 'b' }])).toThrow();
  });
});

describe('commit', () => {
  it('applies patches to every file and re-parses', () => {
    const html = '<html><head><link rel="stylesheet" href="s.css"></head><body><h1 id="t">x</h1></body></html>';
    const e = env(html, 'html', { 's.css': '#t { color: red; }' });
    const r = e.run({ op: 'set', target: e.at('#t'), properties: { color: 'blue' } });
    if (!r.ok) throw new Error('refused');
    const { files, model } = commit(e.model, r.patches);
    expect(files['s.css']).toBe('#t { color: blue; }');
    expect(files['document.html']).toBe(html);
    expect(model.companions['s.css']!.source).toBe('#t { color: blue; }');
  });
});
