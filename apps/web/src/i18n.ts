/**
 * UI strings. Finnish now; Swedish and English are added as new dictionaries
 * without code changes (t() falls back to Finnish).
 */
const fi = {
  'app.name': 'Poliitikkoseuranta',
  'nav.dashboard': 'Kojelauta',
  'nav.search': 'Haku',
  'nav.jobs': 'Taustatyöt',
  'nav.admin': 'Ylläpito',
  'nav.services': 'Palvelut',
  'nav.ai': 'Tekoäly',
  'nav.sync': 'Synkronoinnit',
  'nav.backups': 'Varmuuskopiot',
  'nav.trash': 'Roskakori',
  'nav.audit': 'Muutoshistoria',
  'nav.settings': 'Asetukset',
  'nav.users': 'Käyttäjät',
  'auth.title': 'Kirjaudu sisään',
  'auth.email': 'Sähköpostiosoite',
  'auth.sendLink': 'Lähetä kirjautumislinkki',
  'auth.devLogin': 'Kirjaudu (kehitystila)',
  'auth.linkSent': 'Kirjautumislinkki lähetetty. Tarkista sähköpostisi.',
  'auth.notAllowed': 'Tällä sähköpostiosoitteella ei ole pääsyä palveluun.',
  'auth.signOut': 'Kirjaudu ulos',
  'theme.toggle': 'Vaihda teema',
  'search.placeholder': 'Hae henkilöitä, puolueita, asioita…',
  'common.save': 'Tallenna',
  'common.saved': 'Tallennettu',
  'common.undo': 'Kumoa',
  'common.cancel': 'Peruuta',
  'common.loading': 'Ladataan…',
  'common.add': 'Lisää',
  'common.delete': 'Poista',
  'common.deleted': 'Poistettu',
  'common.restore': 'Palauta',
  'common.test': 'Testaa yhteys',
  'common.none': 'Ei tietoja',
} as const;

export type MessageKey = keyof typeof fi;
const dictionaries: Record<string, Partial<Record<MessageKey, string>>> = { fi };
let locale = 'fi';

export function setLocale(l: string): void {
  locale = l in dictionaries ? l : 'fi';
}

export function t(key: MessageKey, vars?: Record<string, string | number>): string {
  let s = dictionaries[locale]?.[key] ?? fi[key];
  for (const [k, v] of Object.entries(vars ?? {})) s = s.replace(`{${k}}`, String(v));
  return s;
}
