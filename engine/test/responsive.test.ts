import { describe, expect, it } from 'vitest';
import { applyDomOps, breakpointOf, chainEnv, chainMatches, commit, createModel, emptyState, envCondition, listUnlinked, scaleValue } from '../src';
import type { Edit, EditResult, EditState, Probe } from '../src';
import { applyEdit } from '../src';
import { env } from './helpers';
import { basisOfFlex } from '../src/responsive';

/** A probe whose computed values come from a table keyed by property and width (jsdom has no media queries). */
const table = (vals: Record<string, Record<number, string>>) => (p: Probe): Probe => ({
  ...p,
  computed: (i, prop, width) => vals[prop]?.[width ?? 1280] ?? p.computed(i, prop),
});
const okR = (r: EditResult) => {
  if (!r.ok) throw new Error(`refused: ${r.refusal.code}: ${r.refusal.message}`);
  return r;
};
const page = (css: string, body: string) => `<!doctype html>\n<html><head><style>\n${css}\n</style></head><body>${body}</body></html>`;

describe('media conditions', () => {
  it('evaluates max-width and min-width in px, em and rem, with media types and lists', () => {
    expect(chainMatches(['@media (max-width: 640px)'], 640)).toBe(true);
    expect(chainMatches(['@media (max-width: 640px)'], 641)).toBe(false);
    expect(chainMatches(['@media (min-width: 641px)'], 641)).toBe(true);
    expect(chainMatches(['@media only screen and (max-width: 40em)'], 640)).toBe(true);
    expect(chainMatches(['@media print, (max-width: 100px)'], 50)).toBe(true);
    expect(chainMatches(['@media (prefers-color-scheme: dark)'], 1280)).toBe(false);
    expect(chainMatches(['@media (min-width: 100px)', '@supports (display: grid)'], 200)).toBe(true);
    expect(chainMatches([], 1)).toBe(true);
  });
  it('finds the page breakpoint: largest max-width at or below 768, else 767', () => {
    const m = (css: string) => createModel(page(css, '<p>x</p>'), 'html');
    expect(breakpointOf(m('p{color:red}'))).toBe(767);
    expect(breakpointOf(m('@media (max-width: 640px){p{color:red}} @media (max-width: 700px){p{color:red}}'))).toBe(700);
    expect(breakpointOf(m('@media (max-width: 900px){p{color:red}}'))).toBe(767);
    expect(breakpointOf(m('@media (max-width: 768px){p{color:red}}'))).toBe(768);
  });
  it('classifies chains by environment and writes the pair of conditions', () => {
    expect(chainEnv(['@media (max-width: 640px)'], 640)).toBe('phone');
    expect(chainEnv(['@media (min-width: 1200px)'], 640)).toBe('desktop');
    expect(chainEnv(['@media (min-width: 500px)'], 640)).toBe('both');
    expect(envCondition('phone', 640)).toBe('@media (max-width: 640px)');
    expect(envCondition('desktop', 640)).toBe('@media (min-width: 641px)');
  });
});

describe('scaleValue', () => {
  it('multiplies the number and keeps the unit', () => {
    expect(scaleValue('16px', [1.2]).value).toBe('19.2px');
    expect(scaleValue('1.125rem', [1.25]).value).toBe('1.4063rem');
    expect(scaleValue('1.1em', [1.25]).value).toBe('1.375em');
  });
  it('multiplies every number in a shorthand, leaves auto and 0 alone', () => {
    expect(scaleValue('8px 12px', [1.5, 1.5, 1.5, 1.5]).value).toBe('12px 18px');
    expect(scaleValue('0 auto 8px', [2, 2, 2, 2])).toEqual({ value: '0 auto 16px', reasons: [] });
  });
  it('expands to four sides when the side ratios differ', () => {
    expect(scaleValue('10px 20px', [2, 1, 2, 1]).value).toBe('20px 20px 20px 20px');
    expect(scaleValue('10px', [2, 1, 2, 1]).value).toBe('20px 10px 20px 10px');
  });
  it('does not scale calc, clamp, var or keywords, and says why', () => {
    expect(scaleValue('clamp(18px, 5vw, 24px)', [2])).toEqual({ value: 'clamp(18px, 5vw, 24px)', reasons: ['clamp(18px, 5vw, 24px) is not a plain length'] });
    expect(scaleValue('var(--x)', [2]).reasons).toHaveLength(1);
    expect(scaleValue('larger', [2]).reasons[0]).toContain('keyword');
  });
});

