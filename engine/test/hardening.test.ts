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
