import { describe, expect, it } from 'vitest';
import { applyEdit, createModel, describe as describePath, listNotes } from '../src';
import type { Pin } from '../src';
import { env } from './helpers';

// Hardening: reorder remaps pins, remove takes the engine's rules, line endings follow the file, neighbour selectors. These tests use
// their own small pages, never the locked fixtures.

const pin = (selector: string, value = '10px'): Pin => ({ selector, property: 'font-size', environment: 'phone', value });

describe('reorder remaps pins', () => {
  const page = '<html><body>\n<div id="w">\n<section id="s1"><p id="a1">1</p></section>\n<section id="s2"><p id="a2">2</p></section>\n<section id="s3"><p id="a3">3</p></section>\n</div>\n<p id="x">x</p><p id="y">y</p><p id="z">z</p>\n</body></html>';
  const pathOf = (e: ReturnType<typeof env>, sel: string) => describePath(e.model, e.at(sel));
  const run = (e: ReturnType<typeof env>, target: string, placement: 'before' | 'after', sibling: string, pins: Pin[]) => {
    const r = applyEdit(e.model, { op: 'reorder', target: e.at(target), placement, sibling: e.at(sibling) }, e.probe, { pins });
    if (!r.ok) throw new Error(r.refusal.message);
    return r;
  };
  /** After the move the pinned element must still be the same element: resolve the new path in the new model. */
  const check = (src: string, target: string, placement: 'before' | 'after', sibling: string, pinned: string[]) => {
    const e = env(src);
    const pins = pinned.map((s) => pin(pathOf(e, `#${s}`), `${s}px`));
    const r = run(e, target, placement, sibling, pins);
    const next = createModel(e.files(r)['document.html']!, 'html');
    const sel = (id: string) => next.primary.elements.findIndex((x) => x.attrs.some((a) => a.lname === 'id' && a.value === id));
    pinned.forEach((id, k) => expect(r.state!.pins[k]!.selector).toBe(describePath(next, sel(id))));
    return r.state!.pins;
  };
  it('follows a moved element, up and down, to first and to last', () => {
    check(page, '#y', 'before', '#x', ['y']);
    check(page, '#x', 'after', '#y', ['x']);
    check(page, '#z', 'before', '#x', ['z']);
    check(page, '#x', 'after', '#z', ['x']);
  });
  it('follows the siblings it jumps over', () => {
    check(page, '#z', 'before', '#x', ['x', 'y']);
    check(page, '#x', 'after', '#z', ['y', 'z']);
  });
  it('follows descendants of the moved element and of the jumped-over ones', () => {
    check(page, '#s1', 'after', '#s3', ['a1', 'a2', 'a3']);
    check(page, '#s3', 'before', '#s1', ['a1', 'a3']);
  });
  it('leaves pins of elements outside the move alone and an unmoved reorder unchanged', () => {
    const e = env(page);
    const p = pin(pathOf(e, '#x'));
    const r = run(e, '#s1', 'after', '#s3', [p]);
    expect(r.state!.pins[0]!.selector).toBe(p.selector);
    const e2 = env(page);
    const r2 = applyEdit(e2.model, { op: 'reorder', target: e2.at('#x'), placement: 'before', sibling: e2.at('#y') }, e2.probe, { pins: [p] });
    expect(r2.ok && r2.patches.length).toBe(0);
  });
  it('replaying a list gives the same pins and bytes', () => {
    const go = () => {
      const e = env(page);
      const pins = [pin(pathOf(e, '#a2'))];
      const r1 = run(e, '#s1', 'after', '#s2', pins);
      const f1 = e.files(r1)['document.html']!;
      const e2 = env(f1);
      const r2 = applyEdit(e2.model, { op: 'reorder', target: e2.at('#z'), placement: 'before', sibling: e2.at('#x') }, e2.probe, r1.state!);
      return [f1, r2.ok ? e2.files(r2)['document.html'] : '', JSON.stringify(r2.ok ? r2.state : null)];
    };
    expect(go()).toEqual(go());
  });
  it('keeps the note with the moved element and the pin with both', () => {
    const e = env('<html><body>\n<p id="a">a</p>\n<!-- NOTE FOR AI: about b -->\n<p id="b">b</p>\n</body></html>');
    const r = run(e, '#b', 'before', '#a', [pin(pathOf(e, '#b'))]);
    const out = e.files(r)['document.html']!;
    expect(out).toBe('<html><body>\n<!-- NOTE FOR AI: about b -->\n<p id="b">b</p>\n<p id="a">a</p>\n</body></html>');
    expect(r.state!.pins[0]!.selector).toBe('/html[1]/body[1]/p[1]');
    expect(listNotes(createModel(out, 'html')).notes[0]!.path).toBe('/html[1]/body[1]/p[1]');
  });
});

