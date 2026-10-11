// Display names, ranks and number formatting.
//
// The v1 dataset carries scientific names only (Open Tree / PBDB). Common names
// come from this small hand-made table of well-known mammal groups; anything
// not in it falls back to the scientific name.

export const COMMON: Record<string, string> = {
  Mammalia: 'Mammals',
  Theria: 'Live-bearing mammals',
  Eutheria: 'Placental mammals',
  Placentalia: 'Placental mammals',
  Metatheria: 'Marsupials & kin',
  Marsupialia: 'Marsupials',
  Monotremata: 'Monotremes',
  Prototheria: 'Monotremes',
  Multituberculata: 'Multituberculates',
  Boreoeutheria: 'Boreoeutherians',
  Euarchontoglires: 'Primates, rodents & kin',
  Laurasiatheria: 'Laurasiatherians',
  Afrotheria: 'Afrotherians',
  Xenarthra: 'Xenarthrans',
  Glires: 'Rodents & rabbits',
  Primatomorpha: 'Primates & colugos',
  Primates: 'Primates',
  Haplorhini: 'Haplorhine primates',
  Strepsirrhini: 'Lemurs & lorises',
  Simiiformes: 'Monkeys & apes',
  Catarrhini: 'Old World monkeys & apes',
  Platyrrhini: 'New World monkeys',
  Cercopithecidae: 'Old World monkeys',
  Hominoidea: 'Apes',
  Hylobatidae: 'Gibbons',
  Hominidae: 'Great apes',
  Homininae: 'African apes',
  Hominini: 'Hominins',
  Homo: 'Humans',
  'Homo sapiens': 'Human',
  'Homo neanderthalensis': 'Neanderthal',
  'Homo erectus': 'Homo erectus',
  Pan: 'Chimpanzees',
  'Pan troglodytes': 'Chimpanzee',
  'Pan paniscus': 'Bonobo',
  Gorilla: 'Gorillas',
  'Gorilla gorilla': 'Western gorilla',
  Pongo: 'Orangutans',
  Lemuriformes: 'Lemurs',
  Tarsiiformes: 'Tarsiers',
  Dermoptera: 'Colugos',
  Scandentia: 'Treeshrews',
  Rodentia: 'Rodents',
  Muridae: 'Old World mice & rats',
  Mus: 'House mice',
  'Mus musculus': 'House mouse',
  'Rattus norvegicus': 'Brown rat',
  Cricetidae: 'Hamsters, voles & kin',
  Sciuridae: 'Squirrels',
  Castoridae: 'Beavers',
  Hystricidae: 'Old World porcupines',
  Caviidae: 'Cavies',
  Myomorpha: 'Mouse-like rodents',
  Lagomorpha: 'Rabbits, hares & pikas',
  Leporidae: 'Rabbits & hares',
  Ochotonidae: 'Pikas',
  Chiroptera: 'Bats',
  Pteropodidae: 'Fruit bats',
  Vespertilionidae: 'Vesper bats',
  Eulipotyphla: 'Shrews, moles & hedgehogs',
  Soricidae: 'Shrews',
  Talpidae: 'Moles',
  Erinaceidae: 'Hedgehogs',
  Carnivora: 'Carnivorans',
  Feliformia: 'Cat-like carnivorans',
  Caniformia: 'Dog-like carnivorans',
  Felidae: 'Cats',
  'Felis catus': 'Domestic cat',
  'Panthera leo': 'Lion',
  'Panthera tigris': 'Tiger',
  Canidae: 'Dogs & foxes',
  'Canis lupus': 'Wolf & dog',
  Ursidae: 'Bears',
  'Ursus maritimus': 'Polar bear',
  Mustelidae: 'Weasels & otters',
  Pinnipedia: 'Seals & sea lions',
  Phocidae: 'True seals',
  Otariidae: 'Sea lions',
  Hyaenidae: 'Hyenas',
  Herpestidae: 'Mongooses',
  Procyonidae: 'Raccoons',
  Pholidota: 'Pangolins',
  Manidae: 'Pangolins',
  Perissodactyla: 'Odd-toed ungulates',
  Equidae: 'Horses',
  'Equus caballus': 'Horse',
  'Equus asinus': 'Donkey',
  Rhinocerotidae: 'Rhinoceroses',
  Tapiridae: 'Tapirs',
  Artiodactyla: 'Even-toed ungulates & whales',
  Cetartiodactyla: 'Even-toed ungulates & whales',
  Ruminantia: 'Ruminants',
  Bovidae: 'Cattle, antelope & kin',
  'Bos taurus': 'Cattle',
  'Ovis aries': 'Sheep',
  'Capra aegagrus': 'Wild goat & goat',
  'Bubalus bubalis': 'Water buffalo',
  Cervidae: 'Deer',
  Giraffidae: 'Giraffes',
  Suidae: 'Pigs',
  'Sus scrofa': 'Wild boar & pig',
  Camelidae: 'Camels & llamas',
  'Camelus dromedarius': 'Dromedary',
  Hippopotamidae: 'Hippos',
  'Hexaprotodon liberiensis': 'Pygmy hippo',
  Cetacea: 'Whales & dolphins',
  Mysticeti: 'Baleen whales',
  Odontoceti: 'Toothed whales',
  Delphinidae: 'Oceanic dolphins',
  'Balaenoptera musculus': 'Blue whale',
  Proboscidea: 'Elephants',
  Elephantidae: 'Elephants & mammoths',
  Mammuthus: 'Mammoths',
  'Mammuthus primigenius': 'Woolly mammoth',
  Loxodonta: 'African elephants',
  Elephas: 'Asian elephants',
  Sirenia: 'Manatees & dugongs',
  Hyracoidea: 'Hyraxes',
  Tubulidentata: 'Aardvark',
  Afrosoricida: 'Tenrecs & golden moles',
  Macroscelidea: 'Elephant shrews',
  Pilosa: 'Sloths & anteaters',
  Folivora: 'Sloths',
  Vermilingua: 'Anteaters',
  Cingulata: 'Armadillos',
  Dasypodidae: 'Armadillos',
  Diprotodontia: 'Kangaroos, koalas & wombats',
  Macropodidae: 'Kangaroos & wallabies',
  Phascolarctidae: 'Koalas',
  Vombatidae: 'Wombats',
  Petauridae: 'Gliders',
  Pseudocheiridae: 'Ringtail possums',
  Phalangeridae: 'Possums & cuscuses',
  Dasyuromorphia: 'Carnivorous marsupials',
  Dasyuridae: 'Quolls, dunnarts & kin',
  Thylacinidae: 'Thylacines',
  Peramelemorphia: 'Bandicoots & bilbies',
  Notoryctemorphia: 'Marsupial moles',
  Microbiotheria: 'Monito del monte',
  Didelphimorphia: 'Opossums',
  Paucituberculata: 'Shrew opossums',
  Notoungulata: 'Notoungulates',
  Cimolesta: 'Cimolestans',
  Ornithorhynchus: 'Platypus',
  Tachyglossidae: 'Echidnas',
};

