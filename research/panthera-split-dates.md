# Panthera split dates, read from Figueiró et al. 2017 Fig. 1A

Date: 2026-10-11. Task: ToLaD #65. This note is for `web/src/fan/splits.ts`. It was not edited here, because the file is being rewritten on another branch.

## Source and how it was read

Figueiró, Li, … Murphy & Eizirik 2017, "Genome-wide signatures of complex introgression and adaptive evolution in the big cats", *Sci. Adv.* 3:e1700299, doi:10.1126/sciadv.1700299, PMC5517113.

- **Where the numbers are.** The node ages appear only as labels in **Fig. 1A**. The caption says: "Numbers above branches indicate the estimated age [in Ma] of the adjacent node, averaged across all genomic windows (100-kb window size, 100-kb steps) that conform to the species tree (95% highest posterior density interval below the respective branch)." I checked the text, the 20-page supplementary PDF (`1700299_SM.pdf`) and the supplementary tables zip (S12, S13, S19, S22–S26, S30–S37). None of them gives the node ages as numbers.
- **How the image was obtained.** Science and PMC's HTML viewer return 403 or a bot challenge to scripts. Two routes do work: the PMC open-access bucket (`https://pmc-oa-opendata.s3.amazonaws.com/PMC5517113.1/1700299-F1.jpg`) and Europe PMC (`europepmc.org/api/fulltextRepo?pprId=PMC5517113&type=FILE&fileName=1700299-F1.jpg&mimeType=image/jpeg`). Both serve the same image, 313×440 px, and no larger version is offered. I enlarged the tree panel 5× and read the labels by eye.
- **How sure the reading is.** At this size the labels are small but clear. Every value is sharp except possibly the last digit, which could be off by about ±0.02. The two labels that can be checked against independent text quotes both agree:
  - The crown HPD of 3.37–5.84 matches GenomeWeb, and 4.58 rounds to the press release's "4.6".
  - The lion–leopard date of 2.57 (1.89–3.28) matches the PeerJ 2024 quote.

  The other two labels (3.65 and 3.47) have no independent text copy. The digits I am least sure of are the upper HPD bound of the jaguar node (4.66, which could be 4.68) and the crown point (4.58, which could be 4.56).
- **Caveat on what the ages mean.** The authors calibrated MCMCTree with only two soft constraints: Pantherinae–Felinae at 9–15 Ma, and the base of *Panthera* no older than 7 Ma. Both come from earlier supermatrix dates, and the authors say they "interpret the ages as relative divergence times rather than absolute estimates". This does not change the values, but it is why the HPDs are wide.

## Table: ready to paste into `splits.ts`

The tree is the paper's species tree, {(tiger, snow leopard), [jaguar, (lion, leopard)]}. "Confidence" means how well the value is tied to the primary source. It is high for all four nodes, because each is now read from the original figure rather than from a blog or an encyclopaedia.

| Node (splits.ts `name`) | Date Ma | 95% HPD Ma | Source | Confidence | Current in splits.ts |
|---|---|---|---|---|---|
| Big cat ancestors (*Panthera* crown: tiger + snow leopard vs lion + leopard + jaguar) | **4.58** | **3.37–5.84** | Figueiró 2017, Fig. 1A, label on the crown node | high | 4.6 (3.37–5.84), press release + GenomeWeb, medium |
| Tiger + snow leopard ancestors | **3.47** | **2.55–4.43** | Figueiró 2017, Fig. 1A | high | 3.5 (1.82–4.62), Coyne blog + Wikipedia, low |
| Lion + leopard + jaguar ancestors (jaguar vs lion + leopard) | **3.65** | **2.69–4.66** | Figueiró 2017, Fig. 1A | high | 3.6 (no interval: lo = hi = 3.6), Coyne blog, low |
| Lion + leopard ancestors | **2.57** | **1.89–3.28** | Figueiró 2017, Fig. 1A | high | 2.57 (1.89–3.28), PeerJ 2024 quote, medium |
| (*Panthera* vs domestic cat, for reference; outside the fan) | 12.06 | 9.02–15 | Figueiró 2017, Fig. 1A | high | n/a |

Two of the current values were wrong in what they claimed to be:

- **The tiger–snow leopard range 1.82–4.62 Ma is not from Figueiró.** Wikipedia ("Snow leopard", Taxonomy and Evolution) cites it to **Johnson et al. 2006**, *Science* 311:73–77 (`ref name=johnson2006`), the multi-gene felid supermatrix. The current cite mixes a 2017 point estimate with a 2006 interval. I could not open Johnson 2006 Table 1 itself (Science is paywalled and NSUWorks has no full text), so the attribution rests on Wikipedia's citation.
- **The jaguar node had no interval.** Its HPD is 2.69–4.66.

Note that the jaguar split (3.65) is **older** than the tiger–snow leopard split (3.47) in Fig. 1A. In the current table the two are 3.6 and 3.5, so their order is already right. Only their spread changes.

### Cite strings