describe('remove takes the engine-written rules of an inserted element', () => {
  const page = '<!DOCTYPE html>\n<html>\n<head>\n  <style>\n    body { margin: 0; }\n    p { font-size: 16px; }\n    @media (max-width: 640px) {\n      p { font-size: 14px; }\n    }\n  </style>\n</head>\n<body>\n  <p id="a">A</p>\n  <p id="b">B</p>\n</body>\n</html>\n';
  /** Apply a list of edits one after another the way the editor would (a new model from the patched text each time). */
  const steps = (src: string, list: (Parameters<typeof applyEdit>[1] | ((e: ReturnType<typeof env>) => Parameters<typeof applyEdit>[1]))[], comps: Record<string, string> = {}) => {
    let files: Record<string, string> = { 'document.html': src, ...comps };
    let state = { pins: [] as Pin[] };
    for (const item of list) {
      const e = env(files['document.html']!, 'html', Object.fromEntries(Object.keys(comps).map((k) => [k, files[k]!])));
      const edit = typeof item === 'function' ? item(e) : item;
      const r = applyEdit(e.model, edit, e.probe, state);
      if (!r.ok) throw new Error(`${edit.op}: ${r.refusal.code}: ${r.refusal.message}`);
      files = { ...files, ...e.files(r) };
      state = r.state ?? state;
    }
    return files;
  };
  const sel = (s: string) => (e: ReturnType<typeof env>) => e.at(s);
  it('insert, any mix of set edits, remove: the original bytes', () => {
    const out = steps(page, [
      (e) => ({ op: 'insert', kind: 'text', anchor: e.at('#a'), placement: 'after' }),
      (e) => ({ op: 'set', target: e.at('.new-text-1'), properties: { 'font-size': '24px' } }),
      (e) => ({ op: 'set', target: e.at('.new-text-1'), properties: { width: '300px' } }),
      (e) => ({ op: 'set', target: e.at('.new-text-1'), properties: { padding: '10px' } }),
      (e) => ({ op: 'set', target: e.at('.new-text-1'), properties: { margin: '4px' } }),
      (e) => ({ op: 'set', target: e.at('.new-text-1'), properties: { color: '#ff0000' } }),
      (e) => ({ op: 'set', target: e.at('.new-text-1'), properties: { width: '150px' }, environment: 'desktop', link: false }),
      (e) => ({ op: 'set', target: e.at('.new-text-1'), properties: { color: '#00aa00' }, environment: 'phone', link: false }),
      (e) => ({ op: 'remove', target: e.at('.new-text-1') }),
    ]);
    expect(out['document.html']).toBe(page);
  });
  it('removes only the removed element\'s rules when two are inserted', () => {
    const both = steps(page, [
      (e) => ({ op: 'insert', kind: 'rect', anchor: e.at('#a'), placement: 'after' }),
      (e) => ({ op: 'insert', kind: 'text', anchor: e.at('#b'), placement: 'after' }),
      (e) => ({ op: 'set', target: e.at('.new-box-1'), properties: { width: '300px' } }),
      (e) => ({ op: 'set', target: e.at('.new-text-1'), properties: { 'font-size': '30px' } }),
      (e) => ({ op: 'remove', target: e.at('.new-text-1') }),
    ]);
    const without = steps(page, [
      (e) => ({ op: 'insert', kind: 'rect', anchor: e.at('#a'), placement: 'after' }),
      (e) => ({ op: 'set', target: e.at('.new-box-1'), properties: { width: '300px' } }),
    ]);
    expect(both['document.html']).toBe(without['document.html']);
  });
  it('a page-authored rule with the same class name is never deleted', () => {
    const src = '<html><head><style>\n.new-box-1 { width: 40px; }\n</style></head><body>\n<div id="x" class="new-box-1"></div>\n</body></html>';
    const e = env(src);
    const r = applyEdit(e.model, { op: 'remove', target: e.at('#x') }, e.probe);
    expect(e.files(r)['document.html']).toBe(src.replace('<div id="x" class="new-box-1"></div>\n', ''));
  });
  it('an original element keeps the override rules written for it (they cannot be told from the page\'s own)', () => {
    const out = steps(page, [(e) => ({ op: 'set', target: e.at('#a'), properties: { 'font-size': '30px' } }), sel('#a') && ((e) => ({ op: 'remove', target: e.at('#a') }))]);
    expect(out['document.html']).toContain('#a { font-size: 30px; }');
    expect(out['document.html']).not.toContain('<p id="a">');
  });
});

