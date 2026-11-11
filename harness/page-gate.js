// Runs inside the engine harness page (scripts enabled, http origin). Applies one edit through the
// engine's live preview path and exports. Scoring happens elsewhere. Plain JS on purpose.
window.runGateEdit = async function (f, spec) {
  var E = window.UIEngine, M = window.GateMeasure;
  var host = document.getElementById('host');
  var model = E.createModel(f.source, f.kind, f.companions, f.file);
  var preview = await E.createPreview(model, host);
  try {
    var probe = preview.probe;
    var hits = probe.matches(spec.target);
    if (hits.length !== 1) throw new Error('selector ' + spec.target + ' matched ' + hits.length);
    var edit;
    if (spec.edit.op === 'set') edit = { op: 'set', target: hits[0], properties: spec.edit.properties };
    else if (spec.edit.op === 'offset') edit = { op: 'offset', target: hits[0], dx: spec.edit.dx, dy: spec.edit.dy };
    else {
      var mv = probe.matches(spec.edit.move), sib = probe.matches(spec.edit.sibling);
      if (mv.length !== 1 || sib.length !== 1) throw new Error('reorder selectors not unique');
      edit = { op: 'reorder', target: mv[0], placement: spec.edit.placement, sibling: sib[0] };
    }
    // Source spans the E5 rule allows (computed on the ORIGINAL document, before the edit).
    var el = model.primary.elements[hits[0]];
    var spans = { startTag: [el.start, el.startTagEnd], element: [el.start, el.end], rules: [], moved: null };
    var all = [];
    model.sheets.forEach(function (s) { s.rules.forEach(function (r) { all.push(r); }); });
    var node = preview.elements[hits[0]];
    all.forEach(function (r) {
      var m = false;
      r.selectors.forEach(function (s) { try { if (node.matches(s)) m = true; } catch (e) { /* unsupported selector: not matched */ } });
      if (m) spans.rules.push({ file: r.file, start: r.start, end: r.end });
    });
    if (edit.op === 'reorder') {
      var se = model.primary.elements[edit.sibling];
      spans.moved = { start: Math.min(el.start, se.start), end: Math.max(el.end, se.end) };
    }
    var before = M.specMeasure(preview.doc, spec.expected);
    var r = E.applyEdit(model, edit, probe);
    if (!r.ok) return { refused: r.refusal, warnings: r.warnings };
    E.applyDomOps(preview, r.dom);
    if (r.dom.some(function (o) { return o.type === 'html'; })) E.retag(preview, E.commit(model, r.patches).model);
    var after = M.specMeasure(preview.doc, spec.expected);
    var files = E.exportFiles(E.sources(model), r.patches);
    return { refused: null, patches: r.patches, files: files, before: before, after: after, spans: spans, placement: r.placement, warnings: r.warnings };
  } finally {
    preview.dispose();
  }
};