These replace the three Figueiró cites and the lion–leopard one. `FIGUEIRO` is the existing constant.

```ts
// crown
ageMa: 4.58, lo: 3.37, hi: 5.84,
cite: `${FIGUEIRO}, Fig. 1A (node age averaged over species-tree windows, 95% HPD; read from the figure)`,
confidence: 'high',

// Tiger + snow leopard ancestors
ageMa: 3.47, lo: 2.55, hi: 4.43,
cite: `${FIGUEIRO}, Fig. 1A (95% HPD; read from the figure)`,
confidence: 'high',

// Lion + leopard + jaguar ancestors
ageMa: 3.65, lo: 2.69, hi: 4.66,
cite: `${FIGUEIRO}, Fig. 1A (95% HPD; read from the figure)`,
confidence: 'high',

// Lion + leopard ancestors
ageMa: 2.57, lo: 1.89, hi: 3.28,
cite: `${FIGUEIRO}, Fig. 1A (95% HPD; read from the figure)`,
confidence: 'high',
```

The header comment in `splits.ts` ("Its node labels could not be read directly here; the values below are the ones quoted from it by secondary sources…") should become something like: "Node ages and 95% HPDs are read from Fig. 1A's labels (the only place the paper gives them; the figure is 313 px wide, so the last digit is ±0.02). The paper treats them as relative ages under two soft calibrations."

## The European jaguar (*P. gombaszoegensis*)

**Current entry.** It branches off the jaguar lineage at 2.0 Ma (lo 1.5, hi 2.7). The cite is Hemmer 1971 for the placement and O'Regan 2002 for the first appearance. Confidence is low, and the note says the placement is contested by Chatar et al. 2022.

**What Chatar, Michaud & Fischer 2022 say.** The paper is *Papers in Palaeontology* 8(5): e1464, doi:10.1002/spp2.1464. The abstract comes from Crossref; I could not get the full text, because eScholarship and ORBi block scripts. The authors describe a new cranium from Belgium and run a morphometric analysis plus the first phylogenetic analysis of the species. They find:

- The lower teeth are jaguar-like, "similarities were not recovered in other parts of the skull".
- Several cranial traits resemble larger pantherines, "especially … the tiger".
- "The first ever assessment of the phylogenetic placement of *P. gombaszoegensis* places this taxon closer to *P. tigris* than to *P. onca*, which considerably simplifies the biogeographic history of pantherines."

The abstract gives no divergence date. Without the full text I cannot say whether they recover it as sister to the tiger alone or to tiger + *P. zdanskyi*.

**When it first appears.** The first definite European record is about 1.9–2.0 Ma. Wikipedia ("Panthera gombaszogensis") gives "about 2 million to 300,000 years ago" and a first definitive European appearance of about 1.9 Ma. A *P.* aff. *gombaszoegensis* from Kromdraai, South Africa, about 1.9 Ma, was proposed as its origin in 2011, but others doubt that link. The current 2.0 Ma (1.5–2.7) is consistent with this. The ">2.7 Ma" end comes from doubtful records only.

**Options for `splits.ts`.** This is a judgement call, not something the sources settle.

1. **Keep it on the jaguar lineage at 2.0 Ma.** This is the current entry: the traditional view, with the "contested" note and confidence low.
2. **Move it to the tiger lineage at 2.0 Ma**, following Chatar 2022, with confidence low. Its first appearance (about 2.0 Ma) is younger than the tiger + snow leopard split (3.47), so it fits under that node. It would split off the tiger stem below or beside the *P. zdanskyi* split (2.58). Which one comes first depends on Chatar's full tree, which I could not read.

My recommendation is option 1 for now. Chatar 2022 is a single morphometric study, and its phylogeny is in a paper I could not read past the abstract. Keep the current note, and add Chatar's abstract sentence to the note so the card can quote it.

## Sources

- Figueiró et al. 2017, *Sci. Adv.* 3:e1700299, Fig. 1A and caption. PMC5517113; image from the PMC open-access bucket.
- Figueiró et al. 2017, Supplementary Materials (PDF and tables zip). Checked: they contain no node-age table.
- GenomeWeb (crown HPD 3.37–5.84) and the CRG press release (about 4.6 Ma). These are the earlier second-hand values, and both now agree with the figure.
- "Unravelling the maternal evolutionary history of the African leopard", *PeerJ* 2024, 12:e17018. Quotes 2.57 (1.89–3.28), which agrees with the figure.
- Wikipedia, "Snow leopard". Its 4.62–1.82 Ma is cited to Johnson et al. 2006, *Science* 311:73–77.
- Chatar, Michaud & Fischer 2022, *Pap. Palaeontol.* 8:e1464. Abstract via Crossref.
- Wikipedia, "Panthera gombaszogensis": its temporal range and the Kromdraai record.

Not checked: Li et al. 2016 Table S3 and Johnson et al. 2006 Table 1. Fig. 1A made them unnecessary for the values, but the attribution of the 1.82–4.62 range to Johnson rests on Wikipedia's citation.
