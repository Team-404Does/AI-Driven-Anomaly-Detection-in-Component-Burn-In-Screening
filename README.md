# CRIP — Component Reliability Intelligence Platform

> **SIH26170 · AI-Driven Anomaly Detection in Component Burn-In & Screening**
>
> A mission-grade, explainable decision-support prototype for component burn-in and screening data.

CRIP turns raw burn-in telemetry into contextual, traceable engineering decisions. It combines physics-informed anomaly detection, drift forecasting, chamber spatial intelligence, lot/wafer genealogy, equipment-fault discrimination, explainable risk scoring, and audit-ready reporting in one offline-capable application.

> [!IMPORTANT]
> This repository is a **software-in-the-loop prototype** built with clearly labelled synthetic demonstration data. It is not an official ISRO system, does not claim ISRO or military-standard compliance, and must not be used as an autonomous safety-critical test controller.

---

## Why CRIP?

A static screen asks only:

> Is this measurement outside a fixed limit right now?

CRIP asks the engineering questions around that result:

- Is the component abnormal relative to its peers?
- Is the apparent anomaly explained by temperature or voltage stress?
- Is the signal drifting toward failure?
- Is the pattern isolated, lot-related, wafer-related, spatial, or instrumentation-related?
- Why did the model flag it?
- What action should a QA engineer consider?
- Can the evidence and decision be reconstructed later?

```text
RAW DATA
   ↓
DETECTION
   ↓
CONTEXT
   ↓
EXPLANATION
   ↓
DECISION
   ↓
TRACEABILITY
```

---

## Live Demo Journey

The included synthetic batch contains **1,000 components** and controlled ground-truth scenarios.

1. Open **Mission Control** to inspect batch health and active alerts.
2. Open **Anomalies → Static-pass / AI-fail** to find a hidden, sub-threshold anomaly.
3. Open its **Digital Passport** to inspect raw telemetry, population corridors, drift forecast, explanation, and risk decision.
4. Open **Live Chamber** to explore the interactive 8×16 socket map.
5. Inspect the **CH-07 instrumentation event**: 12 units share a synchronized transient and are placed on equipment hold rather than blindly rejected.
6. Open **Genealogy** to inspect the separate LOT-2036 / wafer-correlated process shift.
7. Run a temperature, voltage, and duration scenario in the **Prediction Lab**.
8. Generate a **Prototype NCR-style** or **Engineering Assessment** report.
9. Open **Audit & Models** to inspect model versions, measured metrics, feedback, simulations, and report events.

---

## Key Features

### Mission Control

- Batch-level health overview
- Healthy, watch, review, critical, qualified, and unknown counts
- Data-quality score
- Physics-normalized batch trend
- Anomaly onset timeline
- Critical triage queue
- Equipment/environment alerts
- Recent audit events

### Live Chamber — 8×16 Spatial Intelligence

- Interactive rack and socket visualization
- Status, heat, anomaly, and drift overlays
- Lot/status filters
- Hot-zone detection
- Measurement-channel risk view
- Component detail drawer and Digital Passport links

### Invisible Failure Detection

Highlights units that remain within static limits but are anomalous relative to their:

- peer population,
- temporal trajectory,
- physics-normalized residual,
- drift acceleration,
- or lineage/equipment context.

```text
STATIC SCREEN: PASS
DYNAMIC MODEL: ANOMALOUS
DECISION: HUMAN REVIEW
```

### Component Digital Passport

Each component has a permanent engineering profile with:

- identity, lot, wafer, chamber socket, and channel,
- current status, health score, anomaly score, and risk decision,
- raw telemetry explorer,
- population corridor,
- drift forecast and uncertainty interval,
- anomaly explanation and counterfactual suggestion,
- candidate failure signatures,
- lot/wafer context,
- replay mode and healthy-peer comparison,
- human feedback,
- reports and audit history.

### Anomaly Triage & Human Feedback

QA operators can label a result as:

- Confirmed anomaly
- False positive
- Wrong failure mode
- Needs more testing

Feedback is stored in a controlled retraining queue. The active model **does not silently retrain** after an operator click.

### Equipment-Fault Discrimination

