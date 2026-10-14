# Domestic stocks at their real mass (ToLaD#328)

The widths by mass (#276) weigh each species' individuals at the model's adult body mass, PHYLACINE 1.2 first.
For the domestic stocks that is the wild ancestor's mass: `Bos taurus` 900 kg (the aurochs), `Bubalus bubalis`
725 kg (the wild arni). Mammals alive now came to ~2.4 Gt, twice the literature's.

## The rule

A leaf carrying a domestic stock weighs the mean of who is alive on it now: the stock at its herd's **mean live
mass**, young animals included, plus any wild population left on the leaf at its adult mass. One table, one source:
the domestic biomass of Greenspoon et al. 2023 (PNAS 120:e2204892120, https://doi.org/10.1073/pnas.2204892120),
recomputed per stock from its data release (Zenodo doi:10.5281/zenodo.7594807, CC BY 4.0, already pinned in
`data/raw/greenspoon/`) by `anchors.greenspoon_domestic_mass`: FAOSTAT 2018 head counts by region times that
region's typical live weight, divided by the heads. Its notebook (`human_and_domesticated_biomass.ipynb`) says
where the weights come from:

> 3. Manually curated livestock mass fille. Curated from https://www.ipcc-nggip.iges.or.jp/public/2006gl/pdf/4_Volume4/V4_10_Ch10_Livestock.pdf, available in this repo under 'data/domesticated_data/'

that is the IPCC 2006 Guidelines, Vol. 4 ch. 10, the Tier 1 typical animal masses by region (dairy and other cattle,
breeding and market swine). Dogs and cats take the body mass in its pets table (`pets_rats_mouse.csv`):

> `Dog,Canis familiaris,1000000000,21.62,21.62` · `Cat,Felis catus,600000000,3.75,2.25`

The recomputed biomass matches Greenspoon's published `results/human_and_domesticated.csv` to 0.1 Mt for every stock.

| stock (FAO item) | leaf | mean live mass | was (adult, PHYLACINE first) |
|---|---|---:|---:|
| Cattle (dairy + non-dairy) | Bos taurus | 277 kg | 900 kg |
| Buffaloes | Bubalus bubalis | 333 kg | 725 kg |
| Horses | Equus caballus | 277 kg | 200 kg |
| Camels | Camelus dromedarius | 217 kg | 800 kg |
| Asses | Equus asinus | 130 kg | 275 kg |
| Swine (breeding + market) | Sus scrofa (+ wild boar) | 38.5 kg (leaf 40.0) | 101 kg |
| Sheep | Ovis aries | 31.9 kg | 60 kg |
| Goats | Capra aegagrus (alias of C. hircus) | 30.2 kg | 33.5 kg |
| Dog | Canis familiaris | 21.6 kg | 32.2 kg (clade mean) |
| Cat | Felis catus | 3.75 kg | 2.9 kg (PanTHERIA) |

The model's own `log_mass` (density and occupancy fits) is untouched; only the dated sidecars' `mass` column, which
the widths and the card read, changes (`mass_how` "domestic stock"). The domestic forms with no stock of their own
(llama, alpaca, zebu, yak, Bactrian camel: none alive in the model, `DOMESTIC_FORM_NO_STOCK`) and the species whose
domestic herds the pinned sources do not split out (reindeer, rabbit) keep their adult mass. One mass per leaf: the
cattle column's deep past (the aurochs) now also weighs 277 kg each; the widths have one weight per species.

## Audit: mammals alive now, by mass (build of 2026-10-14)

`web/src/fan/mass.test.ts` prints and bounds it:

| | this build | Greenspoon 2023 (wet) | Bar-On 2018 (carbon → wet) |
|---|---:|---:|---:|
| domestic stocks | 673 Mt | ~630 Mt | 0.1 Gt C → ~670 Mt |
| humans | 494 Mt | ~390 Mt | 0.06 Gt C → ~400 Mt |
| wild | 86 Mt | ~60 Mt (land 20, marine 40) | 0.007 Gt C → ~47 Mt |
| **total** | **1.25 Gt (0.19 Gt C)** | ~1.1 Gt | 0.167 Gt C → ~1.1 Gt |

Conversion: Bar-On, Phillips & Milo 2018 (PNAS 115:6506, https://doi.org/10.1073/pnas.1711842115) report carbon;
we take 0.15 g C per g wet mass (~70% water, ~50% carbon in dry mass), the factor their human figure implies
(7.6 × 10⁹ people × 50 kg × 0.15 ≈ 0.057 Gt C, their 0.06).

The total is +13% on Greenspoon and Bar-On, within 30%. Domestic stocks land on both. Humans run ~25% over:
the model weighs them at PHYLACINE's adult 59.5 kg, where Greenspoon and Bar-On take 50 kg for a population with
children in it (the same adult-vs-population gap the domestic rule closes for the herds; humans are not a domestic
stock and keep the general rule). The wild part runs 1.4-1.8× over, as the build's own `occupancy.land_total`
note says: census species use PHYLACINE adult masses, and Greenspoon's 95% CI for wild land biomass is 13-38 Mt.
