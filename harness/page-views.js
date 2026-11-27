// Runs in the engine harness page. Applies the steps of one small-views spec one at a time to a live preview (each selector resolved against the document as it
// is after the earlier steps), keeps the edit list, and for a `reset` step takes the list through the engine's resetView and replays it on a fresh preview.
// Returns the files after every step, the pins after every step and the refusal (with its step) when there is one. Plain JS on purpose.
window.runViewsSpec = async function (f, steps) {
  var E = window.UIEngine;
  var host = document.getElementById('host');
  async function open(edits) {
    var model = E.createModel(f.source, f.kind, f.companions, f.file);
    var preview = await E.createPreview(model, host);
    var run = E.applyEditSteps(preview, edits, E.emptyState());
    return { preview: preview, run: run };
  }
  var model0 = E.createModel(f.source, f.kind, f.companions, f.file);
  var preview = await E.createPreview(model0, host);
  var edits = [], state = E.emptyState(), stepFiles = [], stepUnlinked = [];
  try {
    for (var i = 0; i < steps.length; i++) {
      var s = steps[i];
      if (s.op === 'reset') {
        if (typeof E.resetView !== 'function') throw new Error('resetView is not exported');
        edits = E.resetView(edits, s.env);
        preview.dispose();
        var o = await open(edits);
        preview = o.preview; state = o.run.state;
        stepFiles.push(o.run.files); stepUnlinked.push(E.listUnlinked(state));
        continue;
      }
      var one = function (sel) { var h = preview.probe.matches(sel); if (h.length !== 1) throw new Error('selector ' + sel + ' matched ' + h.length); return h[0]; };
      var scope = {}; if (s.environment) scope.environment = s.environment; if (s.link !== undefined) scope.link = s.link;
      var edit;
      if (s.op === 'set') edit = Object.assign({ op: 'set', target: one(s.target), properties: s.properties }, scope);
      else if (s.op === 'offset') edit = Object.assign({ op: 'offset', target: one(s.target), dx: s.dx, dy: s.dy }, scope);
      else if (s.op === 'reorder') edit = Object.assign({ op: 'reorder', target: one(s.target), placement: s.placement, sibling: one(s.sibling) }, scope);
      else if (s.op === 'insert') edit = { op: 'insert', kind: s.kind, anchor: one(s.anchor), placement: s.placement };
      else if (s.op === 'remove') edit = { op: 'remove', target: one(s.target) };
      else throw new Error('unknown step ' + s.op);
      var run = E.applyEditSteps(preview, [edit], state);
      var r = run.results[0];
      if (!r.ok) return { refused: Object.assign({ step: i + 1 }, r.refusal), stepFiles: stepFiles };
      state = run.state; edits.push(edit);
      stepFiles.push(run.files); stepUnlinked.push(E.listUnlinked(state));
    }
    var customAfter = typeof E.customEdits === 'function' ? { phone: E.customEdits(edits, 'phone').length, tablet: E.customEdits(edits, 'tablet').length } : null;
    return { refused: null, files: stepFiles[stepFiles.length - 1], stepFiles: stepFiles, stepUnlinked: stepUnlinked, unlinked: E.listUnlinked(state), customAfter: customAfter };
  } catch (e) {
    return { threw: String(e && e.message || e), stepFiles: stepFiles };
  } finally { preview.dispose(); }
};
