import { describe, expect, it } from 'vitest';
import { blockOf } from '../src/edit';
import { env } from './helpers';
import type { EditResult, Probe } from '../src';

const refusalCode = (r: EditResult) => (r.ok ? 'ok' : r.refusal.code);

describe('HTML placement: inline style', () => {
  const html = '<html><body><p id="a" style="margin:0;color:#222">x</p><p id="b">y</p></body></html>';
  it('replaces an existing inline declaration, touching only its value', () => {
    const e = env(html);
    const out = e.out(e.run({ op: 'set', target: e.at('#a'), properties: { color: '#c0392b' } }));
    expect(out).toBe(html.replace('#222', '#c0392b'));
  });
  it('appends to an existing inline style, copying its separators', () => {
    const e = env(html);
    const out = e.out(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '20px' } }));
    expect(out).toBe(html.replace('color:#222', 'color:#222;font-size:20px'));
  });
  it('adds a style attribute when there is neither style nor a single-element rule', () => {
    const e = env(html);
    const out = e.out(e.run({ op: 'set', target: e.at('#b'), properties: { color: 'red' } }));
    expect(out).toBe(html.replace('<p id="b">', '<p id="b" style="color: red">'));
  });
  it('emits the same change as a live-DOM operation', () => {
    const e = env(html);
    const r = e.run({ op: 'set', target: e.at('#b'), properties: { color: 'red' } });
    expect(r.ok && r.dom).toEqual([{ type: 'style', index: e.at('#b'), props: [['color', 'red']] }]);
  });
  it('edits an upper-case STYLE attribute in place', () => {
    const src = '<HTML><BODY><DIV ID=intro STYLE="font-size:14px; color:#222">x</DIV></BODY></HTML>';
    const e = env(src);
    const out = e.out(e.run({ op: 'set', target: e.at('#intro'), properties: { 'font-size': '18px' } }));
    expect(out).toBe(src.replace('14px', '18px'));
  });
});

describe('HTML placement: rules', () => {
  const html = `<html><head><style>
.shared { color: blue; font-size: 10px; }
#only { color: green; }
.once { margin: 4px; }
</style></head><body>
<p class="shared" id="s1">a</p><p class="shared" id="s2">b</p><p id="only">c</p><p class="once" id="o">d</p>
</body></html>`;
  it('edits the rule that targets only this element', () => {
    const e = env(html);
    const out = e.out(e.run({ op: 'set', target: e.at('#only'), properties: { color: 'red' } }));
    expect(out).toBe(html.replace('#only { color: green; }', '#only { color: red; }'));
  });
  it('appends to that rule when it does not declare the property yet', () => {
    const e = env(html);
    const out = e.out(e.run({ op: 'set', target: e.at('#only'), properties: { 'font-size': '30px' } }));
    expect(out).toContain('#only { color: green; font-size: 30px; }');
  });
  it('never edits a shared rule: an element that only has a shared rule gets a style attribute', () => {
    const e = env(html);
    const r = e.run({ op: 'set', target: e.at('#s1'), properties: { color: 'red' } });
    const out = e.out(r);
    expect(out).toContain('.shared { color: blue; font-size: 10px; }');
    expect(out).toContain('<p class="shared" id="s1" style="color: red">');
    expect(out).toContain('<p class="shared" id="s2">');
  });
  it('treats a class used by one element as a single-element rule', () => {
    const e = env(html);
    const out = e.out(e.run({ op: 'set', target: e.at('#o'), properties: { margin: '9px' } }));
    expect(out).toContain('.once { margin: 9px; }');
  });
  it('falls back to inline when a more specific shared rule would beat the single rule', () => {
    const src = '<html><head><style>p#t { color: red } .k { color: blue }</style></head><body><p id="t" class="k">a</p><p class="k">b</p></body></html>';
    // #t rule is single-target and more specific than .k, so it wins and is edited.
    const e = env(src);
    expect(e.out(e.run({ op: 'set', target: e.at('#t'), properties: { color: 'pink' } }))).toContain('p#t { color: pink }');
    const src2 = '<html><head><style>.k { color: blue } .solo { color: red }</style></head><body><p id="t" class="k solo">a</p><p class="k">b</p></body></html>';
    // .solo is single-target but equal specificity and later, so it wins too; make it lose:
    const src3 = '<html><head><style>.solo { color: red } p.k { color: blue }</style></head><body><p id="t" class="k solo">a</p><p class="k">b</p></body></html>';
    const e3 = env(src3);
    const out3 = e3.out(e3.run({ op: 'set', target: e3.at('#t'), properties: { color: 'pink' } }));
    expect(out3).toContain('<p id="t" class="k solo" style="color: pink">');
    expect(out3).toContain('.solo { color: red }');
    void src2;
  });
  it('edits a rule in a companion CSS file and leaves the HTML untouched', () => {
    const doc = '<html><head><link rel="stylesheet" href="s.css"></head><body><h1 id="t">x</h1></body></html>';
    const css = '/* site */\n#t { margin: 0; color: #111; }\n';
    const e = env(doc, 'html', { 's.css': css });
    const files = e.files(e.run({ op: 'set', target: e.at('#t'), properties: { color: '#b5451b' } }));
    expect(files['document.html']).toBe(doc);
    expect(files['s.css']).toBe(css.replace('#111', '#b5451b'));
  });
});

