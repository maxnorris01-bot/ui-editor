/**
 * Approximate selector specificity as a comparable number (a*1e6 + b*1e3 + c).
 *
 * Limits: `:is()/:not()/:has()` contents are counted as ordinary compound parts (the spec takes the
 * most specific argument); `:where()` counts zero. Good enough to decide whether an added
 * declaration would win over another matching rule; anything it cannot rank leads to a safe
 * fallback (inline style) rather than a guess.
 */
export function specificity(selector: string): number {
  let s = selector.replace(/\\./g, 'x');
  s = s.replace(/"[^"]*"|'[^']*'/g, '""');
  s = s.replace(/:where\([^)]*\)/g, '');
  let a = 0;
  let b = 0;
  let c = 0;
  s = s.replace(/\[[^\]]*\]/g, () => (b++, ' '));
  s = s.replace(/#[\w-]+/g, () => (a++, ' '));
  s = s.replace(/\.[\w-]+/g, () => (b++, ' '));
  s = s.replace(/::[\w-]+(\([^)]*\))?/g, () => (c++, ' '));
  // :not/:is/:has arguments were already counted by the passes above; only the pseudo itself is dropped.
  s = s.replace(/:(not|is|has)\([^)]*\)/g, ' ');
  s = s.replace(/:[\w-]+(\([^)]*\))?/g, () => (b++, ' '));
  s = s.replace(/(^|[\s>+~,(])([a-zA-Z][\w-]*)/g, () => (c++, ' '));
  return a * 1e6 + b * 1e3 + c;
}
