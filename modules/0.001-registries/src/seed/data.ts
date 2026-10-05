/**
 * Initial registry data. Compiled by hand from public sources (party
 * register, Eduskunta and Valtioneuvosto web pages); rows are stored with
 * source = 'seed' and are refined by the Eduskunta reference-data sync and by
 * manual edits. Manually edited fields are never overwritten.
 */

export interface PartySeed {
  abbreviation: string;
  nameFi: string;
  nameSv: string;
  nameEn: string;
  officialName: string;
  parliamentaryGroupName: string | null;
  /** Eduskunta parliamentary group code prefix, e.g. "KOK" in "KOK01". */
  groupPrefix: string | null;
  color: string;
  website: string | null;
  status: 'active' | 'dissolved';
}

export const PARTIES: PartySeed[] = [
  {
    abbreviation: 'KOK',
    nameFi: 'Kansallinen Kokoomus',
    nameSv: 'Samlingspartiet',
    nameEn: 'National Coalition Party',
    officialName: 'Kansallinen Kokoomus r.p.',
    parliamentaryGroupName: 'Kansallisen kokoomuksen eduskuntaryhmä',
    groupPrefix: 'KOK',
    color: '#006288',
    website: 'https://www.kokoomus.fi',
    status: 'active',
  },
  {
    abbreviation: 'SDP',
    nameFi: 'Suomen Sosialidemokraattinen Puolue',
    nameSv: 'Finlands Socialdemokratiska Parti',
    nameEn: 'Social Democratic Party of Finland',
    officialName: 'Suomen Sosialidemokraattinen Puolue r.p.',
    parliamentaryGroupName: 'Sosialidemokraattinen eduskuntaryhmä',
    groupPrefix: 'SD',
    color: '#E11931',
    website: 'https://www.sdp.fi',
    status: 'active',
  },
  {
    abbreviation: 'PS',
    nameFi: 'Perussuomalaiset',
    nameSv: 'Sannfinländarna',
    nameEn: 'The Finns Party',
    officialName: 'Perussuomalaiset r.p.',
    parliamentaryGroupName: 'Perussuomalaisten eduskuntaryhmä',
    groupPrefix: 'PS',
    color: '#FFDE55',
    website: 'https://www.perussuomalaiset.fi',
    status: 'active',
  },
  {
    abbreviation: 'KESK',
    nameFi: 'Suomen Keskusta',
    nameSv: 'Centern i Finland',
    nameEn: 'Centre Party of Finland',
    officialName: 'Suomen Keskusta r.p.',
    parliamentaryGroupName: 'Keskustan eduskuntaryhmä',
    groupPrefix: 'KESK',
    color: '#3AAD2E',
    website: 'https://www.keskusta.fi',
    status: 'active',
  },
  {
    abbreviation: 'VIHR',
    nameFi: 'Vihreä liitto',
    nameSv: 'Gröna förbundet',
    nameEn: 'Green League',
    officialName: 'Vihreä liitto r.p.',
    parliamentaryGroupName: 'Vihreä eduskuntaryhmä',
    groupPrefix: 'VIHR',
    color: '#61BF1A',
    website: 'https://www.vihreat.fi',
    status: 'active',
  },
  {
    abbreviation: 'VAS',
    nameFi: 'Vasemmistoliitto',
    nameSv: 'Vänsterförbundet',
    nameEn: 'Left Alliance',
    officialName: 'Vasemmistoliitto r.p.',
    parliamentaryGroupName: 'Vasemmistoliiton eduskuntaryhmä',
    groupPrefix: 'VAS',
    color: '#F00A64',
    website: 'https://www.vasemmisto.fi',
    status: 'active',
  },
  {
    abbreviation: 'RKP',
    nameFi: 'Suomen ruotsalainen kansanpuolue',
    nameSv: 'Svenska folkpartiet i Finland',
    nameEn: 'Swedish People’s Party of Finland',
    officialName: 'Suomen ruotsalainen kansanpuolue r.p.',
    parliamentaryGroupName: 'Ruotsalainen eduskuntaryhmä',
    groupPrefix: 'R',
    color: '#FFDD93',
    website: 'https://www.sfp.fi',
    status: 'active',
  },
  {
    abbreviation: 'KD',
    nameFi: 'Suomen Kristillisdemokraatit (KD)',
    nameSv: 'Kristdemokraterna i Finland (KD)',
    nameEn: 'Christian Democrats',
    officialName: 'Suomen Kristillisdemokraatit (KD) r.p.',
    parliamentaryGroupName: 'Kristillisdemokraattinen eduskuntaryhmä',
    groupPrefix: 'KD',
    color: '#2B67C9',
    website: 'https://www.kd.fi',
    status: 'active',
  },
  {
    abbreviation: 'LIIK',
    nameFi: 'Liike Nyt',
    nameSv: 'Rörelse Nu',
    nameEn: 'Movement Now',
    officialName: 'Liike Nyt r.p.',
    parliamentaryGroupName: 'Liike Nyt -eduskuntaryhmä',
    groupPrefix: 'LIIK',
    color: '#B6007B',
    website: 'https://liikenyt.fi',
    status: 'active',
  },
];

