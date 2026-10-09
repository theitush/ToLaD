# 02 — Population estimates: alive now vs. ever lived

Research notes for ToLaD (Tree of Life and Death). Branch width = individuals ever lived (alive + dead); green share = alive / total.

Notation: `1e30` means 10^30. "~" means order of magnitude. Ranges are rough 95% intervals unless stated.
Confidence grades used below:

- **A**: a peer-reviewed global census with stated uncertainty (within about 2–3x)
- **B**: a peer-reviewed estimate or extrapolation (within about 10x)
- **C**: a back-of-envelope figure from a popular or secondary source, or my own derivation from A/B inputs (within about 100x)
- **D**: an illustrative model output (could be off by 1,000x or more)

---

## 1. Headline conclusions

1. **The tree is overwhelmingly gray.** About 1e30 cells are alive today, and 1e39–1e40 cells have ever lived (Crockford et al. 2023). At the root, the alive share is about 1e-10 to 1e-9. Almost every clade's green share is roughly `(mean lifespan) / (effective clade duration)`. That ratio is about 1e-8 to 1e-10 for most clades. Humans are the outlier at about 7% (8.3e9 alive out of about 1.18e11 ever born). On a linear width scale, the green would be invisible everywhere except humans and very young or recently booming clades. Green share therefore needs its own encoding, such as a log-scaled green fraction or a minimum visible sliver, rather than a literal proportional fill.
2. **Width is dominated by microbes and turnover, not by standing stock.** Cyanobacteria and marine heterotrophic bacteria have generation times of days and have lasted billions of years, so they dominate ever-lived counts. Subsurface prokaryotes are about half of all cells alive today, but with turnover times of about 1e3 years they are a negligible share of cells that have ever lived.
3. **Animals span about 30 orders of magnitude.** Nematodes and copepods are about 1e30 ever. Insects are about 1e28, fish about 1e23 (more if larvae count), mammals about 1e19.5, birds about 1e18.5, *T. rex* 2.5e9 and humans 1.2e11. On a log scale everything fits between about 1e9 and 1e41.
4. **Viruses would out-width all cellular life combined** (about 1e31 virions now and about 1e40–1e42 ever) if you count virions. Viruses are also polyphyletic and do not descend from LUCA as one clade. Recommendation: put them in a separate "Viruses (not a clade)" forest beside LUCA with their own toggle, and use a documented "individual" definition (Section 5).
5. **Few clades have direct estimates.** Only a handful of nodes have defensible alive counts, and only humans, *T. rex* and all cells together have published ever-lived counts. Everything else must be **modelled** from (a) alive count or biomass, (b) census-stage lifespan, and (c) clade duration with an abundance-through-time curve. It then has to be **reconciled** across the tree (Section 3).

---

## 2. Table: clade → alive now → ever lived → source / confidence

"Ever lived" figures marked **(derived)** are my calculations with the Section 3 formula: `N_ever ≈ N_alive × T_eff / L`. Here `L` is the mean residence time at the census stage, and `T_eff` is the clade's duration weighted by abundance relative to today. Inputs are shown so they can be recomputed.

### 2.1 Whole-of-life and microbial

| Clade / node | Alive now | Ever lived | Source / confidence |
|---|---|---|---|
| **All cellular life (LUCA)** | ~1e30 cells | **1e39–1e40 cells** | Ever lived: Crockford, Bar-On, Ward, Milo & Halevy 2023, *Curr. Biol.* 33:4741, "The geologic history of primary productivity" (doi:10.1016/j.cub.2023.09.040). They integrate gross primary productivity over 4 Gyr (1e11–1e12 Gt C fixed) and calibrate it with today's cells-per-productivity ratio. They also find autotrophs outnumber heterotrophs throughout history, with cyanobacteria the likely largest group. **B.** Alive: Bar-On et al. 2018; Flemming & Wuertz 2019. **A/B.** |
| Cross-check (prokaryote production) | — | ~6e39 | Whitman et al. 1998 (*PNAS* 95:6578) give total prokaryote cell production of 1.7e30 cells/yr. 1.7e30 × ~3.8e9 yr ≈ 6e39, which is consistent with Crockford. **B.** |
| **Bacteria + Archaea** | **1.2e30** cells (older figure 4–6e30) | ~1e39–1e40 | Flemming & Wuertz 2019, *Nat. Rev. Microbiol.* 17:247. By habitat: deep oceanic subsurface 4e29, deep continental subsurface 3e29, soil 3e29, ocean 1e29, upper sediment 5e28. 40–80% of cells live in biofilms. Whitman 1998 gave 4–6e30, revised down after Kallmeyer et al. 2012 (*PNAS* 109:16213; subseafloor sediment 2.9e29). Bar-On et al. 2018 (*PNAS* 115:6506) give biomass of bacteria ≈70 Gt C (10x uncertainty) and archaea ≈7 Gt C (13x). **A/B.** |
| Bacteria | ~1e30 | ~1e39–1e40 | Derived split. Bacteria account for nearly all fast-turnover marine and surface cells. **B/C.** |
| Archaea | ~1e29–3e29 | ~1e38–1e39 (derived) | Biomass ratio about 1:10 against bacteria (Bar-On 2018). Mostly slow subsurface cells, plus about 1e28 marine Thaumarchaeota/Nitrososphaerota turning over about 10 times a year. **C.** |
| Cyanobacteria | ~4e27 (marine *Prochlorococcus* 2.9e27 + *Synechococcus* 7.0e26, plus freshwater and terrestrial) | ~1e39–1e40 (derived) | Flombaum et al. 2013, *PNAS* 110:9824 (alive, **A**). Ever lived: about 4e27 × ~300 divisions/yr × ~3e9 yr ≈ 4e39. This agrees with Crockford's statement that cyanobacteria probably dominate all cells ever. **B/C.** |
| SAR11 (*Pelagibacter*) | ~2.4e28 | ~1e38–1e39 (derived) | Morris et al. 2002, *Nature* 420:806–810 (alive: "2.4 × 10^28 SAR11 cells in the oceans", verified in the abstract). Ever lived assumes about 0.1–0.5 divisions/day over about 1 Gyr of effective duration. **C.** |
| Subsurface prokaryotes (habitat, not clade) | ~7e29 | <1e37 | Turnover is about 1–2e3 yr (Whitman 1998), so they make up half of today's cells but less than 0.1% of cells ever lived. This matters for clades that live mainly in the subsurface, such as Bathyarchaeia, Atribacterota and Dehalococcoidia: their green share is about 1000x higher than for surface clades. **C.** |

