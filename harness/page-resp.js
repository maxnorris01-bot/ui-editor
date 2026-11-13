// Runs in the engine harness page (scripts on, http origin). Applies an ordered list of edits to one live
// preview, measures the preview at every test width, and returns the export. Plain JS on purpose.
window.runRespSpec = async function (f, steps, widths, measure) {
  var E = window.UIEngine, M = window.RespMeasure;
  var host = document.getElementById('host');
  var model = E.createModel(f.source, f.kind, f.companions, f.file);
  var preview = await E.createPreview(model, host);
  try {
    var probe = preview.probe;
    var one = function (sel) { var h = probe.matches(sel); if (h.length !== 1) throw new Error('selector ' + sel + ' matched ' + h.length); return h[0]; };
    var edits = steps.map(function (s) {
      var base = { environment: s.environment || 'desktop', link: s.link !== false };
      var t = one(s.target);
      if (s.op === 'set') return Object.assign({ op: 'set', target: t, properties: s.properties }, base);
      if (s.op === 'offset') return Object.assign({ op: 'offset', target: t, dx: s.dx, dy: s.dy }, base);
      return Object.assign({ op: 'reorder', target: t, placement: s.placement, sibling: one(s.sibling) }, base);
    });
    var el = model.primary.elements[edits[0].target];
    var spans = { startTag: [el.start, el.startTagEnd] };
    var before = {};
    widths.forEach(function (w) { preview.setWidth(w); before[w] = M.measure(preview.doc, measure); });
    preview.setWidth(1280);
    var run = E.applyEditSteps(preview, edits);
    var bad = run.results.find(function (r) { return !r.ok; });
    if (bad) return { refused: bad.refusal, warnings: bad.warnings };
    var after = {};
    widths.forEach(function (w) { preview.setWidth(w); after[w] = M.measure(preview.doc, measure); });
    var notes = [];
    run.results.forEach(function (r) { (r.notes || []).forEach(function (n) { notes.push(n); }); });
    return { refused: null, files: run.files, before: before, after: after, notes: notes, spans: spans,
      placements: run.results.map(function (r) { return r.placement; }), unlinked: E.listUnlinked(run.state) };
  } finally { preview.dispose(); }
};