CRIP checks whether anomalies share:

- lot,
- wafer,
- chamber region,
- measurement channel,
- or onset time.

The included demo distinguishes a synchronized CH-07 instrumentation event from independent component failures and assigns `EQUIP HOLD` instead of automatically rejecting those units.

### Prediction Lab

- Observed telemetry and 168-hour forward projection
- Prediction interval
- Drift rate and estimated time-to-limit where justified
- Temperature, voltage, and test-duration controls
- Arrhenius and empirical voltage acceleration
- Risk-change and expected-anomaly estimates
- Model version and assumptions shown with every result
- Every scenario recorded in the audit log

### Root-Cause / Failure Fingerprints

The prototype ranks candidate signatures such as:

- TDDB-like leakage growth
- BTI/HCI-like threshold-voltage drift
- Die-fracture-like step behavior
- Bond-fatigue-like instability
- Instrumentation transient

These are intentionally described as **candidate mechanisms consistent with the data**. Physical diagnosis requires independent engineering validation and failure analysis.

### Genealogy

- Manufacturer → lot → wafer → component traceability
- Risk propagation through lineage
- Per-lot and per-wafer flagged rates
- Process-shift visualization

### Reports & Governance

- Prototype NCR-style report
- Prototype Engineering Assessment Report
- Print-to-PDF workflow
- Model and data version pinning
- Evidence, forecast, risk, context, and disposition summary
- Append-only audit trail
- Model registry with champion/challenger comparison

---

## Architecture

```text
┌───────────────────────────────────────────────────────────────┐
│ Next.js App Router control center                            │
│ Mission Control · Chamber · Passports · Lab · Reports        │
└───────────────────────────┬───────────────────────────────────┘
                            │ Server Components / Route Handlers
┌───────────────────────────▼───────────────────────────────────┐
│ Analysis orchestration                                       │
│ Validation → Physics normalization → Anomaly detection       │
│ → Forecast → Signatures → Correlation → Risk policy          │
└───────────────────────────┬───────────────────────────────────┘
                            │ Drizzle ORM
┌───────────────────────────▼───────────────────────────────────┐
│ PostgreSQL                                                    │
│ Telemetry · Anomalies · Predictions · Risks · Feedback       │
│ Equipment events · Model registry · Reports · Audit log      │
└───────────────────────────────────────────────────────────────┘
```

The current prototype keeps the complete inference pipeline inside the Next.js server runtime. This makes the hackathon/demo deployment simple and offline-capable. A future production architecture can extract the model pipeline into a Python/FastAPI inference service without changing the product workflow.

---

## ML & Physics Implementation

The main model code is stored in [`src/lib/ml`](src/lib/ml):

| File | Responsibility |
|---|---|
| [`isoforest.ts`](src/lib/ml/isoforest.ts) | Deterministic Isolation Forest implementation |
| [`features.ts`](src/lib/ml/features.ts) | Physics normalization, temporal/population features, linear drift forecast, uncertainty |
| [`pipeline.ts`](src/lib/ml/pipeline.ts) | Champion/challenger models, signatures, risk engine, cohort discrimination, metrics, persistence |
| [`generator.ts`](src/lib/sim/generator.ts) | Reproducible synthetic burn-in data and injected ground truth |

### Champion anomaly model

**PRES-IF v1.4**

- 120-tree Isolation Forest
- 256-unit subsamples
- Adaptive per-unit Arrhenius normalization
- Activation-energy prior: `Ea = 0.7 eV`
- Empirical voltage acceleration exponent: `γ = 3.1`
- Robust median/MAD population residuals
- Temporal slope, acceleration, residual volatility, Vth drift, and step-transient features

### Challenger anomaly model

**RAW-IF v0.9**

Uses a comparable Isolation Forest feature pipeline without physics normalization. It demonstrates how raw telemetry can inflate environment-related false alarms.

### Drift model

**DRIFT-LIN v2.1**

- Least-squares trend on the physics-normalized leakage series
- Forward projection to 336 hours, representing 168 hours beyond the observed 168-hour burn-in window
- Prediction interval
- Drift-risk band
- Estimated time-to-limit only when the fitted slope supports it