export interface DistrictSeed {
  code: string;
  nameFi: string;
  nameSv: string;
  validFrom: string | null;
  validTo: string | null;
  notes?: string;
}

// Districts since the 2015 parliamentary elections (Kymi + Etelä-Savo merged into
// Kaakkois-Suomi, Pohjois-Savo + Pohjois-Karjala into Savo-Karjala).
export const DISTRICTS: DistrictSeed[] = [
  {
    code: 'HEL',
    nameFi: 'Helsingin vaalipiiri',
    nameSv: 'Helsingfors valkrets',
    validFrom: null,
    validTo: null,
  },
  { code: 'UUS', nameFi: 'Uudenmaan vaalipiiri', nameSv: 'Nylands valkrets', validFrom: null, validTo: null },
  {
    code: 'VAR',
    nameFi: 'Varsinais-Suomen vaalipiiri',
    nameSv: 'Egentliga Finlands valkrets',
    validFrom: null,
    validTo: null,
  },
  {
    code: 'SAT',
    nameFi: 'Satakunnan vaalipiiri',
    nameSv: 'Satakunta valkrets',
    validFrom: null,
    validTo: null,
  },
  {
    code: 'AHV',
    nameFi: 'Ahvenanmaan maakunnan vaalipiiri',
    nameSv: 'Landskapet Ålands valkrets',
    validFrom: null,
    validTo: null,
  },
  {
    code: 'HAM',
    nameFi: 'Hämeen vaalipiiri',
    nameSv: 'Tavastlands valkrets',
    validFrom: null,
    validTo: null,
  },
  {
    code: 'PIR',
    nameFi: 'Pirkanmaan vaalipiiri',
    nameSv: 'Birkalands valkrets',
    validFrom: null,
    validTo: null,
  },
  {
    code: 'KAA',
    nameFi: 'Kaakkois-Suomen vaalipiiri',
    nameSv: 'Sydöstra Finlands valkrets',
    validFrom: '2015-01-01',
    validTo: null,
  },
  {
    code: 'SAV',
    nameFi: 'Savo-Karjalan vaalipiiri',
    nameSv: 'Savolax-Karelens valkrets',
    validFrom: '2015-01-01',
    validTo: null,
  },
  { code: 'VAA', nameFi: 'Vaasan vaalipiiri', nameSv: 'Vasa valkrets', validFrom: null, validTo: null },
  {
    code: 'KES',
    nameFi: 'Keski-Suomen vaalipiiri',
    nameSv: 'Mellersta Finlands valkrets',
    validFrom: null,
    validTo: null,
  },
  { code: 'OUL', nameFi: 'Oulun vaalipiiri', nameSv: 'Uleåborgs valkrets', validFrom: null, validTo: null },
  { code: 'LAP', nameFi: 'Lapin vaalipiiri', nameSv: 'Lapplands valkrets', validFrom: null, validTo: null },
  {
    code: 'KYM',
    nameFi: 'Kymen vaalipiiri',
    nameSv: 'Kymmene valkrets',
    validFrom: null,
    validTo: '2014-12-31',
    notes: 'Yhdistettiin Kaakkois-Suomen vaalipiiriin',
  },
  {
    code: 'ESA',
    nameFi: 'Etelä-Savon vaalipiiri',
    nameSv: 'Södra Savolax valkrets',
    validFrom: null,
    validTo: '2014-12-31',
    notes: 'Yhdistettiin Kaakkois-Suomen vaalipiiriin',
  },
  {
    code: 'PSA',
    nameFi: 'Pohjois-Savon vaalipiiri',
    nameSv: 'Norra Savolax valkrets',
    validFrom: null,
    validTo: '2014-12-31',
    notes: 'Yhdistettiin Savo-Karjalan vaalipiiriin',
  },
  {
    code: 'PKA',
    nameFi: 'Pohjois-Karjalan vaalipiiri',
    nameSv: 'Norra Karelens valkrets',
    validFrom: null,
    validTo: '2014-12-31',
    notes: 'Yhdistettiin Savo-Karjalan vaalipiiriin',
  },
];

