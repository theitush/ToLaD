# When did each species lose its range? (ToLaD#515)

The tree draws 682 living species falling from 1500 to today, because PHYLACINE's map without people
(present-natural) is bigger than today's map. Here is what dates each of those losses. Every date comes
from a cited source, not from a model. One method, land use (HYDE), is an inference: it was tested and is
not used for any date. Per species: [`range-loss-dates.csv`](range-loss-dates.csv).

| Evidence | Species | What it dates | How sure |
|---|---:|---|---|
| IUCN map codes the lost area *Extinct* or *Possibly Extinct* | **78** | lost between 1500 and 2016 | high: that is what the codes mean |
| A named historic-range source | **165** | 62 Australian species: 1788–2008. 21 North American: 1500–1981 (American part). 4 snub-nosed monkeys: 1600–2002. 14 more start later than 1500 (fur trade 1741/1828, Cape 1652, mink 1800, Japanese otter 1868 …). The rest: 1500 to the source's year | medium (97), low (61), high (7) |
| Dated before 1500 | **6** | Tasmanian devil, mainland: ~3,200 years ago. Baltic harp seal: mid-Holocene. NZ sea lion, mainland: 1280–1850. Moose: after the Iron Age. Dhole in North America and wild horse in the Americas: Late Pleistocene (that part only) | medium–high |
| Island: lost after people arrived | **248** | a lower bound only. Madagascar 118: after ~10,500 BP (possible) or ~2,000 BP (certain). Cuba and Hispaniola 9: after ~3800 BCE. Jamaica: after 600 CE. Fiji, Tonga and New Caledonia 3: after ~1000 BCE. New Zealand 3: after 1280. Rodrigues: after 1691. 113 more are on islands people reached 11,000–61,000 years ago, which says little | a bound, not a date |
| Map from fossils, no date | **4** | nothing | – |
| **Nothing dates it** | **181** | 143 of them are "disjunct range connected"; 68 are Data Deficient | – |
| HYDE land use (inference, tested) | (621 computed) | gives 1900–1949 for most species, whatever their history. 14 of 19 documented windows hit, against 11.8 expected by chance. 0 of 3 prehistoric losses | weak: **not used** |

**Against the tree's rule** (a steady fall from 1500), the 682 split like this:

- **241:** the evidence agrees the loss came after 1500. For 77 of them it starts later than 1500,
  mostly Australia's 1788.