### 2.2 Eukaryotes (non-animal)

| Clade | Alive now | Ever lived | Source / confidence |
|---|---|---|---|
| Eukaryota (all) | ~1e27–1e28 (dominated by unicellular protists and algae) | ~1e37–1e39 (derived) | Bar-On 2018 protist biomass is ≈4 Gt C (4x uncertainty). Picophytoplankton biomass is about 0.74 Pg C, with picoeukaryotes making up 49–69% of it (Buitenhuis et al. 2012, *ESSD* 4:37). At about 0.5–1 pg C per cell, that gives about 1e26–1e27 picoeukaryotic cells. Heterotrophic nanoflagellates add about 1e25–1e26, and soil protists about 1e23–1e24. Ever lived assumes about 100–300 divisions/yr over an effective about 1–1.5 Gyr (eukaryotes were scarce before about 0.8 Ga). **C.** |
| "Protists" (paraphyletic) | ~1e27 | ~1e38 | As above. **Do not store this as a node.** Spread it across SAR, Haptista, Cryptista, Excavates, Amoebozoa, Chlorophyta and so on, using metabarcoding relative abundances (e.g., Tara Oceans). Most picoeukaryote numbers belong to green algae (Mamiellophyceae: *Ostreococcus*, *Micromonas*) and haptophytes. **C.** |
| Fungi | ill-defined; ~1e22–1e25 if counting yeast cells plus genets | ~1e32–1e35 (derived) | Bar-On 2018 gives fungal biomass ≈12 Gt C (3x). Mycelial "individuals" (genets) are not countable at global scale. Soil yeast-like cells are about 1e3–1e6 per g across about 1e19 g of topsoil. **D.** See Section 5. |
| Land plants (Embryophyta) | ~1e15–1e17 shoots/genets (herbs, grasses, mosses and seedlings dominate) | ~1e23–1e25 (derived) | My order-of-magnitude figure: about 1e2–1e4 shoots/m² over about 1e14 m² of vegetated land. Ever lived assumes a lifespan of about 1 yr over about 4.7e8 yr. **D.** Plant biomass is ≈450 Gt C (Bar-On 2018, 1.2x), but that is mostly wood. |
| Trees (growth form, not a clade) | **3.04e12** (stems ≥10 cm DBH) | ~1e19–1e20 (derived) | Crowther et al. 2015, *Nature* 525:201 (alive, **A**; down about 46% since the start of civilisation, so about 5.6e12 pre-human). Ever lived: about 5e12 × 3.5e8 yr / about 70 yr residence ≈ 2e19. **C.** Split across seed plants and ferns using species counts. |

### 2.3 Animals