const CSS = `h1 { font-size: 40px; }
@media (max-width: 640px) {
  h1 { font-size: 16px; }
}`;
const fs = table({ 'font-size': { 1280: '40px', 390: '16px' } });

describe('linked ratio edits', () => {
  it('scales the page\'s own phone value and leaves the page CSS untouched', () => {
    const src = page(CSS, '<h1 id="a">T</h1><h1 id="b">U</h1>');
    const e = env(src, 'html', {}, fs);
    const out = e.out(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '48px' } }));
    expect(out).toBe(src.replace('\n</style>', '\n#a { font-size: 48px; }\n@media (max-width: 640px) { #a { font-size: 19.2px; } }\n</style>'));
  });
  // RETIRED (docs/small-views-rules.md section 5): a Phone edit is now always custom and no longer scales Desktop; replaced by M09 and M10.
  it.skip('gives the same ratio whichever environment the edit was made in', () => {
    const src = page(CSS, '<h1 id="a">T</h1>');
    const e = env(src, 'html', {}, fs);
    const out = e.out(e.run({ op: 'set', target: e.at('#a'), environment: 'phone', properties: { 'font-size': '20px' } }));
    expect(out).toContain('#a { font-size: 50px; }');
    expect(out).toContain('@media (max-width: 640px) { #a { font-size: 20px; } }');
  });
  it('reports a value it cannot scale, keeps it, and says why', () => {
    const src = page('h1 { font-size: 40px; }\n@media (max-width: 640px) { h1 { font-size: clamp(18px, 5vw, 24px); } }', '<h1 id="a">T</h1>');
    const e = env(src, 'html', {}, fs);
    const r = okR(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '48px' } }));
    expect(r.notes).toEqual([{ property: 'font-size', condition: '@media (max-width: 640px)', value: 'clamp(18px, 5vw, 24px)', reason: 'clamp(18px, 5vw, 24px) is not a plain length' }]);
    expect(e.out(r)).toContain('@media (max-width: 640px) { #a { font-size: clamp(18px, 5vw, 24px); } }');
  });
  it('uses !important only when the page\'s own media rule does', () => {
    const src = page('h1 { font-size: 40px; }\n@media (max-width: 640px) { h1 { font-size: 16px !important; } }', '<h1 id="a">T</h1>');
    const e = env(src, 'html', {}, fs);
    const out = e.out(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '48px' } }));
    expect(out).toContain('#a { font-size: 48px; }');
    expect(out).toContain('{ #a { font-size: 19.2px !important; } }');
  });
  it('adds a data-ue hook (and enough specificity) for an element without an id', () => {
    const src = page('.m p { font-size: 40px; }\n@media (max-width: 640px) { .m p { font-size: 16px; } }', '<div class="m"><p>T</p></div>');
    const e = env(src, 'html', {}, fs);
    const out = e.out(e.run({ op: 'set', target: e.at('p'), properties: { 'font-size': '48px' } }));
    expect(out).toContain('<p data-ue="1">T</p>');
    expect(out).toContain('[data-ue="1"][data-ue="1"] { font-size: 48px; }');
  });
  it('refuses when a page rule has an id selector and the element has none', () => {
    const src = page('#w p { font-size: 40px; }\n@media (max-width: 640px) { #w p { font-size: 16px; } }', '<div id="w"><p>T</p></div>');
    const e = env(src, 'html', {}, fs);
    const r = e.run({ op: 'set', target: e.at('p'), properties: { 'font-size': '48px' } });
    expect(!r.ok && r.refusal.code).toBe('specificity');
  });
  it('writes the live-DOM operations that match the text patches', () => {
    const src = page(CSS, '<h1 id="a">T</h1>');
    const e = env(src, 'html', {}, fs);
    const r = okR(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '48px' } }));
    expect(r.dom).toEqual([{ type: 'css', index: e.model.sheets[0]!.elementIndex, text: '#a { font-size: 48px; }\n@media (max-width: 640px) { #a { font-size: 19.2px; } }\n' }]);
    applyDomOps({ doc: e.doc, elements: e.elements, probe: e.probe, model: e.model, iframe: null as never, setWidth() {}, dispose() {} }, r.dom);
    expect(e.doc.querySelector('style')!.textContent).toContain('#a { font-size: 19.2px; }');
  });
  it('keeps the old behaviour (a plain inline style) when the page has no media rule for the property', () => {
    const src = page('h1 { font-size: 40px; }\n@media (max-width: 640px) { h1 { color: red; } }', '<h1 id="a">T</h1><h1 id="b">U</h1>');
    const e = env(src, 'html', {}, fs);
    expect(e.out(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '48px' } }))).toContain('<h1 id="a" style="font-size: 48px">');
  });
  it('refuses a ratio when the new value is not in px', () => {
    const e = env(page(CSS, '<h1 id="a">T</h1>'), 'html', {}, fs);
    const r = e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '3em' } });
    expect(!r.ok && r.refusal.code).toBe('ratio-unit');
  });
  it('replaces an inline declaration in place and overrides only !important media rules', () => {
    const src = page('@media (max-width: 640px) { h1 { font-size: 16px; } }', '<h1 id="a" style="font-size:40px">T</h1>');
    const e = env(src, 'html', {}, fs);
    expect(e.out(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '48px' } }))).toBe(src.replace('font-size:40px', 'font-size:48px'));
  });
  it('scales a shorthand per side and applies a non-ratio property inline', () => {
    const src = page('.c { padding: 12px 20px; color: #333; }\n@media (max-width: 640px) { .c { padding: 8px 12px; color: #999; } }', '<div class="c" id="a">x</div>');
    const e = env(src, 'html', {}, table({ 'padding-top': { 1280: '12px' }, 'padding-right': { 1280: '20px' }, 'padding-bottom': { 1280: '12px' }, 'padding-left': { 1280: '20px' } }));
    const r = okR(e.run({ op: 'set', target: e.at('#a'), properties: { padding: '18px 30px', color: '#c00' } }));
    const out = e.out(r);
    expect(out).toContain('#a { padding: 18px 30px; }');
    expect(out).toContain('@media (max-width: 640px) { #a { padding: 12px 18px; } }');
    expect(out).toContain('style="color: #c00"');
  });
});

