# Cat bottlenecks, quoted (ToLaD#141)

Every population bottleneck in the cats of the fan (`web/src/fan/splits.ts`) that a source read for this note supports, with the quote copied verbatim from it. Each one is an `[[event]]` in the species' history file (`pipeline/history/<Genus_species>.toml`), except the ocelot's, which has no history file yet (see below). The cougar (Culver et al. 2000) and the cheetah (~12 kya) are seeded by the build worker and are left out here.

**How the events were made.** Each source was fetched in full (Europe PMC full text, the publisher's abstract, or the web page) and every quote was checked as an exact substring of the downloaded text by a script, after collapsing whitespace. `...` in a quote joins two passages from the same source. A source that only cites another paper for a bottleneck was not used for it unless the original could be read too (the Gir founder event below is quoted from Driscoll et al. 2002 itself, not from de Manuel et al. 2020, who cite it). Windows are in years before present, with the present taken as 2026, the build year (`anchors.NOW_YEAR`). Where the source gives one date ("around 47 kya"), the window is drawn a little either side of it, and the row says so. Genetic dates are in the source's own time scale (its mutation rate and generation time), which is not the build's: the build rescales each genomic curve's time axis by the lineage's mutation rate (`stats.json -> history.species.<sp>.deep.time_factor`: tiger ×7.4, leopard ×8.5, lion ×4.3, jaguar ×2.0, snow leopard ×0.72), so a dated dip in a paper can sit at a different place on the fan's genomic curve.

Grades follow the history files: B, a census with a stated figure; C, a genetic or historical date with a wide or model-dependent error; D, a date given in passing with citations only.

## Events

| Species | Window (ya) | Title | Source | Verbatim quote | In the data? |
|---|---|---|---|---|---|
| Iberian lynx *Lynx pardinus* | 700,000–100,000 | Ancient lynx decline (C) | Abascal et al. 2016, Genome Biol 17:251, [doi](https://doi.org/10.1186/s13059-016-1090-1) | "PSMC inferred a first and most drastic population decline that affected both Iberian and Eurasian lynx 700–100 thousand years ago (kya; Fig. 1b); this contraction may have separated the two species, resulting in the onset of the population structure detected by CoalHMM (312.2 kya; 95% confidence interval 323.1–179.4 kya)." | **n.** The Iberian lynx has no genomic deep past in the build; its deep past is the flat natural baseline (61,225). |
| Iberian lynx | 50,000–44,000 (source: "around 47 kya") | Glacial bottleneck (C) | Abascal et al. 2016, Fig. 1c | "Based on the allele frequency spectrum, ∂a∂i infers a model with two successive abrupt bottlenecks, one around 47 kya, coincident with the last important decline observed in PSMC output, and a second one at 315 years ago, both reducing to approximately one-tenth the previous population size." | **n.** Flat natural baseline, as above. |
| Iberian lynx | 360–290 (source: "around 315 years ago", in 2016, i.e. c. 1700) | Early-modern bottleneck (C) | Abascal et al. 2016 | "The analysis with ∂a∂i was able to capture a third, more recent decline that reduced the Iberian lynx effective population size to less than 300 individuals around 315 years ago (Fig. 1c)." | **Partly.** The build's range-loss trend falls log-linearly from 61,225 in 1500 to 1,136 in 1988, so the column is falling through 1700, but steadily: no low point there. |
| Iberian lynx | 76–24 (1950–2002) | Fewer than 100 left (B) | Abascal et al. 2016 | "a steep decline during the second half of the 20th century left less than 100 lynx (less than 62 mature) distributed in the two isolated populations of Doñana and Andújar (Sierra Morena) in Andalusia, southern Spain, leading to its recognition as the most endangered felid in the world [8] and to its classification as “critically endangered” in the 2002, 2006, and 2008 IUCN red lists." | **y.** The history points run 1,136 (1988), 568 (1997), 94 (2002), then 1,111 (2020) and 2,401 (2024): the low is the 2002 point. |
| Eurasian lynx *Lynx lynx* (Europe) | 136–61 (1890–1965) | European extirpation (C) | Lucena-Perez et al. 2020, Mol Ecol 29:812–828, [doi](https://doi.org/10.1111/mec.15366) | "The remnant central European populations recovered from their rather extreme bottlenecks following legal protection enacted during the 20th century, but have remained relatively isolated until today. ... In Norway, the population was restricted to a few survivors in the central region from 1926 to 1965, although it has steadily recovered since then, apparently with little contribution of immigrants from outside Scandinavia (Linnell, Broseth, Odden, & Nilsen, 2010)." | **n.** The column is global; its one cited point is 2013 (69,400), reached by a steady range-loss trend from 1500. The European crash is regional and has no counts in the file. Window: 1890 is where the source says NE Poland's lynx were absent (1890–1914), 1965 the end of Norway's low. |
| Lion *Panthera leo* | 20,000–10,000 | Post-glacial decline (C) | Figueiró et al. 2017, Sci Adv 3:e1700299, [doi](https://doi.org/10.1126/sciadv.1700299) | "PSMC results (Fig. 1B) revealed population reductions in all five species ca. 100,000 to 300,000 years ago, and a second round of decline (most notably for the lion and leopard) between 10,000 and 20,000 years ago, following the last glacial maximum." | **n, they disagree.** The build drops the PSMC steps younger than ~22,500 ya (the curve's blind recent end), and the published lion curve in the file (Armstrong et al. 2025) does fall there (to 4,121 at 4–10 kya, rescaled). Instead the build joins the curve log-linearly across the last 20 kyr up to the held 1950 level (500,000, 3.4× higher), so the column rises where the source has a decline. |
| Lion (India) | 4,000–1,000 | Gir founder event (C) | Driscoll et al. 2002, Genome Res 12:414–423, [doi](https://doi.org/10.1101/gr.185702) (abstract) | "The observed rate of reconstruction of new alleles plus the growth in the breadth of microsatellite allele size (variance) was used here to develop genomic estimates of time intervals following historic founder events in cheetahs (12,000 yr ago), in North American pumas (10,000-17,000 yr ago), and in Asiatic lions of the Gir Forest (1000-4000 yr ago)." | **n.** Regional (Asiatic lions are a few % of the global column); the column there is the join described above. |
| Lion (India) | 226–116 (1800–1910) | Asiatic lion near-extinction (C) | de Manuel et al. 2020, PNAS 117:10927–10934, [doi](https://doi.org/10.1073/pnas.1919423117) | "This remarkable absence of genomic diversity in Indian lions is consistent with their recorded strong population decline after the 18th century, mostly mediated by the advance of agriculture, the increased use of firearms, and other familiar companions of human population (4). These factors brought the Indian lion population nearly to extinction, with individual counts as low as 20 in the Kathiawar Peninsula by the beginning of the 20th century (35)." | **n.** Regional; the global column is held at 500,000 from 1500 to 1950. |
| Leopard *Panthera pardus* (Amur genomes) | 20,000–10,000 | Post-glacial decline (C) | Figueiró et al. 2017 | Same sentence as the lion's row ("... a second round of decline (most notably for the lion and leopard) between 10,000 and 20,000 years ago, following the last glacial maximum."). | **n, they disagree.** As for the lion: the published PSMC in the file does drop (to 8,490 at 7–11 kya, rescaled), but the build drops steps younger than ~30,800 ya and joins up to the natural level (1.2× higher). The sequenced leopards were Amur (Far East) animals: Pečnerová et al. 2021 (Curr Biol 31:1862, abstract read) say "all previous whole-genome analyses of leopards are based on the Far Eastern Amur leopards that live at the extremity of the species' distribution and therefore are not necessarily representative of the whole species", and find African leopards 2- to 5-fold more diverse; hence `region`. |
| Jaguar *Panthera onca* | 300,000–30,000 | Pleistocene decline (C) | Figueiró et al. 2017 | "PSMC results (Fig. 1B) revealed population reductions in all five species ca. 100,000 to 300,000 years ago, and a second round of decline (most notably for the lion and leopard) between 10,000 and 20,000 years ago, following the last glacial maximum. In the period between these two rounds of decline, the inferred patterns differ among species, with the leopard showing a rebound ca. 100,000 years ago, whereas the lion and snow leopard remained mostly stable (although at very different effective sizes). The jaguar was the most negatively influenced by the initial decline, stabilizing ca. 30,000 years ago at the lowest effective population size among the extant big cats." | **y.** The build's curve (Bergman et al. 2023 PSMC, time ×2.0) peaks around 126–207 kya and falls about ninefold by its youngest kept step (~22 kya). The fall sits a little younger in the build than in the source's time scale. |
| Tiger *Panthera tigris* | 250,000–220,000 (source: "around 234,000 years ago") | Ancestral bottleneck (C) | Armstrong et al. 2021, Mol Biol Evol 38:2366–2379, [doi](https://doi.org/10.1093/molbev/msab032) | "Demogenetic analyses supported a very strong bottleneck for the species occurring around 234,000 years ago, with most remaining lineages coalescing rapidly, which is consistent with a speciation event." | **n.** The build's curve (Armstrong et al. 2025 PSMC, time ×7.4) is flat from ~45 kya to ~575 kya with a slow decline before it; no sharp low near 234 kya. In the file's own (published) time scale the PSMC steps drop from 70,900 to 41,100 around 315–353 kya, the nearest feature. |
| Tiger | 120,000–100,000 (source: "circa 110 kya") | Late Pleistocene bottleneck (D) | Liu et al. 2018, Curr Biol 28:3840–3849, [doi](https://doi.org/10.1016/j.cub.2018.09.019) (abstract) | "The recent coalescence to a late Pleistocene bottleneck (circa 110 kya) [5, 8, 9] poses challenges for detecting tiger subspecific morphological traits, suggesting that elucidating intraspecific evolution in the tiger requires analyses at the genomic scale." | **n.** Flat there, as above. The same coalescence is likely dated older (234 kya) by Armstrong et al. 2021 with a different method; both are kept and the summary says so. Grade D: the abstract states it in passing with citations, not as its own result. |
| Tiger | 126–16 (1900–2010) | 20th-century crash (C) | IUCN SSC Cat Specialist Group, tiger page, [catsg.org](https://www.catsg.org/living-species-tiger) | "In 2009, the in-situ population was estimated at around 3,200 individuals, with likely fewer than 2,500 mature individuals. This represents a dramatic decline from an estimated 100,000 at the start of the 20th century." | **y.** Baseline 100,000 (1900), points 3,200 (2010), then 3,890, 4,650 and 5,574 (2022): the low is the 2010 point. |
| Snow leopard *Panthera uncia* | 75,000–30,000 | Glacial decline (C) | Solari et al. 2025, PNAS 122:e2502584122, [doi](https://doi.org/10.1073/pnas.2502584122) | "Reconstructions suggested that snow leopards had an effective population size of 13,000 to 17,000 individuals from ~300,000 to 75,000 y ago and underwent a slow decline between ~75,000 to 30,000 y ago to an effective population size of ~6,000 to 8,000 individuals. This decline is coincident with the maximum extent of glaciation in mountainous areas of Asia during the Last Glacial Maximum (~40,000 to 100,000 y ago) which was well before the global Last Glacial Maximum (~20,000 y ago) (57)." | **y.** It is the same curve (Solari Fig. 3B); the build's time ×0.72 puts the fall at ~54–22 kya on the column, a little younger. It is a slow decline rather than a crash, and the source calls it that. |
| Snow leopard | 9,000–7,000 (source: "∼8000 years ago") | Holocene bottleneck (C) | Janecka et al. 2017, J Hered 108:597–607, [doi](https://doi.org/10.1093/jhered/esx044) (abstract) | "Snow leopards exhibited low genetic diversity at microsatellites (AN = 5.8, HO = 0.433, HE = 0.568), virtually no mtDNA variation, and underwent a bottleneck in the Holocene (∼8000 years ago) coinciding with increased temperatures, precipitation, and upward treeline shift in the Tibetan Plateau." | **Partly.** The build keeps PSMC only to ~24 kya, then joins log-linearly down to the 1500 level (5.2× lower): the column falls through 8 kya, but with no low point there. Solari et al. 2025 say their PSMC "did not pick up the more recent population bottleneck ~8,000 y ago suggested by Janecka et al. (15) from microsatellite data likely because PSMC analyses loose power at more recent time scales." |

### Ocelot (no history file, so not in the build)

The loader rejects a history file with no `[[point]]` ("no points"), and an ocelot file with points would change its counts, which is outside this task. The event is ready to paste once the ocelot has a history file:

```toml
[[event]]
kind = "bottleneck"
from_ya = 126
to_ya = 21
title = "Texas remnant"
summary = "Genetic (museum vs living samples, 1853–2005): ocelots lost much of their mitochondrial and microsatellite diversity in Texas over the 20th century, as people cut their range down to two small populations in southern Texas."
quote = "Comparisons of contemporary ocelot populations to historical specimens provided strong evidence for a loss of genetic diversity in Texas over the last 100 years."
cite = "Janecka JE, Tewes ME, Laack L, Caso A, Grassman LI, Honeycutt RL (2014). Loss of genetic diversity among ocelots in the United States during the 20th century linked to human induced population reductions. PLoS ONE 9:e89384"
url = "https://doi.org/10.1371/journal.pone.0089384"
grade = "C"
region = "Texas (United States)"
```

Quote verified in the PMC full text (PMC3935880). Window: the historical specimens date from 1853, the losses run from the early 1900s to 2005; 1900–2005 is drawn. Not in the data (the ocelot has no history file, and Texas is a sliver of its range).

## Species checked, nothing evidenced found

- **Canada lynx** *Lynx canadensis*: its swings follow the snowshoe hare cycle, which is not a bottleneck; no source read gave one.
- **Mainland and Sunda clouded leopards** *Neofelis nebulosa*, *N. diardi*: Bursell et al. 2022 (iScience 25:105647, PMC9801239, full text) give PSMC histories: the Sunda species has a smaller, "distinct and reduced" effective size and the mainland one a rise from ~80 kya, but no dated bottleneck.
- **African leopards**: Pečnerová et al. 2021 (abstract) find an "exceptionally high effective population size maintained by the African leopard throughout the Pleistocene": no bottleneck.
- **Tiger, Toba**: the Cat Specialist Group tiger page says "Around 73,000 years ago, the Toba volcanic eruption on Sumatra may have caused a major reduction in its range, a population bottleneck, and a subsequent decline in genetic diversity among survivors." It is a "may have" with no study behind it on the page, so it is not made an event.
- **Lion, Africa**: Bauer et al. 2015 (PNAS 112:14894, abstract read) document declines since 1990 everywhere but four southern countries, but a decline to ~23,000 is not a bottleneck; the 1950 figure of 500,000 in the history file is unverified (grade D), so the 1950–2002 fall gets no event.
- **Lion, cave lion** (*P. spelaea*, not in the fan): de Manuel et al. 2020 cite earlier mtDNA studies for a bottleneck 47–18 kya, and find their 30,870-year-old Siberian cave lion genome's diversity "perhaps surprising" in its light.
- **Eurasian lynx, deep past**: Lucena-Perez et al. 2020 describe a steep PSMC decline from ~600 to ~200 kya and a sharper decline in Europe than in Asia afterwards. The steep decline is the one Abascal et al. call "the first and most drastic", shared by both lynxes (see the Iberian lynx row), and the build has no deep curve for the Eurasian lynx, so it is not repeated.
- **Fishing cat, Pallas's cat, Andean cat, black-footed cat, wildcat** (Scottish population), the small Neotropical, Asian and African cats: one web search turned up, in result summaries only (not read), inbreeding (black-footed cat genome), lower diversity in captivity (Pallas's cat) and hybridisation (Scottish wildcat), but no dated bottleneck. This is a light check (a search, not a literature review); a deeper one could find more, especially for the Andean cat and fishing cat.
- **Domestic cat** *Felis catus*: domestication founder effects are not population bottlenecks of the kind marked here; not searched.

## Where the data and the sources disagree

1. **The post-glacial declines of lion and leopard are missing.** Both published PSMC curves in the history files fall after the last glacial maximum. The build drops PSMC steps younger than ~22–31 kya as its blind recent end and joins the older curve to a level 1,500 years ago that is higher (lion: the held 1950 level of 500,000; leopard: the natural level). So the fan shows these columns rising across the last 20 kyr, where Figueiró et al. 2017 (and the dropped steps themselves) show the strongest decline of the big cats. Worth a look by whoever owns the deep-past join (`history.py`, the `join` rule).
2. **Genetic dates shift on the fan.** The build rescales each genomic curve's time by the lineage mutation rate (tiger ×7.4, leopard ×8.5), so a dip the source dates at time *t* lies at a different time on the column. The event windows here are the sources' dates, not the build's; marking them on the column will not always land on the curve's own dip (the jaguar's and snow leopard's are close; the tiger's 234 kya bottleneck has no dip near it).
3. **Iberian lynx and snow leopard recent bottlenecks fall on smooth trends.** The build's range-loss trend (1500 onwards) and the deep-past join are log-linear, so a bottleneck within them (c. 1700 lynx, 8 kya snow leopard) is a stretch of steady decline on the column, not a low point.
4. **Regional events on global columns.** The Asiatic lion's near-extinction, the Gir founder event, the European lynx crash and the Amur leopard genomes concern part of the species; each event has `region` set so the card can say so.

# Carnivore bottlenecks other than cats, quoted (ToLaD#147)

The #141 method run over the Carnivora outside Felidae. Same rules as above: every source was fetched (Europe PMC full text or abstract, NCBI PMC, or the agency PDF), every quote was checked by script as an exact substring of the downloaded text after collapsing whitespace (`...` joins two passages of the same source), and every citation's volume and pages were checked against Europe PMC's record. Present = 2026. "In the data?" compares the event with the build that was on `main` when this was written (`data/mammals/stats.json`, and the bulk PSMC curves of ToLaD#64 placed by `time_factor`).

Searched: Europe PMC (title/abstract/full-text queries per family, `bottleneck`, `population decline`, `founder`, `genome`/`PSMC`), then the sources named in the brief. Done in this pass: Canidae, Ursidae, Phocidae, Otariidae, Odobenidae, Mustelidae (partly), Ailuridae, Hyaenidae (one species), and one quick search each for the small families (below).

## Events in history files

| Species | Window (ya) | Title | Source | In the data? |
|---|---|---|---|---|
| Northern elephant seal *Mirounga angustirostris* | 216–134 (1810–1892) | Hunted to a few dozen (B) | Hoelzel et al. 2024, Nat Ecol Evol 8:686, abstract | **y.** The 1890 point (100) is the curve's low; with no baseline the fall into it is a step at the first point. |
| Sea otter *Enhydra lutris* | 285–115 (1741–1911) | Fur-trade crash (B) | Beichman et al. 2023, Mol Ecol 32:281, abstract | **y.** Baseline 225,000 (1741), low 1,500 (1911), 126,000 (1998). |
| Antarctic fur seal *Arctocephalus gazella* | 251–96 (1775–1930) | Sealing near-extinction (C) | Paijmans et al. 2020, Sci Rep 10:5089, abstract (full text read for 1775) | **n.** One point (2008). |
| Northern fur seal *Callorhinus ursinus* | 140–114 (1886–1912) | Pelagic sealing crash (C) | NOAA stock assessment (Young et al. 2026), PDF | **Partly.** The 1912 point (216,000) is the curve's first and lowest. The source dates only the end (1912), and the summary says so. |
| Black-footed ferret *Mustela nigripes* | 45–35 (1981–1991) | Eighteen survivors (A) | USFWS 2019 Species Status Assessment, PDF | **n.** First point 2019 (340); the count of 18 (1985–87) could become a point. |
| Red wolf *Canis rufus* | 53–39 (1973–1987) | Fourteen founders (A) | Hinton et al. 2013, Animals 3:722, full text | **n.** One point (2026). |
| Grey wolf *Canis lupus* (Scandinavia) | 61–35 (1965–1991) | Scandinavian refounding (A) | Viluma et al. 2022, Genome Res 32:449, full text | **n.** Regional, on a global column with one point. |
| Grey wolf (Isle Royale) | 86–76 (1940s) | Isle Royale founders (B) | Robinson et al. 2019, Sci Adv 5:eaau0757, full text | **n.** As above. |
| Brown bear *Ursus arctos* (Scandinavia) | 146–96 (1880–1930; source: "approximately 100 years ago", in 2015) | Scandinavian hunting low (C) | Xenikoudakis et al. 2015, Mol Ecol 24:3441, abstract | **n.** Regional; global column, one point (2017). |
| Polar bear *Ursus maritimus* | 500,000–20,000 | Long Pleistocene decline (C) | Miller et al. 2012, PNAS 109:E2382, abstract | **Partly.** The bulk PSMC (time ×1.53) falls ~15× between 1.5 Mya and ~400 kya, rebounds to ~84,500 at 130–160 kya and falls to ~43,000 by 24 kya: the decline is there, but mostly older than 500 kya on the build's time scale. |
| Giant panda *Ailuropoda melanoleuca* (Sichuan) | 30,000–10,000 | Late-glacial decline (C) | Lan et al. 2024, PNAS 121:e2406343121, full text | **y, as a join.** PSMC kept to ~30 kya (112,647), then a log-linear join down to 15,127 in 1500: the column falls through the window; the dropped blind step (22,430 at 11–24 kya) agrees. |
| Giant panda | 3,000–0 | Human pressure, 3,000 years (C) | Zhao et al. 2013, Nat Genet 45:67, abstract | **Partly.** The same smooth join and the range-loss trend fall through it; the censuses since 1976 show no low. |

Quotes are in the files. Two elephant-seal sources were read; Hoffman et al. 2024 (Nat Ecol Evol 8:2309, full text) give the bottleneck effective size (6, 95% CI 5.0–7.5), and the file's notes cite it rather than marking the same window twice.

## Ready to paste (species with no history file)

The loader still rejects a history file with no `[[point]]` (`history.validate`: "no points"), and a file with points would change the species' counts, which is outside this task. These events are verified and ready for when each species gets a file. Name check against the tree (Upham taxonomy): the brown hyena is `Hyaena brunnea` there (Bergman's PSMC has it as *Parahyaena brunnea*), the Hawaiian monk seal is listed under both *Monachus* and *Neomonachus schauinslandi*.

| Species | Window (ya) | Title | Source | In the data? |
|---|---|---|---|---|
| Ethiopian wolf *Canis simensis* | 40,500–27,000 | Ancient contraction (C) | Mooney et al. 2023, Mol Biol Evol 40:msac277, full text | No file and no bulk curve. |
| Guadalupe fur seal *Arctocephalus townsendi* | 246–196 (1780–1830) | Sealers' near-extermination (C) | Weber et al. 2004, J Hered 95:144, abstract | No file. |
| Hawaiian monk seal *Neomonachus schauinslandi* | 156–126 (1870–1900; source: "late 19th century") | Late-1800s bottleneck (C) | Mohr et al. 2022, Genes 13:1270, abstract | No file. |
| Walrus *Odobenus rosmarus* (Pacific) | 226–76 (1800–1950; source: "nineteenth and twentieth centuries") | Commercial overhunting (D) | Mills et al. 2024, Sci Rep 14:8257, abstract | No file. A census crash with no genetic trace: the source finds mtDNA diversity unchanged. Grade D: no figures or years. |
| Brown hyena *Hyaena (Parahyaena) brunnea* | 1,000,000–11,700 | Million-year decline (C) | Westbury et al. 2018, Mol Biol Evol 35:1225, abstract | **y.** The bulk PSMC (time ×1.52) falls steadily from ~124,000 at 310–370 kya to ~51,000 at 21–27 kya, and the dropped blind steps go on down to ~17,000 at 9–12 kya. |
| Red panda *Ailurus fulgens* (Chinese, *A. styani*) | 330,000–270,000 | Penultimate-glacial bottleneck (C) | Hu et al. 2020, Sci Adv 6:eaax5751, full text | No file and no bulk curve. |
| Red panda (Chinese) | 25,000–15,000 | Last-glacial bottleneck (C) | Hu et al. 2020 | As above. Hu et al. also give the Himalayan red panda three bottlenecks (~250 kya, ~90 kya, and a third); not drawn here. |

**Ethiopian wolf (`Canis_simensis.toml`)**

```toml
[[event]]
kind    = "bottleneck"
from_ya = 40500
to_ya   = 27000
title   = "Ancient contraction"
summary = "Whole genomes of ten Bale Mountains wolves: the species has lived at a small size since an ancient contraction 27,000-40,500 years ago (for a 2- or 3-year generation) and has kept declining since, with recent crashes from farming and dog-borne disease."
quote   = "the Ethiopian wolf has persisted for about 13,500 generations since an ancient contraction (or ∼27,000 or 40,500 years ago, assuming a 2- or 3-year generation time). Throughout the years, the population has continued declining and experiencing both recent crashes and sub-population extinction due to anthropogenic forces."
cite    = "Mooney JA, Marsden CD, Yohannes A, Wayne RK, Lohmueller KE (2023). Long-term small population size, deleterious variation, and altitude adaptation in the Ethiopian wolf, a severely endangered canid. Mol Biol Evol 40:msac277"
url     = "https://doi.org/10.1093/molbev/msac277"
grade   = "C"
```

**Guadalupe fur seal (`Arctocephalus_townsendi.toml`)**

```toml
[[event]]
kind    = "bottleneck"
from_ya = 246
to_ya   = 196
title   = "Sealers' near-extermination"
summary = "Commercial sealers nearly wiped out the Guadalupe fur seal in the late 18th and early 19th centuries. Bones of 26 pre-bottleneck seals carry 25 mitochondrial types; 32 living seals carry 7."
quote   = "The Guadalupe fur seal was nearly exterminated by commercial sealers during the late 18th and early 19th centuries. ... We found 25 different mtDNA genotypes in the prebottleneck fur seals and only 7 genotypes among 32 extant fur seals, including only one of the ancient genotypes."
cite    = "Weber DS, Stewart BS, Lehman N (2004). Genetic consequences of a severe population bottleneck in the Guadalupe fur seal (Arctocephalus townsendi). J Hered 95:144-153"
url     = "https://doi.org/10.1093/jhered/esh018"
grade   = "C"
```

**Hawaiian monk seal (`Neomonachus_schauinslandi.toml`, or the tree's name)**

```toml
[[event]]
kind    = "bottleneck"
from_ya = 156
to_ya   = 126
title   = "Late-1800s bottleneck"
summary = "Hawaiian monk seals went through a severe bottleneck in the late 19th century and kept declining until recovery work began in 1976, with fewer than 1,000 left. Their genomes show a long history of small numbers before it."
quote   = "The species survived a severe bottleneck in the late 19th century and experienced subsequent population declines until becoming the subject of a NOAA-led species recovery effort beginning in 1976 when the population was fewer than 1000 animals."
cite    = "Mohr DW, Gaughran SJ, Paschall J, et al. (2022). A chromosome-length assembly of the Hawaiian monk seal (Neomonachus schauinslandi): a history of genetic purging and genomic stability. Genes 13:1270"
url     = "https://doi.org/10.3390/genes13071270"
grade   = "C"
```

**Walrus (`Odobenus_rosmarus.toml`)**

```toml
[[event]]
kind    = "bottleneck"
from_ya = 226
to_ya   = 76
title   = "Commercial overhunting"
summary = "Pacific walruses were decimated by commercial hunting in the 19th and 20th centuries (the source gives no figures or exact years). Mitochondrial DNA from before the hunting matches today's: no genetic bottleneck followed."
quote   = "Like many other marine mammal species, their population sizes were decimated by historical overhunting in the nineteenth and twentieth centuries. ... We found that genetic variation was unchanged over this period"
cite    = "Mills KK, Hildebrandt KPB, Everson KM, et al. (2024). Ancient DNA indicates a century of overhunting did not reduce genetic diversity in Pacific walruses (Odobenus rosmarus divergens). Sci Rep 14:8257"
url     = "https://doi.org/10.1038/s41598-024-57414-2"
grade   = "D"
region  = "Pacific (O. r. divergens)"
```

**Brown hyena (`Hyaena_brunnea.toml`, alias *Parahyaena brunnea*)**

```toml
[[event]]
kind    = "bottleneck"
from_ya = 1000000
to_ya   = 11700
title   = "Million-year decline"
summary = "Brown hyena genomes show a continuous fall in effective population size that began about a million years ago and sped up sharply towards the end of the Pleistocene, leaving the species with extremely low genetic diversity."
quote   = "We find that brown hyena harbor extremely low genetic diversity on both the mitochondrial and nuclear level, most likely resulting from a continuous and ongoing decline in effective population size that started ∼1 Ma and dramatically accelerated towards the end of the Pleistocene."
cite    = "Westbury MV, Hartmann S, Barlow A, et al. (2018). Extended and continuous decline in effective population size results in low genomic diversity in the world's rarest hyena species, the brown hyena. Mol Biol Evol 35:1225-1237"
url     = "https://doi.org/10.1093/molbev/msy037"
grade   = "C"
```

**Red panda (`Ailurus_fulgens.toml`)**

```toml
[[event]]
kind    = "bottleneck"
from_ya = 330000
to_ya   = 270000
title   = "Penultimate-glacial bottleneck"
summary = "Genomes of Chinese red pandas: a decline from about 800,000 years ago ended in a first bottleneck about 300,000 years ago, during the Penultimate Glaciation. Himalayan red pandas had their first about 250,000 years ago."
quote   = "This species suffered from an obvious population decline approximately 0.8 Ma ago, which coincided with the occurrence of the Naynayxungla Glaciation (0.78 to 0.5 Ma ago). The population decline resulted in the first bottleneck approximately 0.3 Ma ago, mostly likely caused by the Penultimate Glaciation (0.3 to 0.13 Ma ago)"
cite    = "Hu Y, Thapa A, Fan H, et al. (2020). Genomic evidence for two phylogenetic species and long-term population bottlenecks in red pandas. Sci Adv 6:eaax5751"
url     = "https://doi.org/10.1126/sciadv.aax5751"
grade   = "C"
region  = "Chinese red panda (A. styani)"

[[event]]
kind    = "bottleneck"
from_ya = 25000
to_ya   = 15000
title   = "Last-glacial bottleneck"
summary = "After a peak around 50,000 years ago, Chinese red pandas declined fast with the last glaciation, to a second bottleneck at the Last Glacial Maximum, about 20,000 years ago."
quote   = "After the glaciations, the populations started to expand and reached a climax approximately 50 thousand years (ka) ago. Then, the arrival of the last glaciations again resulted in rapid population decline, and the second bottleneck occurred during the Last Glacial Maximum (~20 ka ago)"
cite    = "Hu Y, Thapa A, Fan H, et al. (2020). Genomic evidence for two phylogenetic species and long-term population bottlenecks in red pandas. Sci Adv 6:eaax5751"
url     = "https://doi.org/10.1126/sciadv.aax5751"
grade   = "C"
region  = "Chinese red panda (A. styani)"
```

## Families and species checked, nothing evidenced found

- **Northern fur seal, genetics**: Dickerson et al. 2010 (PLoS ONE 5:e10671, abstract) find only weak structure and no bottleneck signal; the census crash is the event above.
- **Island fox** *Urocyon littoralis*: Robinson et al. 2016 (Curr Biol 26:1183, abstract) describe island populations that "have persisted for thousands of years at extremely small population sizes", with San Nicolas "genetic flatlining", but no dated bottleneck. The 1990s crashes (eagle predation on the northern islands, distemper on Catalina) were not found in a source read here.
- **African wild dog, dhole, Darwin's fox**: one search each turned up no paper with a dated bottleneck in its abstract (Meiring et al. 2022, Sci Rep 12:14979, abstract: Kruger wild dogs "are currently not inbred but have low genomic diversity"). A deeper look could find more.
- **Mediterranean monk seal** *Monachus monachus*: Salmona et al. 2022 (Proc R Soc B, abstract) support "a major effective population size decline in all populations during Antiquity", with no years in the abstract; the full text was not retrievable (Europe PMC error 500), so no window is drawn. Worth a second try: it is the clearest case left in Phocidae.
- **Hyaenidae** other than the brown hyena: Westbury et al. 2020 (cave and spotted hyena palaeogenomes) is about gene flow, not a bottleneck; striped hyena and aardwolf: nothing found.
- **Procyonidae**: Flores-Manzanero et al. 2022 (Conserv Genet, abstract) report "historical and contemporary bottleneck signals" in the Cozumel pygmy raccoon *Procyon pygmaeus*, but no date; not made an event. Raccoon, coatis, kinkajou: nothing.
- **Herpestidae, Viverridae, Mephitidae, Eupleridae (fossa), Nandiniidae, Prionodontidae**: one Europe PMC search each (family or genus names AND bottleneck / genetic diversity) found no dated bottleneck. This is a light check, not a literature review.

## Not done in this pass

- **Mustelidae** beyond the sea otter and black-footed ferret: sea mink (extinct), European mink, Eurasian otter (the 1950s–70s crash in Britain and Europe), wolverine, giant otter, marten reintroductions.
- **Phocidae** beyond the elephant seal and Hawaiian monk seal: Saimaa ringed seal, grey seal (McCarthy et al. 2025 found in a search, not read), harbour seal die-offs, Caspian and Baikal seals.
- **Otariidae** beyond the three fur seals: Juan Fernández fur seal, Steller sea lion decline, New Zealand sea lion.
- **Canidae** for the species listed above as a light check, plus the Mexican grey wolf founders (Loera et al. 2026 found in a search).
- The **Himalayan red panda**'s three bottlenecks, and the giant panda's two ancient ones (Zhao et al. 2013 name them in the abstract without dates; the paper is not open).