export interface TermSeed {
  code: string;
  name: string;
  startDate: string;
  endDate: string | null;
}

// Electoral terms from the first plenary session after each election.
export const TERMS: TermSeed[] = [
  { code: '2023-2027', name: 'Vaalikausi 2023–2027', startDate: '2023-04-05', endDate: null },
  { code: '2019-2023', name: 'Vaalikausi 2019–2023', startDate: '2019-04-17', endDate: '2023-04-04' },
  { code: '2015-2019', name: 'Vaalikausi 2015–2019', startDate: '2015-04-22', endDate: '2019-04-16' },
  { code: '2011-2015', name: 'Vaalikausi 2011–2015', startDate: '2011-04-20', endDate: '2015-04-21' },
  { code: '2007-2011', name: 'Vaalikausi 2007–2011', startDate: '2007-03-21', endDate: '2011-04-19' },
  { code: '2003-2007', name: 'Vaalikausi 2003–2007', startDate: '2003-03-19', endDate: '2007-03-20' },
  { code: '1999-2003', name: 'Vaalikausi 1999–2003', startDate: '1999-03-24', endDate: '2003-03-18' },
];

export interface GovernmentSeed {
  code: string;
  name: string;
  nameSv: string;
  ordinal: number;
  primeMinister: string;
  startDate: string;
  endDate: string | null;
  parties: { abbreviation: string; joinedAt?: string; leftAt?: string }[];
}

