# 05 — Population time series: recent history and deep time

Research notes for ToLaD (GitHub issue #19). Today every species has one constant size, derived from an "alive now" estimate plus the ever-lived model (02, `pipeline/`). This note asks where real population histories exist (elephants falling and recovering, whales collapsing, bison), at what resolution and under what licence, and how to show them. It ends with options for the user to choose from.

The grades A–D and the notation follow 02. "Series" means a run of dated estimates for one species or population. "Species total" means an estimate of the whole species, not one site. All figures below were checked against a search snippet or source page on 2026-10-09 unless they are marked **(unverified)**.

---

## 1. Headline conclusions

1. **Licence is the binding constraint, not data.** The built dataset is CC BY 4.0 (00, `pipeline/SOURCES.md`). The two big aggregators cannot feed it.
   - The Living Planet Database bans passing data to third parties and any reproduction "for financial gain". It also requires derived data to carry the same terms.
   - IUCN Red List data is non-commercial and bars reposting or redistribution, including inside derivative works.

   What we *can* ship is single published estimates from papers, cited (individual numbers are facts), plus open datasets: GPDD (CC0), FAOSTAT (CC BY 4.0), UN WPP (CC BY 3.0 IGO), HYDE, PHYLACINE (CC0), PLOS papers (CC BY) and US federal agency data (NOAA, NPS, USFWS; US-government works).
2. **Species-total annual series are rare.** Roughly 20–50 mammal species have one: humans, 8 livestock species and a few dozen intensively managed or marine mammals. Several hundred species have **site-level** annual series. Those are indices of one place, not species totals. A few hundred species have **2–6 historical points** (pre-exploitation, low point, today), and that tier covers almost every case the user named. Most other assessed species have a **trend direction** only, and that comes from IUCN, so it is licence-restricted. About 1,500–2,500 species have nothing.
3. **The flagships are well covered with sparse points.** African elephants, the great whales, bison, sea otter, northern fur seal, wolves, lions, tigers, white rhino and northern elephant seal each have a defensible 3–8 point curve over 1800–2026. Humans and livestock have true annual series.
4. **Recent centuries barely change "ever" for wild species, but the baseline does.** 200 years is about 0.02% of a 1 Myr species span. The big effect is indirect: if elephants were 20–50× more numerous before 1800, the **deep-time level** (and so ever-lived) should come from that baseline, not from today's depleted count. For humans, births since 1800 are about 15% of everyone ever born. For livestock most births ever are recent, so the curve changes their totals directly.
5. **The current renderers cannot show a 200-year curve yet.**
   - In the fan, `TimeScale` uses a 1 kyr offset, so the last 200 years are about 2% of Panthera's height.
   - In river format v1, the youngest `PROF` bin of a 1 Myr band is about 540 years wide.
   - procgen's resolution is one generation, which for elephants and whales is about 8 generations per 200 years.

   Representing history needs a small format addition (§5.2) and a decision on the time axis near "now" (§6).

---

## 2. Sources

"Mammal coverage" counts are approximate. "Ship?" means whether the series values can go into our CC BY static build.

### 2.1 Aggregated databases

| Source | Covers | Mammal coverage | Span / resolution | Units | Access | Licence / redistribution | Ship? |
|---|---|---|---|---|---|---|---|
| **Living Planet Database** (ZSL/WWF), release 2026.1 | Vertebrate population time series from the literature | 2020 release: 5,117 mammal populations (of ~27,000); whole DB now ~35,000 populations of ~5,500 vertebrate species | 1950/1970–2022; mostly annual or irregular, site-level | Mixed: counts, densities, indices, catch per effort | Web form (name, email, purpose), CSV | Data Use Policy 2026: "supplied for conservation purposes, scientific analysis or research only". No reproduction "for financial gain". "will not pass any Data on to third parties". "will not publish the Data in their original format". Derived data only "with these same terms of use". Published LPI *trends* are CC BY-SA 4.0 | **No.** Use it only as a finding aid that points to the primary papers |
| **BioTIME 2.0** (Dornelas et al. 2025, *GEB*) | Assemblage time series: species abundances in repeated sampling | 708 studies, 56,400 taxa; mammal studies are a small minority (mostly small-mammal trapping grids) **(count unverified)** | 1874–2023; per sampling event | Counts or biomass per sample, not totals | Download page, CSV; R package `BioTIMEr` | **Per study**: CC0, CC BY, CC BY-SA, ODbL, PDDL or ODC-BY, set by the contributor | Partly. CC0/CC BY studies only, and they are site samples |
| **GPDD 2.0** (NERC CPB, Imperial College 2010) | Classic population time series | ~5,000 series in total; several hundred mammal series (lynx, hare, voles, ungulates) **(count unverified)** | Up to ~1750s–2000s; mostly annual | Counts, indices, harvest/fur returns | Static CSVs on KNB, doi:10.5063/F1BZ63Z8 | CC0 (rOpenSci listing), **but** 686 series from 6 sources "cannot be distributed without the permission of the owner" | Yes, excluding the restricted series. Not updated since 2010 |
| **CaPTrends** (Johnson et al. 2022, *GEB* 31:2475) | Large carnivoran population trends | 1,122 trends, 50 species, 621 locations | 1726–2017, 92% start after 1950; ~6.5 observations per trend | Counts, densities, some qualitative | Paper supplement | Paper is CC BY; data licence not confirmed | Probably, after checking. Site-level |
| **IUCN Red List** | One assessment per species: population trend (↑/↓/stable/unknown), criterion A % reduction over 10 yr or 3 generations, sometimes past estimates in the text | ~5,900+ mammals assessed; trend recorded for all, "unknown" for a large share. 2008: 52% of species with known trend were declining | Assessment snapshots | Trend category, % reduction, mature individuals | Web or API (token) | Non-commercial. No reposting, sub-licensing or redistribution, including within derivative works, without permission | **No** for bulk trend flags. Individual numbers cited from an assessment are facts. Greenspoon 2023 already republishes IUCN population figures under CC BY, which we use |
| **Australian TSX** (TERN / UQ) | Threatened species index | 79 mammal taxa (2022) | 1985/1995–2022; index (1995 = 1) | Relative index | Web app download | Licence not found **(unverified)** | Unclear; index only |
| **Wildlife Comeback in Europe** (ZSL/BirdLife/EBCC 2013, 2022) | Recovering European species | ~25 mammals (beaver, European bison, wolf, brown bear, lynx, grey seal, ibex, chamois…) | Points ~1960–2020, some ~1900 lows | Counts | Report PDF | Report copyright; uses LPD | Cite individual figures only |
| **Our World in Data** | Charts that assemble the above (elephants, whales, catches, bison) | ~20 species | Points | Counts | CSV per chart | OWID's processing is CC BY; underlying third-party data keeps its own licence | Use as an index of sources, not as a source |

### 2.2 Species- and group-specific reconstructions

| Group | Best sources | Span / resolution | Licence notes |
|---|---|---|---|
| **African elephants** (*Loxodonta africana*, *L. cyclotis*) | AfESG African Elephant Database and Status Reports (1995, 1998, 2002, 2007, 2016: ~415,000 "estimated" in 2015, 93,000 fewer than 2006). Great Elephant Census (Chase et al. 2016, *PeerJ* 4:e2354): 352,271 savanna elephants in 18 countries, −30% in 15 countries 2007–14, −8%/yr. Edwards et al. 2024 (*PNAS*, doi:10.1073/pnas.2403816121): 1,325 surveys at 475 sites 1964–2016, forest −90%, savanna −70%, combined −77%, southern Africa +42%. 1979: ~1.3 M (Douglas-Hamilton), modelled at 1.1–1.8 M (Milner-Gulland & Beddington 1993). ~1800: 20–27 M (secondary, from carrying-capacity and ivory-export reasoning; **D**) | Points 1800, 1979, 1989 (~600 k), 1995–2016 every 4–9 yr; site densities 1964–2016 | AED data via request form, IUCN copyright, non-commercial reports. GEC on PeerJ (CC BY). Edwards 2024: check its data deposit. The 2021 split into two species means pre-2021 totals are combined and need a forest/savanna split assumption |
| **Asian elephant** (*Elephas maximus*) | ~48,000–52,000 (Menon & Tiwari 2019; Williams et al. 2020), called "a crude guess, unchanged for ~25 years" (Blake & Hedges 2004). India: 29,964 (2017) → 22,446 (2025 DNA-based, "not comparable…new baseline"). ~90% of historical range lost (CITES SC61) | Points only; method breaks | Government reports; cite numbers |
| **Great whales** | Catches: IWC catch database (individual whales 1900s–; summary spreadsheets downloadable, individual data "on request", terms unverified); Rocha, Clapham & Ivashchenko 2014 (*Mar. Fish. Rev.* 76(4)): ~2.9 M large whales killed 1900–99. Pre-whaling and 2001 global numbers for 8 species: Christensen 2006 (UBC FCRR 14(9)) via Pershing et al. 2010 (*PLoS ONE* 5:e12444). Stock reconstructions (catch + Bayesian model, effectively annual): Antarctic blue whale 239,000 (202–311 k) → 360 (150–840) in 1973 → 1,700 in 1996, +7.3%/yr (Branch et al. 2004); western South Atlantic humpback ~27,000 (1830) → ~450 (mid-1950s) → ~25,000, 93% (73–100%) recovered (Zerbini et al. 2019, *R. Soc. Open Sci.*). Survey series: eastern North Pacific gray whale (NOAA, 1967–present), North Atlantic right whale (NARWC, annual since 1990), bowhead (BCB, IWC) | Model-annual (B) for assessed stocks; 2 points (pre-whaling, 2001) for the rest | Pershing 2010 is CC BY (PLoS). NOAA is US federal. IWC terms need checking. Genetic pre-whaling numbers (Roman & Palumbi 2003: 240 k North Atlantic humpbacks, ~360 k fin whales) are **long-term Ne-based** and 3–10× catch-based numbers; do not mix the two |
| **Bison** (*Bison bison*, *B. bonasus*) | Pre-1800: 25–60 M on the Plains (Flores ~25 M under optimum conditions; Shaw 1995 review ~30 M; USFWS 30–75 M; **D**). Hide-trade kills 1871–74 (Hornaday 1889). 1889: Hornaday census 1,091 worldwide (~835 in the US). 2017: ~31,000 in 68 conservation herds, 11–13 k mature (Aune et al. 2017, IUCN), plus commercial herds. European bison: extinct in the wild 1919–27 → 6,819 (2020, Wildlife Comeback 2022) | Points | Hornaday 1889 is public domain (Smithsonian report). IUCN numbers cite only |
| **Sea otter** (*Enhydra lutris*) | <2,000 in 13 remnant colonies by the 1911 Fur Seal Treaty (IUCN 2020). Pre-trade "a few hundred thousand" (150–300 k, **unverified**, D). Recovery: Alaska ~73 k, Russia ~22.5 k (Doroff et al. 2011); California 2,962 (2019, USGS annual index since the 1980s); Aleutian loss of ~65 k by 2000 | Points; annual for California | USGS (US federal) |
| **Northern fur seal** (*Callorhinus ursinus*) | NOAA AFSC: Pribilof pup production, adult male counts and harvests, **1909/1912–present** (CSV on data.gov). ~2 M in the 1950s; ~1.1 M worldwide now | Annual or biennial (pups) | US federal, but data.gov lists "otherRestrictions": check. Pups ≠ total (×~4–5 multiplier) |
| Other exploited marine mammals | Northern elephant seal (~tens left in the 1890s → ~2e5); grey seal; Steller sea lion; walrus; NOAA Stock Assessment Reports for all US stocks | Points to annual | US federal |
| **Wolves** (*Canis lupus*) | No global series. Global ~2e5 (C). Annual regional counts: Isle Royale (wolves and moose since 1959), Yellowstone (since 1995 reintroduction, NPS), US states; Europe: LCIE/Bern Convention reports | Annual (regional) plus global points | NPS/USFWS US federal; Isle Royale project reports |
| **Lions** (*Panthera leo*) | Bauer et al. 2015 (*PNAS*): 47 monitored populations, Bayesian trends since 1990. Africa-wide decline ~38–43% over 1993–2014 (sources differ); East −59%, West −66%; increases only in Botswana, Namibia, South Africa and Zimbabwe. Totals ~20–35 k (Riggio et al. 2013; IUCN 2016). "~400,000 in the 1950s" is a popular figure without a traceable source (**D, unverified**) | Points + regional trend | Cite numbers |
| **Tigers** (*Panthera tigris*) | Global ~3,200 (2010) → 5,574 (2022, Global Tiger Forum). India All India Tiger Estimation every 4 yr: 1,411 (2006), 1,706 (2010), 2,226 (2014), 2,967 (2018), 3,682 (2022; minimum 3,167); methods change between rounds. "~100,000 in 1900" is popular (**D, unverified**) | 4-yearly (India), points (global) | Government reports; cite |
| Other flagships | Southern white rhino (~20–50 c. 1895 → ~16–20 k), saiga (Kazakh annual aerial counts; 2015 die-off), Serengeti wildebeest (1958– surveys), vicuña, Eurasian beaver (~1,200 c. 1900 → >1 M), Przewalski's horse (extinct in the wild 1969 → reintroduced), Soay sheep (St Kilda, annual 1985–) | Points / annual | Mixed; cite **(figures unverified)** |
| **Hudson's Bay Company fur returns** | Canada lynx, Mackenzie River district 1821–1934 (Elton & Nicholson 1942, *J. Anim. Ecol.* 11:215); hare and lynx pelts 1845–1935 (in R `tsibbledata::pelt`); in GPDD | Annual | Pelts traded = **harvest, not population**. Shows the 10-year cycle well. Old public data via GPDD (CC0) |

### 2.3 Humans and livestock

| Source | Covers | Span / resolution | Licence |
|---|---|---|---|
| **HYDE 3.4** (Klein Goldewijk et al.; method paper HYDE 3.2, *ESSD* 2017) | Gridded and regional human population, cropland and grazing land | 10,000 BCE–2024; 1,000-yr steps early, then centuries, decades, annual after 2000. 4.4 M people in 10,000 BCE (HYDE 3.2) | Open access on Utrecht Yoda (doi:10.24416/UU01-67UHB4 for 3.3). CC BY on mirrors; **confirm on the DOI page**. **No livestock counts**, only pasture/rangeland area |
| **UN WPP 2024** | Population and births by country | 1950–2100, annual | CC BY 3.0 IGO (already pinned) |
| **PRB** (Kaneda, Greenbaum & Haub 2022) | Births since 190,000 BCE | ~10 benchmark dates | Article; already used |
| **FAOSTAT QCL** | Stocks of cattle, buffalo, sheep, goats, pigs, horses, asses, camels (and more) | **1961–2024 annual**, by country | CC BY 4.0 (FAO 2025 policy; already pinned) |
| Pre-1961 livestock | No open global series found. Options: national statistics (Mitchell, *International Historical Statistics*, copyright) or a model from HYDE grazing land × stocking density (C/D) | — | — |

### 2.4 Baselines and deep time

| Source | What it gives | Licence |
|---|---|---|
| **PHYLACINE 1.2.1** (Faurby et al. 2018) | Current and **present-natural** range maps (no human pressure) for all 5,831 species since the last interglacial, plus body mass | CC0 (Dryad), already pinned |
| Ceballos, Ehrlich & Dirzo 2017 (*PNAS*) | Range loss 1900–2015 for 177 mammals: all lost ≥30% of range, >40% lost >80% **(from memory, unverified)** | Paper |
| **Greenspoon et al. 2023** | Present-day species totals (392 land species with population reports) and biomass | CC BY 4.0, already pinned. **No time dimension** |
| **Ancient-DNA demography** | Effective population size (**Ne**) through time: Lorenzen et al. 2011 (*Nature* 479:359; woolly rhino, mammoth, horse, reindeer, bison, musk ox over ~50 ka); Shapiro et al. 2004 (*Science*, Beringian bison); Palkopoulou et al. 2015 (*Curr. Biol.*, mammoth genomes, PSMC); Orlando et al. 2013 (horse); PSMC for humans and many living species | Papers. Values are read off figures; usually grade C/D |

**Ne vs census.** Ne is the size of an idealised population with the same genetic drift. Census N is typically ~10× larger (Ne/N ≈ 0.1 across taxa, Frankham 1995; ≈0.4 if the population does not fluctuate). PSMC Ne is a harmonic mean, smooths out sharp changes, cannot resolve the last ~10–20 kyr, and can show false peaks (2024 preprint on avoidable PSMC peaks). Some mammoth runs imply Ne of 1e10–1e11, which is impossible. Use Ne curves only for the **shape** of deep-time change (e.g. a late-glacial decline), scaled ×10 to census and graded D. Never present them as counts.

---

## 3. Coverage across ~6,400 mammal species

These are my estimates, from the sources above. A Red List or LPD download would refine them, but we can't ship those.

| Tier | What exists | ~Species | Flagship examples |
|---|---|---|---|
| (a) annual or near-annual **species-total** series | Census, model reconstruction or agency index for the whole species or most of it | **~20–50** | Humans; cattle, buffalo, sheep, goats, pigs, horses, asses, camels (1961–); Antarctic blue and WSA humpback (model-annual stocks); ENP gray whale; North Atlantic right whale; northern fur seal (pups); California sea otter; Isle Royale wolves and moose (one island) |
| (a′) annual **site-level** series | One or a few sites; index of local abundance | several hundred (LPD 5,117 mammal populations; GPDD; CaPTrends 50 carnivores) | Serengeti wildebeest, Soay sheep, Kruger elephants, HBC lynx/hare |
| (b) a few historical points (2–8) | Pre-exploitation or ~1800 estimate, a historical low, modern surveys | **~100–300**, mostly large, exploited or charismatic | African elephants, Asian elephant, ~12 great whales, bison (both), sea otter, fur seals, elephant seals, white rhino, wolves, lions, tigers, beaver, saiga, vicuña |
| (c) trend direction only | IUCN population trend and, for threatened species, the criterion A % decline over 3 generations | **~3,000–3,500** (assessed species with known trend) | Most primates, ungulates, bats, rodents |
| (c′) range-loss proxy | PHYLACINE current vs present-natural range area | **all ~5,800 in PHYLACINE** | Every species, including late-Quaternary extinct ones (range now = 0) |
| (d) nothing | Data Deficient, trend unknown, newly split or unassessed | **~1,500–2,500** | Many rodents, shrews, bats |

---

## 4. Indices vs counts: anchoring

Most real series are not species totals. They are site counts, densities, catch per effort, pelts traded or index values (LPI, TSX: 1 = base year). To turn one into a curve of individuals:

1. **Tail anchoring (simplest).** Scale the index so its last value equals today's total (our alive-now estimate): `N(t) = N_now · I(t) / I(t_last)`. Fine for a species-wide index.
2. **Multi-site weighting.** Combine site series weighted by each site's share of today's total. Sites with no series take the regional or global trend.
3. **Point anchoring.** If two or more absolute estimates exist (e.g. 1979 and 2016 elephants), fit the index shape between them and grade the in-between as "shape from index, level from points".
4. **Harvest series** (HBC pelts, whale catches) are not abundance. Use them either as inputs to a population model (whale catch → stock reconstruction, as the published papers already do) or only for timing (cycle phase, collapse date).

**Pitfalls**

- **The LPI is not a total.** It is a geometric mean of population *rates*. "−73% since 1970" does not mean 73% fewer animals: many small declining populations outweigh a few large growing ones. Never anchor the LPI to a species or clade total.
- **Site-selection bias.** Studies start where a species is abundant (so later numbers regress downward) or where it is being restored (reintroductions only go up). Fixed sites miss range expansion and contraction.
- **Method breaks.** India's 2025 DNA-based elephant count (22,446) is "not comparable" with 2017 (29,964). Tiger rounds changed methods too. AfESG separates "estimated" from "guessed" categories. A break must split the series, not make a fake decline.
- **Census stage.** Pups (fur seals), mature individuals (IUCN), adults or all ages: convert to the census stage used in 02 §3.1 (born individuals), or the ever/alive ratio drifts.
- **Taxonomy changes.** African elephants split in 2021; giraffes and orangutans are splitting. Older totals then belong to a parent node or need a split assumption.
- **Ne vs N** (§2.4) and **index base effects**: an index starting at a historical low (wolves in 1970) exaggerates recovery.
- **Detectability.** Aerial counts undercount forest species; that is one reason forest elephant numbers are so uncertain.

---

## 5. Proposal: resolution tiers and data format

### 5.1 Tiers

| Tier | Data | What the mesh does | Honesty marks |
|---|---|---|---|
| **A** annual / model-annual | ≥1 point per generation over ≥100 yr | Branch width and procgen births follow the curve, one segment per generation (or per 5 yr for short generations) | Solid edge. Card: source, units, "census" or "model reconstruction", 95% band if given |
| **B** sparse points | 2–8 dated absolute estimates | Log-linear interpolation between points, compiled to procgen ramps. Before the first point: hold at the first point or at the present-natural baseline | Each point is a tick on the branch edge, tappable. Interpolated spans get a dashed or hatched edge. Grade per point (B/C/D: "1800: 20–27 M, D") |
| **C** trend only | IUCN-style % change over 3 generations, or PHYLACINE range loss | One ramp over the stated window (3 generations, or 1800→now for range loss), from the implied start level to today | Dotted edge, "modelled" label. The size of the ramp comes from a rule, not data |
| **D** constant | Nothing | As today: one constant segment | No mark, or "no history known" in the card |

The edge style is drawn on the outline only, so the green/gray lanes stay readable. The card always says how many real points the curve has.

### 5.2 Data format addition

Store **dated points in years**, not segments. Segments depend on generation length, which the pipeline may revise. Compile points to procgen segments at build time.

```jsonc
// data/mammals/history.json (or a HIST section in skeleton/tiles)
{ "Loxodonta africana": {
    "stage": "all ages",            // census stage before conversion
    "interp": "log",                // between points: log-linear
    "points": [
      { "y": 1800, "n": 2.0e7, "lo": 1.0e7, "hi": 2.7e7, "g": "D", "src": 41, "k": "reconstruction" },
      { "y": 1979, "n": 1.3e6, "lo": 1.1e6, "hi": 1.8e6, "g": "C", "src": 42, "k": "estimate" },
      { "y": 2015, "n": 4.15e5,                       "g": "B", "src": 43, "k": "survey" },
      { "y": 2026, "n": 4.1e5,                        "g": "B", "src": 0,  "k": "anchor" } ],
    "baseline": { "n": 2.0e7, "g": "D", "rule": "first-point" } } }
```

- `src` indexes the existing `META.sources` table. `k` is one of census, survey, model reconstruction, estimate, index-anchored, trend-rule or anchor. The last point must equal the pipeline's alive-now value, so the green lane and the curve agree.
- **Compiling to procgen:** births per generation at time t is `B(t) = N_alive(t) · GL / L` (02 §3.1: births per year = N/L). A Segment boundary snaps to the generation containing each point. A log-linear span that changes more than 2× is split into linear sub-segments (one per factor of ~1.4), because `PopulationModel` ramps linearly. Add an optional `meta?: { grade, src, interp }` to `Segment`. procgen ignores it; the renderer reads it for edge styles.
- **River format:** add an additive `HIST` section (row → offset into a point blob). v1 decoders skip unknown sections, so no version bump. The existing `PROF` cannot carry it: its youngest bin is ~540 yr for a 1 Myr band.
- Generations per 200 yr: elephants and great whales ~8, bison and big cats ~25, lynx ~70. Annual data for long-lived species is therefore averaged into generations anyway. Tier A buys little over B for them, except honesty and the card.

### 5.3 Interaction with "individuals ever"

`N_ever ≈ Σ N_alive(t) Δt / L` (02 eq. 2) over the whole species span.

- **Wild species.** The last 200 years are ~0.02% of a 1 Myr span, so the recent curve itself barely changes the total. What matters is the **level before the decline**. Today the model scales the deep past from today's count. For a species now at 2–5% of its 1800 level (elephants, bison, sea otter, blue whale), ever-lived is then 20–50× too low. Proposal: the deep-time level comes from `baseline`, i.e. the first historical point or `N_now × (present-natural range ÷ current range)` from PHYLACINE. The recent curve then joins baseline to now. This is the largest numerical change in this note, so it should be a deliberate decision.
- **Humans.** Births since 1800 are ~1.8e10 of ~1.18e11 (~15%, my estimate from WPP/HYDE birth rates). HYDE 3.4 + WPP give an annual curve from 10,000 BCE, consistent with PRB's total. Grade A since 1950, B before.
- **Livestock.** Most domestic births are recent: herds grew several-fold since 1900, with ~3e8 cattle slaughtered a year now. FAOSTAT 1961– changes the totals directly. Before 1961 is modelled (C/D) back to domestication (~10.5 ka).
- **Extinct late-Quaternary species** (mammoth, cave lion, steppe bison). There is no census, only Ne shape (D) and Damuth-style levels (02 §3.3). Tier C at best.

---

## 6. Options for the user

**Option 1: flagships only, hand-curated (recommended first step).**
About 40–60 species: humans, 8 livestock, elephants, great whales, bison, sea otter, pinnipeds, big cats, wolves, white rhino, beaver and saiga, each from primary papers and agency data. Tiers A/B; everyone else stays D.
- *Pros:* licence-clean (cited facts, CC0/CC BY/US federal); every point checkable; small (a few KB); delivers exactly the stories the user asked for.
- *Cons:* coverage is anecdotal (<1% of species). It needs ~1–2 days of careful curation, and the baselines (1800 elephants, pre-contact bison) are D-grade.

**Option 2: Option 1 + a range-loss trend for every species.**
Add tier C for all ~5,800 PHYLACINE species: decline from present-natural to current range, as a ramp since ~1800 (or since human arrival for islands and the Americas). That ratio also sets the deep-time baseline for ever-lived.
- *Pros:* uniform, CC0, already pinned, covers extinct species, and fixes the depleted-baseline undercount everywhere.
- *Cons:* range loss is not population loss (density changes too), the ramp timing is a rule, and it changes many ever totals at once. It must be labelled "modelled" loudly.

**Option 3: database-driven.**
Ingest site-level series (GPDD CC0, BioTIME CC0/CC BY studies, CaPTrends) and anchor them to totals (§4); hand-curate the flagships.
- *Pros:* hundreds of species with real wiggles; good for small mammals with short generations (lynx/hare cycles).
- *Cons:* LPD and IUCN, the two richest sources, cannot ship. Site indices anchored to totals are the most misleading tier (§4). The work is large and most series are 10–40 years long. Not recommended now; maybe later for a "cycles" showcase (HBC lynx/hare).

### Open decisions

1. Option 1, 2 or 3, or 1 now and 2 next?
2. **Baseline rule for ever-lived:** may the recent history raise deep-time levels (and so ever-lived and width) for depleted species? This can move elephants, rhinos and great whales by 10–50×.
3. **Time axis near "now":** the fan's `TIME_C` = 1 kyr makes 1800–2026 ~2% of the height. With 50 yr it would be ~14%, at the cost of squashing 10 ka–1 Ma. Alternatives are a "recent history" zoom preset or an inset.
4. **Licence policy for cited numbers:** do we accept single figures quoted from non-commercial sources (AfESG, IUCN assessments) as uncopyrightable facts with citation, as Greenspoon already does for IUCN? Or open sources only (that would drop most elephant and lion points)?
5. **Unverified popular figures** (1900 tigers ~100 k, 1950s lions ~400 k, pre-trade sea otters 150–300 k): show them as D with a "popular estimate" label, or leave them out?
6. Do Ne-based deep-time shapes (mammoth, horse, bison) go in at grade D, or wait?

---

## 7. References

- ZSL/WWF. Living Planet Database 2026.1 and Data Use Policy. https://www.livingplanetindex.org/data_portal ; https://www.livingplanetindex.org/documents/LPI_Data_Use_Policy_2026.pdf
- Living Planet Index, about the index (2020 mammal population count). https://livingplanetindex.org/about_index
- Dornelas M et al. (2025). BioTIME 2.0: expanding and improving a database of biodiversity time series. *Global Ecology and Biogeography*. https://researchonline.ljmu.ac.uk/id/eprint/26820/ ; usage and licences: https://biotime.st-andrews.ac.uk/usageGuidelines.php
- NERC Centre for Population Biology (2010). The Global Population Dynamics Database v2. KNB doi:10.5063/F1BZ63Z8 ; https://docs.ropensci.org/rgpdd/ ; https://boninabox.geobon.org/tool-detail?id=73
- Johnson TF et al. (2022). CaPTrends: a database of large carnivoran population trends. *GEB* 31:2475. doi:10.1111/geb.13587. https://nora.nerc.ac.uk/id/eprint/533500/
- IUCN Red List terms (IUCN-family terms consulted: https://nationalredlist.org/node/21776 ; https://iucnrle.org/terms-of-use). The redlist.org terms page returned 403 and was not read directly.
- Thouless CR et al. (2016). African Elephant Status Report 2016. IUCN SSC Occasional Paper 60. https://portals.iucn.org/library/node/46878 ; database: https://africanelephantdatabase.org/report
- Chase MJ et al. (2016). Continent-wide survey reveals massive decline in African savannah elephants. *PeerJ* 4:e2354. https://peerj.com/articles/2354
- Edwards CTT et al. (2024). Survey-based inference of continental African elephant decline. *PNAS*. doi:10.1073/pnas.2403816121. https://newsmediarelations.colostate.edu/2024/11/12/50-years-of-survey-data-confirm-african-elephant-decline/
- Our World in Data. Elephant populations (1979 point; Milner-Gulland & Beddington). https://ourworldindata.org/elephant-populations
- 1800 elephant estimates (secondary): https://spectrum.ieee.org/amp/the-deaths-of-elephants-2650273647
- Asian elephant estimates: https://ielc.libguides.com/sdzg/factsheets/asianelephant/population ; CITES SC61 Doc. 44.2: https://cites.org/sites/default/files/eng/com/sc/61/E61-44-02-A1.pdf ; India 2025: https://www.khaleejtimes.com/world/asia/jumbo-drop-india-elephant-population
- Rocha RC, Clapham PJ, Ivashchenko YV (2014). Emptying the oceans: a summary of industrial whaling catches in the 20th century. *Mar. Fish. Rev.* 76(4). Via https://ourworldindata.org/grapher/whales-killed-per-decade
- Christensen LB (2006). Marine mammal populations: reconstructing historical abundances at the global scale. *Fisheries Centre Research Reports* 14(9), UBC. https://circle.ubc.ca/handle/2429/41154
- Pershing AJ et al. (2010). The impact of whaling on the ocean carbon cycle. *PLoS ONE* 5:e12444. https://journals.plos.org/plosone/article?id=10.1371/journal.pone.0012444
- Branch TA, Matsuoka K, Miyashita T (2004). Evidence for increases in Antarctic blue whales based on Bayesian modelling. *Mar. Mamm. Sci.* 20:726. https://open.uct.ac.za/handle/11427/17262
- Zerbini AN et al. (2019). Assessing the recovery of an Antarctic predator from historical exploitation. *R. Soc. Open Sci.* 6:190368. https://nora.nerc.ac.uk/id/eprint/525442/
- IWC catch data. https://iwc.int (summary spreadsheets; individual catch database on request)
- Hornaday WT (1889). The extermination of the American bison. Smithsonian Annual Report. https://www.americanyawp.com/reader/?p=393 ; Shaw JH (1995) review: https://journals.uair.arizona.edu/index.php/rangelands/article/viewFile/11258/10531 ; Aune K et al. (2017), IUCN *Bison bison* assessment: https://ielc.libguides.com/sdzg/factsheets/americanbison/population
- Doroff A et al. (2011); IUCN *Enhydra lutris* assessment (2020). https://iucnosgbull.org/Volume28A/Doroff_et_al_2011.html ; https://www.otterspecialistgroup.org/osg-newsite/wp-content/uploads/2018/03/4.-Enhydra-lutris-Red-List-2020.pdf
- NOAA AFSC. Northern fur seal pup production, adult male counts and harvest data, Pribilof Islands, 1909–present. https://catalog.data.gov/dataset/northern-fur-seal-pup-production-adult-male-counts-and-harvest-data-for-the-pribilof-islan
- Bauer H et al. (2015). Lion populations are declining rapidly across Africa, except in intensively managed areas. *PNAS* 112:14894. https://research.slu.se/en/publications/lion-panthera-leo-populations-are-declining-rapidly-across-africa/
- Global Tiger Forum (2022) via WWF: https://www.worldwildlife.org/news/stories/new-tiger-population-estimate-of-5574-wild-tigers-announced-by-global-tiger-forum ; NTCA/WII (2023), Status of tigers, co-predators and prey in India 2022: https://ruralindiaonline.org/en/library/resource/status-of-tigers-co-predators-and-prey-in-india-2022/
- ZSL, BirdLife International & EBCC (2022). Wildlife Comeback in Europe (update of Deinet et al. 2013). https://rewildingeurope.com/news/european-wildlife-comeback-new-report-shows-wildlife-will-return-if-we-give-it-space-to-recover/
- Elton C, Nicholson M (1942). The ten-year cycle in numbers of the lynx in Canada. *J. Anim. Ecol.* 11:215. https://jxshix.people.wm.edu/2009-harbin-course/classic/Elton-1942-J-Anim-Ecol.pdf ; `tsibbledata::pelt`: https://search.r-project.org/CRAN/refmans/tsibbledata/html/pelt.html
- Klein Goldewijk K et al. HYDE 3.3/3.4. https://public.yoda.uu.nl/geo/UU01/94FNH0.html ; HYDE 3.2 paper, *ESSD* 9:927 (2017).
- FAO Statistical Database Terms of Use (CC BY 4.0). https://www.fao.org/contact-us/terms/db-terms-of-use
- Faurby S et al. (2018). PHYLACINE 1.2. *Ecology* 99:2626. Dryad doi:10.5061/dryad.bp26v20
- Greenspoon L et al. (2023). The global biomass of wild mammals. *PNAS* 120:e2204892120.
- Ceballos G, Ehrlich PR, Dirzo R (2017). Biological annihilation via the ongoing sixth mass extinction. *PNAS* 114:E6089.
- Lorenzen ED et al. (2011). Species-specific responses of Late Quaternary megafauna to climate and humans. *Nature* 479:359. https://pmc.ncbi.nlm.nih.gov/articles/PMC4070744
- Shapiro B et al. (2004). Rise and fall of the Beringian steppe bison. *Science* 306:1561.
- Palkopoulou E et al. (2015). Complete genomes reveal signatures of demographic and genetic declines in the woolly mammoth. *Curr. Biol.* 25:1395.
- Frankham R (1995). Effective population size/adult population size ratios in wildlife: a review. *Genet. Res.* 66:95. https://www.cambridge.org/core/product/59D48CF3CCD19ECE47163795F6EEA89E
- PSMC caveats: https://www.molecularecologist.com/2016/05/opening-pandoras-box-psmc-and-population-structure/ ; https://www.biorxiv.org/content/10.1101/2024.06.17.599025.full.pdf
- Australian Threatened Species Index. https://www.tsx.org.au
- Roman J, Palumbi SR (2003). Whales before whaling in the North Atlantic. *Science* 301:508.
