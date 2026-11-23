// Independent measurements of one loaded document for the insert-and-comments checks (docs/insert-comments-rules.md section 3).
// Plain JS evaluated as text (also in a scripts-off context). Nothing here knows about the engine.
(function () {
  var NOTE = ' NOTE FOR AI: ';
  function allNodes(doc, filter) {
    var out = [];
    var w = doc.createTreeWalker(doc, filter);
    for (var n = w.nextNode(); n; n = w.nextNode()) out.push(n);
    return out;
  }
  function prevSignificant(n) {
    var s = n.previousSibling;
    while (s && s.nodeType === 3 && !/\S/.test(s.textContent || '')) s = s.previousSibling;
    return s;
  }
  function nextSignificant(n) {
    var s = n.nextSibling;
    while (s && s.nodeType === 3 && !/\S/.test(s.textContent || '')) s = s.nextSibling;
    return s;
  }
  function pos(el) { return Array.prototype.indexOf.call(el.parentNode.children, el); }
  /** p: {created:[{selector,...}], gone:[sel], notes:[{target}], header:string, order:{parent}, boxSel:[...], measured:[{selector,prop}], textSel:[...], classes:[cls]} */
  function info(doc, p) {
    var out = {};
    var view = doc.defaultView;
    out.rootName = doc.documentElement.localName;
    out.parserErrors = doc.getElementsByTagName('parsererror').length;
    out.elementCount = doc.getElementsByTagName('*').length;
    out.scriptCount = doc.getElementsByTagName('script').length;
    out.styleCount = doc.getElementsByTagName('style').length;
    out.scrollWidth = doc.documentElement.scrollWidth;
    out.clientWidth = doc.documentElement.clientWidth;
    out.scrollHeight = doc.documentElement.scrollHeight;
    var comments = allNodes(doc, 128);
    out.commentTotal = comments.length;
    out.noteComments = comments.filter(function (c) { return c.data.indexOf(' NOTE FOR AI') === 0; }).length;
    var hdr = comments.filter(function (c) { return c.data === ' ' + p.header + ' '; });
    out.headerCount = hdr.length;
    out.header = null;
    if (hdr.length) {
      var h = hdr[0];
      var prev = prevSignificant(h);
      out.header = { parentIsDocument: h.parentNode === doc, previousIsDoctype: !!prev && prev.nodeType === 10, isFirstNode: !prev, nextData: (function () { var n = nextSignificant(h); return n && n.nodeType === 8 ? n.data : null; })() };
    }
    out.created = (p.created || []).map(function (c) {
      var m = doc.querySelectorAll(c.selector);
      var r = { selector: c.selector, count: m.length };
      if (m.length === 1) {
        var el = m[0];
        r.tag = el.localName;
        r.text = el.textContent;
        r.parentMatches = !!el.parentElement && el.parentElement === doc.querySelector(c.parent);
        r.index = el.parentElement ? pos(el) : -1;
        r.attrs = {};
        Object.keys(c.attrs || {}).forEach(function (k) { r.attrs[k] = el.getAttribute(k); });
        r.styleAttr = el.getAttribute('style');
        r.hasClass = (el.getAttribute('class') || '').split(/\s+/).indexOf(c.selector.replace(/^\./, '')) >= 0;
        var cs = view.getComputedStyle(el);
        r.maxWidth = cs.getPropertyValue('max-width');
        var pr = el.parentElement ? el.parentElement.getBoundingClientRect() : null;
        var b = el.getBoundingClientRect();
        r.box = [b.x, b.y, b.width, b.height];
        r.parentBox = pr ? [pr.x, pr.y, pr.width, pr.height] : null;
      }
      return r;
    });
    out.gone = (p.gone || []).map(function (s) { return doc.querySelectorAll(s).length; });
    out.textOf = (p.textSel || []).map(function (s) { var el = doc.querySelector(s); return el ? el.textContent : null; });
    out.notes = (p.notes || []).map(function (n) {
      var el = doc.querySelector(n.selector);
      if (!el) return { selector: n.selector, data: null, missing: true, count: 0 };
      var pv = prevSignificant(el);
      var cnt = 0;
      for (var s = pv; s && s.nodeType === 8; s = prevSignificant(s)) { if (s.data.indexOf(' NOTE FOR AI') === 0) cnt++; }
      return { selector: n.selector, data: pv && pv.nodeType === 8 ? pv.data : null, count: cnt };
    });
    out.pageNote = comments.filter(function (c) { return c.data.indexOf(' NOTE FOR AI (whole page): ') === 0; }).map(function (c) { return c.data; });
    out.measured = (p.measured || []).map(function (m) {
      var el = doc.querySelector(m.selector);
      return el ? view.getComputedStyle(el).getPropertyValue(m.prop) : null;
    });
    out.boxes = {};
    (p.boxSel || []).forEach(function (s) { var el = doc.querySelector(s); if (el) { var r = el.getBoundingClientRect(); out.boxes[s] = [r.x, r.y, r.width, r.height]; } });
    if (p.order) {
      var par = doc.querySelector(p.order.parent);
      out.order = par ? Array.prototype.map.call(par.children, function (c) { return c.id; }) : null;
    }
    out.indexOf = {};
    (p.indexSel || []).forEach(function (s) {
      var el = doc.querySelector(s); var i = -1;
      if (el) { var all = window.GateMeasure.walk(doc); i = all.indexOf(el); }
      out.indexOf[s] = i;
    });
    out.subtree = (p.subtreeSel || []).map(function (s) { var el = doc.querySelector(s); return el ? el.querySelectorAll('*').length + 1 : 0; });
    out.styleTexts = Array.prototype.map.call(doc.getElementsByTagName('style'), function (s) { return s.textContent; });
    return out;
  }
  window.InsMeasure = { info: info };
})();