export const GOVERNMENTS: GovernmentSeed[] = [
  {
    code: 'orpo',
    name: 'Orpon hallitus',
    nameSv: 'Regeringen Orpo',
    ordinal: 77,
    primeMinister: 'Petteri Orpo',
    startDate: '2023-06-20',
    endDate: null,
    parties: [
      { abbreviation: 'KOK' },
      { abbreviation: 'PS' },
      { abbreviation: 'RKP' },
      { abbreviation: 'KD' },
    ],
  },
  {
    code: 'marin',
    name: 'Marinin hallitus',
    nameSv: 'Regeringen Marin',
    ordinal: 76,
    primeMinister: 'Sanna Marin',
    startDate: '2019-12-10',
    endDate: '2023-06-20',
    parties: [
      { abbreviation: 'SDP' },
      { abbreviation: 'KESK' },
      { abbreviation: 'VIHR' },
      { abbreviation: 'VAS' },
      { abbreviation: 'RKP' },
    ],
  },
  {
    code: 'rinne',
    name: 'Rinteen hallitus',
    nameSv: 'Regeringen Rinne',
    ordinal: 75,
    primeMinister: 'Antti Rinne',
    startDate: '2019-06-06',
    endDate: '2019-12-10',
    parties: [
      { abbreviation: 'SDP' },
      { abbreviation: 'KESK' },
      { abbreviation: 'VIHR' },
      { abbreviation: 'VAS' },
      { abbreviation: 'RKP' },
    ],
  },
  {
    code: 'sipila',
    name: 'Sipilän hallitus',
    nameSv: 'Regeringen Sipilä',
    ordinal: 74,
    primeMinister: 'Juha Sipilä',
    startDate: '2015-05-29',
    endDate: '2019-06-06',
    parties: [
      { abbreviation: 'KESK' },
      { abbreviation: 'KOK' },
      { abbreviation: 'PS', leftAt: '2017-06-13' },
    ],
  },
  {
    code: 'stubb',
    name: 'Stubbin hallitus',
    nameSv: 'Regeringen Stubb',
    ordinal: 73,
    primeMinister: 'Alexander Stubb',
    startDate: '2014-06-24',
    endDate: '2015-05-29',
    parties: [
      { abbreviation: 'KOK' },
      { abbreviation: 'SDP' },
      { abbreviation: 'RKP' },
      { abbreviation: 'KD' },
      { abbreviation: 'VIHR', leftAt: '2014-09-18' },
    ],
  },
  {
    code: 'katainen',
    name: 'Kataisen hallitus',
    nameSv: 'Regeringen Katainen',
    ordinal: 72,
    primeMinister: 'Jyrki Katainen',
    startDate: '2011-06-22',
    endDate: '2014-06-24',
    parties: [
      { abbreviation: 'KOK' },
      { abbreviation: 'SDP' },
      { abbreviation: 'VAS', leftAt: '2014-03-25' },
      { abbreviation: 'VIHR' },
      { abbreviation: 'RKP' },
      { abbreviation: 'KD' },
    ],
  },
  {
    code: 'kiviniemi',
    name: 'Kiviniemen hallitus',
    nameSv: 'Regeringen Kiviniemi',
    ordinal: 71,
    primeMinister: 'Mari Kiviniemi',
    startDate: '2010-06-22',
    endDate: '2011-06-22',
    parties: [
      { abbreviation: 'KESK' },
      { abbreviation: 'KOK' },
      { abbreviation: 'VIHR' },
      { abbreviation: 'RKP' },
    ],
  },
  {
    code: 'vanhanen-2',
    name: 'Vanhasen II hallitus',
    nameSv: 'Regeringen Vanhanen II',
    ordinal: 70,
    primeMinister: 'Matti Vanhanen',
    startDate: '2007-04-19',
    endDate: '2010-06-22',
    parties: [
      { abbreviation: 'KESK' },
      { abbreviation: 'KOK' },
      { abbreviation: 'VIHR' },
      { abbreviation: 'RKP' },
    ],
  },
  {
    code: 'vanhanen-1',
    name: 'Vanhasen I hallitus',
    nameSv: 'Regeringen Vanhanen I',
    ordinal: 69,
    primeMinister: 'Matti Vanhanen',
    startDate: '2003-06-24',
    endDate: '2007-04-19',
    parties: [{ abbreviation: 'KESK' }, { abbreviation: 'SDP' }, { abbreviation: 'RKP' }],
  },
  {
    code: 'jaatteenmaki',
    name: 'Jäätteenmäen hallitus',
    nameSv: 'Regeringen Jäätteenmäki',
    ordinal: 68,
    primeMinister: 'Anneli Jäätteenmäki',
    startDate: '2003-04-17',
    endDate: '2003-06-24',
    parties: [{ abbreviation: 'KESK' }, { abbreviation: 'SDP' }, { abbreviation: 'RKP' }],
  },
];

export interface BodySeed {
  code: string;
  abbreviation: string;
  nameFi: string;
  nameSv: string;
  type: 'committee' | 'body';
  validFrom?: string;
}

