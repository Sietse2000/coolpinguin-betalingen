export default function RulesPage() {
  return (
    <div className="max-w-4xl">
      <h1 className="page-title">Beslisregels</h1>
      <p className="page-sub">
        Exacte regels die bepalen of een betaling automatisch verwerkt wordt of naar handmatige controle gaat.
        Deze regels zijn deterministisch — geen AI, geen zwarte doos.
      </p>

      {/* Beslismatrix */}
      <div className="card overflow-hidden mb-6">
        <div className="px-4 py-3 border-b border-gray-200" style={{ backgroundColor: '#083046' }}>
          <h2 className="text-sm font-medium text-white">Beslismatrix</h2>
        </div>
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="bg-gray-50 border-b border-gray-200">
                {['#', 'Scenario', 'Payment boeken', 'Label "Betaald"', 'Auto?', 'Review?', 'Toelichting'].map((h) => (
                  <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wide whitespace-nowrap">
                    {h}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody className="divide-y divide-gray-100">
              {MATRIX.map((row, i) => (
                <tr key={i} className="hover:bg-gray-50">
                  <td className="px-4 py-3 text-xs text-gray-400 font-medium">{i + 1}</td>
                  <td className="px-4 py-3 font-medium text-cp-dark">{row.scenario}</td>
                  <td className="px-4 py-3">
                    <Cell value={row.payment} />
                  </td>
                  <td className="px-4 py-3">
                    <Cell value={row.label} />
                  </td>
                  <td className="px-4 py-3">
                    <Cell value={row.auto} />
                  </td>
                  <td className="px-4 py-3">
                    <Cell value={row.review} />
                  </td>
                  <td className="px-4 py-3 text-xs text-gray-500 max-w-64">{row.note}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Matching prioriteiten */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-medium text-cp-dark mb-4">Matching prioriteiten</h2>
        <ol className="space-y-3">
          {[
            {
              nr: 1,
              title: 'Exact factuurnummer',
              desc: 'Het factuurnummer (bijv. I02235) staat letterlijk in de omschrijving of betaalreferentie.',
              note: 'Hoogste prioriteit. Kan leiden tot auto-verwerking als bedrag ook klopt.',
            },
            {
              nr: 2,
              title: 'Laatste 4 cijfers',
              desc: 'De laatste 4 cijfers van het factuurnummer worden herkend (bijv. "2235" voor I02235).',
              note: 'Automatisch als er precies één factuur matcht én het bedrag klopt. Bij meerdere kandidaten: altijd review.',
            },
            {
              nr: 3,
              title: 'Bedrag + klantnaam',
              desc: 'Het bedrag klopt exact én de tegenpartijnaam lijkt op de klantnaam in RentMagic.',
              note: 'Altijd naar review — namen kunnen overeenkomen bij meerdere facturen.',
            },
            {
              nr: 4,
              title: 'Alleen bedrag',
              desc: 'Alleen het bedrag klopt, geen andere identificatie.',
              note: 'Zwakste match. Altijd naar review. Meerdere facturen kunnen hetzelfde bedrag hebben.',
            },
          ].map((p) => (
            <li key={p.nr} className="flex gap-4">
              <span className="flex-shrink-0 w-7 h-7 rounded-full flex items-center justify-center text-sm font-medium text-white" style={{ backgroundColor: '#2c80b3' }}>
                {p.nr}
              </span>
              <div>
                <div className="font-medium text-cp-dark text-sm">{p.title}</div>
                <div className="text-xs text-gray-500 mt-0.5">{p.desc}</div>
                <div className="text-xs text-amber-600 mt-0.5 italic">{p.note}</div>
              </div>
            </li>
          ))}
        </ol>
      </div>

      {/* Label-regel */}
      <div className="card p-5 mb-6">
        <h2 className="text-sm font-medium text-cp-dark mb-3">Label "Betaald" — strikte regel</h2>
        <div className="p-4 rounded-lg bg-cp-blue-light border border-cp-blue/30">
          <p className="text-sm text-cp-dark font-medium mb-2">
            Het label wordt ALLEEN op "Betaald" gezet als het resterende open saldo precies €0,00 is.
          </p>
          <div className="space-y-1.5 text-sm text-gray-600">
            <div className="flex items-center gap-2">
              <span className="text-green-600">✓</span>
              <span>Betaling = open bedrag → label "Betaald"</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-amber-500">~</span>
              <span>Betaling &lt; open bedrag → payment geboekt, label overgeslagen (deelbetaling)</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-500">✗</span>
              <span>Betaling &gt; open bedrag → nooit automatisch verwerkt, altijd review</span>
            </div>
            <div className="flex items-center gap-2">
              <span className="text-red-500">✗</span>
              <span>€0,01 of meer restant → geen label, ook niet na handmatige goedkeuring</span>
            </div>
          </div>
        </div>
      </div>

      {/* Nooit automatisch */}
      <div className="card p-5">
        <h2 className="text-sm font-medium text-cp-dark mb-3">Wordt nooit automatisch verwerkt</h2>
        <ul className="space-y-1.5 text-sm text-gray-600">
          {[
            'Meerdere facturen komen in aanmerking op hetzelfde patroon (ambigue)',
            'Betaald bedrag is hoger dan het open bedrag (overbetaling)',
            'Alleen bedrag + naam, zonder factuurnummer',
            'Alleen bedrag, zonder enige andere identificatie',
            'Laatste 4 cijfers die meerdere facturen matchen',
            'Meerdere verkorte factuurreferenties in één betaling',
            'Uitgaande transacties (DBIT)',
            'Transacties die al eerder gezien zijn (duplicaat)',
            'Geen enkele match gevonden',
          ].map((item) => (
            <li key={item} className="flex items-start gap-2">
              <span className="text-red-500 mt-0.5 flex-shrink-0">✗</span>
              <span>{item}</span>
            </li>
          ))}
        </ul>
      </div>
    </div>
  )
}

function Cell({ value }: { value: 'ja' | 'nee' | 'soms' }) {
  if (value === 'ja') return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-green-100 text-green-700">JA</span>
  )
  if (value === 'nee') return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-gray-100 text-gray-500">NEE</span>
  )
  return (
    <span className="inline-flex items-center px-2 py-0.5 rounded text-xs font-medium bg-amber-100 text-amber-700">SOMS</span>
  )
}

const MATRIX: {
  scenario: string
  payment: 'ja' | 'nee' | 'soms'
  label: 'ja' | 'nee' | 'soms'
  auto: 'ja' | 'nee' | 'soms'
  review: 'ja' | 'nee' | 'soms'
  note: string
}[] = [
  {
    scenario: 'Volledig factuurnr (I02235) + exact bedrag',
    payment: 'ja', label: 'ja', auto: 'ja', review: 'nee',
    note: 'Veiligste scenario. Factuurnummer én bedrag kloppen exact. Volledig automatisch.',
  },
  {
    scenario: 'Volledig factuurnr + lager bedrag (deelbetaling)',
    payment: 'ja', label: 'nee', auto: 'ja', review: 'nee',
    note: 'Payment geboekt voor ontvangen bedrag. Label overgeslagen — restant nog open.',
  },
  {
    scenario: 'Volledig factuurnr + hoger bedrag (overbetaling)',
    payment: 'nee', label: 'nee', auto: 'nee', review: 'ja',
    note: 'Nooit automatisch verwerkt. Kan foutieve transactie of terugbetaling zijn.',
  },
  {
    scenario: 'Laatste 4 cijfers (2235) + unieke match + exact bedrag',
    payment: 'ja', label: 'ja', auto: 'ja', review: 'nee',
    note: 'Automatisch alleen als exact één factuur op deze laatste 4 cijfers matcht.',
  },
  {
    scenario: 'Laatste 4 cijfers + unieke match + lager bedrag',
    payment: 'ja', label: 'nee', auto: 'ja', review: 'nee',
    note: 'Deelbetaling via last4. Payment geboekt, label overgeslagen.',
  },
  {
    scenario: 'Laatste 4 cijfers + meerdere facturen matchen',
    payment: 'nee', label: 'nee', auto: 'nee', review: 'ja',
    note: 'Onduidelijk welke factuur bedoeld is. Handmatige keuze verplicht.',
  },
  {
    scenario: 'Meerdere volledige factuurnrs + som exact (bijv. I02235 + I02236)',
    payment: 'ja', label: 'soms', auto: 'ja', review: 'nee',
    note: 'Per factuur apart geboekt. Label per factuur alleen als saldo daarna €0,00 is.',
  },
  {
    scenario: 'Meerdere verkorte nummers (bijv. 2235 en 2236)',
    payment: 'nee', label: 'nee', auto: 'nee', review: 'ja',
    note: 'Niet automatisch in fase 1. Factuurkoppelingen handmatig bevestigen.',
  },
  {
    scenario: 'Geen factuurnummer, alleen bedrag + klantnaam',
    payment: 'nee', label: 'nee', auto: 'nee', review: 'ja',
    note: 'Suggestie op basis van naam en bedrag. Altijd handmatige controle.',
  },
  {
    scenario: 'Geen factuurnummer, alleen bedrag',
    payment: 'nee', label: 'nee', auto: 'nee', review: 'ja',
    note: 'Zwakste signaal. Meerdere facturen kunnen hetzelfde bedrag hebben.',
  },
  {
    scenario: 'Geen match gevonden',
    payment: 'nee', label: 'nee', auto: 'nee', review: 'ja',
    note: 'Handmatig koppelen via review-scherm.',
  },
  {
    scenario: 'Uitgaande betaling (DBIT)',
    payment: 'nee', label: 'nee', auto: 'nee', review: 'nee',
    note: 'Volledig overgeslagen. App verwerkt alleen inkomende betalingen.',
  },
]
