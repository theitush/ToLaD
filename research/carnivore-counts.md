# Carnivore alive-now against IUCN and cited figures (ToLaD#183)

Every living wild carnivore whose alive-now is at least 1M, plus every VU/EN/CR carnivore at least 100k, from
`data/build/audit_leaves.json` after the #183 build (main bef01b2 plus the otter land rule). 56 rows.

**What the IUCN snapshot carries.** `data/raw/redlist/iucn-2026-1.zip` is GBIF's Darwin Core copy of the
Red List: per species the category, the assessment citation and its year. It has **no population size and no
criteria text**, so neither column below comes from it. An "IUCN figure" here is the population report Greenspoon
et al. 2023 compiled from IUCN assessments (`census` rows), or a figure found on the web and cited.

**The ceiling rule.** IUCN criteria C and D cap a threatened species' size (VU < 10,000 mature, EN < 2,500,
CR < 250); criterion A alone has no cap. Without criteria in the snapshot, a C/D listing can't be told from an
A listing. A VU/EN check without criteria would flag 417 VU and 405 EN species modelled above their C bound,
nearly all of them, so the audit's `ceiling` check stays on CR/EW (#88). Its comment now says why. Every
threatened suspect checked by hand is A-listed, so a cap would not have touched it:

| species | IUCN | criteria | source |
|---|---|---|---|
| *Vormela peregusna* | VU 2016 | A2c | [Acta Zool. Bulg. 2022](https://acta-zoologica-bulgarica.eu/2022/002566) (citing the assessment) |
| *Aonyx cinereus* | VU 2021 | A2cde+3cde | [SeaLifeBase](https://sealifebase.ca/summary/71062) (assessment of 2020-02-19) |
| *Pagophilus groenlandicus* | NT 2025 | A2cd | [SeaLifeBase](https://sealifebase.se/summary/Pagophilus-groenlandicus) |

**The rule that fixed a whole class: otters were counted as marine.** PHYLACINE codes a species `Marine` if it
uses the sea at all. Otters, the polar bear, the hippo, the arctic fox and the water rat are also coded
`Terrestrial`. As "marine", their count used the occupancy fitted on marine census species, a fit whose
Carnivora effect is set by seal censuses (harp seal 13.5M, crabeater 12M), applied to a land range. They also
skipped Greenspoon's land model, which counts them as land animals.

The rule (`model.py`): a species coded terrestrial and marine, outside the marine clades (Cetacea, Sirenia,
pinnipeds), is a land species. It changed only these species. The rest move by 7% or less through the refit.

| species | before | after | now from |
|---|---|---|---|
| *Lutra sumatrana* (EN) | 1.13M | 9,624 | Greenspoon model |
| *Lutrogale perspicillata* (VU) | 1.93M | 36,333 | Greenspoon model |
| *Lutra lutra* (NT) | 1.74M | 86,257 | Greenspoon model |
| *Aonyx capensis* | 401k | 39,724 | Greenspoon model |
| *Lontra canadensis* | 1.05M | 107,535 | Greenspoon model |
| *Lontra felina* (EN) | 77k | 8,108 | Greenspoon model |
| *Aonyx cinereus* (VU) | 7.17M | 1.17M | density model (Greenspoon has no figure) |
| *Vulpes lagopus* | 132k | 25,839 | density model (see below) |
| *Hydromys chrysogaster* | 4.19M | 6.27M | Greenspoon model |

The audit's four `today` flags (otters ×10 to ×117 above Greenspoon's per-species figure) are gone: 236 → 232
flagged, and no new flag appeared.

**The arctic fox got worse.** It went from 132k (marine fit) to 25.8k (land fit). The only global figure found is
"in the order of several hundred thousand" (Tannerfeldt 1997, via [Wikipedia](https://en.wikipedia.org/wiki/Arctic_fox)),
so it is now about ×12 low. A history point was tried, but the pipeline lets only a point from 2000 or later, graded
A–C, set today's count (`history.ALIVE_MIN_YEAR`). The 1997 point would only have drawn a false 300k → 26k crash,
so the file was dropped. It is a leftover.

## The table

Verdict = our figure ÷ the comparison figure. "unverifiable" = no IUCN or cited figure was found or searched for.
It is not a judgement that the figure is right.

| species | IUCN | ours | our source | comparison figure | verdict |
|---|---|---|---|---|---|
| *Mustela nivalis* | LC 2019 | 80.9M | Greenspoon model | none. Implied 1.58/km² over its 51.2M km² PHYLACINE range; cited densities run from 0 to ~13/km² ([King & Powell 2007](https://academic.oup.com/book/6132/chapter/149692106)) | plausible, unverifiable |
| *Mustela erminea* | LC 2016 | 42.9M | Greenspoon model | none. Implied 0.86/km² over 49.9M km²; cited densities run from 0 to ~22/km² (King & Powell 2007) | plausible, unverifiable |
| *Procyon lotor* | LC 2016 | 40.0M | census (non-IUCN source via Greenspoon 2023) | Greenspoon model 31.4M | ok (×1.3) |
| *Galerella sanguinea* | LC 2016 | 20.1M | Greenspoon model | none | unverifiable |
| *Vormela peregusna* | VU 2016 (A2c) | 15.9M | Greenspoon model | none; no density found. Implied 1.54/km² over 10.3M km² | unverifiable, suspect |
| *Pagophilus (Phoca) groenlandicus* | NT 2025 | 13.5M | census (IUCN via Greenspoon 2023) | NW Atlantic 4.4M in 2024 (DFO 2024 stock assessment, published 2025, as reported in a web search and not read directly; the earlier re-analysis, [DFO Res. Doc. 2023/068](https://dfo-mpo.gc.ca/csas-sccs/Publications/ResDocs-DocRech/2023/2023_068-eng.html), gives 4.7M for 2019) + West Ice 0.43M + White/Barents Sea 1.50M in 2019 ([NAMMCO](https://nammco.no/harp-seal/)) ≈ 6.3M | ×2.1 high |
| *Ictonyx striatus* | LC 2015 | 12.2M | Greenspoon model | none | unverifiable |
| *Lobodon carcinophaga* | LC 2025 | 12.0M | census (IUCN via Greenspoon 2023) | latest point estimate 7M, called a likely underestimate; 1970s surveys ~12M ([Wikipedia](https://en.wikipedia.org/wiki/Crabeater_seal)) | ok (×1.7 above a low figure) |
| *Poecilogale albinucha* | LC 2015 | 7.96M | Greenspoon model | none | unverifiable |
| *Helogale parvula* | LC 2015 | 6.44M | Greenspoon model | none | unverifiable |
| *Mustela sibirica* | LC 2024 | 5.97M | Greenspoon model | none | unverifiable |
| *Spilogale putorius* | VU 2016 | 5.66M | Greenspoon model | none range-wide. Implied 1.52/km² over 3.7M km²; Florida densities of 6.5–23/km² ([J Mammal 2021](https://bioone.org/journals/journal-of-mammalogy/volume-102/issue-3/gyab039/High-density-and-survival-of-a-native-small-carnivore-the/10.1093/jmammal/gyab039.full)) are local | unverifiable |
| *Mustela africana* | LC 2016 | 5.38M | Greenspoon model | none | unverifiable |
| *Vulpes cana* | LC 2015 | 5.14M | Greenspoon model | none | unverifiable |
| *Pusa hispida* | LC 2016 | 4.50M | census (IUCN via Greenspoon 2023) | the same | IUCN figure |
| *Mustela putorius* | LC 2016 | 4.48M | Greenspoon model | none | unverifiable |
| *Spilogale gracilis* | LC 2016 | 3.73M | Greenspoon model | none | unverifiable |
| *Martes americana* | LC 2016 | 3.72M | Greenspoon model | none | unverifiable |
| *Mustela altaica* | NT 2016 | 3.70M | Greenspoon model | none | unverifiable |
| *Suricata suricatta* | LC 2015 | 3.62M | Greenspoon model | none | unverifiable |
| *Ictonyx libyca* | LC 2015 | 3.56M | density model | none | unverifiable |
| *Lynx rufus* | LC 2016 | 3.50M | census (non-IUCN source via Greenspoon 2023) | Greenspoon model 2.75M | ok (×1.3) |
| *Canis anthus* | NE | 3.22M | density model | none | unverifiable |
| *Arctocephalus pusillus* | LC 2015 | 3.18M | census (IUCN via Greenspoon 2023) | the same | IUCN figure |
| *Vulpes vulpes* | LC 2021 | 3.13M | Greenspoon model | none global. Implied 0.06/km² over 55.3M km², low for the most widespread carnivore | suspect low, unverifiable |
| *Mustela frenata* | LC 2016 | 3.02M | Greenspoon model | none | unverifiable |
| *Poiana richardsonii* | LC 2015 | 2.88M | Greenspoon model | none | unverifiable |
| *Helogale hirtula* | LC 2015 | 2.62M | Greenspoon model | none | unverifiable |
| *Mustela kathiah* | LC 2024 | 2.43M | Greenspoon model | none | unverifiable |
| *Melogale moschata* | LC 2024 | 2.39M | Greenspoon model | none | unverifiable |
| *Hydrictis maculicollis* | NT 2021 | 2.28M | density model | none | unverifiable |
| *Cynictis penicillata* | LC 2015 | 2.15M | Greenspoon model | none | unverifiable |
| *Urva javanica* | LC 2016 | 2.03M | Greenspoon model (order fit) | none | unverifiable |
| *Arctocephalus gazella* | EN 2026 | 1.83M | history (IUCN 2026: 944k mature × 1.94, #174) | the same | ok |
| *Mellivora capensis* | LC 2016 | 1.79M | Greenspoon model | none | unverifiable |
| *Mustela nudipes* | LC 2015 | 1.72M | Greenspoon model | none | unverifiable |
| *Callorhinus ursinus* | VU 2015 | 1.65M | census + history file | the same (IUCN via Greenspoon 2023) | IUCN figure |
| *Urva edwardsii* | LC 2024 | 1.63M | density model | none | unverifiable |
| *Urva auropunctata* | LC 2016 | 1.57M | density model | none | unverifiable |
| *Herpestes edwardsi* | LC 2016 | 1.35M | density model | none | unverifiable |
| *Civettictis civetta* | LC 2019 | 1.21M | Greenspoon model | none | unverifiable |
| *Galerella ochracea* | LC 2015 | 1.17M | Greenspoon model | none | unverifiable |
| *Aonyx cinereus* | VU 2021 (A2cde+3cde) | 1.17M (was 7.17M) | density model, land fit | none: the CITES CoP18 listing proposal notes there are no reliable wild population estimates (paraphrase; the PDF was not readable); Sundarbans 53 animals over 351 km of waterways ([Notes on Population Status…](https://www.researchgate.net/publication/323335472_Notes_on_Population_Status_and_Feeding_Behaviour_of_Asian_Small-Clawed_Otter_Aonyx_cinereus_in_the_Sundarbans_Mangrove_Forest_of_Bangladesh)) | suspect, unverifiable |
| *Vulpes rueppellii* | LC 2015 | 1.12M | Greenspoon model | none | unverifiable |
| *Felis silvestris* | LC 2023 | 1.07M | Greenspoon model | none | unverifiable |
| *Prionodon linsang* | LC 2016 | 1.03M | Greenspoon model | none | unverifiable |
| *Cystophora cristata* | EN 2025 | 1.02M | census (IUCN via Greenspoon 2023, pre-2025) | the same | IUCN figure (older assessment) |
| *Mirounga leonina* | VU 2026 | 975k | census (IUCN via Greenspoon 2023) | the same | IUCN figure (older assessment) |
| *Catopuma temminckii* | VU 2025 | 385k | density model | none (not searched) | unverifiable |
| *Odobenus rosmarus* | VU 2025 | 338k | census (IUCN via Greenspoon 2023) | the same | IUCN figure (older assessment) |
| *Spilogale pygmaea* | VU 2016 | 305k | Greenspoon model | none (not searched) | unverifiable |
| *Pusa caspica* | EN 2016 | 204k | census (IUCN via Greenspoon 2023) | the same | IUCN figure |
| *Galidictis fasciata* | VU 2016 | 183k | Greenspoon model | none (not searched) | unverifiable |
| *Panthera pardus* | VU 2025 | 131k | history file | Greenspoon model 109k | ok |
| *Ursus thibetanus* | VU 2020 | 112k | Greenspoon model | none (not searched) | unverifiable |
| *Enhydra lutris* | EN 2021 | 103k | history file | IUCN census 126k | ok |

The otters left the table by falling below 1M or 100k: *Lutrogale perspicillata*, *Lutra lutra*, *Lutra sumatrana*,
*Lontra canadensis*.

**Nothing left is off by more than ×3 against a cited figure**, so no hand point was added. The closest are the
harp seal (×2.1 high: the IUCN-era 13.5M against the stocks' current assessments) and the arctic fox (×12 low, no
usable figure). *Vormela*, *Spilogale putorius*, *Aonyx cinereus* and the red fox still look wrong. No cited
figure checks them, and they were not changed on a hunch.
Left over: #186 (arctic fox regression, IUCN criteria for the ceiling rule, unverified suspects, harp seal ×2.1).