export const BODIES: BodySeed[] = [
  {
    code: 'SuV',
    abbreviation: 'SuV',
    nameFi: 'Suuri valiokunta',
    nameSv: 'Stora utskottet',
    type: 'committee',
  },
  {
    code: 'PeV',
    abbreviation: 'PeV',
    nameFi: 'Perustuslakivaliokunta',
    nameSv: 'Grundlagsutskottet',
    type: 'committee',
  },
  {
    code: 'UaV',
    abbreviation: 'UaV',
    nameFi: 'Ulkoasiainvaliokunta',
    nameSv: 'Utrikesutskottet',
    type: 'committee',
  },
  {
    code: 'VaV',
    abbreviation: 'VaV',
    nameFi: 'Valtiovarainvaliokunta',
    nameSv: 'Finansutskottet',
    type: 'committee',
  },
  {
    code: 'TrV',
    abbreviation: 'TrV',
    nameFi: 'Tarkastusvaliokunta',
    nameSv: 'Revisionsutskottet',
    type: 'committee',
    validFrom: '2007-01-01',
  },
  {
    code: 'HaV',
    abbreviation: 'HaV',
    nameFi: 'Hallintovaliokunta',
    nameSv: 'Förvaltningsutskottet',
    type: 'committee',
  },
  { code: 'LaV', abbreviation: 'LaV', nameFi: 'Lakivaliokunta', nameSv: 'Lagutskottet', type: 'committee' },
  {
    code: 'LiV',
    abbreviation: 'LiV',
    nameFi: 'Liikenne- ja viestintävaliokunta',
    nameSv: 'Kommunikationsutskottet',
    type: 'committee',
  },
  {
    code: 'MmV',
    abbreviation: 'MmV',
    nameFi: 'Maa- ja metsätalousvaliokunta',
    nameSv: 'Jord- och skogsbruksutskottet',
    type: 'committee',
  },
  {
    code: 'PuV',
    abbreviation: 'PuV',
    nameFi: 'Puolustusvaliokunta',
    nameSv: 'Försvarsutskottet',
    type: 'committee',
  },
  {
    code: 'SiV',
    abbreviation: 'SiV',
    nameFi: 'Sivistysvaliokunta',
    nameSv: 'Kulturutskottet',
    type: 'committee',
  },
  {
    code: 'StV',
    abbreviation: 'StV',
    nameFi: 'Sosiaali- ja terveysvaliokunta',
    nameSv: 'Social- och hälsovårdsutskottet',
    type: 'committee',
  },
  {
    code: 'TaV',
    abbreviation: 'TaV',
    nameFi: 'Talousvaliokunta',
    nameSv: 'Ekonomiutskottet',
    type: 'committee',
  },
  {
    code: 'TiV',
    abbreviation: 'TiV',
    nameFi: 'Tiedusteluvalvontavaliokunta',
    nameSv: 'Underrättelsetillsynsutskottet',
    type: 'committee',
    validFrom: '2019-01-01',
  },
  {
    code: 'TyV',
    abbreviation: 'TyV',
    nameFi: 'Työelämä- ja tasa-arvovaliokunta',
    nameSv: 'Arbetslivs- och jämställdhetsutskottet',
    type: 'committee',
  },
  {
    code: 'TuV',
    abbreviation: 'TuV',
    nameFi: 'Tulevaisuusvaliokunta',
    nameSv: 'Framtidsutskottet',
    type: 'committee',
  },
  {
    code: 'YmV',
    abbreviation: 'YmV',
    nameFi: 'Ympäristövaliokunta',
    nameSv: 'Miljöutskottet',
    type: 'committee',
  },
  {
    code: 'PMN',
    abbreviation: 'PMN',
    nameFi: 'Puhemiesneuvosto',
    nameSv: 'Talmanskonferensen',
    type: 'body',
  },
  {
    code: 'KANS',
    abbreviation: 'KANS',
    nameFi: 'Kansliatoimikunta',
    nameSv: 'Kanslikommissionen',
    type: 'body',
  },
];

export interface PositionTypeSeed {
  code: string;
  nameFi: string;
  nameSv: string;
  level: 'municipal' | 'regional' | 'state' | 'eu' | 'party' | 'other';
  sortOrder: number;
}

export const POSITION_TYPES: PositionTypeSeed[] = [
  { code: 'mp', nameFi: 'Kansanedustaja', nameSv: 'Riksdagsledamot', level: 'state', sortOrder: 10 },
  { code: 'minister', nameFi: 'Ministeri', nameSv: 'Minister', level: 'state', sortOrder: 20 },
  { code: 'president', nameFi: 'Presidentti', nameSv: 'President', level: 'state', sortOrder: 30 },
  {
    code: 'mep',
    nameFi: 'Europarlamentaarikko (MEP)',
    nameSv: 'Europaparlamentariker',
    level: 'eu',
    sortOrder: 40,
  },
  {
    code: 'regional-councillor',
    nameFi: 'Aluevaltuutettu',
    nameSv: 'Välfärdsområdesfullmäktigeledamot',
    level: 'regional',
    sortOrder: 50,
  },
  {
    code: 'municipal-councillor',
    nameFi: 'Kunnanvaltuutettu',
    nameSv: 'Kommunfullmäktigeledamot',
    level: 'municipal',
    sortOrder: 60,
  },
];