describe('unlinked edits and pins', () => {
  const run = (src: string, edits: Edit[], vals = fs) => {
    const e = env(src, 'html', {}, vals);
    let model = e.model;
    let state: EditState = emptyState();
    let files: Record<string, string> = {};
    for (const edit of edits) {
      const r = okR(applyEdit(model, edit, e.probe, state));
      ({ files, model } = commit(model, r.patches));
      state = r.state!;
    }
    return { files, state, e };
  };
  it('writes an environment-only rule and pins the value', () => {
    const src = page(CSS, '<h1 id="a">T</h1>');
    const e = env(src, 'html', {}, fs);
    const r = okR(e.run({ op: 'set', target: e.at('#a'), environment: 'phone', link: false, properties: { 'font-size': '16px' } }));
    expect(e.out(r)).toContain('@media (max-width: 640px) { #a { font-size: 16px; } }');
    expect(listUnlinked(r.state!)).toEqual([{ selector: '/html[1]/body[1]/h1[1]', property: 'font-size', environment: 'phone', value: '16px' }]);
  });
  it('creates the condition from the default breakpoint when the page has none', () => {
    const src = page('p { font-size: 20px; }', '<p id="a">x</p>');
    const e = env(src);
    const out = e.out(e.run({ op: 'set', target: e.at('#a'), environment: 'desktop', link: false, properties: { 'font-size': '30px' } }));
    expect(out).toContain('@media (min-width: 768px) { #a { font-size: 30px; } }');
  });
  it('replays a list deterministically and pinned values survive the third edit', () => {
    const src = page(CSS, '<h1 id="a">T</h1>');
    const probe0 = env(src, 'html', {}, fs);
    const idx = probe0.at('#a');
    const edits: Edit[] = [
      { op: 'set', target: idx, environment: 'desktop', properties: { 'font-size': '48px' } },
      { op: 'set', target: idx, environment: 'phone', link: false, properties: { 'font-size': '16px' } },
      { op: 'set', target: idx, environment: 'desktop', properties: { 'font-size': '60px' } },
    ];
    // Each step needs a probe that reports the effective value at that moment.
    const effective = [
      { 1280: '40px', 390: '16px' },
      { 1280: '48px', 390: '19.2px' },
      { 1280: '48px', 390: '16px' },
    ];
    let model = probe0.model;
    let state: EditState = emptyState();
    let css = '';
    edits.forEach((ed, i) => {
      const e = env(model.primary.source, 'html', {}, table({ 'font-size': effective[i]! }));
      const r = okR(applyEdit(model, ed, e.probe, state));
      state = r.state!;
      model = commit(model, r.patches).model;
      css = model.primary.source;
    });
    expect(css).toContain('#a { font-size: 60px; }');
    expect(css.trim().split('\n').slice(-3).join('\n')).toContain('@media (max-width: 640px) { #a { font-size: 16px; } }');
    expect(listUnlinked(state)).toHaveLength(1);
  });
  it('writes a phone-only offset composed with the existing transform', () => {
    const src = page('#a { display: inline-block; transform: rotate(3deg); }', '<span id="a">x</span>');
    const e = env(src, 'html', {}, table({ display: { 390: 'inline-block' }, transform: {} }));
    const out = e.out(e.run({ op: 'offset', target: e.at('#a'), dx: 24, dy: 16, environment: 'phone', link: false }));
    expect(out).toContain('@media (max-width: 767px) { #a { transform: translate(24px, 16px) rotate(3deg); } }');
  });
  it('reorders with CSS order in a flex parent (first position) and refuses in a block parent', () => {
    const flex = page('#r { display: flex; }', '<div id="r"><i id="x">1</i><i id="y">2</i><i id="z">3</i></div>');
    const e = env(flex, 'html', {}, table({ display: { 390: 'flex' }, order: { 390: '0' } }));
    const out = e.out(e.run({ op: 'reorder', target: e.at('#z'), placement: 'before', sibling: e.at('#x'), environment: 'phone', link: false }));
    expect(out).toContain('{ #z { order: -1; } }');
    const block = page('#r { display: block; }', '<div id="r"><i id="x">1</i><i id="y">2</i><i id="z">3</i></div>');
    const b = env(block, 'html', {}, table({ display: { 390: 'block' }, order: { 390: '0' } }));
    const r = b.run({ op: 'reorder', target: b.at('#z'), placement: 'before', sibling: b.at('#x'), environment: 'phone', link: false });
    expect(!r.ok && r.refusal.code).toBe('order-needs-flex-or-grid');
    const mid = env(flex, 'html', {}, table({ display: { 390: 'flex' }, order: { 390: '0' } }));
    const m = mid.run({ op: 'reorder', target: mid.at('#z'), placement: 'before', sibling: mid.at('#y'), environment: 'phone', link: false });
    expect(!m.ok && m.refusal.code).toBe('order-position');
  });
  it('refuses unlinked edits in SVG', () => {
    const e = env('<svg xmlns="http://www.w3.org/2000/svg"><rect id="a" width="1" height="1"/></svg>', 'svg');
    const r = e.run({ op: 'set', target: e.at('#a'), link: false, properties: { fill: 'red' } });
    expect(!r.ok && r.refusal.code).toBe('svg-unlinked');
  });
});