### Risk engine

The ML score does not directly become the operational decision. A separate deterministic policy uses:

- anomaly score,
- drift risk,
- static threshold status,
- lot/wafer correlation,
- equipment correlation,
- failure-signature evidence,
- and missing-data penalty.

Default prototype bands:

| Score | Risk | Typical action |
|---:|---|---|
| 0–30 | Healthy | Pass |
| 31–60 | Watch | Monitor / conditional review |
| 61–80 | Review | Human engineering review |
| 81–100 | Critical | Reject / isolate according to procedure |

Thresholds are prototype settings and require calibration on representative, validated deployment data.

---

## Current Synthetic Benchmark

The seeded model registry stores metrics computed during the pipeline run against controlled synthetic ground truth. A typical deterministic seed produces:

| Model | Precision | Recall | F1 | Notes |
|---|---:|---:|---:|---|
| PRES-IF v1.4 | 0.417 | 1.000 | 0.588 | Raw detector output before systemic-event disposition |
| PRES-IF v1.4, post-discrimination | 0.625 | 1.000 | 0.769 | CH-07 instrument cohort reclassified from component failures |
| RAW-IF v0.9 | 0.333 | 1.000 | 0.500 | Un-normalized challenger |
| DRIFT-LIN v2.1 | MAE 0.0421 µA | RMSE 0.0546 µA | R² 0.984 | Normal-unit holdout; 963 samples |

> [!NOTE]
> These metrics measure behavior on the included **synthetic dataset**, not flight-qualified hardware. They demonstrate the prototype pipeline and evaluation discipline; they are not validated engineering performance claims.

---

## Synthetic Demo Dataset

The generator creates a deterministic 1,000-component burn-in batch with 43 samples per available component, from hour 0 through hour 168 at 4-hour intervals.

Injected scenarios:

| Scenario | Purpose |
|---|---|
| Normal | Stable population with realistic noise |
| Gradual drift | Progressive leakage growth |
| Step failure | Abrupt multiparameter change |
| Thermal coupling | Temperature-driven signal movement, cleared by physics normalization |
| Equipment event | 12 unrelated units on CH-07 with synchronized transient |
| Lot/wafer shift | Shared process-related Vth movement in LOT-2036 |
| Hidden anomaly | Static-limit pass but abnormal dynamic trajectory |
| Missing telemetry | Explicit unknown/manual-QC handling |

The synthetic data is clearly marked as `DS-SYN-2026-0142` throughout the model registry and reports.

---

## Technology Stack

### Application

- Next.js 16 — App Router
- React 19
- TypeScript
- Tailwind CSS 4
- ECharts
- Lucide React

### Data

- PostgreSQL
- Drizzle ORM / Drizzle Kit

### Runtime

- Node.js 22 recommended
- Works as a single deployable service plus PostgreSQL
- No external model API or third-party AI dependency
- Core pipeline can run without internet access

---

## Repository Structure

```text
src/
├── app/
│   ├── api/
│   │   ├── analyze/        # Run the complete analysis pipeline
│   │   ├── feedback/       # Store controlled QA feedback
│   │   ├── forecast/       # Component forecast data
│   │   ├── health/         # Database-backed health check
│   │   ├── reports/        # Generate report records
│   │   ├── search/         # Component command-search
│   │   ├── seed/           # Seed the demo dataset
│   │   ├── upload/         # Validate, ingest and analyze CSV
│   │   └── whatif/         # Stress-scenario simulator
│   ├── analytics/          # Batch distributions and correlations
│   ├── anomalies/          # Triage workspace
│   ├── audit/              # Audit trail and model registry
│   ├── chamber/            # 8×16 chamber visualization
│   ├── components/         # Registry and Digital Passports
│   ├── genealogy/          # Lot/wafer graph
│   ├── lab/                # Forecasting and What-If simulator
│   ├── reports/            # Report list and printable documents
│   └── root-cause/         # Failure-fingerprint analysis
├── components/             # Interactive product UI
├── db/
│   ├── index.ts            # PostgreSQL client
│   ├── schema.ts           # Drizzle relational schema
│   └── seed.ts             # CLI seed entry point
└── lib/
    ├── ml/                  # Model and physics pipeline
    └── sim/                 # Synthetic data generator
```