describe('line endings follow the file', () => {
  const crlf = (t: string) => t.replace(/\n/g, '\r\n');
  const lone = (t: string) => (t.match(/(?<!\r)\n/g) ?? []).length;
  const page = crlf('<!DOCTYPE html>\n<html>\n<head>\n  <style>\n    body { margin: 0; }\n  </style>\n</head>\n<body>\n  <p id="a">A</p>\n  <p id="b">B</p>\n</body>\n</html>\n');
  it('insert, text, note (with line breaks), page note and the appended rule are CRLF in a CRLF file', () => {
    let e = env(page);
    let r = e.run({ op: 'insert', kind: 'rect', anchor: e.at('#a'), placement: 'after' });
    let src = e.out(r);
    expect(lone(src)).toBe(0);
    expect(src).toContain('  <p id="a">A</p>\r\n  <div class="new-box-1"></div>\r\n  <p id="b">');
    e = env(src); r = e.run({ op: 'note', target: e.at('#b'), text: 'one\ntwo' }); src = e.out(r);
    e = env(src); r = e.run({ op: 'note', target: 'page', text: 'page\nnote' }); src = e.out(r);
    e = env(src); r = e.run({ op: 'text', target: e.at('#a'), text: 'x\ny' }); src = e.out(r);
    expect(lone(src)).toBe(0);
    expect(src).toContain('<p id="a">x\r\ny</p>');
    const l = listNotes(createModel(src, 'html'));
    expect(l.page).toEqual({ text: 'page\nnote' });
    expect(l.notes[0]!.text).toBe('one\ntwo');
  });
  it('an appended responsive rule is CRLF too (size, spacing and font edits)', () => {
    const e = env('<html><head><style>\r\np { font-size: 16px; }\r\n@media (max-width: 640px) {\r\n p { font-size: 14px; }\r\n}\r\n</style></head><body>\r\n<p id="a">A</p>\r\n</body></html>\r\n');
    const r = e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '24px' } });
    expect(lone(e.out(r))).toBe(0);
  });
  it('a mixed file takes the nearest line break and is never normalised', () => {
    const src = '<!DOCTYPE html>\n<html>\n<head>\n<style>\nbody { margin: 0; }\n</style>\n</head>\n<body>\n<p id="first">F</p>\n<p id="mid">M</p>\r\n<p id="last">L</p>\r\n</body>\r\n</html>\r\n';
    let e = env(src);
    let out = e.out(e.run({ op: 'insert', kind: 'rect', anchor: e.at('#first'), placement: 'after' }));
    expect(out).toContain('<p id="first">F</p>\n<div class="new-box-1"></div>\n<p id="mid">');
    e = env(out);
    out = e.out(e.run({ op: 'insert', kind: 'text', anchor: e.at('#last'), placement: 'after' }));
    expect(out).toContain('<p id="last">L</p>\r\n<p class="new-text-1">Text</p>\r\n</body>');
    expect(out).toContain('</style>\n</head>');
    expect(out.replace(/\.new-box-1 \{[^}]*\}\n/, '').replace(/\.new-text-1 \{[^}]*\}\n/, '').replace('<div class="new-box-1"></div>\n', '').replace('<p class="new-text-1">Text</p>\r\n', '')).toBe(src);
  });
  it('no final newline is invented, and insert then remove restores a CRLF file with none', () => {
    const css = 'p { color: red; }\r\nq { color: blue; }'; // CRLF, ends with "}" and no break
    const html = '<html><head><link rel="stylesheet" href="a.css"></head><body>\r\n<p id="a">A</p>\r\n</body></html>';
    const e = env(html, 'html', { 'a.css': css });
    const r = e.run({ op: 'insert', kind: 'rect', anchor: e.at('#a'), placement: 'after' });
    const f = e.files(r);
    expect(f['a.css']!.endsWith('\r\n')).toBe(false);
    expect(lone(f['a.css']!)).toBe(0);
    const e2 = env(f['document.html']!, 'html', { 'a.css': f['a.css']! });
    const back = e2.files(e2.run({ op: 'remove', target: e2.at('.new-box-1') }));
    expect(back['document.html']).toBe(html);
    expect(back['a.css']).toBe(css);
  });
  it('a file with no line breaks uses LF; a mostly-CRLF file with the edit before its first break uses CRLF', () => {
    const e = env('<p id="a">x</p>');
    expect(e.out(e.run({ op: 'note', target: e.at('#a'), text: 'a\nb' }))).toContain('a\nb');
    const c = env('<p id="a">x</p>\r\n<p id="b">y</p>\r\n');
    expect(lone(c.out(c.run({ op: 'note', target: c.at('#a'), text: 'a\nb' })))).toBe(0);
  });
});