describe('listUnlinked', () => {
  it('returns every pinned override, sorted, and nothing for an empty state', () => {
    expect(listUnlinked(emptyState())).toEqual([]);
    const st: EditState = { pins: [
      { selector: '/b', property: 'color', environment: 'phone', value: 'red' },
      { selector: '/a', property: 'font-size', environment: 'desktop', value: '3px' },
    ] };
    expect(listUnlinked(st).map((x) => x.selector)).toEqual(['/a', '/b']);
  });
});

describe('override rules and a trailing source-map comment', () => {
  const edit = (e: ReturnType<typeof env>) => e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '48px' } });
  const NEW = '#a { font-size: 48px; }\n@media (max-width: 640px) { #a { font-size: 19.2px; } }\n';
  const MAP = '/*# sourceMappingURL=site.css.map */';

  it('companion CSS: puts the rules before the comment on its own line, with a trailing newline', () => {
    const css = `${CSS}\n${MAP}\n`;
    const e = env('<html><head><link rel="stylesheet" href="s.css"></head><body><h1 id="a">T</h1></body></html>', 'html', { 's.css': css }, fs);
    const out = e.files(edit(e))['s.css']!;
    expect(out).toBe(`${CSS}\n${NEW}${MAP}\n`);
    expect(out.endsWith(`${MAP}\n`)).toBe(true);
  });
  it('companion CSS: same without a trailing newline, the comment line stays byte-identical', () => {
    const css = `${CSS}\n${MAP}`;
    const e = env('<html><head><link rel="stylesheet" href="s.css"></head><body><h1 id="a">T</h1></body></html>', 'html', { 's.css': css }, fs);
    const out = e.files(edit(e))['s.css']!;
    expect(out).toBe(`${CSS}\n${NEW}${MAP}`);
  });
  it('companion CSS: a comment on the same line as the last rule gets the rules inserted before it', () => {
    const css = `${CSS}${MAP}`;
    const e = env('<html><head><link rel="stylesheet" href="s.css"></head><body><h1 id="a">T</h1></body></html>', 'html', { 's.css': css }, fs);
    const out = e.files(edit(e))['s.css']!;
    expect(out).toBe(`${CSS}${NEW}${MAP}`);
  });
  it('companion CSS without a comment keeps the old behaviour (with and without a trailing newline)', () => {
    const mk = (css: string) => { const e = env('<html><head><link rel="stylesheet" href="s.css"></head><body><h1 id="a">T</h1></body></html>', 'html', { 's.css': css }, fs); return e.files(edit(e))['s.css']!; };
    expect(mk(`${CSS}\n`)).toBe(`${CSS}\n${NEW}`);
    expect(mk(CSS)).toBe(`${CSS}\n${NEW}`);
  });
  it('a similar comment that is not the last thing in the file is not treated as the source-map comment', () => {
    const css = `${CSS}\n${MAP}\n.x { color: red; }\n`;
    const e = env('<html><head><link rel="stylesheet" href="s.css"></head><body><h1 id="a">T</h1></body></html>', 'html', { 's.css': css }, fs);
    expect(e.files(edit(e))['s.css']).toBe(`${css}${NEW}`);
  });
  it('<style> block: puts the rules before a trailing source-map comment', () => {
    const src = page(`${CSS}\n${MAP}`, '<h1 id="a">T</h1>');
    const e = env(src, 'html', {}, fs);
    expect(e.out(edit(e))).toBe(src.replace(MAP, `${NEW}${MAP}`));
  });
  it('<style> block without a comment is unchanged behaviour', () => {
    const src = page(CSS, '<h1 id="a">T</h1>');
    const e = env(src, 'html', {}, fs);
    expect(e.out(edit(e))).toBe(src.replace('\n</style>', `\n${NEW}</style>`));
  });
});

