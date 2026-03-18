# Coolpinguin – Betalingen afboeken

MVP voor het automatisch matchen van bankbetalingen aan openstaande facturen in RentMagic.

## Snel starten

### Vereisten
- Node.js 18+
- PostgreSQL (lokaal of via Docker)
- RentMagic API credentials

### 1. Installeer dependencies

```bash
npm install
```

### 2. Omgevingsvariabelen instellen

```bash
cp .env.example .env
```

Vul in `.env`:
```
DATABASE_URL="postgresql://postgres:password@localhost:5432/coolpenguin_afboeken"
RENTMAGIC_BASE_URL="https://jouw-rentmagic-url.nl"
RENTMAGIC_API_KEY="jouw-api-key"
```

### 3. Database aanmaken

```bash
# Maak de database aan in PostgreSQL, dan:
npm run db:push

# Of met migraties (aanbevolen voor productie):
npm run db:migrate
```

### 4. Applicatie starten

```bash
npm run dev
```

Open http://localhost:3000

---

## Workflow

1. **Facturen synchroniseren**: Ga naar _Facturen_ → klik "Sync vanuit RentMagic"
2. **Bankbestand uploaden**: Ga naar _Upload_ → sleep een CAMT.053 of MT940 bestand
3. **Review**: Transacties met lage confidence verschijnen in _Review_
4. **Verwerkt**: Alle verwerkte betalingen en eventuele fouten in _Verwerkt_

---

## Architectuur

```
app/
├── (dashboard)/          # UI pagina's
│   ├── page.tsx          # Dashboard overzicht
│   ├── upload/           # Bestand uploaden
│   ├── transactions/     # Alle transacties
│   ├── review/           # Handmatige review
│   ├── processed/        # Verwerkt + fouten
│   └── invoices/         # Factuurcache
│
├── api/
│   ├── uploads/          # POST: bestand parsen + matchen
│   ├── transactions/     # GET lijst, GET detail
│   │   └── [id]/
│   │       ├── process/  # POST: verwerken naar RentMagic
│   │       ├── reject/   # POST: afwijzen
│   │       └── link/     # POST: handmatig koppelen
│   ├── invoices/
│   │   └── sync/         # POST: sync vanuit RentMagic
│   ├── payments/
│   │   └── [id]/retry/   # POST: opnieuw proberen
│   └── audit/            # GET: audit log

lib/
├── parsers/
│   ├── camt053.ts        # CAMT.053 XML parser
│   └── mt940.ts          # MT940 parser
├── matching/
│   └── engine.ts         # Matching + confidence scoring
├── processing/
│   └── processor.ts      # Centrale verwerkingsfunctie
├── rentmagic/
│   ├── client.ts         # API client (payments + invoices)
│   └── label.ts          # Label-only patch (voor retry)
└── utils/
    ├── hash.ts            # Transactie-deduplicatie
    └── audit.ts           # Audit logging

prisma/
└── schema.prisma         # Datamodel
```

---

## Matching-strategie

| Strategie | Confidence | Auto-process |
|---|---|---|
| Exact factuurnummer in omschrijving + exact bedrag | 0.97 | Ja |
| Exact factuurnummer in omschrijving, bedrag wijkt af | 0.82 | Nee (review) |
| Exact bedrag + klantnaam >90% overeenkomst | 0.87 | Nee (review) |
| Exact bedrag + klantnaam >70% overeenkomst | 0.76 | Nee |
| Exact bedrag + datum binnen venster | 0.60–0.72 | Nee |
| Bijna-exact bedrag + fuzzy naam | 0.40–0.60 | Nee |

**Auto-process drempel**: ≥ 0.90 confidence EN slechts 1 match boven de drempel EN bedrag is exact gelijk aan open bedrag.

Deelbetalingen gaan altijd naar review in fase 1.

---

## Foutafhandeling

- **Payment OK, label PATCH faalt** → status `PARTIAL_SUCCESS`, retry beschikbaar
- **Payment faalt** → status `PENDING`, logboek bijgewerkt
- **Dubbele upload** → hash-deduplicatie, duplicaten overgeslagen
- **Meerdere matches** → altijd naar review, nooit auto-process

---

## Fase 2 (niet in MVP)

- Directe bankkoppeling (Open Banking API)
- Deelbetalingen automatisch matchen
- E-mailnotificaties bij fouten
- Gebruikersauthenticatie
- Cronjob voor periodieke factuurSync
- Bulk-goedkeuring in review-scherm
- Export naar CSV/Excel

---

## Docker (optioneel)

```yaml
# docker-compose.yml
version: '3.8'
services:
  db:
    image: postgres:16
    environment:
      POSTGRES_DB: coolpenguin_afboeken
      POSTGRES_PASSWORD: password
    ports:
      - "5432:5432"
    volumes:
      - pgdata:/var/lib/postgresql/data

volumes:
  pgdata:
```

Start met: `docker compose up -d`