- **3:** only an end date (European bison 1927, Père David's deer ~1900, Atlantic grey whale ~1750).
- **6:** at least part of the loss is dated before 1500.
- **247 island species:** people's arrival gives only a lower bound. In Madagascar, a loss before 1500
  is possible.
- **185:** no evidence found here dates the loss.

## How the 682 were classed

Each species is classed by its full PHYLACINE note (`Certainty.Level`, `Modification`, `Motivation` in
`Data/Ranges/Spatial_metadata.csv`), in this order:

1. **IUCN codes** (certainty 0, 78 species). The note reads "Added cells coded Extinct or Possibly Extinct by IUCN".
2. **Historic source** (165 species). Certainty 2 ("range expansions based on other sources for species with known range
   declines"), or any note naming Strahan & Van Dyck, Hall or Ray et al. Also certainty 5 notes that add
   a historic part ("historically had the species", "formerly occurred").
3. **Before 1500 / fossil.** A source that dates the loss before 1500, or a map built from fossil co-occurrence (certainty 6).
4. **Island.** Any species still undated whose lost cells lie at least half on an island in the arrival table below.
   This covers certainty 4 ("expansion to entire islands"), certainty 5 "inhabited island" notes, and the
   Madagascar lemurs and tenrecs whose notes only say "suitable areas for the genus".
5. **None** (181 species): everything else.

The rough pass in #507 counted 250 recorded-history notes, 129 islands, 2 fossil maps and 301 with no time.
This pass reads every note, so the counts differ. Island dating now covers every species on a dated island,
not only notes that say "island". Seven certainty-5 notes that read like "no time" do carry a historic part (the hippo, the
giraffe, wild boar, sable, souslik, desman and *Phyllomys*).

**Mixed notes.** `dated_share` in the CSV is the share of a species' lost cells that the dated evidence covers. For
example, the brown bear's note adds Hall's historic range for America and "suitable areas" for Eurasia.
Only the American 37% is dated (1500–1981). Five certainty-5 notes add a named historic part to a
suitable-area expansion, and the map does not say which cells are which; their `dated_share` is blank.

## 1. IUCN's Extinct and Possibly Extinct codes: 78 species, 1500–2016

PHYLACINE adds IUCN's *Extinct* and *Possibly Extinct* polygons to the present-natural map and leaves
them out of the current map (Faurby et al. 2018 Ecology 99:2626, metadata p. 9: "for 80 of these species
the present natural range was larger than the current range because IUCN contains part of the polygons
coded as extinct or possibly extinct"). IUCN's mapping standard defines both codes as areas where the
species was "known or thought very likely to occur post 1500 AD" and is now gone (IUCN Mapping attribute
codes v1.19, 2021). The maps are IUCN 2016-3, so these losses happened between 1500 and 2016.

Examples: marsh deer *Blastocerus dichotomus* (400 lost cells), Asiatic black bear *Ursus thibetanus*
(335), black-footed ferret *Mustela nigripes* (308), white-lipped peccary *Tayassu pecari* (228), giant
anteater *Myrmecophaga tridactyla* (97).

**Every other species carries such polygons too.** The same metadata says the coded polygons are in every
present-natural map. So part of the loss of many species in the other groups is also IUCN-coded post-1500,
but without IUCN's polygons we cannot tell which cells. That is what the IUCN spatial download would give
(see Downloads).

## 2. Named historic-range sources: 165 species

| Source the note cites | Species | Window | Why that window |
|---|---:|---|---|
| Strahan & Van Dyck 2008, *The Mammals of Australia* | 62 | 1788–2008 | Its former ranges come from records since European settlement in 1788. Woinarski, Burbidge & Harrison 2015 (PNAS 112:4531) date most declines to the 1850s–1950s |
| Hall 1981, *The Mammals of North America* | 21 | 1500–1981, American part | Specimen and literature records of the historic period. Laliberte & Ripple 2004 (BioScience 54:123) use it as the pre-settlement range |
| Ray, Hunter & Zigouris 2005, WCS Working Paper 24 | 15 | 1500–2005 | Literature records of African carnivores, with no single baseline year stated (low). PHYLACINE also cites it for two American cats, which it does not cover |
| Li, Pan & Oxnard 2002, *Int. J. Primatol.* 23:1227, "Extinction of snub-nosed monkeys in China during the past 400 years" | 4 | 1600–2002 | Chinese local gazetteers |
| Others, each with its own source | 63 | see CSV | 14 with a documented start (table below); 46 low, bounded by 1500 and the map |

Documented starts later than 1500, besides Australia:

| Species | Window | Evidence |
|---|---|---|
| sea otter *Enhydra lutris* | 1741–1911 | the maritime fur trade (Kenyon 1969, N. Am. Fauna 68) |
| chinchillas *Chinchilla chinchilla*, *C. lanigera* | 1828–1996 | the fur trade, peaking 1895–1910 (Jiménez 1996, Biol. Conserv. 77:1) |
| Cape mountain zebra *Equus zebra* | 1652–1988 | decline after the Cape settlement (Penzhorn 1988, Mammalian Species 314) |
| European mink *Mustela lutreola* | 1800–2007 | Maran 2007 (Tallinn Univ. dissertation) |
| pine marten *Martes martes* (Great Britain) | 1800–1977 | Langley & Yalden 1977, Mammal Rev. 7:95 |
| Australian sea lion *Neophoca cinerea* (Bass Strait) | 1798–1989 | sealing; King 1989, Fauna of Australia 1B |
| Japanese otter (*Lutra lutra*, Japan) | 1868–1979 | Meiji-era fur hunting; last record 1979 |
| hairy-nosed wombats *Lasiorhinus* | 1788–2013 | Queensland Government profile |
| snub-nosed monkeys *Rhinopithecus* (4) | 1600–2002 | Li et al. 2002 |

## 3. Dated before 1500: 6 species

- **Tasmanian devil**, mainland Australia: extinct there ~3,200 years ago (Brown 2006, Alcheringa 30(S1):49;
  White et al. 2018, The Holocene 28:1145). This is PHYLACINE's own source for the map. All 369 lost
  cells are on the mainland, so the tree draws a 3,200-year-old loss as happening after 1500.
- **Harp seal**, Baltic: a mid-Holocene breeding population, gone in prehistory (Storå & Ericson 2004,
  Mar. Mamm. Sci. 20:115).
- **New Zealand sea lion**, mainland: lost after Polynesian arrival, 1280–1850 (Collins et al. 2014, Proc.
  R. Soc. B 281:20140097). Part of this loss falls before 1500.
- **Moose**: the note's map is an Iron Age range (Willms 1987).
- **Dhole**, North America: known only from Late Pleistocene fossils (Kurtén & Anderson 1980). That is
  34% of its lost cells, the ×11.7 in #507's leftovers.
- **Wild horse**, the Americas: horses died out there in the Late Pleistocene (Guthrie 2003, Nature
  426:169). That is 39% of its 9,239 lost cells.

## 4. Islands: people's arrival, a bound and not a date (248 species)

A loss on an island can only have happened after people got there. Each lost cell is matched to an island
by its centre (box list in `range-loss-dates/build_dates.py`). A species is island-bounded when at least
half its lost cells are on a listed island.

| Island | Species | People arrived | Says |
|---|---:|---|---|
| Madagascar | 118 | possible ~10,500 BP (Hansford et al. 2018, Sci. Adv. 4:eaat6925); certain by ~2,000 cal BP (Douglass et al. 2019, Quat. Sci. Rev. 221:105878) | a little: possibly before 1500 |
| Cuba, Hispaniola | 9 | ~5,800 BP (Napolitano et al. 2019, Sci. Adv. 5:eaar7806) | a little |
| Cayman Islands (part of *Capromys pilorides*) | – | no pre-Columbian sites; 1503 (Stokes & Keegan 1993) | after 1500 |
| Jamaica | 1 | shortly after 600 CE (Callaghan 2008, J. Island Coastal Archaeol. 3:54) | a little |
| Fiji, Tonga, New Caledonia | 3 | Lapita, ~3,000–2,850 cal BP (Sheppard 2011, Curr. Anthropol. 52:799; Burley et al. 2012, PLoS ONE 7:e48769) | a little |
| New Zealand | 3 | ~1280 CE (Wilmshurst et al. 2011, PNAS 108:1815) | yes: the loss was in the last 750 years |
| Rodrigues | 1 | 1691 | yes: after 1500 |
| Philippines, Sundaland, Sulawesi, Lesser Sundas, Moluccas, New Guinea, Taiwan, Hainan, Sri Lanka, Ryukyus, Japan, Andamans, Solomons, Vancouver Island | 113 | 11,000–61,000 years ago (citations in the CSV; land-bridge islands from Voris 2000, J. Biogeogr. 27:1153) | little |

The Madagascar bound matters most, because 118 species sit on it. People were there by 2,000 years ago,
and possibly 10,500 years ago, so these losses may predate 1500. Nothing here dates them more tightly.
A dated forest-cover history exists for Madagascar (national maps since 1953, Vieilledent et al. 2018,
Biol. Conserv. 222:189). Using it would be the same kind of inference as HYDE, and it has not been tested.

## 5. Land use (HYDE): an inference, tested, not used

**What it does.** HYDE 3.2.1 (Klein Goldewijk et al. 2017, ESSD 9:927) maps cropland, pasture, rangeland
and urban land per 5′ cell from 10,000 BCE to 2017. The inference is "a species lost a cell when that cell
was converted". For each species, the converted land (cropland + pasture + converted rangeland + urban) is
summed over its lost cells per time slice. The inferred date is the year conversion reached half of its 2017
level (q50), with the quarter-points (q25, q75) as a spread.

**Matching the grids.** Each HYDE 5′ cell goes whole to the PHYLACINE cell (Behrmann on WGS84, 96.5 km,
360 × 142) that holds its centre. That is about 130 HYDE cells per PHYLACINE cell at the equator. The
mismatch is a fraction of one small cell along each edge. 27 time slices were used: every 1,000–2,000
years before 0 CE, every 100–200 years to 1700, and every 20–50 years after.

**The test.** 22 species whose losses historians date: 19 in the historic period and 3 prehistoric controls.

| species | where | documented | HYDE q25–q50–q75 | q50 in window |
|---|---|---|---|---|
| *Bison bison* | North America | 1750–1890 | 1869–1889–1910 | yes |
| *Cervus canadensis* | eastern N. America | 1700–1900 | 1849–1876–1892 | yes |
| *Ursus arctos* | contiguous USA, Mexico | 1850–1950 | 1878–1895–1915 | yes |
| *Canis lupus* | North America | 1700–1950 | 1868–1889–1917 | yes |
| *Puma concolor* | eastern N. America | 1700–1950 | 1849–1877–1893 | yes |
| *Panthera leo* | North Africa | 1850–1960 | 1820–1907–1954 | yes |
| *Panthera tigris* | Java and Bali | 1940–1990 | 1881–1936–1989 | no (4 yr) |
| *Panthera tigris* | Caspian region | 1900–1975 | 1676–1868–1925 | no (32 yr) |
| *Lynx pardinus* | Iberia, France | 1900–2002 | −207–1011–1462 | no (889 yr) |
| *Mustela lutreola* | Europe | 1850–2007 | 988–1662–1839 | no (188 yr) |
| *Oryx leucoryx* | Arabia, Levant | 1850–1972 | 1825–1959–1982 | yes |
| *Rhinoceros sondaicus* | S and SE Asia | 1850–2010 | 1786–1920–1976 | yes |
| *Rhinopithecus roxellana* | China | 1600–2002 | 1716–1797–1965 | yes |
| *Chinchilla lanigera* | Chile, Argentina | 1890–1930 | 1871–1925–1952 | yes |
| *Macrotis lagotis* | Australia | 1880–1970 | 1916–1938–1956 | yes |
| *Bettongia lesueur* | mainland Australia | 1880–1960 | 1916–1937–1955 | yes |
| *Myrmecobius fasciatus* | Australia | 1880–1980 | 1914–1936–1953 | yes |
| *Equus zebra* | southern Africa | 1700–1950 | 1890–1919–1940 | yes |
| *Martes martes* | Great Britain | 1800–1915 | 1024–1713–1875 | no (87 yr) |
| *Sarcophilus harrisii* | mainland Australia | ~1300–1100 BCE | 1914–1937–1955 | no (3,037 yr) |
| *Cuon alpinus* | North America | Late Pleistocene | 1866–1891–1918 | no (~10,900 yr) |
| *Equus ferus* | the Americas | Late Pleistocene | 1878–1913–1949 | no (~10,900 yr) |

The sources for each documented window are in `range-loss-dates/hyde_test.py`.

**How good it is:**

- **The hits are cheap.** 14 of 19 historic windows hit. But most windows are 100–300 years wide, and HYDE
  gives nearly every species a date of 1850–1950: 345 of the 621 HYDE dates fall in 1900–1949. Drawing a
  date at random from that spread hits 11.8 of the same 19 windows. The small edge comes from frontier
  regions (bison, elk, chinchilla), where HYDE knows when settlers arrived.
- **It cannot see a prehistoric loss.** All 3 controls fail by 3,000–11,000 years. HYDE dates when the land
  was farmed, not when the animal went. The Tasmanian devil's mainland range was farmed after 1900, 3,000
  years after the devil left it.
- **Hunting losses in old farmland come out too early.** Iberian lynx, mink and pine marten were lost to
  persecution long after the land was farmed.
- **The lost cells are hardly more converted than the kept ones.** The median converted share in 2017 is
  0.39 in lost cells against 0.33 in current cells. For the 181 undated species it is 0.32 against 0.31.
  For most of them, conversion does not explain the loss.

So HYDE's dates (`hyde_q25`/`hyde_q50`/`hyde_q75` in the CSV) are kept for reference only. They are never
written into `earliest_year`/`latest_year`.

## What stays undated: 181 species, plus 4 fossil maps

- 143 are certainty 3, "disjunct range likely anthropogenic": PHYLACINE filled the gap between known
  localities ("Connected via suitable habitat", "Connected as a line"). 68 are Data Deficient. For
  these, whether the gap was occupied in 1500 is itself unknown. A date cannot be found for a loss that may
  not have happened.
- 41 are certainty 5, "expanded to suitable areas contiguous with the current range". These include the
  red fox (its 2,093 extra cells lie in North America, which its note does not mention), the Eurasian beaver, the Eurasian lynx, the kulan and the Iberian lynx (range of
  the rabbit). For several of them, European records date some of the loss. For example, Crees et al. 2016
  (Proc. R. Soc. B 283:20152152) date Holocene range collapse in European large mammals, and much of it
  falls before 1500. Reading those needs one species at a time.
- The fossil maps of *Equus grevyi*, *Ailuropoda*, *Axis kuhlii* and *Saiga* give no year.

## Downloads

| What | Size and time | Needs | Status |
|---|---|---|---|
| HYDE 3.2.1 baseline (DANS, doi:10.17026/dans-25g-gez3, CC0) | 5.34 GB zip. Only the members used were read, over HTTP range requests (~350 MB, ~10 min at ~6 MB/s) | nothing | **done** (`range-loss-dates/hyde_fetch.py`). HYDE 3.3 on yoda.uu.nl sits behind a bot wall (Anubis) that refuses scripts |
| IUCN Red List API v4: assessments of the 682 (country presence including "Extinct Post-1500" and "Possibly Extinct"; range and threats text) | 682 × 2 small JSON calls, ~12 min | a free personal token: account at api.iucnredlist.org/users/sign_up | **Ita runs it**: `IUCN_REDLIST_KEY=… python3 research/range-loss-dates/iucn_api_fetch.py research/range-loss-dates.csv data/raw/redlist/api/` (resumable; just rerun). Without a token every call returns 403, including the docs, so the field names come from the client docs and must be checked on the first saved file |
| IUCN spatial data, mammals (shapefile with `presence` 4/5 polygons, 2026 maps) | size shown only after login. At the ~6 MB/s measured here, even 5 GB is under 15 min | IUCN account, then a request form for non-commercial use at iucnredlist.org/resources/spatial-data-download, then a browser download | **Ita downloads it**. It is the one source that dates cells: every lost cell IUCN codes 4 or 5 is a post-1500 loss, for all 682 and not just the 78 |
| Past-range maps of Pacifici et al. 2020 (Nat. Commun. 11:2840): 204 mammals, 1970s vs 2017 | small | check the paper's data availability | not fetched. It would date the post-1970 part for the species in both lists |
| Ceballos, Ehrlich & Dirzo 2017 (PNAS 114:E6089): 177 mammals, ~1900 vs 2015 | small (supplement) | none | not fetched. It would date the post-1900 part |

There is no open mirror of IUCN's country or spatial data. The GBIF copy of the Red List (`data/raw/redlist/iucn-2026-1.zip`) has 178,011 distribution rows, every one of them "Global". IUCN's terms forbid redistribution, so no Zenodo copy of the polygons was found.

## Recommendation (Ita's call, not done)

1. **Start the fall at the documented start where a source gives one later than 1500: 77 species.** The 62
   Australian species would fall from 1788. Rodrigues from 1691, the sea otter from 1741, the chinchillas
   from 1828, the Cape mountain zebra from 1652, and so on. This is evidence, not a model, and it changes
   only where the fall begins.
2. **Keep 1500 → today where the evidence says the same: 164 species.** That is the 78 IUCN-coded
   species and the 1500-bounded historic sources (Hall, Ray, others). Their card can cite the source.
3. **Do not draw dated prehistoric losses as falling after 1500: 6 species.** The Tasmanian devil's
   mainland range, the Baltic harp seal, and the North American part of the dhole and of the wild horse were
   gone long before 1500. Their 1500 level should leave those cells out. That changes the 1500 level for
   these species, so it is a decision for Ita.
4. **Islands: keep the rule, and say what the bound is.** The card can read "lost after people reached
   Madagascar (by 2,000 years ago)". Nothing found here dates these losses more tightly.
5. **Undated (181 + 4): mark them as undated.** Do not use HYDE's dates: they fail every prehistoric
   control, and on historic losses they do little better than chance.
6. **The next step that dates the most:** the IUCN spatial download (Ita, one browser session), then the
   API token (~12 min script). The polygons would turn part of many of the 181 undated losses into dated
   post-1500 losses, and the range text often names a decade.

## Files

- `range-loss-dates.csv`: one row per species. `earliest_year` and `latest_year` (negative = BCE; blank =
  no bound), `basis`, `source`, `citation`, `confidence`, `dated_share`, PHYLACINE's note, and the HYDE
  reference columns.
- `range-loss-dates/lost_cells.py`: the 682 and their lost cells, from PHYLACINE 1.2.1.
- `range-loss-dates/hyde_fetch.py` and `range-loss-dates/httpzip.py`: HYDE slices summed onto PHYLACINE's grid.
- `range-loss-dates/build_dates.py`: the classing, the source and island tables, and the CSV.
- `range-loss-dates/hyde_test.py`: the 22-species test.
- `range-loss-dates/iucn_api_fetch.py`: for Ita, with a token.

To rebuild from `pipeline/`:

```
uv run --with zipfile-deflate64 python ../research/range-loss-dates/hyde_fetch.py H.npz
uv run python ../research/range-loss-dates/lost_cells.py L.json
uv run python ../research/range-loss-dates/build_dates.py L.json H.npz ../research/range-loss-dates.csv
uv run python ../research/range-loss-dates/hyde_test.py L.json H.npz
```