describe('linked width and height', () => {
  const wh = table({ width: { 1280: '480px', 390: '200px' }, height: { 1280: '100px', 390: '50px' }, 'max-width': { 1280: 'none', 390: 'none' } });
  const widthPage = (css: string, tag = '<div class="p" id="a">x</div>') => page(css, tag);
  const set = (src: string, props: Record<string, string>, extra: Partial<Edit> = {}, tweak = wh) => {
    const e = env(src, 'html', {}, tweak);
    return { e, r: okR(e.run({ op: 'set', target: e.at('#a'), properties: props, ...extra } as Edit)) };
  };
  it('scales a fixed px value of the other environment and guards both widths', () => {
    const { e, r } = set(widthPage('.p { width: 480px; }\n@media (max-width: 640px) { .p { width: 200px; } }'), { width: '600px' });
    const out = e.out(r);
    expect(out).toContain('@media (min-width: 641px) { #a { width: 600px; max-width: 100%; } }');
    expect(out).toContain('@media (max-width: 640px) { #a { width: 250px; max-width: 100%; } }');
    expect(r.notes ?? []).toEqual([]);
  });
  it('scales rem and em declarations and keeps their unit', () => {
    const { e, r } = set(widthPage('.p { width: 30rem; }\n@media (max-width: 640px) { .p { width: 12.5em; } }'), { width: '600px' });
    expect(e.out(r)).toContain('@media (max-width: 640px) { #a { width: 15.625em; max-width: 100%; } }');
  });
  it('leaves a percentage or auto alone, applies the new value to the edited environment only and notes it', () => {
    for (const flexible of ['80%', 'auto', 'clamp(100px, 50vw, 300px)', 'calc(100% - 20px)']) {
      const { e, r } = set(widthPage(`.p { width: 480px; }\n@media (max-width: 640px) { .p { width: ${flexible}; } }`), { width: '600px' });
      const out = e.out(r);
      expect(out).toContain('@media (min-width: 641px) { #a { width: 600px; max-width: 100%; } }');
      expect(out).not.toContain('max-width: 640px) { #a');
      expect(r.notes).toEqual([{ property: 'width', condition: '@media (max-width: 640px)', value: flexible, reason: expect.stringContaining('left alone') }]);
    }
  });
  it('leaves an undeclared value alone', () => {
    const { e, r } = set(widthPage('.q { color: red; }\n@media (max-width: 640px) { .q { color: blue; } }'), { width: '600px' });
    expect(e.out(r)).toContain('@media (min-width: 641px) { #a { width: 600px; max-width: 100%; } }');
    expect(r.notes?.[0]).toMatchObject({ property: 'width', value: '(not declared)' });
  });
  it('writes one rule when both environments end up with the same value', () => {
    const { e, r } = set(widthPage('#a { width: 480px; }\n@media (max-width: 640px) { .q { color: blue; } }'), { width: '600px' }, {}, table({ width: { 1280: '480px', 390: '480px' } }));
    expect(e.out(r)).toContain('#a { width: 600px; max-width: 100%; }');
    expect(e.out(r)).not.toContain('@media (min-width: 641px) { #a');
  });
  it('adds no guard to height and none when the element has its own max-width', () => {
    const h = set(widthPage('.p { height: 100px; }\n@media (max-width: 640px) { .p { height: 50px; } }'), { height: '150px' });
    expect(h.e.out(h.r)).toContain('@media (min-width: 641px) { #a { height: 150px; } }');
    expect(h.e.out(h.r)).toContain('@media (max-width: 640px) { #a { height: 75px; } }');
    const m = set(widthPage('.p { width: 480px; max-width: 500px; }\n@media (max-width: 640px) { .p { width: 200px; } }'), { width: '600px' }, {}, table({ width: { 1280: '480px', 390: '200px' }, 'max-width': { 1280: '500px', 390: '500px' } }));
    expect(m.e.out(m.r)).toContain('@media (min-width: 641px) { #a { width: 600px; } }');
    expect(m.e.out(m.r)).toContain('@media (max-width: 640px) { #a { width: 250px; } }');
  });
  it('treats a numeric width attribute as a fixed px value', () => {
    const { e, r } = set(widthPage('.q { color: red; }\n@media (max-width: 640px) { .q { color: blue; } }', '<table id="a" width="400"><tr><td>x</td></tr></table>'), { width: '480px' }, {}, table({ width: { 1280: '400px', 390: '400px' }, 'max-width': { 1280: 'none', 390: 'none' } }));
    expect(e.out(r)).toContain('#a { width: 480px; max-width: 100%; }');
  });
  it('treats a percentage attribute as flexible', () => {
    const { e, r } = set(widthPage('.q { color: red; }\n@media (max-width: 640px) { .q { color: blue; } }', '<table id="a" width="100%"><tr><td>x</td></tr></table>'), { width: '480px' }, {}, table({ width: { 1280: '1000px', 390: '390px' } }));
    expect(e.out(r)).toContain('@media (min-width: 641px) { #a { width: 480px; max-width: 100%; } }');
    expect(r.notes?.[0]?.value).toBe('100%');
  });
  it('uses !important only for an inline declaration and refuses a page !important', () => {
    const inl = set(widthPage('@media (max-width: 640px) { .q { color: blue; } }', '<div id="a" class="p" style="width: 480px">x</div>'), { width: '600px' });
    expect(inl.e.out(inl.r)).toContain('#a { width: 600px !important; max-width: 100%; }');
    const e = env(widthPage('.p { width: 480px !important; }\n@media (max-width: 640px) { .p { width: 200px; } }'), 'html', {}, wh);
    const x = e.run({ op: 'set', target: e.at('#a'), properties: { width: '600px' } });
    expect(!x.ok && x.refusal.code).toBe('important-conflict');
  });
  it('keeps a pinned value of the other environment', () => {
    const src = widthPage('.p { width: 480px; }\n@media (max-width: 640px) { .p { width: 200px; } }');
    const e = env(src, 'html', {}, wh);
    const a = okR(e.run({ op: 'set', target: e.at('#a'), properties: { width: '250px' }, environment: 'phone', link: false }));
    const b = okR(applyEdit(e.model, { op: 'set', target: e.at('#a'), properties: { width: '600px' } }, e.probe, a.state));
    expect(b.notes?.[0]?.reason).toContain('pinned');
    expect(JSON.stringify(b.patches)).not.toContain('max-width: 640px');
  });
  it('falls back to the old behaviour for a non-px value or a page with no stylesheet', () => {
    const a = set(widthPage('.p { width: 480px; }\n@media (max-width: 640px) { .p { width: 200px; } }'), { width: '50%' });
    expect(a.e.out(a.r)).toContain('style="width: 50%"');
    const e = env('<html><body><div id="a">x</div></body></html>', 'html', {}, wh);
    const r = okR(e.run({ op: 'set', target: e.at('#a'), properties: { width: '600px' } }));
    expect(e.out(r)).toContain('style="width: 600px"');
  });
  it('unlinked width and height keep the old behaviour (inside the environment, no guard)', () => {
    const { e, r } = set(widthPage('.p { width: 480px; }\n@media (max-width: 640px) { .p { width: 200px; } }'), { width: '300px' }, { environment: 'phone', link: false });
    expect(e.out(r)).toContain('@media (max-width: 640px) { #a { width: 300px; } }');
  });
});

