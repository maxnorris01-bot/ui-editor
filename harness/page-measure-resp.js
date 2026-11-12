// Per-width measurements for the responsive check (docs/responsive-rules.md). Plain JS, evaluated as text.
(function () {
  function rect(e) { var r = e.getBoundingClientRect(); return [r.x, r.y, r.width, r.height]; }
  /** m: {target, props?, bbox?} or {parent, visualOrder:true}. */
  function measure(doc, m) {
    var view = doc.defaultView, out = {};
    var el = doc.querySelector(m.target || m.parent);
    if (!el) return { missing: true };
    if (m.props) { var cs = view.getComputedStyle(el); out.props = {}; m.props.forEach(function (k) { out.props[k] = cs.getPropertyValue(k); }); }
    if (m.bbox) out.bbox = rect(el);
    if (m.visualOrder) {
      out.visualOrder = Array.prototype.map.call(el.children, function (c) { var r = c.getBoundingClientRect(); return [c.id, Math.round(r.top), Math.round(r.left)]; })
        .sort(function (a, b) { return a[1] - b[1] || a[2] - b[2]; }).map(function (x) { return x[0]; });
    }
    return out;
  }
  window.RespMeasure = { measure: measure };
})();
