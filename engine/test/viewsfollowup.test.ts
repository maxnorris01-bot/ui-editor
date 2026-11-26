import { describe, expect, it } from 'vitest';
import { applyEdit } from '../src';
import { env } from './helpers';

// Small views follow-up: a Desktop edit of a non-ratio property after a view is customised, and a width declared only for the tablet range. Own small pages.
const page = (css: string) => `<html><head><style>\n${css}\n</style></head><body><h1 id="a">T</h1><div id="b">B</div></body></html>`;
const CSS = 'h1 { color: #123456; font-size: 32px; }\n@media (max-width: 640px) { h1 { font-size: 20px; } }\n#b { width: 600px; }\n@media (min-width: 769px) and (max-width: 1024px) { #b { width: 500px; } }';

describe('Desktop edit of a non-ratio property after a custom view', () => {
  it('is written as before when nothing is custom', () => {
    const e = env(page(CSS));
    expect(e.out(e.run({ op: 'set', target: e.at('#a'), properties: { color: '#aa0000' } }))).toContain('h1 { color: #aa0000;');
  });
  it('is not refused after a Phone custom colour: the view\'s rule is written again with !important', () => {
    let e = env(page(CSS));
    const r1 = e.run({ op: 'set', target: e.at('#a'), properties: { color: '#008000' }, environment: 'phone' });
    const s1 = e.out(r1);
    e = env(s1);
    const r2 = applyEdit(e.model, { op: 'set', target: e.at('#a'), properties: { color: '#aa0000' } }, e.probe, r1.ok ? r1.state! : undefined);
    expect(r2.ok).toBe(true);
    const out = e.out(r2);
    expect(out).toContain('color: #aa0000');
    const phone = '@media (max-width: 640px) { #a { color: #008000 !important; } }';
    expect(out).toContain(phone);
    expect(out.indexOf(phone)).toBeGreaterThan(out.indexOf('#a { color: #008000; }'));
  });
  it('works the same for a Tablet custom value, and for a property on another element', () => {
    let e = env(page(CSS));
    const r1 = e.run({ op: 'set', target: e.at('#a'), properties: { 'font-family': 'Georgia, serif' }, environment: 'tablet' });
    e = env(e.out(r1));
    const r2 = applyEdit(e.model, { op: 'set', target: e.at('#a'), properties: { 'font-family': 'Verdana, sans-serif' } }, e.probe, r1.ok ? r1.state! : undefined);
    expect(e.out(r2)).toContain('@media (min-width: 641px) and (max-width: 1024px) { #a { font-family: Georgia, serif !important; } }');
    const r3 = applyEdit(e.model, { op: 'set', target: e.at('#b'), properties: { color: '#aa0000' } }, e.probe, r1.ok ? r1.state! : undefined);
    expect(e.out(r3)).not.toContain('!important');
  });
});

describe('a width declared only for the tablet range', () => {
  it('a Desktop width edit scales it by the same ratio inside its own condition', () => {
    const e = env(page(CSS));
    const out = e.out(e.run({ op: 'set', target: e.at('#b'), properties: { width: '450px' } }));
    // (jsdom ignores media queries when it computes the old width, so the ratio itself is checked in the browser harness: N08)
    expect(out).toMatch(/@media \(min-width: 769px\) and \(max-width: 1024px\) \{ #b \{ width: [\d.]+px; max-width: 100%; \} \}/);
  });
});
