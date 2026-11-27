# Views real-page rules (LOCKED)

Locked in the commit `docs: lock the views real-page rules and specs`. After it this file and `views-check/realpage-edits.json` are never edited; a flaw found after a run is a numbered amendment file
(`docs/views-realpage-amendment-N.md`) labelled as made after seeing a run, and both runs stay on record. Brief: `~/Desktop/Projects/ui-editor-views-realpages-brief.md`. Earlier rules stay in force:
`docs/realpage-rules.md` (selection procedure, load settings, the five files), `docs/small-views-rules.md` and amendment 1 (ranges and checks), `docs/small-views-followup-rules.md`.
Sections marked **(mine)** are operational definitions written by the implementing agent.

Question: **do the three views (Desktop, Tablet, Phone) hold up on the five real pages?** This round changes nothing under `engine/` or `src/`. A spec that shows a real engine defect is recorded as FAIL and
the round STOPS for Max's decision.

## 1. Inputs and the ranges of each page

The five files of `../ui-editor-realpages/` (outside the repo, never committed, never edited; the harness works on in-memory copies and gitignored exports). **B and T were read with the engine's own
exports** (`createModel`, `breakpointOf`, `tabletMax`, `tabletMin`, from `engine/src/index.ts`; freelancer with its linked `css/styles.css` as companion), and agree with the harness's independent
reading of the `max-width` conditions (`harness/views-lib.ts`, `phoneMax` and `tabletTop`):

| page | B (Phone is widths up to B) | T | Tablet band | how |
|---|---|---|---|---|
| leemunroe-email.html | 640 | 1024 (default: no max-width between 769 and 1100) | 641 to 1024 | `breakpointOf`, `tabletMax`, `tabletMin` |
| mailgun-action.html | 599 | 1024 (default) | 600 to 1024 | same |
| freelancer-index.html (+ css/styles.css) | 767.98 | 991.98 | 768 to 991.98 | same |
| fibonacci-spiral.svg, normal-distribution.svg | 767 (default) | 1024 (default) | none (SVG has no environments) | `docs/small-views-rules.md` section 2, item 5 |

True for the emails: they declare phone rules only (no tablet rules), but under the locked definitions every page whose B is at most 767 has a Tablet band (from floor(B)+1 to T), so **all three HTML
pages have a Tablet band** and `tablet-covered-by-phone` is not the true answer for any of them. No spec expects that refusal; the brief's alternative ("or a refusal is the true answer") does not apply.

## 2. Targets (mine; fixed before the engine touched these pages)

Reused from the earlier real-page selection procedure (`realpage-check/edits.json`, `docs/realpage-rules.md` section 2): T1 the element with the most prominent text, T2 the largest container, T4 a
button, link or cell. Each selector was verified unique in its file in plain Chromium.

| | T1 | T2 | T4 |
|---|---|---|---|
| leemunroe | `td.wrapper > p:nth-of-type(1)` | `table.body` | `a[target="_blank"]` |
| mailgun | `td.content td.content > p:nth-of-type(1)` | `div[role="article"]` | `td.content td.content` |
| freelancer | `h1.masthead-heading` | `#contact` | `a.btn-xl` |

Original values measured in plain Chromium (no engine, JavaScript off, other hosts aborted) before locking: T1 font-size 16px at every width on both emails; freelancer h1 64px at 992 and above and 44px at
991 and below. Hence the ratios of the Desktop size edits: 24/16 = 1.5 (lee munroe), 22/16 = 1.375 (mailgun), 80/64 = 1.25 (freelancer).

## 3. Truth (mine)

Computed values at every test width, within 0.5 px (colours exact), measured by the browser with JavaScript off on the original and the exported page. Test widths: 1280, 1024, 768, 390, floor(B),
floor(B)+1, floor(T), floor(T)+1 and 800 (inside every Tablet band), as `harness/views-lib.ts` `testWidths`. So: lee munroe 640, 641, 1024, 1025; mailgun 599, 600, 1024, 1025; freelancer 767, 768,
991, 992. The fractional boundaries B = 767.98 and T = 991.98 cannot be a Playwright viewport (integers only), so V14 measures them in an iframe whose CSS width is the exact fractional value (sandboxed
without scripts, same origin) and also at 767.5 and 992.98 (T+1 written as 992.98 beside the whole width 992). Region of a width: Phone is a width at or below B, Tablet floor(B)+1 up to T, Desktop above T.
Widths strictly between B and floor(B)+1 (767.99 on freelancer) belong to no range and are not tested.

