import { describe, expect, it } from 'vitest';
import { createModel } from '../src';
import { env } from './helpers';

// Content edits (insert, text, remove, note). These tests use their own small pages, never the locked fixtures.

describe('text', () => {
  const page = '<!DOCTYPE html>\n<html>\n<head><title>t</title></head>\n<body>\n  <p id="a">Hello</p>\n  <section id="pad">\n    padded\n  </section>\n  <div id="mix"><b>x</b></div>\n  <pre id="pre">a</pre>\n  <p id="c">has <!-- inner -->comment</p>\n  <br id="br">\n</body>\n</html>\n';
  it('replaces only the text and escapes & < >', () => {
    const e = env(page);
    const r = e.run({ op: 'text', target: e.at('#a'), text: 'Q&A <b> "x" > 1' });
    expect(r.ok).toBe(true);
    expect(e.out(r)).toBe(page.replace('Hello', 'Q&amp;A &lt;b&gt; "x" &gt; 1'));
  });
  it('keeps the whitespace around the text', () => {
    const e = env(page);
    const r = e.run({ op: 'text', target: e.at('#pad'), text: 'new' });
    expect(e.out(r)).toBe(page.replace('padded', 'new'));
  });
  it('allows empty text', () => {
    const e = env(page);
    expect(e.out(e.run({ op: 'text', target: e.at('#a'), text: '' }))).toBe(page.replace('>Hello<', '><'));
  });
  it('writes hostile strings as literal text', () => {
    const e = env(page);
    for (const t of ['<script>alert(1)</script>', '</style>', '"><img src=x onerror=1>', '&amp;', '-->']) {
      const r = e.run({ op: 'text', target: e.at('#a'), text: t });
      expect(r.ok).toBe(true);
      const out = e.out(r);
      const m = createModel(out, 'html');
      expect(m.primary.elements.length).toBe(e.model.primary.elements.length);
      expect(out).not.toContain('<script');
    }
  });
  it('normalises carriage returns and refuses NUL', () => {
    const e = env(page);
    expect(e.out(e.run({ op: 'text', target: e.at('#a'), text: 'a\r\nb' }))).toContain('>a\nb<');
    const r = e.run({ op: 'text', target: e.at('#a'), text: 'a\u0000b' });
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal.code).toBe('invalid-character');
  });
  it('refuses mixed content, raw text, comments inside, void elements', () => {
    const e = env(page);
    const code = (sel: string) => { const r = e.run({ op: 'text', target: e.at(sel), text: 'x' }); return r.ok ? 'ok' : r.refusal.code; };
    expect(code('#mix')).toBe('mixed-content');
    expect(code('#pre')).toBe('raw-text-element');
    expect(code('#c')).toBe('has-comment');
    expect(code('#br')).toBe('void-element');
  });
  it('refuses an element the parser created', () => {
    const e = env('<p id="a">x</p>');
    const body = e.model.primary.elements.find((x) => x.ltag === 'body')!;
    const r = e.run({ op: 'text', target: body.index, text: 'x' });
    expect(!r.ok && r.refusal.code).toBe('implied');
  });
  it('works on SVG text and keeps the file well-formed', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><text id="t" x="1" y="2">Old</text></svg>';
    const e = env(svg, 'svg');
    const r = e.run({ op: 'text', target: e.at('#t'), text: 'A & B <c>' });
    expect(e.out(r)).toBe(svg.replace('Old', 'A &amp; B &lt;c&gt;'));
  });
  it('is a no-op when the text is already that text', () => {
    const e = env(page);
    const r = e.run({ op: 'text', target: e.at('#a'), text: 'Hello' });
    expect(r.ok && r.patches.length).toBe(0);
  });
  it('unknown edit kinds are refused, not guessed', () => {
    const e = env(page);
    const r = e.run({ op: 'explode', target: 0 } as never);
    expect(!r.ok && r.refusal.code).toBe('unknown-edit');
  });
});
