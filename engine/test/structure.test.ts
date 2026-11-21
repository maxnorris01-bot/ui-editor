import { describe, expect, it } from 'vitest';
import { applyEdit, createModel, listNotes } from '../src';
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

describe('remove', () => {
  const page = '<!DOCTYPE html>\n<html>\n<head><style>\n  .new-box-1 { width: 10px; }\n</style></head>\n<body>\n  <div id="keep">\n    <p id="a">One</p>\n    <p id="b" class="new-box-1">Two</p>\n    <p id="c">Three <b>x</b></p>\n  </div>\n  <span id="s1">A</span><span id="s2">B</span>\n</body>\n</html>\n';
  it('removes a line-formatted element with its lines', () => {
    const e = env(page);
    expect(e.out(e.run({ op: 'remove', target: e.at('#a') }))).toBe(page.replace('    <p id="a">One</p>\n', ''));
  });
  it('removes an inline element without inventing whitespace', () => {
    const e = env(page);
    expect(e.out(e.run({ op: 'remove', target: e.at('#s1') }))).toBe(page.replace('<span id="s1">A</span>', ''));
  });
  it('removes the element subtree and its engine rule', () => {
    const e = env(page);
    const r = e.run({ op: 'remove', target: e.at('#b') });
    expect(e.out(r)).toBe(page.replace('    <p id="b" class="new-box-1">Two</p>\n', '').replace('  .new-box-1 { width: 10px; }\n', ''));
  });
  it('keeps a rule that other elements still use', () => {
    const shared = page.replace('<p id="a">', '<p id="a" class="new-box-1">');
    const e = env(shared);
    expect(e.out(e.run({ op: 'remove', target: e.at('#b') }))).toBe(shared.replace('    <p id="b" class="new-box-1">Two</p>\n', ''));
  });
  it('refuses html, head, body, parser-made elements and an SVG root', () => {
    const e = env(page);
    for (const t of ['html', 'head', 'body']) {
      const r = e.run({ op: 'remove', target: e.model.primary.elements.findIndex((x) => x.ltag === t) });
      expect(!r.ok && r.refusal.code).toBe('protected-element');
    }
    const frag = env('<p id="a">x</p>');
    const body = frag.model.primary.elements.find((x) => x.ltag === 'body')!;
    expect((() => { const r = frag.run({ op: 'remove', target: body.index }); return !r.ok && r.refusal.code; })()).toBe('implied');
    const svg = env('<svg xmlns="http://www.w3.org/2000/svg"><rect id="r" width="1" height="1"/></svg>', 'svg');
    const r = svg.run({ op: 'remove', target: 0 });
    expect(!r.ok && r.refusal.code).toBe('protected-element');
  });
  it('refuses to remove an SVG element that something references', () => {
    const svg = '<svg xmlns="http://www.w3.org/2000/svg"><defs><linearGradient id="g"/></defs><rect id="r" fill="url(#g)" width="1" height="1"/></svg>';
    const e = env(svg, 'svg');
    const r = e.run({ op: 'remove', target: e.at('#g') });
    expect(!r.ok && r.refusal.code).toBe('referenced');
    expect(e.out(e.run({ op: 'remove', target: e.at('#r') }))).toBe(svg.replace('<rect id="r" fill="url(#g)" width="1" height="1"/>', ''));
  });
  it('moves the pins of an edit list: later elements shift, removed elements drop', () => {
    const e = env('<body><p id="a">1</p><p id="b">2</p><p id="c">3</p></body>');
    const pins = [
      { selector: '/html[1]/body[1]/p[2]', property: 'font-size', environment: 'phone' as const, value: '10px' },
      { selector: '/html[1]/body[1]/p[3]', property: 'font-size', environment: 'phone' as const, value: '20px' },
    ];
    const r = applyEdit(e.model, { op: 'remove', target: e.at('#a') }, e.probe, { pins });
    expect(r.ok && r.state?.pins).toEqual([
      { selector: '/html[1]/body[1]/p[1]', property: 'font-size', environment: 'phone', value: '10px' },
      { selector: '/html[1]/body[1]/p[2]', property: 'font-size', environment: 'phone', value: '20px' },
    ]);
    const r2 = applyEdit(e.model, { op: 'remove', target: e.at('#b') }, e.probe, { pins });
    expect(r2.ok && r2.state?.pins).toEqual([{ selector: '/html[1]/body[1]/p[2]', property: 'font-size', environment: 'phone', value: '20px' }]);
  });
});