- `scaled` (Q1): at every width the value equals the **original page's value at that width times the ratio** (the Desktop value is exact because the ratio is new over original Desktop).
- Desktop colour (Q2): every width shows the new colour (a Desktop edit reaches every view, written as an inline style the page's own media rules cannot beat).
- Custom Phone (Q3): widths up to B show the new value, every width above B shows the original page's value at that width. Custom Tablet (Q4): widths floor(B)+1 to T show the new value, every other
  width the original's.
- Q5 (V12): Phone keeps its own colour; Tablet and Desktop show the Desktop colour.
- Q6 (V13): the export equals, byte for byte, the export of the same list built without the Phone custom edit (the harness filters the list itself, independently of `resetView`), and `customEdits` for
  Phone is empty afterwards (Tablet's is not).
- Collateral (Q7, every spec): every element other than the target and the legit allowance of `docs/small-views-rules.md` section 4 equals the original's computed style and box at every test width
  (and at the fractional widths of V14), no new horizontal overflow at 390 and 768; measured by the browser only.
- No-op round trip (Q8): `exportFiles(sources(createModel(...)), [])` for each of the five files is byte-identical to the source, `css/styles.css` included; undo by replay gives the same bytes at
  every step of V12 and V13.
- SVG (Q9): the page's environment field is ignored for SVG (`docs/small-views-rules.md` section 2, item 5), so a Phone- or Tablet-tagged edit must equal the earlier saved Desktop export **bytes**
  (`results/views/baseline-hashes.json`, the engine's real-page run: `real/R13/fibonacci-spiral.svg`, `real/R17/normal-distribution.svg`), and the same edit with no environment must equal them too.
  The value is the same at every width.
- No view marker, flag or comment in anything the engine added (as before).

## 4. Specs

16 specs, `views-check/realpage-edits.json`, **prefix V** (searched: no earlier spec file uses a V id; the letters A to V that appear in earlier rules documents are check names, not spec ids). All are
declared PASS; none is declared REFUSED, because none of the five files is expected to produce a true refusal (section 1).

| spec | page | question |
|---|---|---|
| V01 to V03 | leemunroe, mailgun, freelancer | Q1 Desktop font-size of T1 reaches Phone and Tablet by the ratio |
| V04, V05 | leemunroe, freelancer | Q2 Desktop colour of T1 reaches every view |
| V06 to V08 | leemunroe, mailgun, freelancer | Q3 custom Phone colour on T4 |
| V09 to V11 | leemunroe, mailgun, freelancer | Q4 custom Tablet background on T2 |
| V12 | freelancer | Q5 Phone custom colour, then Desktop colour on the same element |
| V13 | freelancer | Q6 Phone, Tablet and Desktop edits, then Reset Phone |
| V14 | freelancer | Q10 fractional breakpoints: custom Tablet at 767, 767.5, 767.98, 768, 991, 991.98, 992, 992.98 |
| V15, V16 | the two SVGs | Q9 Phone- or Tablet-tagged edit equals the saved Desktop bytes |

Q7 (collateral) is a check inside every spec; Q8 (no-op round trips) is five rows `RT01` to `RT05` beside the specs (one per input file).

RETIRED list: **none**.

## 5. Outcomes and the pass line

Each spec gets exactly one outcome: PASS (every check below holds), REFUSED (a structured refusal; counts as a pass only if its code is the declared one: none is declared), FAIL (anything else).

**Pass line** (the verdict script `harness/views-real-verdict.ts` computes it from these items only):

1. every V spec is PASS (a REFUSED with a declared true reason would also count; none is declared), 0 FAIL;
2. check C (collateral) holds in every spec, 0 rows failing;
3. RT01 to RT05 byte-identical;
4. the fractional widths of V14 hold, and V15 and V16 equal the saved bytes;
5. the scorer check (section 6) passed: 6 faults each FAIL where stated, and every unfaulted control PASS;
6. the earlier suites keep their bytes and results: `harness/regress-views.ts` (the saved baseline hashes: 180 of 180 compared identical, the retired S09 and Z09 excepted, as in the follow-up run),
   and the existing runs of the gate (40), real-page (20), responsive (18 + 1 REFUSED), size (15/16 with Z09 retired), flex (5 + Z22 REFUSED), insert (30 + 6 REFUSED), hardening (20), the 32 M-specs (31 PASS +
   M20 REFUSED) and the 13 N-specs; `npm test` (218), `npm run typecheck`, lint, build;
7. `git diff main --stat -- engine src` is empty and every locked file is byte-identical to its locking commit.

One scored run (`GATE_RUN=v1`). A failure caused by a rule gap or a scorer bug (not the engine) is recorded, amended in a numbered post-run amendment, and run again; both runs stay on record. A failure
caused by the engine STOPS the round.

## 6. Scorer check (before the first scored run)

At most 6 fault switches, run on hand-built exports of a copy of the harness (`harness/controls-views-real.ts`): (1) a Phone edit that also changes a width above B; (2) a Desktop edit that overwrites a
custom view's value; (3) Reset that leaves a rule behind; (4) a collateral change on an unedited element; (5) a Tablet edit that reaches Phone widths; (6) a no-op round trip that changes one byte. Each
must FAIL the check named in the control; the unfaulted controls (including one for the fractional-width check) must PASS. A control that does not fail STOPS the round.

## 7. Results (committed files)

`views-check/results/realpage-results.csv`, `views-check/results/realpage-summary.md`, the scorer check text. Only file names, selectors, numbers and diff sizes are committed; exports and dumps stay in
the gitignored `views-check/tmp/` and `views-check/raw/`.
