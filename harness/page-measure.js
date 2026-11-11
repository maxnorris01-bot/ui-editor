// Measurement helpers. Plain JS on purpose: evaluated as text in the page (also in a scripts-off
// context), so no transformer helpers may leak into it. Nothing here knows about the engine.
(function () {
  function walk(doc) {
    var out = [];
    (function rec(e) { out.push(e); for (var i = 0; i < e.children.length; i++) rec(e.children[i]); })(doc.documentElement);
    return out;
  }
  function rect(e) { var r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }
  function q(doc, sel) { return doc.querySelector(sel); }
  /** Values named by a spec's `expected`, measured on one document. */
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
      out.order = p ? Array.prototype.filter.call(p.children, function (c) { return c.getAttribute('id'); }).map(function (c) { return c.getAttribute('id'); }) : null;
    }
    return out;
  }
  /** Every element in document order: all computed properties and the bounding box. */
  function fullDump(doc, targetSel, parentSel) {
    var view = doc.defaultView;
    var els = walk(doc);
    var idx = new Map(); els.forEach(function (e, i) { idx.set(e, i); });
    var names = []; var cs0 = view.getComputedStyle(doc.documentElement);
    for (var i = 0; i < cs0.length; i++) names.push(cs0[i]);
    var rows = els.map(function (e) {
      var cs = view.getComputedStyle(e);
      var props = names.map(function (n) { return cs.getPropertyValue(n); });
      return { tag: e.localName, id: e.getAttribute('id'), parent: e.parentElement ? idx.get(e.parentElement) : -1, rect: rect(e), props: props };
    });
    var t = targetSel ? q(doc, targetSel) : null; var p = parentSel ? q(doc, parentSel) : null;
    return { names: names, rows: rows, target: t ? idx.get(t) : -1, parent: p ? idx.get(p) : -1,
      parserErrors: doc.getElementsByTagName('parsererror').length, rootName: doc.documentElement.localName };
  }
  window.GateMeasure = { walk: walk, specMeasure: specMeasure, fullDump: fullDump };
})();
