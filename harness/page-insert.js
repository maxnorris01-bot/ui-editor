// Runs in the engine harness page (scripts on, http origin). Applies the steps of one insert-and-comments spec to one live
// preview, ONE EDIT AT A TIME (each selector is resolved against the document as it is after the earlier steps), and returns
// the exported files after every step, the preview's own measurements and the engine's review lists. Plain JS on purpose.
// It reads nothing from the engine's model for the verdict: the verdict is computed in Node from the exported files.
window.runInsertSpec = async function (f, steps, opts) {
  var E = window.UIEngine;
  var host = document.getElementById('host');
  var model = E.createModel(f.source, f.kind, f.companions, f.file);
  var preview = await E.createPreview(model, host);
  var stepFiles = [];
  var stepUnlinked = [];
  var state = E.emptyState();
  var done = 0;
  try {
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      var one = function (sel) {
        var h = preview.probe.matches(sel);
        if (h.length !== 1) throw new Error('selector ' + sel + ' matched ' + h.length + ' elements');
        return h[0];
      };
      var edit;
      var base = { environment: s.environment || 'desktop', link: s.link !== false };
      if (s.op === 'set') edit = Object.assign({ op: 'set', target: one(s.target), properties: s.properties }, base);
      else if (s.op === 'reorder') edit = Object.assign({ op: 'reorder', target: one(s.target), placement: s.placement, sibling: one(s.sibling) }, base);
      else if (s.op === 'offset') edit = Object.assign({ op: 'offset', target: one(s.target), dx: s.dx, dy: s.dy }, base);
      else if (s.op === 'insert') edit = { op: 'insert', kind: s.kind, anchor: one(s.anchor), placement: s.placement };
      else if (s.op === 'text') edit = { op: 'text', target: one(s.target), text: s.text };
      else if (s.op === 'remove') edit = { op: 'remove', target: one(s.target) };
      else if (s.op === 'note') edit = { op: 'note', target: s.target === 'page' ? 'page' : one(s.target), text: s.text };
      else throw new Error('unknown step op ' + s.op);
      var run = E.applyEditSteps(preview, [edit], state);
      var r = run.results[0];
      if (!r.ok) return { refused: Object.assign({ step: i + 1 }, r.refusal), stepFiles: stepFiles, done: done };
      state = run.state;
      stepFiles.push(run.files);
      stepUnlinked.push(E.listUnlinked(state));
      done++;
    }
    var out = { refused: null, files: stepFiles.length ? stepFiles[stepFiles.length - 1] : null, stepFiles: stepFiles, stepUnlinked: stepUnlinked, unlinked: E.listUnlinked(state) };
    out.notes = typeof E.listNotes === 'function' ? E.listNotes(preview.model) : null;
    // the preview's own measurements, to compare with the exported file
    out.preview = {};
    (opts.previewWidths || []).forEach(function (w) {
      preview.setWidth(w);
      var d = preview.doc;
      var m = { scrollHeight: d.documentElement.scrollHeight, boxes: {} };
      (opts.boxSelectors || []).forEach(function (sel) {
        var el = d.querySelector(sel);
        if (el) { var r2 = el.getBoundingClientRect(); m.boxes[sel] = [r2.x, r2.y, r2.width, r2.height]; }
      });
      out.preview[w] = m;
    });
    preview.setWidth(1280);
    // the preview's element count against the export's is checked by the harness through the engine's own re-tag
    out.previewElementCount = preview.elements.length;
    return out;
  } catch (e) {
    return { threw: String(e && e.message || e), stack: String(e && e.stack || '').slice(0, 600), stepFiles: stepFiles, done: done };
  } finally { preview.dispose(); }
};

window.runListNotes = function (f) {
  var E = window.UIEngine;
  if (typeof E.listNotes !== 'function') return null;
  return E.listNotes(E.createModel(f.source, f.kind, f.companions, f.file));
};
