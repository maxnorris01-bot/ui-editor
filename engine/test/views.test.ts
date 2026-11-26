import { describe, expect, it } from 'vitest';
import { applyEdit, createModel, customEdits, envCondition, chainEnv, resetView, tabletMax, listUnlinked } from '../src';
import type { Edit } from '../src';
import { env } from './helpers';

// Small views: Tablet as a third environment, Phone and Tablet edits that stay in their own view, Reset. Own small pages, never the locked fixtures.
const page = (css: string, body = '<h1 id="a">T</h1><p id="b">P</p>') => `<html><head><style>\n${css}\n</style></head><body>${body}</body></html>`;
const CSS = 'h1 { font-size: 32px; }\n@media (max-width: 640px) { h1 { font-size: 20px; } }';

describe('ranges', () => {
  it('tabletMax is the largest max-width condition above 768 and at most 1100, else 1024', () => {
    expect(tabletMax(createModel(page(CSS), 'html'))).toBe(1024);
    expect(tabletMax(createModel(page(`${CSS}\n@media (max-width: 900px) { h1 { color: red; } }`), 'html'))).toBe(900);
    expect(tabletMax(createModel(page(`${CSS}\n@media (max-width: 1200px) { h1 { color: red; } }\n.x { max-width: 1000px; }`), 'html'))).toBe(1024);
  });
  it('envCondition and chainEnv know the Tablet range', () => {
    expect(envCondition('tablet', 640, 1024)).toBe('@media (min-width: 641px) and (max-width: 1024px)');
    expect(envCondition('tablet', 767.98, 1024)).toBe('@media (min-width: 768px) and (max-width: 1024px)');
    expect(envCondition('phone', 640)).toBe('@media (max-width: 640px)');
    expect(chainEnv([envCondition('tablet', 640, 1024)], 640, 1024)).toBe('tablet');
    expect(chainEnv(['@media (max-width: 900px)'], 640, 1024)).toBe('both');
    expect(chainEnv(['@media (min-width: 641px)'], 640, 1024)).toBe('desktop');
    // without the tablet top the old two-view answer is given
    expect(chainEnv([envCondition('tablet', 640, 1024)], 640)).toBe('desktop');
  });
});

describe('custom Phone and Tablet edits', () => {
  it('a Tablet edit is written inside the tablet range only and pinned', () => {
    const e = env(page(CSS));
    const r = e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '40px' }, environment: 'tablet' });
    expect(e.out(r)).toContain('@media (min-width: 641px) and (max-width: 1024px) { #a { font-size: 40px; } }');
    expect(r.ok && listUnlinked(r.state!)).toEqual([{ selector: '/html[1]/body[1]/h1[1]', property: 'font-size', environment: 'tablet', value: '40px' }]);
  });
  it('the link flag is ignored in Phone and Tablet', () => {
    const a = env(page(CSS)), b = env(page(CSS));
    const x = a.out(a.run({ op: 'set', target: a.at('#a'), properties: { 'font-size': '18px' }, environment: 'phone', link: true }));
    const y = b.out(b.run({ op: 'set', target: b.at('#a'), properties: { 'font-size': '18px' }, environment: 'phone', link: false }));
    expect(x).toBe(y);
    expect(x).toContain('@media (max-width: 640px) { #a { font-size: 18px; } }');
    expect(x).not.toContain('#a { font-size: 28');
  });
  it('a page whose own phone breakpoint is 768 has no tablet range: a Tablet edit is refused, a Phone edit is not', () => {
    const e = env(page('h1 { font-size: 32px; }\n@media (max-width: 768px) { h1 { font-size: 20px; } }'));
    const r = e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '40px' }, environment: 'tablet' });
    expect(!r.ok && r.refusal.code).toBe('tablet-covered-by-phone');
    expect(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '18px' }, environment: 'phone' }).ok).toBe(true);
  });
  it('a Desktop edit after a Tablet custom value keeps it in force (the view\'s rule is written again)', () => {
    let e = env(page(CSS));
    let r = e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '40px' }, environment: 'tablet' });
    const s1 = e.out(r);
    e = env(s1);
    r = applyEdit(e.model, { op: 'set', target: e.at('#a'), properties: { 'font-size': '48px' } }, e.probe, r.ok ? r.state! : undefined);
    const out = e.out(r);
    const lastTablet = out.lastIndexOf('@media (min-width: 641px) and (max-width: 1024px) { #a { font-size: 40px; } }');
    expect(lastTablet).toBeGreaterThan(out.indexOf('#a { font-size: 48px; }'));
  });
  it('a Desktop edit with no custom value writes what it always did', () => {
    const e = env(page(CSS));
    expect(e.out(e.run({ op: 'set', target: e.at('#a'), properties: { 'font-size': '48px' } }))).toContain('#a { font-size: 48px; }');
  });
  it('SVG ignores the environment', () => {
    const e = env('<svg xmlns="http://www.w3.org/2000/svg"><rect id="r" width="1" height="1" fill="red"/></svg>', 'svg');
    expect(e.run({ op: 'set', target: e.at('#r'), properties: { fill: 'blue' }, environment: 'tablet' }).ok).toBe(true);
  });
});

describe('resetView and customEdits', () => {
  const edits: Edit[] = [
    { op: 'set', target: 1, properties: { 'font-size': '40px' }, environment: 'tablet' },
    { op: 'set', target: 1, properties: { 'font-size': '18px' }, environment: 'phone' },
    { op: 'set', target: 1, properties: { 'font-size': '48px' } },
    { op: 'offset', target: 2, dx: 1, dy: 1, environment: 'tablet', link: false },
    { op: 'note', target: 1, text: 'n', environment: 'tablet' },
    { op: 'insert', kind: 'rect', anchor: 1, placement: 'after' },
  ];
  it('drops the element edits of the view only, never content edits or Desktop edits', () => {
    expect(resetView(edits, 'tablet')).toEqual([edits[1], edits[2], edits[4], edits[5]]);
    expect(resetView(edits, 'phone')).toEqual([edits[0], edits[2], edits[3], edits[4], edits[5]]);
    expect(resetView(resetView(edits, 'phone'), 'tablet')).toEqual([edits[2], edits[4], edits[5]]);
  });
  it('customEdits lists what would be dropped; Desktop is not offered', () => {
    expect(customEdits(edits, 'tablet')).toEqual([edits[0], edits[3]]);
    expect(customEdits(edits, 'phone')).toEqual([edits[1]]);
    expect(customEdits(edits, 'desktop')).toEqual([]);
    expect(resetView(edits, 'desktop')).toBe(edits);
    expect(resetView([], 'tablet')).toEqual([]);
  });
});
