// Measurement helpers for the real-page check (docs/realpage-rules.md). Same as page-measure.js
// except that reorder checks use `expected.order.key` instead of ids. Plain JS, evaluated as text.
(function () {
  function walk(doc) {
    var out = [];
    (function rec(e) { out.push(e); for (var i = 0; i < e.children.length; i++) rec(e.children[i]); })(doc.documentElement);
    return out;
  }
  function rect(e) { var r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }
  function q(doc, sel) { return doc.querySelector(sel); }
  function keyOf(child, key) {
    var c = child;
    if (key.selector) c = child.querySelector(key.selector);
    if (!c) return null;
    if (key.attr === 'text') return c.textContent.replace(/\s+/g, ' ').trim().slice(0, key.length || 100000);
    return [].concat(key.attr).map(function (n) { return c.getAttribute(n); }).join(',');
  }
  function specMeasure(doc, expected) {
    var view = doc.defaultView;
    var out = { computed: [], bbox: null, order: null };
    (expected.computed || []).forEach(function (c) {
      var el = q(doc, c.selector);
      out.computed.push({ selector: c.selector, property: c.property, value: el ? view.getComputedStyle(el).getPropertyValue(c.property) : null });
    });
    if (expected.bboxDelta) { var el = q(doc, expected.bboxDelta.selector); out.bbox = el ? rect(el) : null; }
    if (expected.order) {
      var p = q(doc, expected.order.parent);
      out.order = p ? Array.prototype.map.call(p.children, function (c) { return keyOf(c, expected.order.key); }) : null;
    }
    return out;
  }
  function fullDump(doc, targetSel, order) {
    var view = doc.defaultView;
    var els = walk(doc);
    var idx = new Map(); els.forEach(function (e, i) { idx.set(e, i); });
    var names = []; var cs0 = view.getComputedStyle(doc.documentElement);
    for (var i = 0; i < cs0.length; i++) names.push(cs0[i]);
    var p = order ? q(doc, order.parent) : null;
    var rows = els.map(function (e) {
      var cs = view.getComputedStyle(e);
      var props = names.map(function (n) { return cs.getPropertyValue(n); });
      return { tag: e.localName, id: e.getAttribute('id'), parent: e.parentElement ? idx.get(e.parentElement) : -1, rect: rect(e), props: props,
        key: p && e.parentElement === p ? keyOf(e, order.key) : null };
    });
    var t = targetSel ? q(doc, targetSel) : null;
    return { names: names, rows: rows, target: t ? idx.get(t) : -1, parent: p ? idx.get(p) : -1,
      parserErrors: doc.getElementsByTagName('parsererror').length, rootName: doc.documentElement.localName };
  }
  window.GateMeasure = { walk: walk, specMeasure: specMeasure, fullDump: fullDump };
})();