| Clade | Alive now | Ever lived | Source / confidence |
|---|---|---|---|
| Animalia (total) | ~1e21–1e22 (nematodes plus copepods and other micro-arthropods) | ~1e30–1e31 (derived) | Bar-On 2018 gives animal biomass ≈2 Gt C (5x), with the largest shares in marine arthropods (1 Gt C) and fish (0.7). **C.** |
| **Nematoda** | ~1e21 (soil **4.4 ± 0.64e20**, plus marine sediments ~1e20–1e21) | **~1e30–1e31** (derived) | van den Hoogen et al. 2019, *Nature* 572:194 (soil, **A**). For marine sediments I use about 1e6/m² across 3.6e14 m² (**C**). Ever lived: 1e21 × ~10 generations/yr × ~4e8 yr ≈ 4e30. **C.** These are probably the most numerous animals ever, alongside copepods. |
| Copepoda | ~1e21 | ~1e29–1e31 (derived) | Boxshall's back-of-envelope estimate assumes 1 copepod per litre of seawater, giving about 1.3e21 (secondary sources, **C**). Ever lived assumes about 5 generations/yr over about 3e8 yr. **C/D.** |
| Terrestrial arthropods | soil arthropods **~1e19** (2x range; about 95% mites and springtails) | — | Rosenberg et al. 2023, *Sci. Adv.* (doi:10.1126/sciadv.abq4049). Total terrestrial arthropod dry biomass is ≈300 Mt (100–500). **A/B.** |
| Insecta | ~1e19 ("10 quintillion") | **~1e27–1e28.5** (derived) | Smithsonian "BugInfo" figure, origin unsourced (**C**). Ever lived: 1e19 × ~2/yr × ~3e8 yr effective ≈ 6e27. **C.** Springtails are Collembola, not Insecta, so keep Rosenberg's soil count separate. |
| Formicidae (ants) | **≥2e16** (lower bound, excludes subterranean ants) | ~1e23–1e25 (derived; ~1e24) | Schultheiss et al. 2022, *PNAS* 119:e2201550119 (alive, **A/B**; 12 Mt C). Ever lived assumes worker turnover of about 1/yr, near-modern abundance since about 50 Ma, and low abundance from about 140 to 50 Ma. **C.** |
| Antarctic krill (*Euphausia superba*) | ~3–5e14 | — | Popular sources, from biomass of about 130–500 Mt (**C**). |
| Fish (non-tetrapod vertebrates) | ~1e14–1e16 post-larval (mesopelagic dominated; *Cyclothone* bristlemouths alone are about 1e14–1e15) | ~1e22–1e24 post-larval; **1e25–1e27 if hatched larvae count** (derived) | Bar-On 2018 gives fish ≈0.7 Gt C. Irigoien et al. 2014 (*Nat. Commun.* 5:3271) revise the ~1 Gt (1,000 Mt) mesopelagic fish estimate upward by "at least one order of magnitude", i.e. ≳10 Gt wet. Bristlemouth figures come from Wikipedia and WHOI (**C**). Annual wild catch is 1.1–2.2e12 individuals (Animal Welfare 2024, **B**). The census-stage choice changes the ever-lived figure by about 1000x (Section 5). |
| Aves (wild) | **~5e10** (median of species sums; the mean across Monte Carlo is 4.3e11) | ~1e18–1e19 (derived; ~2.5e18) | Callaghan, Nakagawa & Cornwell 2021, *PNAS* 118:e2023170118, covering 9,700 species (**B**). Ever lived: 5e10 × ~0.5/yr × ~1e8 yr (Neornithes). **C.** Domestic poultry adds about 2.6e10 alive (FAOSTAT, 2018 poultry stocks) and about 1e12.5 ever (derived from slaughter of about 7e10/yr in recent decades). |
| Non-avian Dinosauria | 0 | ~1e13–1e16 (illustrative) | Starrfelt & Liow 2016 (*Phil. Trans. R. Soc. B*) put true species richness at about 1.5–2.5e3. My figure uses about 2e3 species × about 2 Myr each × about 1e5–1e6 individuals per species / about 10 yr lifespan. **D.** |
| *Tyrannosaurus rex* | 0 (about 2e4 alive at any one time) | **2.5e9** (95%: 1.4e8–4.2e10) | Marshall et al. 2021, *Science* 372:284 (Damuth's law, about 127,000 generations, Monte Carlo). **B.** This is the template for the methodology. |
| Mammalia (wild) | ~1e11–1e12 (rodents and bats dominate counts) | ~1e19–1e20.5 (derived) | Greenspoon et al. 2023, *PNAS* 120:e2204892120 give biomass only: terrestrial wild mammals ≈20 Mt (13–38), marine ≈40 Mt. Dividing by an abundance-weighted mean mass of about 30–100 g gives about 2e11–7e11. Tomasik (reducing-suffering.org) gives 1e11–1e12 (**C**). Ever lived: 3e11 × ~1/yr × ~1.5e8 yr. **C.** |
| Livestock mammals | ~4.4e9 (FAOSTAT 2024 world stocks: cattle 1.58e9, sheep 1.36e9, goats 1.19e9, pigs 0.96e9, buffalo 0.21e9) | ~1e11.5 (derived) | FAOSTAT QCL "Stocks", World, 2024 (checked 2026-10-09 against the bulk download; **B**). Livestock biomass is ≈630 Mt (Greenspoon 2023). |
| Reptiles / Amphibians | ~1e11–1e14 each | ~1e19–1e22 (derived) | Tomasik ranges (**D**). Use the allometric method instead (Section 3.3), with body masses from AmphiBIO and the Meiri reptile size data and densities from TetraDENSITY. |
| ***Homo sapiens*** | **~8.30e9** (UN WPP 2024 medium projection, 1 July 2026: 8,300,678,396) | **~1.17e11** (117,020,448,575 through 2022; about 1.176e11 by Oct 2026 adding WPP births of ~1.32e8/yr) | PRB (Kaneda, Greenbaum & Haub, Nov 2022), counting births since 190,000 BCE. The living are 6.8% of everyone ever born. **B** (PRB itself notes there are no data for over 99% of the period). |
| Genus *Homo* (all species) | 8.3e9 | ~1.2e11–1.5e11 (derived) | PRB's *H. sapiens* figure plus archaic *Homo*: about 2 Myr × about 1e5 census population / 25 yr ≈ 1e10. **D.** |

### 2.4 Viruses (outside the LUCA tree)

| Node | Alive now | Ever lived | Source / confidence |
|---|---|---|---|
| All viruses (virions) | **~1e31** particles (possibly up to 10x more or slightly fewer) | **~1e40–1e42 virions** (derived) | Mushegian 2020, *J. Bacteriol.* 202:e00052-20, re-deriving the "Hendrix product" (Hendrix et al. 1999, *PNAS*) (**B**). Bar-On 2018 puts virus biomass at ≈0.2 Gt C (20x). Ever lived: Suttle 2007 (*Nat. Rev. Microbiol.* 5:801) gives about 1e23 marine infections/s, which is about 3e30 infections/yr. A burst size of about 20–50 gives about 1e32 virions/yr. A standing stock of about 1e30.5 marine virions turning over every 1–10 days gives the same figure. Over about 3.5e9 yr that is about 1e41. **D.** |
| All viruses (infections as "individuals") | ~1e30 active infections at any moment? | ~1e40 | Same inputs. Using infections makes a virus "individual" commensurate with host cells. **D.** |

### 2.5 Species-level context (for the allocation step)

| Quantity | Value | Source |
|---|---|---|
| Described extant species | ~2.1–2.2e6 | Catalogue of Life |
| Estimated extant eukaryotic species | 8.7e6 ± 1.3e6 | Mora et al. 2011, *PLoS Biol.* |
| Estimated extant microbial "species" (OTUs) | 1e11–1e12 | Locey & Lennon 2016, *PNAS* 113:5970 (model extrapolation) |
| Species ever lived (eukaryote-centric) | 5e9–5e10 | Raup 1991, *Extinction: Bad Genes or Bad Luck?*, who also puts survivors at about 1 in 1,000 species |
| Fraction of species extinct | >99% (often quoted as 99.9%) | Raup 1991; standard textbook figure |
| Described fossil species | ~2.5e5 | Commonly quoted; PBDB holds far more occurrences |
| Mean species duration | ~1–10 Myr (mammals about 1–2, marine invertebrates about 5–10) | Paleobiology literature, e.g., via PBDB |

---

## 3. Methodology for clades without direct estimates

### 3.1 Core quantity and why this definition

Count individuals that ever **entered the census pool**, meaning they were born, hatched, germinated, budded or produced by fission:

```
N_ever(c) = ∫_{t0(c)}^{now} N_alive(c, t) / L(c, t) dt          (1)
```

- `N_alive(c,t)` is the standing population of clade c at time t.
- `L(c,t)` is the **mean residence time in the census pool**, which is the mean age at death of individuals counted in `N_alive`. It is **not** the generation time.
- The ToLaD rule: **the census stage used for `N_alive` must be the one used for `L` and for `N_ever`.** If birds are censused as adults, `L` is adult lifespan and `N_ever` counts individuals that reached adulthood. That keeps alive / total internally consistent. Pick one stage per clade and record it. Defaults are: cells at division; animals at hatching or birth for vertebrates and at the adult or free-living stage for invertebrates; plants as established individuals.
- At steady state, births equal deaths, so `1/L` is also the per-capita birth rate into the pool. For a binary-fission organism, count each division as one death and two births. The alternative convention counts the mother as continuing. The two differ by at most 2x, which is invisible on a log scale, but the choice should be documented.

Discretise (1) over time bins `k` (e.g., geological stages, or 1–10 Myr bins):

```
N_ever(c) = Σ_k  N_alive(c, t_k) · Δt_k / L(c, t_k)              (2)
```

Practical factorisation, with abundance-through-time expressed relative to today:

```
N_ever(c) ≈ N_now(c) / L(c) · T_eff(c),   T_eff(c) = Σ_k f_c(t_k) Δt_k,   f_c(t) = N_alive(c,t)/N_now(c)    (3)
```

For extinct clades, use `N_peak` in place of `N_now` and normalise `f` to the peak.

### 3.2 Getting each input

**(a) `N_now`, the standing population.** In order of preference:

1. A direct census, such as the Section 2 sources. For bird species use Callaghan 2021, and for mammal species the Greenspoon 2023 compilation (392 species).
2. Biomass divided by abundance-weighted mean body mass. Biomass comes from Bar-On 2018 by taxon, Greenspoon 2023 and Rosenberg 2023. Pitfall: use the **abundance-weighted** (harmonic-like) mean mass, not the mean species mass. Size spectra are steep, so most individuals sit at the small end.
3. Allometric density, the Damuth approach (3.3).
4. Allocation from the parent (3.4).

**(b) `L`, the census-stage residence time.**

- Vertebrates: generation length from Pacifici et al. 2013 (*Nature Conservation* 5:87; 5,427 mammals) and Bird et al. 2020 (*Conserv. Biol.* 34:1252; all birds, median 2.99 yr, range 1.42–27.9 yr). Also AnAge (longevity, age at maturity), the COMBINE mammal trait database, AmphiBIO, and FishBase or SeaLifeBase (longevity, K, age at maturity).
- Generation length is longer than mean lifespan in a high-mortality pool. A reasonable approximation is `L ≈ 1/m`, where `m` is the annual mortality rate. If only generation length `G` is known, `L ≈ G/2` is a reasonable default for adults.
- Microbes: division and turnover times by habitat from Whitman 1998. They are 6–25 days in the surface ocean, 0.8 yr in the deep ocean, 2.5 yr in soil, and 1e3 yr or more in the subsurface.
- Allometric fallback: `L ≈ L0 · M^0.25`. Brook & Bowman 2005 give generation length ∝ W^0.25 and r_max ∝ W^-0.25. Hatton et al. 2019 (*PNAS* 116:21616) show growth and mortality rates scale with exponents of about ±1/4 both within and across all eukaryotes. Calibrate `L0` separately for endotherms, ectotherms and unicells.

**(c) `T_eff`, effective duration.**

- The origin `t0` comes from TimeTree 5 (crown or stem age; pick stem age for ToLaD, since stem lineages are members of the branch) or from PBDB first appearance.
- The shape `f(t)` comes from the PBDB diversity curve of the clade. Use sampling-standardised genus richness (SQS or "shareholder quorum", or range-through counts). Proxy: `f(t) ≈ S(t)/S_now`.
- If there is no curve, use the default: a logistic ramp from 0 at `t0` to 1 by `t0 + 0.2 × age`.
- For microbes, scale `f(t)` by the clade's share of global primary productivity, following the Crockford time series.
- Using species richness as an abundance proxy assumes constant individuals per species. That is crude but standard, and it is the same assumption Marshall et al. make within a species.

### 3.3 Allometric (Damuth / Marshall) estimator for animal clades, extinct ones included

Per species `i`:

```
N_ever(i) = D(M_i) · A_i · τ_i / L(M_i)
D(M)  = d0 · M^b        b ≈ -0.75 (Damuth 1981, fitted -0.70 on 307 herbivorous mammals); across all eukaryotes, abundance ∝ M^-1 (Hatton 2019)
L(M)  = L0 · M^0.25
```

- `A_i` is geographic range area. For extant species use IUCN range maps. For fossils, estimate it from PBDB occurrence convex hulls, scaled up.
- `τ_i` is species duration. Use the PBDB range-through duration, or the clade-typical 1–3 Myr.
- `d0` and `L0` are group-specific intercepts. Fit them on extant data: TetraDENSITY (Santini, Isaac & Ficetola 2018, *GEB* 27:787–791, doi:10.1111/geb.12756) has more than 18,000 density estimates for terrestrial vertebrates. Marshall et al. 2021 added an ectotherm/endotherm correction for theropods.
- Combined: `N_ever(i) ∝ A_i · τ_i · M_i^(-1)`. Each 10x increase in body mass costs about 10x in individuals ever.

For a clade, sum over species. Unknown or unsampled species are filled in with a true-richness estimate, e.g., Starrfelt & Liow's Poisson sampling model for dinosaurs:

```
N_ever(c) = S_true(c) · median_i[ D(M_i) · A_i · τ_i / L(M_i) ]  × bias_correction(log-normal mean = median · exp(σ²/2))
```

This is what Marshall et al. did for *T. rex*. They used body mass of about 5.2 t, Damuth density with an ectotherm-to-endotherm correction, and a range of about 2.3e6 km². That gave about 2e4 alive at once and about 127,000 generations, so about 2.5e9 ever, with a Monte Carlo 95% CI of 1.4e8–4.2e10.

### 3.4 Propagating and reconciling across the tree

Store every node estimate as a log-normal: `{log10_median, log10_sd, method, census_stage, sources[], grade}`. Two passes:

**Pass 1, bottom-up (sum).** For node p with children c1..cn that all have estimates:

```
N(p) = Σ N(ci)       # linear-space sum
```

Do this by Monte Carlo: draw 1,000–10,000 samples per child in log space, sum them linearly, and take percentiles. The Fenton–Wilkinson approximation also works. The sum is dominated by the largest child, so the parent inherits mostly that child's uncertainty.

**Pass 2, top-down (allocate).** For node p with a direct estimate `E_p` (e.g., Crockford for LUCA, or Schultheiss for ants):

1. `R = E_p − Σ_{children with own estimates} N(ci)`.
   - If R < 0 beyond the joint uncertainty, flag a conflict and do not silently rescale.
   - If R < 0 within the uncertainty, scale children proportionally, in log space toward the parent.
2. Distribute R over the unestimated children with weights:

```
w_i = S_i^ever · M_i^(-1) · T_eff,i      (Damuth + lifespan allometry; S^ever = extant + estimated extinct species)
fallback w_i = S_i^ever · T_eff,i         (no body mass)
last resort w_i = leaf count in the Open Tree synthesis tree
```

3. Each allocated child gets the parent's log-sd plus an allocation penalty (e.g., +0.5 dex) and grade D.
4. Recurse.

**Combining multiple estimates for one node** (e.g., a direct census vs. the sum of its children): use an inverse-variance-weighted mean in log10 space, and keep both for the tooltip.

**Pitfalls of species-count allocation.** Species counts are a terrible proxy across body-size or lifestyle classes. Nematodes have about 25k described species and about 1e30 ever. Mammals have about 6.5k species and about 1e19.5. Only allocate by species count among siblings with similar body size and similar trophic or habitat mode. Otherwise apply the `M^-1` and turnover terms. For microbes, replace species counts with **relative abundance from metagenomics** (GTDB-classified Tara Oceans, Earth Microbiome Project, and soil and subsurface surveys) weighted by habitat turnover. The habitat splits are those of Flemming & Wuertz and Whitman.

### 3.5 Green share

```
green(c) = N_alive(c) / N_ever(c) ≈ L(c) / T_eff(c)     (for a clade at modern abundance)
```

- Extinct clades get exactly 0.
- Clades whose `f(t)` peaks today (e.g., *Homo sapiens*, domesticated chickens, recently radiated grasses) get unusually high green shares.
- Display suggestion: encode `log10(green)` as a hue or saturation ramp, or overlay a minimum-width green core line, because true proportions are usually below 1e-8.

### 3.6 Uncertainty display

- Typical uncertainty runs from ±0.3 dex (2x) for grade A to ±3 dex or more for grade D.
- Branch width uses the median. Show uncertainty as a soft or blurred outer band (lo–hi width) or as a whisker in the info panel. In linear mode, show the ranges numerically only.
- The info panel shows a three-number summary (`10^x (10^lo–10^hi)`), the method chain (e.g., "allocated from parent by M^-1 weighting"), the census stage, and the source links.
- Show the grade (A–D) as a small badge. Let users filter by "show only A/B-grade nodes".

---

## 4. Suggested data inputs (implementation checklist)

| Need | Source |
|---|---|
| Topology and taxonomy | Open Tree of Life synthesis and taxonomy; NCBI Taxonomy; GTDB for Bacteria and Archaea; ICTV for viruses |
| Divergence and first-appearance times | TimeTree 5; Paleobiology Database (PBDB) first and last occurrences |
| Diversity through time `f(t)` | PBDB API (`/diversity` with the range-through option, or an SQS-standardised curve); Sepkoski compendium for marine genera |
| Extant species counts | Catalogue of Life; Open Tree leaf counts |
| Body mass | PanTHERIA, EltonTraits 1.0, COMBINE (mammals); AVONET, EltonTraits (birds); AmphiBIO; Meiri 2018 reptile sizes; FishBase; BIEN and TRY (plants) |
| Generation and lifespan | Pacifici 2013 (mammals); Bird 2020 (birds); AnAge; FishBase; Whitman 1998 (microbes) |
| Population density | TetraDENSITY (Santini 2018); Damuth 1981 |
| Abundance or biomass anchors | Bar-On 2018 (GitHub milo-lab/biomass_distribution); Callaghan 2021; Greenspoon 2023; Rosenberg 2023; van den Hoogen 2019; Schultheiss 2022; Crowther 2015; Flombaum 2013; Flemming & Wuertz 2019 |
| Anchors for whole-life and ever-lived totals | Crockford 2023; Whitman 1998 production; PRB 2022; Marshall 2021 |

---

## 5. Defining an "individual": pitfalls

- **Prokaryotes.** One cell is one individual. Endospores and dormant cells count as alive. The Flemming & Wuertz biofilm finding (40–80% of cells) does not change the count. HGT does not affect counts, but it does affect **where counts attach in the tree**: deep prokaryote phylogeny is reticulate and its rooting is debated. The species concept is operational (e.g., 95% ANI in GTDB). Use the GTDB tree as the backbone and show "reticulate / uncertain" styling on deep prokaryote nodes.
- **Unicellular eukaryotes.** One cell is one individual. Colonial forms (*Volvox*, *Phaeocystis* colonies) count as colonies, or as cells if that is documented. Slime molds count as cells (Dictyostelium aggregates are not individuals).
- **Multicellular organisms.** Count organisms, not cells. A human has about 3e13 cells but counts once. Crockford's 1e39–1e40 counts **cells**. Because unicells dominate, the organism count for all life is essentially the same number.
- **Clonal organisms (genet vs. ramet).** Aspen clones like Pando, seagrasses, grasses, bryophytes, corals, siphonophores and fungal mycelia are all affected. Recommendation: count **ramets/shoots for plants**, **polyps/zooids for colonial animals only if** that is the census stage of the source, and **genets for fungi**, noting that genet counts are basically unknown. Lichens: count the fungal partner as the individual and the photobiont cells under their own clades.
- **Social insects.** Count workers, as Schultheiss does, not colonies.
- **Fish, insects and other high-fecundity species.** Eggs → larvae → adults can change the ever-lived count by 1e3–1e6. Default to the post-larval or adult census stage to match the alive sources, and offer the "hatched" stage as a documented alternative.
- **Humans.** PRB counts live births. Miscarriages and stillbirths are excluded.
- **Domestic animals.** They are in-clade individuals. Chickens: about 2.6e10 alive and about 7e10 slaughtered per year. They make a visible bump in Galliformes, with a high green share.
- **Viruses.** They are not alive in the metabolic sense and have no LUCA ancestry. ICTV lists six realms of independent origin (Riboviria, Duplodnaviria, Varidnaviria, Monodnaviria, Adnaviria, Ribozyviria), plus unassigned groups. Options:
  - *Virion*: one particle, which is what the 1e31 figure counts. A "dead" virion is one that has decayed or been inactivated. Epifluorescence counts include defective particles, gene-transfer agents and membrane vesicles.
  - *Infection*: one infected cell, which makes the count commensurate with hosts.
  - Integrated proviruses and prophages, and endogenous retroviruses (about 8% of the human genome), should **not** count as individuals.
  - Recommendation: default to virions, offer the infection unit as a toggle, render viruses in a separate forest, and default the overall view to cellular life so viruses do not dominate the scale.
- **Plasmids, transposons, prions, viroids.** Exclude them, or put viroids and satellites in the virus forest only.

---

## 6. Worked example (recompute check): Aves

- `N_now` = 5e10 (Callaghan median; adults).
- `L` = adult residence time ≈ 2 yr. Bird et al. 2020 give a median generation length of 3 yr, and `L ≈ G/2` gives about 1.5–2 yr.
- `T_eff`: crown birds go back about 100 Ma, but `f(t)` is low before the K–Pg boundary, so take about 8e7 yr at about modern abundance.
- `N_ever` ≈ 5e10 / 2 × 8e7 = **2e18**. The range is 1e17.5–1e19.5, driven by Callaghan's median-vs-mean gap and by `f(t)`.
- `green` ≈ 5e10 / 2e18 = **2.5e-8**.

---

## 7. Sources

- Crockford PW, Bar-On YM, Ward LM, Milo R, Halevy I (2023). The geologic history of primary productivity. *Current Biology* 33(21):4741–4750. https://doi.org/10.1016/j.cub.2023.09.040 (summary: https://carleton.ca/news/story/how-much-life-existed-on-earth/)
- Bar-On YM, Phillips R, Milo R (2018). The biomass distribution on Earth. *PNAS* 115:6506. https://pmc.ncbi.nlm.nih.gov/articles/PMC6016768/
- Whitman WB, Coleman DC, Wiebe WJ (1998). Prokaryotes: the unseen majority. *PNAS* 95:6578. https://pmc.ncbi.nlm.nih.gov/articles/PMC33863
- Flemming H-C, Wuertz S (2019). Bacteria and archaea on Earth and their abundance in biofilms. *Nat Rev Microbiol* 17:247. https://link.springer.com/article/10.1038/s41579-019-0158-9
- Kallmeyer J et al. (2012). Global distribution of microbial abundance and biomass in subseafloor sediment. *PNAS* 109:16213. https://pmc.ncbi.nlm.nih.gov/articles/PMC3479597
- Flombaum P et al. (2013). Present and future global distributions of *Prochlorococcus* and *Synechococcus*. *PNAS* 110:9824. https://dspace.mit.edu/handle/1721.1/88271
- Buitenhuis ET et al. (2012). Picophytoplankton biomass distribution in the global ocean. *ESSD* 4:37. https://essd.copernicus.org/articles/4/37/2012/
- Mushegian AR (2020). Are there 10^31 virus particles on Earth, or more, or fewer? *J Bacteriol* 202:e00052-20. https://pmc.ncbi.nlm.nih.gov/articles/PMC7148134/
- Suttle CA (2007). Marine viruses — major players in the global ecosystem. *Nat Rev Microbiol* 5:801. https://bionumbers.hms.harvard.edu/bionumber.aspx?id=102753
- van den Hoogen J et al. (2019). Soil nematode abundance and functional group composition at a global scale. *Nature* 572:194. https://hal.inrae.fr/hal-02627798
- Rosenberg Y et al. (2023). The global biomass and number of terrestrial arthropods. *Science Advances*. https://pmc.ncbi.nlm.nih.gov/articles/instance/9897674
- Schultheiss P et al. (2022). The abundance, biomass, and distribution of ants on Earth. *PNAS* 119:e2201550119. https://doi.org/10.1073/pnas.2201550119
- Smithsonian BugInfo: Numbers of insects. https://www.si.edu/spotlight/buginfo/bugnos
- Callaghan CT, Nakagawa S, Cornwell WK (2021). Global abundance estimates for 9,700 bird species. *PNAS* 118:e2023170118. https://www.sci.news/biology/bird-abundances-09669.html
- Greenspoon L et al. (2023). The global biomass of wild mammals. *PNAS* 120:e2204892120. https://doi.org/10.1073/pnas.2204892120
- Crowther TW et al. (2015). Mapping tree density at a global scale. *Nature* 525:201. https://environment.yale.edu/news/article/Yale-study-reveals-there-are-3-trillion-trees-on-earth
- Marshall CR et al. (2021). Absolute abundance and preservation rate of *Tyrannosaurus rex*. *Science* 372:284. https://news.berkeley.edu/2021/04/15/how-many-t-rexes-were-there-billions
- Population Reference Bureau (2022). How many people have ever lived on Earth? https://www.prb.org/articles/how-many-people-have-ever-lived-on-earth/
- Damuth J (1981). Population density and body size in mammals. *Nature* 290:699. https://pdodds.w3.uvm.edu/files/papers/others/1981/damuth1981a.pdf
- Hatton IA et al. (2019). Linking scaling laws across eukaryotes. *PNAS* 116:21616. https://pmc.ncbi.nlm.nih.gov/articles/PMC6815163
- Pacifici M et al. (2013). Generation length for mammals. *Nature Conservation* 5:87. https://datadryad.org/dataset/doi:10.5061/dryad.gd0m3
- Bird JP et al. (2020). Generation lengths of the world's birds. *Conserv Biol* 34:1252. https://datazone.birdlife.org/species/genlength
- Locey KJ, Lennon JT (2016). Scaling laws predict global microbial diversity. *PNAS* 113:5970. https://pmc.ncbi.nlm.nih.gov/articles/PMC4889364
- Raup DM (1991). *Extinction: Bad Genes or Bad Luck?* W.W. Norton.
- Starrfelt J, Liow LH (2016). How many dinosaur species were there? *Phil Trans R Soc B* 371:20150219. https://www.nationalgeographic.com/science/article/most-dinosaur-species-are-still-undiscovered/
- Wild fish catch numbers (2024), *Animal Welfare*. https://www.ncbi.nlm.nih.gov/pmc/articles/PMC10951671/
- Tomasik B. How many wild animals are there? https://reducing-suffering.org/how-many-wild-animals-are-there
- Bristlemouth abundance: https://twilightzone.whoi.edu/bristlemouth-dominance-how-do-we-know/

**Citation checks (2026-10-09, data pipeline v0).** The figures this note had cited from memory were checked against the primary sources (Crossref metadata, publisher abstracts, or the pinned data files in `pipeline/SOURCES.md`):

- **FAOSTAT livestock stocks: fixed.** World stocks for 2024 (latest year in the bulk QCL file): cattle 1,578,614,149; sheep 1,362,590,940; goats 1,187,524,236; pigs 962,441,623; buffalo 212,008,800. The 2.3 row now uses these. The pipeline reads them straight from the pinned file.
- **UN WPP figure for 2026: confirmed.** WPP 2024 medium variant, World, 1 July 2026: 8,300,678,396. Births are ~1.32e8 a year over 2022–2026.
- **PRB total: confirmed.** Table 1 lists 117,020,448,575 born through 2022. The authors are Kaneda, Greenbaum & Haub (Nov 2022), not just Kaneda & Haub.
- **Schultheiss DOI: confirmed.** It is 10.1073/pnas.2201550119 (*PNAS* 119:e2201550119, 2022). The source list now links the DOI instead of the press story.
- **Santini 2018 TetraDENSITY: confirmed, with fuller details.** Santini, Isaac & Ficetola 2018, *Global Ecology and Biogeography* 27:787–791, doi:10.1111/geb.12756. The abstract says "> 18,000 records".
- **Morris 2002 SAR11: confirmed.** *Nature* 420:806–810, doi:10.1038/nature01240. The abstract gives "2.4 × 10^28 SAR11 cells in the oceans".
- **Irigoien 2014: wording fixed.** *Nat. Commun.* 5:3271, doi:10.1038/ncomms4271. The paper does not state "10 Gt" directly. It says the ~1,000 Mt estimate "needs to be revised to at least one order of magnitude higher". The fish row now says this.
- **Still unchecked (flagged):** the bristlemouth abundance (Wikipedia/WHOI), the Smithsonian insect count, and Tomasik's ranges. These are secondary sources and stay grade C/D.
