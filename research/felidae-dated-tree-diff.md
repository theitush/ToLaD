# Felidae: the data's dated tree vs the old hand tree (ToLaD#145)

The fan's cat tree used to be typed into web/src/fan/splits.ts (TimeTree 5 pairs outside Panthera, Figueiró 2017 inside).
It now comes from the pipeline's dated tree (pipeline/FORMAT.md, "Dated tree"): Upham et al. 2019's topology, dated by the
**ensemble** rule (research/dated-tree-sources.md §5: on a clade both Upham and Álvarez-Carretero 2022 have, the
geometric mean of their ages; elsewhere interpolated in Upham's shape), a fossil floor, fossils grafted by rule, and the
hand values in pipeline/overrides.toml ([[dated_clade]] Panthera and the domestic cat, [[dated_fossil]] four Panthera
fossils). Regenerated 2026-10-12 (tree145b) by a one-off vitest script that matches each hand split to the youngest data
split over the same hand species.

**Why the dates moved.** Under Upham's own ages (the previous version of this note) crown Felidae was 7.2 Ma and seven
deep splits fell outside the hand ranges. With the ensemble ages the family's crown is **11.97 Ma** (Johnson et al. 2006
10.8, Li et al. 2016 ~15, TimeTree 13.8), inside the 11–15 Ma it should be, and **every matched split's range overlaps the
hand range**. The biggest change is the caracal + serval/golden cat split: 5.0 against 2.06 (both ranges are wide).
The ensemble ranges are wide on purpose: they are the union of the two trees' 95% intervals.

**Root.** The fan's root is a fossil split at 19.51 Ma (*Pseudaelurus* / *Styriofelis* and kin, on the family's stem),
not the crown: the data holds 98 dated fossil cats. Of them, 56 sit inside the crown (most join a split by taxonomy only,
"loose"; the card says so) and 42 stay on its stem: the early-Miocene cats and the sabre-tooth subfamily
(*Machairodus*, *Amphimachairodus*, *Paramachaerodus*, *Metailurus*, *Yoshi*, ...). With the crown at 11.97 instead of
7.2, the fossils first seen between those dates (within crown genera) moved from the stem to inside the crown.

**Topology.** Upham's where it differs from the hand tree: Pardofelis with the bay cat (not the golden cats), Pallas's cat
with Felis, the ocelot lineage and Lynx resolved differently. The hand splits in the second table have no exact
counterpart. Panthera is Figueiró's (override).

hand 42 species, 39 splits; data 136 species (98 fossil), 68 splits; root 13.8 vs 19.51
only in hand: none

