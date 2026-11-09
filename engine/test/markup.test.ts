import { describe, expect, it } from 'vitest';
import { contentEnd, parseMarkup, scanAttrs } from '../src/markup';

describe('scanAttrs', () => {
  it('keeps spelling, quotes and offsets', () => {
    const tag = `<DIV ID=intro CLASS='a b' STYLE="x:y" hidden data-x = "1">`;
    const attrs = scanAttrs(tag, 4, tag.length);
    expect(attrs.map((a) => [a.name, a.value, a.quote])).toEqual([
      ['ID', 'intro', ''],
      ['CLASS', 'a b', "'"],
      ['STYLE', 'x:y', '"'],
      ['hidden', null, ''],
      ['data-x', '1', '"'],
    ]);
    const style = attrs[2]!;
    expect(tag.slice(style.valueStart, style.valueEnd)).toBe('x:y');
    expect(attrs[0]!.lname).toBe('id');
  });
  it('stops at a self-closing slash', () => {
    const tag = '<rect x="1" y="2"/>';
    expect(scanAttrs(tag, 5, tag.length).map((a) => a.name)).toEqual(['x', 'y']);
  });
});

describe('parseMarkup html', () => {
  const src = '<!DOCTYPE html>\n<HTML>\n<BODY>\n<UL ID=steps>\n\t<li id=s1>One</li>\n    <LI ID=s2>Two\n\t<li id=s3>Three\n</UL>\n<p id=a>A\n<p id=b>B\n</BODY>\n</HTML>\n';
  const m = parseMarkup('t.html', src, 'html');
  const byId = (id: string) => m.elements.find((e) => e.attrs.some((a) => a.lname === 'id' && a.value === id))!;

  it('keeps raw tag case and marks implied elements', () => {
    expect(m.elements.map((e) => e.tag).slice(0, 3)).toEqual(['HTML', 'head', 'BODY']);
    expect(m.elements[1]!.implied).toBe(true);
    expect(m.elements[0]!.implied).toBe(false);
  });
  it('gives implied-end elements a range that includes trailing whitespace, trimmed by contentEnd', () => {
    const s2 = byId('s2');
    expect(s2.endTagStart).toBe(-1);
    expect(src.slice(s2.start, s2.end)).toBe('<LI ID=s2>Two\n\t');
    expect(src.slice(s2.start, contentEnd(src, s2))).toBe('<LI ID=s2>Two');
    const s3 = byId('s3');
    expect(src.slice(s3.start, contentEnd(src, s3))).toBe('<li id=s3>Three');
  });
  it('nests unclosed p elements as siblings', () => {
    expect(byId('a').parent).toBe(byId('b').parent);
  });
  it('indexes elements in pre-order', () => {
    m.elements.forEach((e, i) => expect(e.index).toBe(i));
  });
});

describe('parseMarkup svg', () => {
  const src = '<?xml version="1.0"?>\n<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 10 10">\n  <linearGradient id="g"><stop offset="0"/></linearGradient>\n  <rect id="r" width="1" height="2"/>\n</svg>\n';
  const m = parseMarkup('t.svg', src, 'svg');
  it('starts at the svg root and keeps camelCase names and attribute order', () => {
    expect(m.elements[0]!.tag).toBe('svg');
    expect(m.elements.map((e) => e.tag)).toEqual(['svg', 'linearGradient', 'stop', 'rect']);
    expect(m.elements[0]!.attrs.map((a) => a.name)).toEqual(['xmlns', 'viewBox']);
    expect(m.elements[3]!.namespace).toBe('svg');
    expect(m.elements[3]!.selfClosing).toBe(true);
  });
});
