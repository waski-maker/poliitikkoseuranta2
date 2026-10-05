export default {
  id: 'reduce-step',
  version: 1,
  description: 'Map–reduce: osatulosten yhdistäminen lopulliseksi vastaukseksi',
  template: `Tehtävä: {{task}}

Aineisto käsiteltiin {{parts}} osassa. Alla ovat osien havainnot. Yhdistä ne yhdeksi johdonmukaiseksi
vastaukseksi. Säilytä lähdeviitteet [#tunniste] täsmälleen sellaisinaan. Älä lisää viitteitä, joita
havainnoissa ei ole.

{{partials}}`,
};