/** Strip Open Tree homonym qualifiers: "Theria (subclass in Deuterostomia)" → "Theria". */
export function cleanName(s: string): string {
  return s.replace(/\s*\((?:[^()]*\bin\b[^()]*|fossil)\)\s*$/i, '').trim();
}

export interface DisplayName {
  /** What labels show: the common name if known, else the scientific name. */
  label: string;
  /** Scientific name (cleaned), or '' for an unnamed clade. */
  sci: string;
  common: string | null;
}

/** Names list "primary|alt|alt" (alts = collapsed unary ancestors, nearest first). */
export function displayName(names: string[]): DisplayName {
  const clean = names.map(cleanName).filter((s) => s.length > 0);
  if (clean.length === 0) return { label: '', sci: '', common: null };
  // The outermost alt is the broadest group this band stands for.
  for (let i = clean.length - 1; i >= 0; i--) {
    const c = COMMON[clean[i]];
    if (c) return { label: c, sci: clean[i], common: c };
  }
  return { label: clean[0], sci: clean[0], common: null };
}

const RANK_SUFFIX: [RegExp, string][] = [
  [/oidea$/, 'superfamily'],
  [/idae$/, 'family'],
  [/inae$/, 'subfamily'],
  [/ini$/, 'tribe'],
  [/iformes$/, 'order'],
  [/morpha$/, 'clade'],
];

const ORDERS = new Set([
  'Primates', 'Rodentia', 'Lagomorpha', 'Chiroptera', 'Eulipotyphla', 'Carnivora', 'Pholidota', 'Perissodactyla', 'Artiodactyla',
  'Cetartiodactyla', 'Proboscidea', 'Sirenia', 'Hyracoidea', 'Tubulidentata', 'Afrosoricida', 'Macroscelidea', 'Pilosa', 'Cingulata',
  'Dermoptera', 'Scandentia', 'Diprotodontia', 'Dasyuromorphia', 'Peramelemorphia', 'Notoryctemorphia', 'Microbiotheria',
  'Didelphimorphia', 'Paucituberculata', 'Monotremata', 'Notoungulata', 'Cimolesta', 'Multituberculata',
]);
const HIGHER: Record<string, string> = {
  Mammalia: 'class',
  Theria: 'subclass',
  Prototheria: 'subclass',
  Eutheria: 'infraclass',
  Metatheria: 'infraclass',
  Cetacea: 'infraorder',
};

/**
 * Rank, inferred: v1 data has no rank column, so this uses the species flag,
 * a list of orders and the ICZN family-group suffixes. "clade" otherwise.
 */
export function rankOf(sci: string, isSpecies: boolean, nameCount: number): string {
  if (!sci) return 'unnamed clade';
  if (isSpecies && /^[A-Z][a-z]+ [a-z]/.test(sci)) return 'species';
  if (HIGHER[sci]) return HIGHER[sci];
  if (ORDERS.has(sci)) return 'order';
  for (const [re, r] of RANK_SUFFIX) if (re.test(sci)) return r;
  if (/^[A-Z][a-z]+$/.test(sci) && nameCount === 1) return 'genus';
  return 'clade';
}

/** "66 Mya", "11.7 kya", "350 ya", "now". `stepYears` sets the precision. */
export function formatAge(ageMa: number, stepYears = 0): string {
  const y = ageMa * 1e6;
  if (Math.abs(y) < 0.5) return 'now';
  const dec = (unit: number) => {
    if (!stepYears) return y / unit >= 100 ? 0 : y / unit >= 10 ? 1 : 2;
    const s = stepYears / unit;
    return s >= 1 ? 0 : Math.min(3, Math.ceil(-Math.log10(s) - 1e-9));
  };
  const fmt = (v: number, d: number) => {
    let s = v.toFixed(d);
    if (!stepYears && s.includes('.')) s = s.replace(/\.?0+$/, '');
    return s;
  };
  if (y >= 1e6 && (!stepYears || stepYears >= 1e5)) return `${fmt(y / 1e6, dec(1e6))} Mya`;
  if (y >= 1e3 && (!stepYears || stepYears >= 100)) return `${fmt(y / 1e3, dec(1e3))} kya`;
  return `${fmt(y, dec(1))} ya`;
}
