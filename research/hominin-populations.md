# Hominin population sizes (ToLaD#302, #280)

What the fan shows for each fossil hominin: **alive at a time** (census individuals, held over the species'
band) and **ever lived** (= alive x span / 12.5 years, births at alive / half a generation, a 25-year
generation). Before #302 both came from the allometric model (density x clade-mean range x occupancy, a
~9-year generation from body mass) over a band that, for Open Tree leaves, started at the parent's split
(H. erectus from Homo's 3.84 Ma, Sahelanthropus from 11.2 Ma). Now each count is cited
(`pipeline/overrides.toml` `[[fossil_count]]`), the generation is 25 years (chimpanzee, Langergraber et al.
2012; humans 26.9, Wang et al. 2023), and a literature first appearance (`[[date]]`) starts the band.

How each figure was obtained (`kind`):

- **census**: a published census-size estimate.
- **ne-ratio**: a genetic effective size (Ne) x a census/Ne ratio of 3-10 (Sjödin et al. 2012's ~10 for
  early H. sapiens, the ratio the app's human deep past already uses).
- **density-area**: forager densities 0.04-0.4 per km² (Marlowe 2005), central 0.1, x an area.
- **analog**: no estimate exists for the species (true of every pre-erectus hominin): the census of the
  living great apes of its size in Africa, bonobos 15,000-20,000 (one regional species) to chimpanzees
  173,000-300,000 (pan-African): 50,000 (15,000-300,000).

| species | before: alive | before: ever | after: alive (range) | after: ever | kind | source |
|---|---:|---:|---:|---:|---|---|
| Homo neanderthalensis (0.43-0.04 Ma) | 458,000 | 2.2e10 | 20,000 (5,000-70,000) | 6.2e8 | census | Bocquet-Appel & Degioanni 2013, Curr Anthropol 54: S202 |
| Denisovan, Homo longi (0.20-0.05 Ma, new) | — | — | 25,000 (3,000-150,000) | 3.0e8 | ne-ratio | Ne ~2,500 (1,000-15,000): Meyer et al. 2012; Rogers et al. 2017 |
| Homo heidelbergensis (0.70-0.20 Ma) | 30,400 | 3.2e9 | 100,000 (30,000-300,000) | 4.0e9 | ne-ratio | Ne 10,000-26,000: Huff et al. 2010; Deevey 1960 (1e6 people at 300 ka) |
| Homo erectus (2.0-0.11 Ma; was 3.84-) | 35,700 | 2.9e10 | 200,000 (50,000-500,000) | 3.0e10 | ne-ratio | Ne 18,500 x 10: Huff et al. 2010; 125,000 at 1 Ma: Deevey 1960; Ne 1,300 bottleneck 930-813 ka: Hu et al. 2023 |
| Homo floresiensis (0.19-0.05 Ma) | 907 | 1.7e7 | 1,400 (500-5,000) | 1.6e7 | density-area | Flores 13,540 km² x Marlowe 2005 |
| Homo naledi (0.34-0.24 Ma) | 35,700 | 7.6e8 | 10,000 (2,000-50,000) | 7.9e7 | density-area | ~1e5 km² x Marlowe 2005; dates Dirks et al. 2017 |
| Homo antecessor (0.95-0.77 Ma; was 3.05-) | 30,400 | 1.4e10 | 10,000 (2,000-50,000) | 1.4e8 | density-area | ~1e5 km² of northern Iberia x Marlowe 2005 |
| Homo georgicus (1.85-1.77 Ma) | 35,700 | 6.1e8 | 10,000 (2,000-50,000) | 6.4e7 | density-area | ~1e5 km² x Marlowe 2005 |
| Homo habilis (2.4-1.44 Ma; was 3.84-) | 35,700 | 1.8e10 | 50,000 (15,000-300,000) | 3.8e9 | analog | bonobo/chimpanzee census, IUCN 2016 |
| Homo rudolfensis (2.1-1.8 Ma; was 3.84-) | 35,700 | 1.6e10 | 50,000 | 1.2e9 | analog | " |
| Paranthropus robustus (2.0-1.0 Ma; was 3.46-) | 35,700 | 1.9e10 | 50,000 | 4.0e9 | analog | " |
| Paranthropus boisei (2.3-1.4 Ma; was 3.08-) | 35,700 | 1.3e10 | 50,000 | 3.6e9 | analog | " |
| Paranthropus aethiopicus (2.7-2.3 Ma; was 3.08-) | 35,700 | 6.0e9 | 50,000 | 1.6e9 | analog | " |
| Australopithecus sediba | 40,400 | 8.8e7 | 50,000 | 4.0e7 | analog | " |
| Australopithecus garhi | 40,400 | 1.8e9 | 50,000 | 8.0e8 | analog | " |
| Australopithecus africanus | 40,400 | 7.9e9 | 50,000 | 3.6e9 | analog | " |
| Australopithecus deyiremeda | 40,400 | 1.8e9 | 50,000 | 8.0e8 | analog | " |
| Kenyanthropus platyops | 35,700 | 2.3e9 | 50,000 | 1.2e9 | analog | " |
| Australopithecus afarensis | 8,460 | 1.6e9 | 50,000 | 3.6e9 | analog | " |
| Australopithecus anamensis | 8,460 | 7.1e8 | 50,000 | 1.6e9 | analog | " |
| Ardipithecus ramidus (OTT: Australopithecus r.; was 5.95-) | 40,400 | 1.5e10 | 50,000 | 8.0e8 | analog | " |
| Ardipithecus kadabba | 40,400 | 5.3e9 | 50,000 | 2.4e9 | analog | " |
| Orrorin tugenensis | 40,400 | 3.5e9 | 50,000 | 1.6e9 | analog | " |
| Sahelanthropus tchadensis (7.2-6.8 Ma; was 11.18-) | 16,100 | 1.5e10 | 50,000 | 1.6e9 | analog | " |

"Before" is main at 907391a (model alive, model ever over the old band); "after" is this branch's
`stats.json -> fossil_counts`. Neanderthals fall from 22 billion ever to 620 million (#280); H. erectus
is 5.6x wider at a time (200,000, Ita's "they were prevalent") but its ever-lived stays ~3e10 because the
longer generation and the shorter band (2.0 Ma, not 3.84) cancel the wider count.

What is soft: everything before H. erectus is an analogy, not a measurement (no hominin before ~2 Ma has a
genome or a census model); the density-area figures depend on an assumed occupied area; Ne-to-census
ratios of 3-10 are the usual span, not measured for any archaic species. The ranges in the table, not the
central figures, are what the sources support.

The #113 audit (`make -C pipeline audit`) is unchanged by this: 233 flagged leaves before and after (it
covers living species and the cats; fossils carry no curated history).