---

## Local Development

### Prerequisites

- Node.js 22+
- npm
- PostgreSQL 15+

### 1. Clone and install

```bash
git clone <your-repository-url>
cd <your-repository-directory>
npm install
```

### 2. Create the database

Create a PostgreSQL database and add `.env`:

```env
DATABASE_URL=postgresql://postgres:postgres@127.0.0.1:5432/app_db
```

Do not commit production credentials.

### 3. Apply the schema

```bash
npx drizzle-kit push
```

### 4. Seed the demonstration batch

```bash
npx tsx src/db/seed.ts
```

To erase application data and reproduce the deterministic synthetic batch:

```bash
npx tsx src/db/seed.ts --force
```

> `--force` truncates CRIP application tables. Do not use it against a database containing data you want to keep.

### 5. Start development mode

```bash
npm run dev
```

Open [http://localhost:3000](http://localhost:3000).

### Production validation

```bash
npx next typegen
npm exec tsc -- --noEmit --pretty false
npm run build
```

---

## CSV Upload Format

### Required columns

```text
component_code,hour,leakage_ua
```

### Optional columns

```text
lot_id
wafer_id
manufacturer
channel_id
vth_mv
rds_mohm
chamber_temp_c
vds_stress_v
rack
chamber_row
chamber_col
```

### Minimal example

```csv
component_code,hour,leakage_ua,lot_id,wafer_id,chamber_temp_c,vds_stress_v,channel_id
COMP-UP-0001,0,1.24,LOT-UP-01,WFR-A01,124.8,28.0,CH-01
COMP-UP-0001,4,1.27,LOT-UP-01,WFR-A01,125.2,28.0,CH-01
COMP-UP-0002,0,1.31,LOT-UP-01,WFR-A01,124.9,28.0,CH-02
COMP-UP-0002,4,1.35,LOT-UP-01,WFR-A01,125.1,28.0,CH-02
```

The upload route checks:

- required columns,
- empty identifiers,
- numeric parsing,
- missing values,
- duplicates,
- impossible leakage values,
- file size (40 MB maximum),
- and component/location metadata defaults.

Duplicates are dropped; missing samples are flagged rather than silently imputed.

---

## API Routes

| Method | Route | Purpose |
|---|---|---|
| `GET` | `/api/health` | Database-backed service health |
| `POST` | `/api/analyze` | Run the full analysis pipeline for a batch |
| `POST` | `/api/upload` | Validate, persist, and analyze CSV telemetry |
| `GET` | `/api/forecast?code=COMP-...` | Retrieve telemetry and forecast data |
| `POST` | `/api/whatif` | Run an audited stress-condition scenario |
| `POST` | `/api/feedback` | Add an engineer label to the controlled queue |
| `POST` | `/api/reports` | Generate an NCR-style or assessment report |
| `GET` | `/api/search?q=COMP` | Search the component registry |
| `GET/POST` | `/api/seed` | Initialize the synthetic demonstration dataset |

Example What-If request:

```json
{
  "componentCode": "COMP-00078",
  "tempC": 140,
  "voltage": 32,
  "durationH": 336
}
```

---

## Database Model

Core persisted entities:

- `users`
- `batches`
- `components`
- `telemetry`
- `anomalies`
- `predictions`
- `failure_signatures`
- `risk_assessments`
- `equipment_events`
- `feedback`
- `model_registry`
- `audit_log`
- `reports`

All analysis outputs are persisted rather than calculated only for presentation. Model versions, explanations, confidence, and timestamps stay connected to the component decision.

---

## Deploy on Railway — Recommended

Railway is the simplest deployment target for this repository because the application and managed PostgreSQL database can live in the same project with private networking.

The repository includes [`railway.toml`](railway.toml).

### Steps

1. Push the repository to GitHub.
2. In Railway, create **New Project → Deploy from GitHub Repo**.
3. Add **PostgreSQL** to the project.
4. In the application service, add:

```env
DATABASE_URL=${{Postgres.DATABASE_URL}}
```

5. If necessary, add:

```env
NIXPACKS_NODE_VERSION=22
```

6. Deploy and generate a public domain.

The configured deploy command:

```bash
npx drizzle-kit push --force; npx tsx src/db/seed.ts; npm run start
```

- applies the database schema,
- seeds only when the database is empty,
- starts the production Next.js server,
- and exposes `/api/health` for Railway health checks.

Because the seed command is idempotent unless `--force` is passed, routine redeployments do not overwrite existing data.

### Recommended production hardening

Before handling non-demo data:

- replace automatic schema push with reviewed migrations,
- gate demo seeding behind a `SEED_DEMO` environment variable,
- add authentication and role-based access enforcement,
- place uploads in object storage,
- add CSRF and rate-limit controls,
- encrypt backups and establish retention policy,
- validate models on representative hardware datasets,
- and separate model inference into a controlled service if independent lifecycle management is required.

---

## Deploy on Render

1. Create a PostgreSQL database.
2. Create a Node Web Service from the GitHub repository.
3. Set the build command:

```bash
npm install && npm run build
```

4. Set the start command:

```bash
npx drizzle-kit push --force; npx tsx src/db/seed.ts; npm run start
```

5. Set `DATABASE_URL` to the Render **Internal Database URL**.
6. Set the health-check path to `/api/health`.

Free Render web services may sleep after inactivity and can have noticeable cold starts. A continuously available instance is recommended for a live judging session.

---

## Keyboard Shortcuts

| Key | Action |
|---|---|
| `/` | Open component search / command palette |
| `G` | Mission Control |
| `C` | Live Chamber |
| `B` | Batch Analytics |
| `A` | Anomaly Triage |
| `P` | Prediction Lab |

---

## Security & Offline Profile

Current design properties:

- Database access remains server-side.
- No API keys or secrets are embedded in browser code.
- No external AI/model API is required.
- CSV uploads have type/size/schema checks.
- Engineering feedback is attributable and stored.
- Simulations and report generation are audited.
- The complete core pipeline can run on a local network without internet access.

The prototype demonstrates a security-oriented architecture but has **not** been formally assessed for ISRO, MIL-STD, or another regulated compliance framework.

---

## Evidence and Claims Discipline

CRIP distinguishes three levels:

1. **Design concept** — an engineering capability proposed by the product blueprint.
2. **Prototype implementation** — working software implemented and tested in this repository.
3. **Validated engineering claim** — a result supported by representative hardware data, controlled validation, and applicable engineering review.

This repository demonstrates level 2. It does not present prototype outputs as level-3 qualification evidence.

Specifically:

- lifetime and time-to-limit outputs are model-derived estimates,
- candidate failure mechanisms require physical failure analysis,
- synthetic benchmark metrics are not hardware qualification results,
- adaptive screening output is decision support, not automatic chamber control,
- and final component disposition remains with authorized QA engineering.

---

## Roadmap

- [ ] Authentication and enforced RBAC
- [ ] Controlled schema migrations
- [ ] Object storage for source files and generated PDF artifacts
- [ ] Background analysis jobs with progress events
- [ ] Python/FastAPI inference profile for independently versioned models
- [ ] MLflow-backed experiment and model registry
- [ ] SHAP integration for a validated tree-based production model
- [ ] Real burn-in dataset adapters and unit registry
- [ ] Batch-specific threshold configuration and approval workflow
- [ ] Automated test suite and browser smoke tests
- [ ] Docker Compose air-gapped deployment profile
- [ ] ONNX edge-inference evaluation

---

## Responsible Use

CRIP supports engineers; it does not replace them. Do not use prototype scores as the sole basis for flight-hardware acceptance, rejection, lifetime certification, or automatic modification of safety-critical test procedures.

---

## License

Add the license selected by your team before public distribution. Until then, all rights remain with the repository owner(s).

---

## Project Positioning

> **An AI-driven component reliability intelligence platform that combines dynamic anomaly detection, environment-aware normalization, burn-in drift forecasting, spatial and genealogy context, equipment-fault discrimination, explainable risk scoring, and audit-ready engineering reporting.**