describe('note', () => {
  const HDR = '<!-- Exported from UI Editor. Comments starting "NOTE FOR AI:" are the designer\'s instructions for the element that follows. Implement them. -->';
  const page = '<!DOCTYPE html>\n<html>\n<head><title>t</title></head>\n<body>\n  <h1 id="h">Title</h1>\n  <p id="p">One</p><p id="q">Two</p>\n</body>\n</html>\n';
  const notePage = (n: string) => page.replace('<!DOCTYPE html>\n', `<!DOCTYPE html>\n${HDR}\n`).replace('  <h1 id="h">', `  <!-- NOTE FOR AI: ${n} -->\n  <h1 id="h">`);
  it('adds a note on its own line, indented, and one header after the DOCTYPE', () => {
    const e = env(page);
    expect(e.out(e.run({ op: 'note', target: e.at('#h'), text: 'Make it bold' }))).toBe(notePage('Make it bold'));
  });
  it('writes a same-line note with no whitespace invented', () => {
    const e = env(page);
    const out = e.out(e.run({ op: 'note', target: e.at('#q'), text: 'x' }));
    expect(out).toContain('<p id="p">One</p><!-- NOTE FOR AI: x --><p id="q">Two</p>');
  });
  it('puts the header at the very start when there is no DOCTYPE, and after an XML declaration', () => {
    const e = env('<p id="a">x</p>\n');
    expect(e.out(e.run({ op: 'note', target: e.at('#a'), text: 'n' }))).toBe(`${HDR}\n<!-- NOTE FOR AI: n -->\n<p id="a">x</p>\n`);
    const svg = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg">\n  <rect id="r" width="1" height="1"/>\n</svg>\n';
    const s = env(svg, 'svg');
    expect(s.out(s.run({ op: 'note', target: s.at('#r'), text: 'n' }))).toBe(`<?xml version="1.0"?>\n${HDR}\n<svg xmlns="http://www.w3.org/2000/svg">\n  <!-- NOTE FOR AI: n -->\n  <rect id="r" width="1" height="1"/>\n</svg>\n`);
  });
  it('a second note adds no second header; replacing keeps one comment; empty text deletes', () => {
    const e = env(notePage('first'));
    const two = e.out(e.run({ op: 'note', target: e.at('#p'), text: 'second' }));
    expect(two.split(HDR).length).toBe(2);
    expect(e.out(e.run({ op: 'note', target: e.at('#h'), text: 'changed' }))).toBe(notePage('changed'));
    expect(e.out(e.run({ op: 'note', target: e.at('#h'), text: '' }))).toBe(page);
    expect(e.out(e.run({ op: 'note', target: e.at('#h'), text: '   ' }))).toBe(page);
  });
  it('deleting the last note returns the original bytes; deleting a missing note changes nothing', () => {
    const e = env(page);
    const r = e.run({ op: 'note', target: e.at('#p'), text: '' });
    expect(r.ok && r.patches.length).toBe(0);
    const withNote = e.out(e.run({ op: 'note', target: e.at('#p'), text: 'tmp' }));
    const e2 = env(withNote);
    expect(e2.out(e2.run({ op: 'note', target: e2.at('#p'), text: '' }))).toBe(page);
  });
  it('a page note sits right after the header; deleting both notes returns the original', () => {
    const e = env(page);
    const out = e.out(e.run({ op: 'note', target: 'page', text: 'Whole page' }));
    expect(out).toBe(page.replace('<!DOCTYPE html>\n', `<!DOCTYPE html>\n${HDR}\n<!-- NOTE FOR AI (whole page): Whole page -->\n`));
    const e2 = env(out);
    const withEl = e2.out(e2.run({ op: 'note', target: e2.at('#h'), text: 'el' }));
    expect(withEl.split(HDR).length).toBe(2);
    const e3 = env(withEl);
    const noPage = e3.out(e3.run({ op: 'note', target: 'page', text: '' }));
    expect(noPage).toBe(notePage('el'));
    const e4 = env(noPage);
    expect(e4.out(e4.run({ op: 'note', target: e4.at('#h'), text: '' }))).toBe(page);
  });
  it('neutralises every hyphen run; the comment cannot end early', () => {
    const e = env(page);
    for (const [t, want] of [['-->', '- ->'], ['--', '- -'], ['--!>', '- -!>'], ['<!--', '<!- -'], ['a---b', 'a- - -b'], ['ends-', 'ends-'], ['> lead', '> lead'], ['-> lead', '-> lead']] as const) {
      const out = e.out(e.run({ op: 'note', target: e.at('#h'), text: t }));
      expect(out).toContain(`<!-- NOTE FOR AI: ${want} -->\n  <h1`);
      const m = createModel(out, 'html');
      expect(m.primary.comments.filter((c) => c.data.startsWith(' NOTE FOR AI: ')).length).toBe(1);
      expect(m.primary.elements.length).toBe(e.model.primary.elements.length);
    }
  });
  it('keeps hostile markup inert and line breaks as typed', () => {
    const e = env(page);
    const out = e.out(e.run({ op: 'note', target: e.at('#h'), text: '<script>alert(1)</script> </style> "><img src=x onerror=1> &amp;\nsecond line' }));
    const m = createModel(out, 'html');
    expect(m.primary.elements.length).toBe(e.model.primary.elements.length);
    expect(m.primary.comments.some((c) => c.data.includes('second line'))).toBe(true);
  });
  it('refuses parser-made elements', () => {
    const e = env('<p id="a">x</p>');
    const body = e.model.primary.elements.find((x) => x.ltag === 'body')!;
    const r = e.run({ op: 'note', target: body.index, text: 'n' });
    expect(!r.ok && r.refusal.code).toBe('implied');
  });
  it('listNotes reads notes, the page note, and elements', () => {
    const src = notePage('hello').replace('<!DOCTYPE html>\n' + HDR + '\n', '<!DOCTYPE html>\n' + HDR + '\n<!-- NOTE FOR AI (whole page): about the page -->\n');
    const m = createModel(src, 'html');
    const l = listNotes(m);
    expect(l.page).toEqual({ text: 'about the page' });
    expect(l.notes.map((n) => [n.path, n.text])).toEqual([['/html[1]/body[1]/h1[1]', 'hello']]);
    expect(listNotes(createModel(page, 'html'))).toEqual({ page: null, notes: [] });
  });
  it('a note travels with its element when it is reordered, and with a remove', () => {
    const src = '<!DOCTYPE html>\n<html>\n<body>\n  <ul>\n    <li id="a">A</li>\n    <li id="b">B</li>\n  </ul>\n</body>\n</html>\n';
    const e = env(src);
    const noted = e.out(e.run({ op: 'note', target: e.at('#b'), text: 'B note' }));
    const e2 = env(noted);
    const moved = e2.out(e2.run({ op: 'reorder', target: e2.at('#b'), placement: 'before', sibling: e2.at('#a') }));
    expect(moved).toBe(`<!DOCTYPE html>\n${HDR}\n<html>\n<body>\n  <ul>\n    <!-- NOTE FOR AI: B note -->\n    <li id="b">B</li>\n    <li id="a">A</li>\n  </ul>\n</body>\n</html>\n`);
    const e3 = env(noted);
    expect(e3.out(e3.run({ op: 'remove', target: e3.at('#b') }))).toBe(src.replace('    <li id="b">B</li>\n', ''));
  });
  it('an insert-before-the-note style reorder lands before the neighbour\'s note too', () => {
    const src = '<html>\n<body>\n  <ul>\n    <li id="a">A</li>\n    <li id="b">B</li>\n    <li id="c">C</li>\n  </ul>\n</body>\n</html>\n';
    const e = env(src);
    const withNote = e.out(e.run({ op: 'note', target: e.at('#a'), text: 'A note' }));
    const e2 = env(withNote);
    const out = e2.out(e2.run({ op: 'reorder', target: e2.at('#c'), placement: 'before', sibling: e2.at('#a') }));
    expect(out.indexOf('<li id="c">')).toBeLessThan(out.indexOf('<!-- NOTE FOR AI: A note -->'));
  });
});