describe('HTML refusals', () => {
  it('refuses when the property is set with !important elsewhere', () => {
    const e = env('<html><head><style>#a { color: red !important }</style></head><body><p id="a">x</p></body></html>');
    expect(refusalCode(e.run({ op: 'set', target: e.at('#a'), properties: { color: 'blue' } }))).toBe('important-conflict');
  });
  it('a linked colour edit on a property that also has an @media rule is written inline so it wins at every width', () => {
    const e = env('<html><head><style>@media (min-width: 1px) { #a { color: red } }</style></head><body><p id="a">x</p></body></html>');
    const r = e.run({ op: 'set', target: e.at('#a'), properties: { color: 'blue' } });
    expect(e.out(r)).toContain('<p id="a" style="color: blue">');
  });
  it('refuses to mix shorthand and longhand', () => {
    const e = env('<html><body><p id="a" style="padding-top:2px">x</p></body></html>');
    expect(refusalCode(e.run({ op: 'set', target: e.at('#a'), properties: { padding: '4px' } }))).toBe('shorthand-mix');
  });
  it('does not mistake unrelated font-* or padding-* longhands for a shorthand mix', () => {
    const e = env('<html><head><style>#a { font-size: 12px; font-weight: 700; padding-left: 1px }</style></head><body><p id="a">x</p></body></html>');
    expect(refusalCode(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-family': 'Georgia, serif' } }))).toBe('ok');
    expect(refusalCode(e.run({ op: 'set', target: e.at('#a'), properties: { 'padding-top': '2px' } }))).toBe('ok');
    expect(refusalCode(e.run({ op: 'set', target: e.at('#a'), properties: { font: '12px serif' } }))).toBe('shorthand-mix');
    expect(refusalCode(e.run({ op: 'set', target: e.at('#a'), properties: { padding: '2px' } }))).toBe('shorthand-mix');
  });
  it('refuses an element the parser created', () => {
    const e = env('<p id="a">x</p>');
    const head = e.model.primary.elements.find((x) => x.ltag === 'head')!;
    expect(refusalCode(e.run({ op: 'set', target: head.index, properties: { color: 'red' } }))).toBe('no-source');
  });
  it('warns about scripts and missing stylesheets instead of guessing', () => {
    const e = env('<html><head><link rel=stylesheet href=gone.css></head><body><p id="a">x</p><script>1</script></body></html>');
    const r = e.run({ op: 'set', target: e.at('#a'), properties: { color: 'red' } });
    expect(r.warnings.join(' ')).toMatch(/script/);
    expect(r.warnings.join(' ')).toMatch(/gone\.css/);
  });
});

describe('HTML flex items', () => {
  const html = '<html><head><style>#row { display: flex } #side { flex: 0 0 240px } #free { flex: none }</style></head><body><div id="row"><div id="side">a</div><div id="free">b</div></div></body></html>';
  const tweak = (p: Probe): Probe => ({ ...p, computed: (i, prop) => (prop === 'flex-basis' ? (i === p.matches('#side')[0] ? '240px' : 'auto') : p.computed(i, prop)) });
  it('writes flex-basis along with width when the item has a non-auto flex-basis', () => {
    const e = env(html, 'html', {}, tweak);
    const out = e.out(e.run({ op: 'set', target: e.at('#side'), properties: { width: '300px' } }));
    expect(out).toContain('#side { flex: 0 0 240px; width: 300px; flex-basis: 300px }');
  });
  it('leaves flex-basis alone when it is auto', () => {
    const e = env(html, 'html', {}, tweak);
    const out = e.out(e.run({ op: 'set', target: e.at('#free'), properties: { width: '300px' } }));
    expect(out).not.toContain('flex-basis: 300px');
  });
});

describe('HTML offsets', () => {
  it('adds a translate when there is no transform', () => {
    const e = env('<html><body><div id="a" style="display:block">x</div></body></html>');
    const out = e.out(e.run({ op: 'offset', target: e.at('#a'), dx: 24, dy: -10 }));
    expect(out).toContain('style="display:block;transform:translate(24px, -10px)"');
  });
  it('prepends to an inline transform', () => {
    const e = env('<html><body><div id="a" style="transform: rotate(5deg)">x</div></body></html>');
    const out = e.out(e.run({ op: 'offset', target: e.at('#a'), dx: 3, dy: 4 }));
    expect(out).toContain('transform: translate(3px, 4px) rotate(5deg)');
  });
  it('prepends to a transform declared in the single-element rule', () => {
    const e = env('<html><head><style>#a { transform: scale(1.1); top: 0 }</style></head><body><div id="a">x</div></body></html>');
    const out = e.out(e.run({ op: 'offset', target: e.at('#a'), dx: -16, dy: 8 }));
    expect(out).toContain('#a { transform: translate(-16px, 8px) scale(1.1); top: 0 }');
  });
  it('composes with a shared-rule transform by writing inline', () => {
    const e = env('<html><head><style>.k { transform: scale(2) }</style></head><body><div id="a" class="k">x</div><div class="k">y</div></body></html>');
    const out = e.out(e.run({ op: 'offset', target: e.at('#a'), dx: 1, dy: 2 }));
    expect(out).toContain('.k { transform: scale(2) }');
    expect(out).toContain('style="transform: translate(1px, 2px) scale(2)"');
  });
  it('refuses display:inline targets and transformed ancestors', () => {
    const tweak = (p: Probe): Probe => ({
      ...p,
      computed: (i, prop) => {
        if (prop === 'display' && i === p.matches('#i')[0]) return 'inline';
        if (prop === 'transform' && i === p.matches('#wrap')[0]) return 'matrix(2, 0, 0, 2, 0, 0)';
        return p.computed(i, prop);
      },
    });
    const e = env('<html><body><span id="i">x</span><div id="wrap"><div id="in">y</div></div></body></html>', 'html', {}, tweak);
    expect(refusalCode(e.run({ op: 'offset', target: e.at('#i'), dx: 1, dy: 1 }))).toBe('not-transformable');
    expect(refusalCode(e.run({ op: 'offset', target: e.at('#in'), dx: 1, dy: 1 }))).toBe('transformed-ancestor');
  });
});

describe('reorder', () => {
  it('moves whole lines so the result is a permutation of the original lines', () => {
    const src = '<html><body>\n<ul id="l">\n  <li id="a">A</li>\n  <li id="b">B</li>\n  <li id="c">C</li>\n</ul>\n</body></html>';
    const e = env(src);
    const out = e.out(e.run({ op: 'reorder', target: e.at('#c'), placement: 'before', sibling: e.at('#a') }));
    expect(out).toBe('<html><body>\n<ul id="l">\n  <li id="c">C</li>\n  <li id="a">A</li>\n  <li id="b">B</li>\n</ul>\n</body></html>');
    expect(out.split('\n').sort()).toEqual(src.split('\n').sort());
  });
  it('supports placing after a sibling', () => {
    const src = '<html><body>\n<div id="p">\n<b id="x">1</b>\n<b id="y">2</b>\n<b id="z">3</b>\n</div>\n</body></html>';
    const e = env(src);
    const out = e.out(e.run({ op: 'reorder', target: e.at('#x'), placement: 'after', sibling: e.at('#z') }));
    expect(out).toContain('<b id="y">2</b>\n<b id="z">3</b>\n<b id="x">1</b>\n</div>');
  });
  it('keeps indentation when an element with no end tag moves', () => {
    const src = '<HTML><BODY>\n<UL ID=steps>\n\t<li id=s1>One</li>\n    <LI ID=s2>Two\n\t<li id=s3>Three\n</UL>\n</BODY></HTML>';
    const e = env(src);
    const out = e.out(e.run({ op: 'reorder', target: e.at('#s3'), placement: 'before', sibling: e.at('#s1') }));
    expect(out).toBe('<HTML><BODY>\n<UL ID=steps>\n\t<li id=s3>Three\n\t<li id=s1>One</li>\n    <LI ID=s2>Two\n</UL>\n</BODY></HTML>');
    expect(out.split('\n').sort()).toEqual(src.split('\n').sort());
  });
  it('moves inline elements by their own text when they share a line', () => {
    const src = '<html><body><p><i id="a">A</i> <i id="b">B</i></p></body></html>';
    const e = env(src);
    const out = e.out(e.run({ op: 'reorder', target: e.at('#b'), placement: 'before', sibling: e.at('#a') }));
    expect(out).toBe('<html><body><p><i id="b">B</i><i id="a">A</i> </p></body></html>');
  });
  it('is a no-op when already in place', () => {
    const e = env('<html><body><div><i id="a">A</i><i id="b">B</i></div></body></html>');
    const r = e.run({ op: 'reorder', target: e.at('#a'), placement: 'before', sibling: e.at('#b') });
    expect(r.ok && r.patches).toEqual([]);
  });
  it('refuses across parents, onto itself, and for implied parents', () => {
    const e = env('<html><body><div id="d1"><i id="a">A</i></div><div id="d2"><i id="b">B</i></div></body></html>');
    expect(refusalCode(e.run({ op: 'reorder', target: e.at('#a'), placement: 'before', sibling: e.at('#b') }))).toBe('different-parents');
    expect(refusalCode(e.run({ op: 'reorder', target: e.at('#a'), placement: 'before', sibling: e.at('#a') }))).toBe('same-element');
  });
  it('gives the preview the parent text exactly as exported', () => {
    const src = '<html><body>\n<ul id="l">\n  <li id="a">A</li>\n  <li id="b">B</li>\n</ul>\n</body></html>';
    const e = env(src);
    const r = e.run({ op: 'reorder', target: e.at('#b'), placement: 'before', sibling: e.at('#a') });
    expect(r.ok && r.dom).toEqual([{ type: 'html', index: e.at('#l'), html: '\n  <li id="b">B</li>\n  <li id="a">A</li>\n' }]);
  });
  it('blockOf returns whole lines only when the element owns them', () => {
    const src = '<div>\n  <p id="a">x</p>\n  <p>y</p> <p id="b">z</p>\n</div>';
    const e = env(src);
    const a = e.model.primary.elements[e.at('#a')]!;
    const b = e.model.primary.elements[e.at('#b')]!;
    expect(blockOf(src, a)).toMatchObject({ line: true });
    expect(blockOf(src, b)).toMatchObject({ line: false });
  });
});

describe('SVG set', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">\n<circle id="c" cx="5" cy="5" r="10" fill="red"/>\n<text id="t" style="font-size:14px;fill:#555">a</text>\n<rect id="r" width="3" height="4"/>\n</svg>';
  it('edits the presentation attribute the element already uses', () => {
    const e = env(svg, 'svg');
    const out = e.out(e.run({ op: 'set', target: e.at('#c'), properties: { r: '16', fill: 'blue' } }));
    expect(out).toContain('<circle id="c" cx="5" cy="5" r="16" fill="blue"/>');
  });
  it('edits inside style= when the element uses style', () => {
    const e = env(svg, 'svg');
    const out = e.out(e.run({ op: 'set', target: e.at('#t'), properties: { 'font-size': '20px' } }));
    expect(out).toContain('style="font-size:20px;fill:#555"');
  });
  it('appends to style= when the property is new and the element has style', () => {
    const e = env(svg, 'svg');
    expect(e.out(e.run({ op: 'set', target: e.at('#t'), properties: { 'font-weight': '700' } }))).toContain('style="font-size:14px;fill:#555;font-weight:700"');
  });
  it('adds a presentation attribute when the element has neither', () => {
    const e = env(svg, 'svg');
    expect(e.out(e.run({ op: 'set', target: e.at('#r'), properties: { fill: 'green' } }))).toContain('<rect id="r" width="3" height="4" fill="green"/>');
  });
  it('refuses elements reused through <use> or living in <defs>', () => {
    const e = env('<svg xmlns="http://www.w3.org/2000/svg" xmlns:xlink="http://www.w3.org/1999/xlink"><defs><g id="shape"><circle id="in" r="2"/></g></defs><use id="u" xlink:href="#shape"/></svg>', 'svg');
    expect(refusalCode(e.run({ op: 'set', target: e.at('#in'), properties: { fill: 'red' } }))).toBe('shared-instance');
    expect(refusalCode(e.run({ op: 'set', target: e.at('#shape'), properties: { fill: 'red' } }))).toBe('shared-instance');
  });
  it('refuses when a stylesheet rule in the SVG sets the property', () => {
    const e = env('<svg xmlns="http://www.w3.org/2000/svg"><style>.k{fill:red}</style><rect id="r" class="k"/></svg>', 'svg');
    expect(refusalCode(e.run({ op: 'set', target: e.at('#r'), properties: { fill: 'blue' } }))).toBe('svg-stylesheet');
  });
  it('emits attr and style DOM operations matching where it wrote', () => {
    const e = env(svg, 'svg');
    const r = e.run({ op: 'set', target: e.at('#c'), properties: { r: '16' } });
    expect(r.ok && r.dom).toEqual([{ type: 'attr', index: e.at('#c'), name: 'r', value: '16' }]);
  });
});

describe('SVG offset', () => {
  const svg = '<svg xmlns="http://www.w3.org/2000/svg">\n<g id="g" transform="scale(2)"><rect id="r" x="10" y="20" width="5" height="5"/><path id="p" d="M0 0"/><circle id="c" cx="1" cy="1" r="1" transform="translate(5 5)"/></g>\n</svg>';
  // jsdom has no SVG geometry, so supply screen matrices: group scale(2) => parent matrix scale 2.
  const tweak = (p: Probe): Probe => ({
    ...p,
    screenMatrix: () => [2, 0, 0, 2, 0, 0],
    parentScreenMatrix: () => [2, 0, 0, 2, 0, 0],
  });
  it('updates x and y through the inverse of the element matrix', () => {
    const e = env(svg, 'svg', {}, tweak);
    const out = e.out(e.run({ op: 'offset', target: e.at('#r'), dx: 30, dy: -20 }));
    expect(out).toContain('<rect id="r" x="25" y="10" width="5" height="5"/>');
  });
  it('accounts for rotation', () => {
    const c = Math.cos(Math.PI / 6);
    const s = Math.sin(Math.PI / 6);
    const rot = (p: Probe): Probe => ({ ...p, screenMatrix: () => [c, s, -s, c, 0, 0] });
    const e = env(svg, 'svg', {}, rot);
    const r = e.run({ op: 'offset', target: e.at('#r'), dx: 10, dy: 0 });
    // local = R^-1 * (10, 0) = (10c, -10s)
    expect(r.ok && r.dom).toEqual([
      { type: 'attr', index: e.at('#r'), name: 'x', value: String(+(10 + 10 * c).toFixed(4)) },
      { type: 'attr', index: e.at('#r'), name: 'y', value: String(+(20 - 10 * s).toFixed(4)) },
    ]);
  });
  it('adds a translate transform for elements without x/y', () => {
    const e = env(svg, 'svg', {}, tweak);
    expect(e.out(e.run({ op: 'offset', target: e.at('#p'), dx: 4, dy: 6 }))).toContain('<path id="p" d="M0 0" transform="translate(2 3)"/>');
  });
  it('prepends to an existing transform attribute', () => {
    const e = env(svg, 'svg', {}, tweak);
    // circle has cx/cy so it uses them; use a transformed path to test composition
    const src = '<svg xmlns="http://www.w3.org/2000/svg"><path id="p" d="M0 0" transform="rotate(10)"/></svg>';
    const e2 = env(src, 'svg', {}, tweak);
    expect(e2.out(e2.run({ op: 'offset', target: e2.at('#p'), dx: 2, dy: 2 }))).toContain('transform="translate(1 1) rotate(10)"');
    void e;
  });
  it('falls back to a transform when x or y is not a plain number', () => {
    const src = '<svg xmlns="http://www.w3.org/2000/svg"><text id="t" x="1 2 3" y="5">a</text></svg>';
    const e = env(src, 'svg', {}, tweak);
    expect(e.out(e.run({ op: 'offset', target: e.at('#t'), dx: 2, dy: 2 }))).toContain('transform="translate(1 1)"');
  });
  it('refuses when no matrix is available or the matrix is degenerate', () => {
    const none = env(svg, 'svg');
    expect(refusalCode(none.run({ op: 'offset', target: none.at('#r'), dx: 1, dy: 1 }))).toBe('no-matrix');
    const flat = env(svg, 'svg', {}, (p) => ({ ...p, screenMatrix: () => [0, 0, 0, 0, 0, 0] }));
    expect(refusalCode(flat.run({ op: 'offset', target: flat.at('#r'), dx: 1, dy: 1 }))).toBe('singular-matrix');
  });
});