describe('linked and unlinked size edits on flex items', () => {
  const flexV = (over: Record<string, Record<number, string>> = {}) => table({
    display: { 1280: 'flex', 390: 'flex' }, 'flex-direction': { 1280: 'row', 390: 'row' }, 'flex-basis': { 1280: '240px', 390: '240px' }, 'flex-grow': { 1280: '0', 390: '0' },
    width: { 1280: '240px', 390: '240px' }, height: { 1280: '100px', 390: '60px' }, 'max-width': { 1280: 'none', 390: 'none' }, ...over,
  });
  const row = (css: string, item = '<div id="a" class="s">x</div>') => page(css, `<div class="row">${item}<div>y</div></div>`);
  const run = (src: string, props: Record<string, string>, tweak = flexV(), extra: Partial<Edit> = {}) => {
    const e = env(src, 'html', {}, tweak);
    return { e, r: e.run({ op: 'set', target: e.at('#a'), properties: props, ...extra } as Edit) };
  };
  it('writes flex-basis with the width and scales the other environment\'s basis', () => {
    const { e, r } = run(row('.row { display: flex; }\n.s { flex: 0 0 400px; }\n@media (max-width: 640px) { .s { flex-basis: 200px; } }'), { width: '480px' }, flexV({ 'flex-basis': { 1280: '400px', 390: '200px' }, width: { 1280: '400px', 390: '200px' } }));
    const out = e.out(okR(r));
    expect(out).toContain('@media (min-width: 641px) { #a { width: 480px; flex-basis: 480px; max-width: 100%; } }');
    expect(out).toContain('@media (max-width: 640px) { #a { flex-basis: 240px; max-width: 100%; } }');
  });
  it('the E14 shape: no width declared, same basis in both: a basis rule for each environment', () => {
    const { e, r } = run(row('.row { display: flex; }\n.s { flex: 0 0 240px; }\n@media (max-width: 640px) { .q { color: red; } }'), { width: '300px' });
    const out = e.out(okR(r));
    expect(out).toContain('@media (min-width: 641px) { #a { width: 300px; flex-basis: 300px; max-width: 100%; } }');
    expect(out).toContain('@media (max-width: 640px) { #a { flex-basis: 300px; max-width: 100%; } }');
  });
  it('scales a basis in rem and em and keeps the unit', () => {
    const { e, r } = run(row('.row { display: flex; }\n.s { flex: 0 0 30rem; }\n@media (max-width: 640px) { .s { flex-basis: 10em; } }'), { width: '600px' }, flexV({ 'flex-basis': { 1280: '480px', 390: '160px' }, width: { 1280: '480px', 390: '160px' } }));
    expect(e.out(okR(r))).toContain('#a { flex-basis: 12.5em; max-width: 100%; }');
  });
  it('leaves a flexible basis alone with a note', () => {
    for (const basis of ['30%', 'content', 'calc(100% - 20px)']) {
      const { e, r } = run(row(`.row { display: flex; }\n.s { flex: 0 0 240px; }\n@media (max-width: 640px) { .s { flex-basis: ${basis}; } }`), { width: '300px' });
      const x = okR(r);
      expect(e.out(x)).not.toContain('max-width: 640px) { #a');
      expect(x.notes?.[0]).toMatchObject({ property: 'width', value: basis, reason: expect.stringContaining('left alone') });
    }
  });
  it('scales the width too when it is also declared as a fixed length', () => {
    const { e, r } = run(row('.row { display: flex; }\n.s { flex: 0 0 240px; width: 240px; }\n@media (max-width: 640px) { .s { flex-basis: 200px; width: 200px; } }'), { width: '300px' }, flexV({ 'flex-basis': { 1280: '240px', 390: '200px' }, width: { 1280: '240px', 390: '200px' } }));
    expect(e.out(okR(r))).toContain('@media (max-width: 640px) { #a { flex-basis: 250px; width: 250px; max-width: 100%; } }');
  });
  it('uses the height and the basis for a column container, with no guard', () => {
    const { e, r } = run(row('.row { display: flex; flex-direction: column; }\n.s { flex: 0 0 100px; }\n@media (max-width: 640px) { .s { flex-basis: 60px; } }'), { height: '150px' }, flexV({ 'flex-direction': { 1280: 'column', 390: 'column' }, 'flex-basis': { 1280: '100px', 390: '60px' }, height: { 1280: '100px', 390: '60px' } }));
    const out = e.out(okR(r));
    expect(out).toContain('@media (min-width: 641px) { #a { height: 150px; flex-basis: 150px; } }');
    expect(out).toContain('@media (max-width: 640px) { #a { flex-basis: 90px; } }');
  });
  it('treats a flex item with an auto basis, and a non-flex parent, as before', () => {
    const auto = run(row('.row { display: flex; }\n.s { width: 240px; }\n@media (max-width: 640px) { .s { width: 200px; } }'), { width: '300px' }, flexV({ 'flex-basis': { 1280: 'auto', 390: 'auto' }, width: { 1280: '240px', 390: '200px' } }));
    expect(auto.e.out(okR(auto.r))).not.toContain('flex-basis');
    const block = run(row('.row { display: block; }\n.s { width: 240px; }\n@media (max-width: 640px) { .s { width: 200px; } }'), { width: '300px' }, flexV({ display: { 1280: 'block', 390: 'block' }, width: { 1280: '240px', 390: '200px' } }));
    expect(block.e.out(okR(block.r))).not.toContain('flex-basis');
  });
  it('refuses a flex item that can grow, in either environment', () => {
    const css = '.row { display: flex; }\n.s { flex: 1; }\n@media (max-width: 640px) { .q { color: red; } }';
    for (const grow of [{ 1280: '1', 390: '0' }, { 1280: '0', 390: '2' }]) {
      const { r } = run(row(css), { width: '300px' }, flexV({ 'flex-basis': { 1280: '0%', 390: '0%' }, 'flex-grow': grow }));
      expect(!r.ok && r.refusal.code).toBe('flex-grow');
    }
  });
  it('unlinked size edits on a flex item also write flex-basis, only inside the environment', () => {
    const { e, r } = run(row('.row { display: flex; }\n.s { flex: 0 0 300px; }\n@media (max-width: 640px) { .q { color: red; } }'), { width: '200px' }, flexV(), { environment: 'phone', link: false });
    expect(e.out(okR(r))).toContain('@media (max-width: 640px) { #a { width: 200px; flex-basis: 200px; } }');
    const g = run(row('.row { display: flex; }\n.s { flex: 1; }\n@media (max-width: 640px) { .q { color: red; } }'), { width: '200px' }, flexV({ 'flex-basis': { 1280: '0%', 390: '0%' }, 'flex-grow': { 1280: '1', 390: '1' } }), { environment: 'phone', link: false });
    expect(!g.r.ok && g.r.refusal.code).toBe('flex-grow');
  });
  it('a flex-basis in the element\'s own style attribute is beaten with !important', () => {
    const { e, r } = run(row('.row { display: flex; }\n@media (max-width: 640px) { .q { color: red; } }', '<div id="a" style="flex: 0 0 240px">x</div>'), { width: '300px' });
    expect(e.out(okR(r))).toContain('flex-basis: 300px !important;');
  });
  it('reads the basis out of the flex shorthand', () => {
    expect(basisOfFlex('0 0 240px')).toBe('240px');
    expect(basisOfFlex('1')).toBe('0%');
    expect(basisOfFlex('1 1')).toBe('0%');
    expect(basisOfFlex('none')).toBe('auto');
    expect(basisOfFlex('2 1 content')).toBe('content');
    expect(basisOfFlex('1 1 10em')).toBe('10em');
  });
});