| hand split | hand Ma (range) | data Ma (range) | Δ Ma | ranges overlap | data source |
|---|---|---|---|---|---|
| Cat ancestors | 13.8 (11.95–15.66) | 11.97 (5.227–21.81) | -1.83 | yes | ensemble |
| Pantherine ancestors | 9.29 (8.17–10.4) | 8.162 (3.629–15.24) | -1.13 | yes | ensemble |
| Clouded leopard ancestors | 2.15 (2.15–2.15) | 2.476 (0.768–4.226) | +0.33 | yes | upham-interp |
| Big cat ancestors | 4.58 (3.37–5.84) | 4.58 (3.37–5.84) | +0.00 | yes | override |
| Tiger + snow leopard ancestors | 3.47 (2.55–4.43) | 3.47 (2.55–4.43) | +0.00 | yes | override |
| Tiger ancestors | 2.58 (2.16–2.58) | 2.58 (2.58–2.58) | +0.00 | yes | override |
| Lion + leopard + jaguar ancestors | 3.65 (2.69–4.66) | 3.65 (2.69–4.66) | +0.00 | yes | override |
| Jaguar ancestors | 2 (1.5–2.7) | 2 (1.5–2.7) | +0.00 | yes | override |
| Jaguar ancestors | 0.129 (0.0117–0.129) | 0.129 (0.129–0.129) | +0.00 | yes | override |
| Lion + leopard ancestors | 2.57 (1.89–3.28) | 2.57 (1.89–3.28) | +0.00 | yes | override |
| Lion ancestors | 0.5 (0.392–0.578) | 0.5 (0.392–0.578) | +0.00 | yes | override |
| Small cat ancestors | 11.86 (9.04–14.37) | 10.42 (4.865–19.6) | -1.44 | yes | ensemble |
| Bay cat lineage | 6.31 (5.7–6.93) | 5.49 (1.059–14.29) | -0.82 | yes | ensemble |
| Caracal lineage | 7.44 (5.35–9.53) | 7.458 (2.947–14.25) | +0.02 | yes | ensemble |
| Caracal ancestors | 2.06 (1.19–2.93) | 5.025 (2.083–9.06) | +2.97 | yes | ensemble |
| Ocelot lineage | 4.57 (3.65–5.49) | 4.806 (1.039–12.21) | +0.24 | yes | ensemble |
| Ocelot + margay ancestors | 2.05 (1.35–2.76) | 1.292 (0.004554–6.536) | -0.76 | yes | ensemble |
| Lynx ancestors | 6.1 (4.58–7.62) | 5.079 (2.218–9.427) | -1.02 | yes | ensemble |
| Northern lynx ancestors | 2.68 (1.96–3.4) | 2.201 (0.9367–3.865) | -0.48 | yes | ensemble |
| Puma lineage | 5.66 (4.65–6.67) | 6.224 (2.722–11.95) | +0.56 | yes | ensemble |
| Cougar + jaguarundi ancestors | 5.21 (3.52–6.89) | 5.248 (2.037–10.42) | +0.04 | yes | ensemble |
| Leopard cat lineage | 5.95 (3.77–8.13) | 4.64 (1.263–10.45) | -1.31 | yes | ensemble |
| Flat-headed + leopard cat ancestors | 5.76 (3.89–7.63) | 4.031 (1.314–8.923) | -1.73 | yes | ensemble |
| Leopard cat + fishing cat ancestors | 3.29 (2.36–4.21) | 2.24 (0.4566–5.417) | -1.05 | yes | ensemble |
| Wildcat lineage | 4.44 (3.43–5.45) | 4.804 (1.449–11.07) | +0.36 | yes | ensemble |
| Sand cat + wildcat ancestors | 3.01 (2.45–3.57) | 2.34 (0.8948–4.229) | -0.67 | yes | ensemble |
| Wildcat ancestors | 0.0095 (0.0095–0.0115) | 0.0095 (0.0095–0.0115) | +0.00 | yes | override |

| hand split (not in data) | daughters | hand Ma | |
|---|---|---|---|
| Golden cat ancestors | Borneo bay cat / Asian golden cat | 5.57 (4.4–6.74) | not a clade in the data's tree |
| Ocelot + lynx + puma + domestic cat ancestors | (8) / (17) | 10.65 (8.73–12.57) | not a clade in the data's tree |
| Ocelot + tiger cat ancestors | (2) / (5) | 4.46 (3.02–5.89) | not a clade in the data's tree |
| Pampas cat + tiger cat ancestors | Pampas cat / (4) | 3.46 (2.33–4.59) | not a clade in the data's tree |
| Tiger cat ancestors | (2) / (2) | 2.37 (1.19–3.55) | not a clade in the data's tree |
| Oncilla ancestors | Northern tiger cat / Southern tiger cat | 1.46 (1.46–1.46) | not a clade in the data's tree |
| Geoffroy's cat + kodkod ancestors | Geoffroy's cat / Guiña | 1.58 (1.43–1.73) | not a clade in the data's tree |
| Lynx + puma + domestic cat ancestors | (4) / (3) / (10) | 10.32 (7.65–12.68) | not a clade in the data's tree |
| Eurasian + Canada lynx ancestors | Eurasian lynx / Canada lynx | 2.48 (2–2.95) | not a clade in the data's tree |
| Leopard cat + domestic cat ancestors | Pallas's cat / (9) | 8.88 (6.67–11.09) | not a clade in the data's tree |
| Leopard cat + wildcat ancestors | (4) / (5) | 8.31 (6.66–9.95) | not a clade in the data's tree |
| Black-footed cat + wildcat ancestors | Black-footed cat / (3) | 3.17 (2.38–3.96) | not a clade in the data's tree |

crown Felidae 11.97 Ma (ensemble); fossils inside it: 56; on its stem: 42
