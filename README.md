# OptiSMB — Acquirer Statement Analysis Portal

> **AI-powered payment acquiring analysis for US small businesses.**  
> Upload your acquiring statement. We read the fine print, catch overcharges, and benchmark the rate you should be paying — in sixty seconds.

[![Next.js](https://img.shields.io/badge/Next.js-16.2-black?logo=next.js)](https://nextjs.org)
[![React](https://img.shields.io/badge/React-19.2-61DAFB?logo=react)](https://react.dev)
[![Tailwind CSS](https://img.shields.io/badge/Tailwind-3.4-38BDF8?logo=tailwindcss)](https://tailwindcss.com)
[![Claude](https://img.shields.io/badge/AI-Claude%20via%20OpenRouter-orange)](https://openrouter.ai)
[![License](https://img.shields.io/badge/license-MIT-green)](LICENSE)

---

## Table of Contents

- [Overview](#overview)
- [Live Demo](#live-demo)
- [Key Features](#key-features)
- [Tech Stack](#tech-stack)
- [Architecture](#architecture)
- [Project Structure](#project-structure)
- [Getting Started](#getting-started)
- [Environment Variables](#environment-variables)
- [Application Pages & Routes](#application-pages--routes)
- [Tier Model (Free / Level 1 / Level 2)](#tier-model)
- [AI Integration](#ai-integration)
- [Dual Confidence Model](#dual-confidence-model)
- [Data Source Tiers](#data-source-tiers)
- [Acquirer Database](#acquirer-database)
- [API Routes](#api-routes)
- [Core Components](#core-components)
- [State Management](#state-management)
- [Security & Privacy](#security--privacy)
- [Regulatory & Compliance](#regulatory--compliance)
- [Functional Specification](#functional-specification)
- [Roadmap](#roadmap)
- [Contributing](#contributing)

---

## Overview

OptiSMB is a fully automated, AI-powered web platform that enables Small and Medium-sized Businesses to:

1. **Upload** their payment acquiring statements (PDF, CSV, XLSX)
2. **Parse** every fee line automatically using Claude AI with per-field confidence scoring
3. **Cross-reference** against their merchant agreement to detect overcharges and missing rebates
4. **Benchmark** their effective rate against a database of 10 US acquirers
5. **Model** what-if scenarios (volume, card mix, growth) to project future savings
6. **Ask questions** about their statement in plain English via a grounded AI Q&A assistant

**Target saving: 10–30% of annual payment acquiring costs.**

The platform operates as a comparison and information tool — it never gives regulated financial advice and never executes acquirer switches on behalf of the SMB.

---

## Live Demo

The app runs locally on **http://localhost:3001**

**Demo credentials (any email/password works in simulation mode):**
- Email: `owner@horizonretail.com`
- Password: `any password`

**Tier simulation:** Go to Settings → Subscription → click Free / L1 / L2 to instantly switch tiers and explore all features.

---

## Key Features

### Core Analysis
- **Automated statement parsing** — AI extracts every fee line in under 60 seconds (P95). CSV files use real LLM extraction; binary formats fall back to demo data with clear notice.
- **Per-field confidence scoring** — Every extracted field carries a High / Medium / Low confidence badge. Fields below Low confidence are flagged, never silently dropped.
- **Fee breakdown table** — All fee lines with type, rate, amount, card type, channel, and confidence. Filterable by channel (POS / Online) or flagged status.
- **Channel split analysis** — Dedicated tab showing POS (card present) vs CNP (card not present) volume, fees, effective rates, transaction counts, average transaction values, and full card mix breakdown.
- **Fee composition donut chart** — Visual breakdown of interchange, scheme fees, service/acquirer margin, and other fees.
- **Effective rate trend** — 6-month line chart comparing your rate against panel median and best-in-class.

### Discrepancy Detection (Level 1+)
- **Merchant agreement cross-reference** — Upload your signed merchant agreement; OptiSMB reconciles every fee line against your contracted rates.
- **Overcharge detection** — Flags interchange pass-through errors, inflated service margins, and unauthorised fee additions.
- **Missing rebate detection** — Checks whether volume-tier thresholds have been met and rebates correctly applied.
- **Impact quantification** — Quarterly and annualised cost of each discrepancy.
- **Merchant agreement version control** — Full version history with effective dates, acquirer tagging, and active/superseded status.

### Benchmarking
- **Top 3 recommendations** — Ranked by projected annual saving for your MCC, volume band, and card mix.
- **Data source tier badges** — T1 (regulatory), T2 (SMB-reported, corroborated), T3 (floor rate estimate) displayed on every recommendation.
- **Recommendation confidence** — High / Medium / Low per acquirer, with data-as-of date always shown.
- **Referral disclosure** — Every recommendation page discloses whether OptiSMB may receive a referral fee (does not affect ranking).
- **Staleness monitoring** — Amber alert at 90 days, red alert at 180 days for benchmark data age.
- **Acquirer database table** — 10 US acquirers with tier, MCC coverage, days since update, and staleness status.

### What-If Scenario Modelling (Level 2)
- **5 sliders** — Monthly volume ($k), average order value ($), debit %, credit %, YoY growth %.
- **Real-time recalculation** — Effective rate and projected fees update instantly as sliders move.
- **Savings projection** — Estimated annual saving for Stripe, Adyen, and Square at your modelled parameters.
- **Scenario save/load/delete** — Named scenarios persisted to localStorage.

### Q&A Assistant (Level 1+)
- **Grounded entirely in statement data** — Claude is instructed to answer only from the structured parsed statement JSON. Hallucination pathway explicitly closed.
- **Source citation** — Every answer cites the source data field(s) it was derived from (e.g., `parsedData.scheme_fees`).
- **Out-of-scope decline** — Questions that cannot be answered from the uploaded data are explicitly declined with an explanation.
- **Suggestion chips** — Pre-built question prompts for common queries.
- **Q&A export** — Download the full conversation as CSV.
- **Powered by Claude via OpenRouter** — Model: `anthropic/claude-3-haiku` (configurable).

### Notifications & Alerts
- **In-app notification centre** — Parse complete, report ready, discrepancy detected, staleness alerts, agreement uploaded.
- **Email simulation** — All email notifications are simulated in demo mode with visual indicator. Production-ready to connect Resend or SendGrid.
- **Staleness banner** — Prominent alert on dashboard, report, and benchmark pages when data is ≥90 days old.
- **Human review queue banner** — Shows on dashboard when a low-confidence statement has been routed for human review.

### Dashboard
- **4 KPI cards** — Effective rate (with sparkline), estimated overpayment (with sparkline), statements analysed, best saving available (dark card with teal CTA).
- **Onboarding banner** — Shown to first-time users with guided upload CTA and step-by-step explainer.
- **Dual confidence explainer** — Card explaining the difference between parsing confidence and rate data confidence.
- **Recent analyses table** — Last 5 statements with click-through to report.
- **Quick action cards** — Upload, Merchant Agreement, What-If Modelling.

### Account & Settings
- **Profile** — Business name, email, industry, country.
- **Tier simulator** — Switch between Free / L1 / L2 instantly for demos.
- **Subscription panel** — Current plan, next billing date, feature comparison grid.
- **Multi-currency** (Level 2) — Select base currency (USD, EUR, GBP, CAD, AUD, MXN).
- **Email notifications** — Toggle parse complete, report ready, and staleness alerts.
- **Data export** — Download all account data as JSON (GDPR/CCPA right of access).
- **T3 data contribution** — Explicit opt-in to contribute anonymised rate data to benchmarking panel.
- **Security** — Password change, MFA (Level 2), sign out all sessions.
- **Account deletion** — Type-to-confirm deletion; 30-day processing window; audit logs retained 7 years.

---

## Tech Stack

| Layer | Technology |
|---|---|
| **Framework** | Next.js 16.2.4 (App Router) |
| **UI Library** | React 19.2.5 |
| **Styling** | Tailwind CSS 3.4.17 with custom design tokens |
| **Fonts** | Bowlby One SC, Instrument Serif, Inter, JetBrains Mono (Google Fonts) |
| **AI / LLM** | Anthropic Claude 3 Haiku via OpenRouter API |
| **State** | React Context + localStorage persistence |
| **Charts** | Custom SVG (DonutChart, HBar, Sparkline, LineChart) |
| **Icons** | Custom SVG icon library |
| **API** | Next.js API Routes (Edge-compatible) |
| **Language** | JavaScript (JSX) — no TypeScript |
| **Build** | Turbopack (Next.js default) |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      Browser (Client)                        │
│  React 19 + Next.js App Router + Tailwind CSS               │
│                                                              │
│  AppContext (localStorage) ──── Toast System                 │
│       │                                                      │
│  Pages: dashboard, upload, report, benchmark, whatif,        │
│         agreement, analyses, notifications, settings,        │
│         upgrade, help, login, register                       │
└──────────────────────────┬──────────────────────────────────┘
                           │ fetch
                           ▼
┌─────────────────────────────────────────────────────────────┐
│              Next.js API Routes (Server-side)               │
│                                                             │
│  /api/parse  ──────────────── /api/chat                     │
│  (statement parsing)          (Q&A assistant)               │
│       │                             │                        │
│       └─────────────┬───────────────┘                        │
│                     ▼                                        │
│              OpenRouter API                                  │
│         (anthropic/claude-3-haiku)                          │
│         API key secured server-side                         │
└─────────────────────────────────────────────────────────────┘
```

**Key architectural decisions:**
- **No real backend** — All state is managed in React Context with localStorage persistence. Production would add PostgreSQL + S3.
- **API key security** — OpenRouter key is stored in `.env.local` and only accessed from Next.js API routes (server-side). Never exposed to the client.
- **Simulated services** — Auth (Auth0 pattern), email (Resend/SendGrid pattern), and OCR (AWS Textract pattern) are simulated with toast notifications. Drop-in ready for real integration.
- **Binary file fallback** — PDFs and XLSX files cannot be text-extracted in this release without a server-side OCR library. They fall back to demo data with a clear user notice. CSV files are fully parsed by the LLM.

---

## Project Structure

```
SMB-App/
│
├── app/                          # Next.js App Router
│   ├── layout.jsx                # Root layout (AppProvider + ToastProvider)
│   ├── globals.css               # Global styles, Tailwind directives, utilities
│   ├── page.jsx                  # Marketing landing page
│   │
│   ├── login/
│   │   └── page.jsx              # Login page (email/password + SSO simulation)
│   ├── register/
│   │   └── page.jsx              # 3-step registration (credentials → verify → business)
│   │
│   ├── (app)/                    # Authenticated app shell (auth-guarded layout)
│   │   ├── layout.jsx            # Sidebar nav + topbar + mobile hamburger
│   │   ├── dashboard/page.jsx    # Main dashboard with KPIs and recent analyses
│   │   ├── upload/page.jsx       # Statement upload (drag-drop, parsing animation)
│   │   ├── agreement/page.jsx    # Merchant agreement management (version control)
│   │   ├── report/page.jsx       # Full analysis report (6 tabs)
│   │   ├── analyses/page.jsx     # All statements with tier-gated history
│   │   ├── benchmark/page.jsx    # Standalone benchmarking + acquirer database
│   │   ├── whatif/page.jsx       # What-if scenario modelling (Level 2)
│   │   ├── notifications/page.jsx# Notification centre with email simulation
│   │   ├── settings/page.jsx     # Account, subscription, privacy, security
│   │   ├── upgrade/page.jsx      # Plan comparison + ROI calculator
│   │   └── help/page.jsx         # FAQ accordion + contact form
│   │
│   └── api/
│       ├── parse/route.js        # POST — statement parsing via Claude
│       └── chat/route.js         # POST — grounded Q&A via Claude
│
├── components/
│   ├── AppContext.jsx             # Global state (user, statements, agreements, notifications)
│   ├── UI.jsx                    # Shared UI components
│   ├── Icons.jsx                 # SVG icon library
│   ├── Charts.jsx                # SVG chart components
│   └── Toast.jsx                 # Toast notification system
│
├── lib/
│   ├── mockData.js               # Demo statements, acquirer database, notifications
│   └── utils.js                  # tierOk(), downloadCSV(), triggerPrint(), etc.
│
├── .env.local                    # Secret keys (never committed)
├── .gitignore                    # Excludes node_modules, .next, .env.local
├── jsconfig.json                 # Path alias: @/ → project root
├── tailwind.config.js            # Custom design tokens
├── next.config.js                # Next.js configuration
├── postcss.config.js
└── package.json
```

---

## Getting Started

### Prerequisites

- **Node.js** 18.17+ (Node 20 recommended)
- **npm** 9+
- An **OpenRouter API key** — sign up free at [openrouter.ai](https://openrouter.ai)

### Installation

```bash
# 1. Clone the repository
git clone https://github.com/opti-smb/OptiSMB-app.git
cd OptiSMB-app

# 2. Install dependencies
npm install

# 3. Create environment file
cp .env.example .env.local
# Then add your OpenRouter API key (see Environment Variables below)

# 4. Start the development server
npm run dev
```

The app will be available at **http://localhost:3001**

### Build for Production

```bash
npm run build
npm start          # serves on port 3001
```

---

## Environment Variables

Create a `.env.local` file in the project root:

```env
# Required — OpenRouter API key for AI parsing and Q&A
OPENROUTER_API_KEY=sk-or-v1-your-key-here
```

> **Security:** This key is only accessed from Next.js server-side API routes (`/api/parse`, `/api/chat`). It is never sent to the browser.

### Optional future integrations (not required for demo)

```env
# Auth0 — Real authentication
AUTH0_SECRET=your-auth0-secret
AUTH0_BASE_URL=http://localhost:3001
AUTH0_ISSUER_BASE_URL=https://your-tenant.us.auth0.com
AUTH0_CLIENT_ID=your-client-id
AUTH0_CLIENT_SECRET=your-client-secret

# Email — Resend (recommended) or SendGrid
RESEND_API_KEY=re_your-resend-key
EMAIL_FROM=noreply@yourdomain.com

# AWS Textract — OCR for scanned PDFs and images
AWS_ACCESS_KEY_ID=your-key
AWS_SECRET_ACCESS_KEY=your-secret
AWS_REGION=us-east-1
```

---

## Application Pages & Routes

### Public Routes

| Route | Description |
|---|---|
| `/` | Marketing landing page — hero, pricing table, comparison table, CTA |
| `/login` | Email + password login. SSO buttons (simulated). |
| `/register` | 3-step registration: credentials → email verification → business profile |

### Authenticated Routes (`/app` shell — sidebar + topbar)

| Route | Tier | Description |
|---|---|---|
| `/dashboard` | All | KPIs, recent analyses, onboarding banner, staleness alerts, quick actions |
| `/upload` | All | Drag-and-drop upload, 6-stage parsing animation, duplicate detection, agreement prompt |
| `/agreement` | L1+ | Merchant agreement upload, version history, active terms display |
| `/report` | All | 6-tab analysis report (see Report Tabs below) |
| `/analyses` | All | All uploaded statements, tier-gated history, filter, export CSV |
| `/benchmark` | All | Top 3 recommendations, acquirer database, trend chart |
| `/whatif` | L2 | Slider-based scenario modelling, save/load scenarios |
| `/notifications` | All | Notification centre, staleness alerts, email simulation indicator |
| `/settings` | All | Profile, subscription, currency, notifications, data export, security |
| `/upgrade` | All | Plan comparison, feature matrix, ROI calculator |
| `/help` | All | FAQ accordion, contact form |

### Report Tabs

| Tab | Tier | Contents |
|---|---|---|
| Overview | All | Total fees KPIs, channel split bar chart, fee composition donut |
| Fee Breakdown | All | All fee lines with filtering by channel / flagged. Per-field confidence. |
| Channel Split | All | POS vs CNP deep dive — volume, fees, effective rate, txn count, avg txn, card mix |
| Discrepancy Report | L1+ | Agreed vs charged table, overcharge and missing rebate detection |
| Benchmarking | All | Top 3 acquirers with T1/T2/T3 badges, savings (L1+), referral disclosure |
| Q&A | L1+ | Grounded AI chat with source citation and out-of-scope decline |

---

## Tier Model

| Feature | Free | Level 1 ($39/mo) | Level 2 ($99/mo) |
|---|:---:|:---:|:---:|
| Account registration & login | ✓ | ✓ | ✓ |
| Statement uploads per month | 1 | 5 | Unlimited |
| Supported formats (PDF, CSV, XLSX) | ✓ | ✓ | ✓ |
| Image / OCR upload (JPG/PNG) | — | ✓ | ✓ |
| Bulk upload | — | — | ✓ |
| Automated parsing + confidence scores | ✓ | ✓ | ✓ |
| Fee breakdown table | ✓ | ✓ | ✓ |
| Channel split (POS vs CNP) | ✓ | ✓ | ✓ |
| Acquirer benchmarking — top 3 | ✓ | ✓ | ✓ |
| Estimated annual savings | — | ✓ | ✓ |
| Merchant agreement upload | — | ✓ | ✓ |
| Discrepancy report | — | ✓ | ✓ |
| Q&A assistant (AI chat) | — | ✓ | ✓ |
| Email & in-app notifications | — | ✓ | ✓ |
| What-if scenario modelling | — | — | ✓ |
| Multi-currency support | — | — | ✓ |
| Export to PDF | — | ✓ | ✓ |
| Export to Excel (CSV) | — | — | ✓ |
| History retention | 3 months | 12 months | Unlimited |

> **Tier simulation:** In Settings → Subscription, click Free / L1 / L2 to instantly switch tiers without a payment flow. This is intentional for demo/testing.

### Tier gating implementation

```js
// lib/utils.js
export function tierOk(current, needed) {
  const rank = { Free: 0, L1: 1, L2: 2 };
  return (rank[current] ?? 0) >= (rank[needed] ?? 0);
}
```

The `<TierGate>` component wraps any feature that requires a higher tier — it blurs the content and overlays an upgrade prompt.

---

## AI Integration

### Statement Parsing (`/api/parse`)

**Endpoint:** `POST /api/parse`  
**Body:** `FormData` with `file`, `fileName`, `fileType`

**Flow:**
1. File arrives at the API route (server-side)
2. If the file is text-extractable (CSV, text-based), the content is read and sent to Claude
3. Claude is prompted to extract the canonical schema (see below) and return structured JSON
4. Markdown code fences are stripped from the response
5. If the file is binary (PDF, XLSX) or parsing fails, returns `{ success: false, reason: 'binary_format' }`
6. Client falls back to demo data with a user-visible notice

**Canonical schema extracted:**

```json
{
  "billing_period": { "from": "YYYY-MM-DD", "to": "YYYY-MM-DD" },
  "acquirer_name": "string",
  "merchant_id": "string",
  "total_transaction_volume": 0.00,
  "total_fees_charged": 0.00,
  "effective_rate": 0.00,
  "interchange_fees": 0.00,
  "scheme_fees": 0.00,
  "service_fees": 0.00,
  "other_fees": 0.00,
  "currency": "USD",
  "channel_split": {
    "pos": { "volume": 0, "fees": 0 },
    "cnp": { "volume": 0, "fees": 0 }
  },
  "fee_lines": [
    {
      "type": "string",
      "rate": "string",
      "amount": 0.00,
      "card_type": "string",
      "channel": "POS|Online|All",
      "confidence": "high|medium|low",
      "flagged": false
    }
  ],
  "parsing_confidence": "high|medium|low"
}
```

### Q&A Assistant (`/api/chat`)

**Endpoint:** `POST /api/chat`  
**Body:** `{ messages: [...], statementContext: {...} }`

**System prompt behaviour:**
- The structured statement JSON is injected as context into every request
- Claude is instructed to answer **only** from the provided data
- Every answer must cite the source field(s) using `[Source: fieldName]` syntax
- Out-of-scope questions receive an explicit decline: *"This question cannot be answered from your uploaded statement data."*
- No general financial advice pathway exists

**Model:** `anthropic/claude-3-haiku` (fast, cost-effective, accurate for structured data Q&A)

---

## Dual Confidence Model

This is one of the most important design decisions in OptiSMB. **Two confidence scores are always shown separately and never merged.**

| Score | Measures | Example |
|---|---|---|
| **Parsing confidence** | How accurately the system extracted data from the uploaded document | High — all fee lines clearly identified; Low — scanned PDF with poor quality |
| **Rate data confidence** | How reliable the acquirer rate data is that we're comparing against | High — T1 regulatory data <90 days old; Low — T3 floor rate estimate >180 days old |

**Critical rule:** A perfectly parsed statement (High parsing confidence) compared against stale data (Low rate confidence) produces a Low-confidence recommendation. The **saving estimate inherits the lower of the two confidence scores.**

```jsx
// Always displayed as two separate badges — never collapsed
<DualConfidence
  parsing={stmt.parsingConfidence}   // "high" | "medium" | "low"
  rate={stmt.rateConfidence}         // "high" | "medium" | "low"
  asOf={stmt.dataAsOf}               // "12 Apr 2026"
/>
```

---

## Data Source Tiers

Every acquirer recommendation displays its data source tier:

| Tier | Source | Confidence | Notes |
|---|---|---|---|
| **T1** | Published interchange schedules (Visa/MC/Amex) + regulatory disclosures | High | Publicly available; updated quarterly |
| **T2** | SMB-submitted rate data, anonymised and corroborated | Medium-High | Cross-validated with T1 where possible |
| **T3** | Floor rate from interchange only — acquirer margin unknown | Low | Estimated; contact acquirer for current pricing |
| **T4** | Open Banking / PSD2 real-time account feeds | High | Where available; continuous |
| **T5** | Acquirer commercial partnership (voluntary) | High | Does not influence ranking algorithm |

**Staleness thresholds:**
- **Amber (≥90 days):** Warning shown on dashboard, report, and benchmark pages
- **Red (≥180 days):** Strong warning; recommendations labelled as potentially misleading

---

## Acquirer Database

10 US acquirers tracked in the current release:

| Acquirer | Data Tier | MCC Coverage |
|---|---|---|
| Chase Merchant Services | T1 | Full |
| Worldpay (FIS) | T1 | Full |
| First Data (Fiserv) | T1 | Full |
| Adyen | T1 | Full |
| Stripe | T2 | Full |
| PayPal / Braintree | T2 | Full |
| Square | T3 | Partial |
| Heartland | T2 | Partial |
| Elavon | T2 | Full |
| Clover | T3 | Partial |

---

## API Routes

### `POST /api/parse`

Parses an uploaded statement file using Claude AI.

**Request:** `multipart/form-data`
| Field | Type | Description |
|---|---|---|
| `file` | File | The statement file |
| `fileName` | string | Original filename |
| `fileType` | string | MIME type |

**Response:**
```json
{
  "success": true,
  "data": { ...canonicalSchema },
  "method": "llm"
}
```
Or on binary/failure:
```json
{
  "success": false,
  "reason": "binary_format"
}
```

---

### `POST /api/chat`

Answers a question about a statement using Claude AI.

**Request body:**
```json
{
  "messages": [
    { "role": "user", "content": "What is my effective rate?" }
  ],
  "statementContext": {
    "acquirer": "Chase Merchant Services",
    "period": "Mar 2026",
    "parsedData": { ...canonicalSchema },
    "discrepancies": [...],
    "benchmarks": [...]
  }
}
```

**Response:**
```json
{
  "content": "Your effective rate for Mar 2026 is 1.84%. [Source: parsedData.effective_rate]"
}
```

---

## Core Components

### `AppContext.jsx`
Global state provider wrapping the entire authenticated app.

**State:**
- `user` — profile, tier, notification prefs
- `statements[]` — all uploaded statements with parsed data
- `merchantAgreements[]` — version-controlled agreement history
- `notifications[]` — in-app notification queue
- `savedScenarios[]` — what-if scenario saves
- `humanReviewQueue[]` — low-confidence statements awaiting review
- `onboardingDone` — first-time user flag

**Key functions:**
- `addStatement(stmt)` — adds parsed statement, auto-creates notifications, routes to review queue if low confidence
- `addMerchantAgreement(data)` — adds agreement version, marks previous as superseded
- `checkStaleness(stmt)` — returns `{ level: 'amber'|'red', daysOld }` or `null`
- `isDuplicate(acquirer, period)` — checks for duplicate before upload
- `exportUserData()` — returns full account data as JSON for GDPR/CCPA export

### `UI.jsx`
Shared design system components:

| Component | Description |
|---|---|
| `Btn` | Button with variants: `primary`, `teal`, `ghost`, `outline`, `danger` |
| `Card` | Standard card container with cream background |
| `Pill` | Inline badge with tones: `ink`, `teal`, `amber`, `rose`, `leaf`, `cream` |
| `TierBadge` | Shows Free / Level 1 / Level 2 as coloured Pill |
| `TierGate` | Wraps content; blurs + overlays upgrade prompt if tier insufficient |
| `Disclaimer` | Collapsible info/warn banner for regulatory notices |
| `Toggle` | Accessible switch input |
| `Field` | Form field wrapper with label and hint |
| `Input` | Styled text input |
| `Select` | Styled select dropdown |
| `KPI` | Large metric display with label, value, delta, sub-text |
| `ConfidenceBadge` | High/Medium/Low badge with dot indicator and data-as-of date |
| `DualConfidence` | Side-by-side parsing + rate confidence badges |
| `Tooltip` | Hover tooltip |
| `EmptyState` | Centred empty state with icon, title, body, action |
| `SectionHeader` | Page header with eyebrow, title, and action slot |

### `Charts.jsx`
Custom SVG chart components (no external chart library):

| Component | Description |
|---|---|
| `DonutChart` | Segmented ring with centre label |
| `HBar` | Horizontal bar chart |
| `Sparkline` | Miniature area + line chart for KPI cards |
| `LineChart` | Multi-series line chart with axes, gridlines, and dashed series support |

### `Icons.jsx`
40+ SVG icons as named exports. All share a consistent 24×24 viewBox and `1.6px` stroke weight.

Notable: `ArrowRight`, `ArrowUpRight`, `Upload`, `FileText`, `BarChart`, `Sparkles`, `Lock`, `Bell`, `Settings`, `Receipt`, `Shield`, `AlertTriangle`, `CircleCheck`, `Send`, `Download`, `Trash`, `Edit`, `RefreshCw`, `History`, `Globe`, `TrendingUp`, `TrendingDown`, `Logo` (OptiSMB brand mark), `Google`, `Microsoft` (coloured SSO icons).

### `Toast.jsx`
Non-blocking notification system.

```jsx
const { addToast } = useToast();
addToast({ type: 'success', title: 'Saved', message: 'Optional detail' });
addToast({ type: 'error', title: 'Failed' });
addToast({ type: 'info', title: 'Note' });
```
Toasts auto-dismiss after 4 seconds. Manual dismiss via × button. Slide-in/out animation.

---

## State Management

All state lives in `AppContext` and is persisted to `localStorage` under the key `smb_state`.

**Hydration pattern:**
```js
useEffect(() => {
  // Read from localStorage on mount
  const raw = localStorage.getItem('smb_state');
  if (raw) { /* restore state */ }
  setHydrated(true);
}, []);

useEffect(() => {
  // Save to localStorage on every state change
  if (!hydrated) return;
  localStorage.setItem('smb_state', JSON.stringify({ ...allState }));
}, [/* all state deps */]);
```

**Auth guard:** The `(app)` layout checks `isAuthenticated` on every render and redirects to `/login` if false.

---

## Security & Privacy

| Concern | Implementation |
|---|---|
| **API key exposure** | `OPENROUTER_API_KEY` only read server-side in API routes. Never in client bundles. |
| **File upload safety** | Max 50MB enforced client-side. Allowed extensions validated before processing. |
| **No PII in logs** | `console.log` only used for email simulation trace — no user data logged. |
| **Data isolation** | All data is per-account in localStorage. Production would enforce strict API-level account isolation. |
| **Account deletion** | Purges all localStorage state. Production: 30-day GDPR erasure SLA, audit logs retained 7 years. |
| **T3 data consent** | Anonymised rate data contribution is **off by default**. Requires explicit opt-in toggle in Settings. |
| **Referral independence** | Referral fees do not influence recommendation ranking. Algorithm ranks by projected saving only. |

---

## Regulatory & Compliance

OptiSMB operates as a **comparison and information tool**, not a regulated financial adviser.

**Mandatory disclaimer** (shown on all recommendation and report pages):
> *The rate data shown is provided for informational purposes only and does not constitute financial advice. Savings estimates are indicative and based on available market data. Your actual costs will depend on your specific negotiated terms. We do not execute acquirer switches on your behalf. Where applicable, we may receive a referral fee if you contact an acquirer through this platform. This does not affect the ranking of recommendations.*

**US regulatory position:**
- Operating under a price comparison model (no personalised advice)
- CCPA and GLBA compliant data handling
- Right to access (data export), right to erasure (account deletion)
- Referral fee disclosure on every recommendation page

---

## Functional Specification

This codebase implements **Functional Specification Document v3.0** covering:

| Section | Status |
|---|---|
| FR-01: Account Registration & Login | ✓ Implemented (simulated Auth0) |
| FR-02: Statement Upload (PDF/CSV/XLSX, 50MB limit, duplicate detection) | ✓ Implemented |
| FR-03: Merchant Agreement Upload (version control, L1+) | ✓ Implemented |
| FR-04: Automated Statement Parsing (confidence scoring, human review queue) | ✓ Implemented |
| FR-05: Agreement vs Statement Discrepancy Analysis (L1+) | ✓ Implemented |
| FR-06: Acquirer Benchmarking & Recommendations (T1/T2/T3 tiers, referral disclosure) | ✓ Implemented |
| FR-07: What-If Scenario Modelling (L2) | ✓ Implemented |
| FR-08: Dashboard & Historical View (tier-gated history) | ✓ Implemented |
| FR-09: Conversational Q&A (grounded, source-cited, out-of-scope decline) | ✓ Implemented |
| FR-10: Notifications & Alerts (staleness monitoring, email simulation) | ✓ Implemented |

**Pre-launch gates (production requirements — not needed for demo):**
- GATE 1: Legal — FCA/CFPB advice boundary assessment
- GATE 2: Data — Minimum 10 acquirers at T1/T2 confidence in production database
- GATE 3: Pilot — 20-SMB closed beta with ≥85% parsing accuracy validated

---

## Roadmap

### Phase 1 (Current — Demo)
- [x] Complete frontend with all PRD features
- [x] Real AI parsing and Q&A via OpenRouter Claude
- [x] Simulated auth, email, OCR
- [x] 10-acquirer US database
- [x] Dual confidence model
- [x] Tier gating (Free / L1 / L2)

### Phase 2 (Production)
- [ ] Real Auth0 integration (SSO, MFA)
- [ ] PostgreSQL database (accounts, statements, analyses)
- [ ] AWS S3 document storage (AES-256)
- [ ] AWS Textract OCR for scanned PDFs and images
- [ ] Real email via Resend or SendGrid
- [ ] Open Banking / PSD2 data feeds (T4)
- [ ] Acquirer commercial partnerships (T5)
- [ ] API access for Level 2 subscribers
- [ ] Accountant white-label channel

### Phase 3
- [ ] Multi-tenant white-label for accounting platforms (Xero, QuickBooks)
- [ ] B2B data insights licensing (anonymised, aggregated)
- [ ] Multi-period trend analysis
- [ ] EU geographic expansion (separate legal assessment)

---

## Contributing

1. Fork the repository
2. Create a feature branch: `git checkout -b feature/your-feature`
3. Commit your changes: `git commit -m "Add your feature"`
4. Push to your branch: `git push origin feature/your-feature`
5. Open a Pull Request

**Code style:**
- No TypeScript (plain JSX)
- No comments unless the WHY is non-obvious
- No premature abstraction — three similar lines beats a helper
- Tailwind utility classes only — no CSS modules

---

## License

MIT © 2026 OptiSMB Inc., New York

---

<div align="center">
  <strong>OptiSMB</strong> · Acquirer audit made simple<br/>
  <a href="http://localhost:3001">localhost:3001</a> · Built with Next.js + Claude AI
</div>
