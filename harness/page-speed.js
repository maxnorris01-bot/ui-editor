// Runs inside the harness page (plain JS on purpose: no transformer helpers may leak into the page).
// Measures source-in -> preview-ready and edit-apply -> exported-text. It does NOT score anything.
window.runSpeed = async function (fixtures, t1Edits, runs) {
  const E = window.UIEngine;
  const host = document.getElementById('host');
  const median = (a) => { const s = [...a].sort((x, y) => x - y); const m = s.length >> 1; return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2; };
  const out = [];
  for (const f of fixtures) {
    const preview = [];
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      const model = E.createModel(f.source, f.kind, f.companions, f.file);
      const p = await E.createPreview(model, host);
      preview.push(performance.now() - t0);
      p.dispose();
    }
    // One live preview for the edit timings.
    const model = E.createModel(f.source, f.kind, f.companions, f.file);
    const p = await E.createPreview(model, host);
    const spec = t1Edits[f.file];
    const target = p.probe.matches(spec.target);
    if (target.length !== 1) throw new Error(`selector ${spec.target} matched ${target.length} in ${f.file}`);
    const edit = { op: 'set', target: target[0], properties: spec.edit.properties };
    // performance.now() is coarse (0.1 ms), and one apply takes far less, so time batches and divide.
    const BATCH = 200;
    const apply = [];
    let status = 'ok';
    let reason = '';
    for (let i = 0; i < runs; i++) {
      const t0 = performance.now();
      for (let k = 0; k < BATCH; k++) {
        const r = E.applyEdit(model, edit, p.probe);
        if (r.ok) E.exportFiles(E.sources(model), r.patches);
        if (!r.ok) { status = 'refused'; reason = r.refusal.code; }
      }
      apply.push((performance.now() - t0) / BATCH);
    }
    p.dispose();
    out.push({
      file: f.file, bytes: f.bytes, elements: model.primary.elements.length,
      previewMs: { median: median(preview), min: Math.min(...preview), max: Math.max(...preview), first: preview[0] },
      applyMs: { median: median(apply), min: Math.min(...apply), max: Math.max(...apply) },
      applyStatus: status, applyRefusal: reason,
    });
  }
  return out;
};
