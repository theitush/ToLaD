# Data audit: catching interesting-looking data bugs before they reach the fan

Date: 2026-10-11. Task: ToLaD#113. Code: `pipeline/tolad_pipeline/audit.py`, run by `make -C pipeline audit`
(also at the end of `make -C pipeline test` when a build snapshot exists). The full generated list is in
[data-audit-report.md](data-audit-report.md). Flags a person has checked and accepted go in
`pipeline/audit-reviewed.toml`, each with its reason.

## Why this is needed

A data bug in ToLaD rarely looks like a bug. A modelled level that is 26× too high does not make the fan
crash: it draws a bottleneck and a recovery, which looks like history. Every one of the bugs below was
found by eye, usually by Ita, after it had shipped.

## The past bugs, by cause

| Bug | What the fan showed | Cause | Class |
|---|---|---|---|
| #94 cougar | a pinch ~30 kya, then a 26× climb to 1500 | a genomic level (40k) joined log-linearly to a *modelled* natural level (1.0M) | join between sources at mismatched levels |
| #92 wisent | a 386× climb from the Pleistocene to a modelled 7M in 1500, then a crash to 66 | the natural level scaled from today's relic range to all of Europe, joined to the genomic level | modelled level far from published estimates, plus a join |
| #93 range-loss trend | lion, orangutan, black rhino *rising* from 1500 to their first cited point | the modelled natural level was below the first cited level, and the trend joined them anyway | join between sources at mismatched levels |
| #72 black-footed ferret | 161k alive, a 16.7M natural level | an occupancy model where a census (a few hundred) exists; the natural level scales from it | modelled level far from published estimates |
| #110 Eurasian lynx | ~400k alive | density × the whole Palearctic range, no cited count (published: tens of thousands) | modelled level far from published estimates |
| #88 CR species | *Galagoides rondoensis* 410k, *Pteropus aruensis* 290k | modelled counts that the species' own IUCN category rules out | modelled level far from published estimates |
| #105 EX species | 7 Red List EX species and 31 Holocene fossil grafts drawn living | Red List EX with no end date; fossil last appearances rounded to 0 Ma | status and extinct-flag disagreement |
| #66 / #75 genomic time axis | Panthera curves shifted ~5× in time | a figure plotted in generations (g = 1) read as years; one mutation rate for every clade | unit or generation error |
| #70 steps explosion | 76k–224k steps per Panthera species, ~100 s load | one fan step per generation over a 2 Myr log-linear curve | steps or sampling artifact |
| names (#116) | (found by this audit) 19 *Felis* subspecies, *Lynx vulgaris*, *Puma yaguarondi* drawn as species | Open Tree keeps infraspecific or stale names as species tips; each gets its clade's mean count | stale or mismatched names |

Two shapes recur:

- **A modelled number put next to a cited one.** The model (density × range × occupancy, or Greenspoon's
  per-species model) is grade D and can be off by 10–100×. On its own it is honest. Next to a cited
  point, or joined to a genomic curve, the difference turns into a rise or a crash that looks like an event.
- **A status or a name that one source has and another lacks.** The tree (Open Tree, PBDB) and the lists
  (Red List, PHYLACINE, Upham) disagree. Whatever the tree says gets drawn.

## The guards

Each guard has a threshold that comes from a rule already in use or a published criterion. None was
tuned to make the list short.

| Class | Guard (`audit.py`) | Threshold and where it comes from |
|---|---|---|
| join | two adjacent knots of the drawn curve that are not both cited (a genomic-to-modelled join, a modelled span, a #61 step) change by more than 10×. It is marked **rapid** when the change happens inside IUCN criterion A's window | 10×: the #77 rule (`history.DEEP_JOIN_FLAG`). The window is max(10 years, 3 generations), from IUCN Categories and Criteria v3.1, criterion A |
| today | a modelled today's count is more than 10× off an *independent* published figure for the same species: Greenspoon 2023's IUCN census compilation, its per-species model, or a recent (≥ 2000) cited point of a history file that does not set the count. A count with no such figure is **unanchored**, which the report lists as a state, not a flag | 10×, the same rule. The GBIF Red List checklist has no population-size field, so the IUCN figures come through Greenspoon's compilation |
| ceiling | an IUCN CR/EW species whose count is modelled and above 10,000 | 10,000 mature individuals is criterion C's widest bound (VU), so it is the largest population that criteria C or D allow (#88's rule). EN is not checked, because an EN species listed under criterion A or B can be any size |
| deep | the pipeline's own #77/#80 flag: a genomic deep past more than 10× off the next level | `history.DEEP_JOIN_FLAG` |
| status | a living leaf the Red List calls EX; an extinct leaf the Red List assesses as living; an EW species drawn with a modelled wild count; an extinct leaf or fossil graft whose band runs to the present (T1 = 0) | categorical (#105) |
| name | a living leaf that no extant-species list knows (not in Upham, PHYLACINE, Greenspoon/IUCN, and Red List NE) but that is drawn as a species with a count | categorical. These are the "unverified extant tips" of `stats.json` |
| units | a genomic curve whose time or Ne is rescaled from its source by more than the lineage's mutation-rate band spans | the 95% prediction band of the per-lineage rate (`mutation.py`, Bergeron 2023 pedigree fit, #74/#75) is ~3× wide. Rescaling to any rate inside it moves a curve by less than that, so a bigger rescale is more than the rate's uncertainty explains (a snapshot without the band falls back to 3×, the spread #75 measured) |
| steps | the steps a cat costs the fan | already guarded in `web/src/fan/population.test.ts` (#70): ≤ 1,500 share samples and ≤ 8,000 features per species |

**Severity** is the size of the error drawn, in dex: |log10| of the ratio. A wrong alive/dead state counts
2, the same as a 100× error. A name that is not a species counts 1.

**Ranking by visibility:**
1. the cats that the Felidae view places (the binomials in `web/src/fan/splits.ts`);
2. the other Felidae leaves, which are in the tree and in the tiles' Felidae totals but not placed in the fan;
3. the rest of Carnivora;
4. everything else.

Within each tier, species are ranked by severity.

**Cost:** the build writes a per-leaf snapshot (`data/build/audit_leaves.json`, about 4 MB) in under a
second. The audit reads it and runs in about 0.4 s, so `make test` runs it too.

## The first report (main 1a3ecb1, with the per-lineage mutation rates of #114)

The audit checked 7,415 species leaves and flagged 1,673 of them. Three more carry only reviewed flags. 6,816
living species have a modelled count that no published figure checks (unanchored).

| Class | Species | What it finds | Follow-up |
|---|---|---|---|
| name | 1,461 | Open Tree tips that are subspecies or stale names, each drawn with its clade's mean count: ~6.2 billion animals alive that are not species. 28 are in Felidae (19 *Felis* subspecies at 2.07M each) | #116 |
| ceiling | 62 | CR species modelled above 10,000. This is #88's list, re-run against Red List 2026 (#88 had 27) | #88 |
| status | 44 | extinct leaves and Holocene fossil grafts whose band runs to the present (T1 = 0). The 7 Red List EX species are no longer counted alive, but they still end at 0 | #105 |
| join | 102 | joins between modelled and genomic levels; 17 range-loss trends with two modelled ends; 23 one-generation #61 steps at 1500; 34 trends from a modelled 1500 level to a cited point | #118, #120, #92, #94 |
| deep | 34 | genomic deep pasts more than 10× off the next level (the #77 flag; 33 before #114) | #120 |
| today | 4 | otters modelled 10–117× above Greenspoon's estimate | #117 |
| units | 3, reviewed | the Armstrong 2025 Panthera curves, plotted with g = 1 (#66): rescaled 4–8.5× by design | reviewed |
| steps | — | guarded by the web test | — |

### Every cat in the Felidae view

The fan places 38 living cats. Each is clean or listed with a cause:

- **Flagged (2):**
  - **Cougar** (*Puma concolor*): a genomic 37k ~21 kya climbs 27× to a modelled 1.02M in 1500 (join plus deep flag). Today's 777k is Greenspoon's model, with no published figure behind it. → #94.
  - **Iberian lynx** (*Lynx pardinus*): a modelled 4.1k in 1500 falls 25× to a *modelled* 159 today. The 2024 census is ~2,400, so today is ~15× low. → #94 (its census history), #118.
- **Reviewed (3):** lion, leopard and tiger. Their units flag is the g = 1 time axis of #66, cross-checked against other curves (`pipeline/audit-reviewed.toml`).
- **Unanchored (19):** no flag, but today's count is modelled and no published figure checks it. Most rest on Greenspoon's per-species model:
  - wildcat 1.07M, caracal 616k, ocelot 559k
  - **Eurasian lynx 435k** (#110), serval 434k
  - Asian golden cat 410k, leopard cat 331k, margay 291k
  - Canada lynx 213k, jungle cat 190k, Geoffroy's cat 166k
  - jaguarundi 155k, pampas cat 121k, marbled cat 75k
  - bay cat 71k, rusty-spotted cat 62k, African golden cat 52k
  - clouded leopard 32k, fishing cat 23k

  Their cited counts are #110 ("the lynx and other cats with no cited count") and #94.
- **Clean (14):** domestic cat, bobcat, jaguar, sand cat, kodkod, Pallas's cat, oncilla, black-footed cat, southern tiger cat, snow leopard, Sunda clouded leopard, cheetah, flat-headed cat, Andean cat. Each has a census or a history file, and no join beyond 10×.

The other 28 Felidae leaves (not placed in the fan, but in the tree and in its totals) are all flagged by `name` (#116): 19 *Felis* subspecies, *Puma yaguarondi* (a stale spelling, so the jaguarundi is counted twice), *Lynx vulgaris*, *Lynx spelaea*, *Leptailurus servalina*, two *Leopardus* and three *Prionailurus* names.

**Which past bugs the guards would have caught.** This is reasoned from the rules, not re-run on old builds.

| Bug | Caught? | By |
|---|---|---|
| #94 cougar | yes | join and deep |
| #92 wisent | yes | join and deep (386×) |
| #88 CR species | yes | ceiling |
| #105 EX species | yes | status |
| #66 Panthera curves | yes | units |
| #110 Eurasian lynx | only listed | unanchored; no published figure on disk is more than 10× away |
| #72 black-footed ferret | only listed | unanchored, since Greenspoon has no ferret census. Its 104× range-loss trend from a modelled natural level to a modelled today would also have fired the join guard |
| #93 lion, rising 3.3× | no | below the 10× rule |
| #70 steps | not by the audit | caught by the web test instead |

The lesson is the *unanchored* list. A modelled count with no published figure behind it is where these bugs
live, so it is what the report lists for every cat.

## What the fan should show for a flagged species (proposal for Ita, #119)

| Option | What the viewer sees | For | Against |
|---|---|---|---|
| **A. Draw it as built** | the curve as now; the card names the flag in a sentence | no new visual language; nothing hidden | the shape still reads as history, which is the problem |
| **B. Mark the flagged span** | the curve as built, but the unsupported span (the join, the step, the modelled trend) drawn in a "not from a source" style: desaturated or hatched, with no change of width. The card says "this 27× climb joins a genomic estimate to a modelled one; no source records it" | the viewer sees the shape *and* that it is not history; it follows the grade styling the fan already has, and needs only a span-level flag in the tile | one more style to read; the flagged span still has a width that somebody chose |
| **C. Fall back to a flat "no data" span** | the unsupported span replaced by a flat span at the later, better-sourced level, styled as missing data | no invented event at all | it throws away real signal (the cougar's late-Pleistocene low is partly real, Culver 2000), and a flat line is a claim too |

**Recommendation: B** for join, deep, today and ceiling flags. The span stays, but it is marked as not being
history, and the card names the rule. Use **C** only where the error is categorical (a `name` that is not a
species, or a `status` disagreement). There the fix belongs in the data (#116, #105) rather than in the display,
and until then the leaf should draw no individuals of its own.

The audit's JSON (`data/build/audit.json`) already carries each flag's span (`frm`, `to`), so the tiles could
carry a per-span flag bit if B is chosen.

## Left open

- A published population-size figure for every cat. The GBIF Red List checklist has no population field, and
  the IUCN API needs a token. The 19 unanchored cats wait on #110 and #94.
- EN species are not ceiling-checked; the reason is in the guards table above.
