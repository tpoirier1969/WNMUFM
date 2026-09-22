# Comparable Stations benchmark plan

## Purpose

WNMU-FM currently receives source-supplied benchmark values from NPR labeled things such as **Typical Station** or **Average Station**. Those values are useful as NPR benchmarks, but the imported reports do not disclose which stations make up the comparison group or whether the benchmark is matched to WNMU-FM by market size, rurality, income, education, university affiliation, or any other local characteristic.

The next major analytics module should therefore add a second, separate benchmark:

- **NPR Typical/Average Station** — preserve the source value and source label; do not imply demographic matching.
- **WNMU Comparable Stations** — a transparent peer benchmark built from documented public data and a reproducible similarity model.

The Comparable Stations benchmark must never replace or relabel the NPR benchmark. They answer different questions.

## Core design principles

1. **Compare station systems, not individual repeaters.** CPB Station Finder can list multiple transmitters under one flagship station. Peer comparison should normally operate at the CPB radio grantee / flagship-station level so a network is not counted several times merely because it uses repeaters.
2. **Use a consistent coverage definition.** For FM, CPB defines primary coverage using the 60 dBu contour. Use that same standard wherever feasible so WNMU and candidate peers are measured consistently.
3. **Use coverage-area demographics, not the county of license.** A rural station can cross multiple counties and serve a very different population from its city of license.
4. **Do not average medians naively.** Coverage-wide median household income should be derived from household-income distributions where feasible, or be clearly labeled as an approximation if a weighted-median shortcut is ever used.
5. **Keep facts, model choices, and unknowns separate.** Every peer variable needs a source, source year, extraction method, and confidence/coverage note.
6. **Missing peer data stays missing.** Do not substitute national averages or inferred values merely to complete a score.
7. **The peer model must be inspectable.** Staff should be able to see why a station was included and how similar it is on each dimension.
8. **Weights are policy choices, not facts.** Default weights may be proposed, but the app should preserve the underlying measurements and eventually allow alternate weighting models.

## Authoritative source universe

### CPB radio universe

Use the Corporation for Public Broadcasting Station Finder / CSG universe as the initial public-radio population. CPB states that Station Finder includes CSG-qualified stations. A CPB data-policy description also refers to 408 Radio CSG grantees.

Sources:

- CPB Station Finder: https://cpb.org/cpb-station-finder/
- CPB data-policy / CSG systems background: https://cpb.org/grants/data-and-policy-analyst-radio-and-television-community-service-grants-system-consultation
- 2024 Radio Station Activity Survey instructions: https://cpb.org/sites/default/files/Instruction%20Guide%20-%20SAS-Radio%202024%20v19-2.pdf

The station finder lists transmitters, not necessarily one row per grantee. Candidate construction must de-duplicate to the relevant flagship/grantee system.

### CPB coverage/rural definitions

CPB's Radio CSG rules define Coverage Area Population (CAP) using the station's primary coverage contour. The FY2025 rules use 60 dBu for FM. CPB also defines a Rural Audience Service Station (RASS) as having CAP density of **40 people per square kilometer or less**.

CPB's FY2025 grant calculations use these CAP ranges:

- under 20,000
- 20,000 to under 100,000
- 100,000 to under 300,000
- 300,000 to under 1 million
- 1 million to under 3 million
- 3 million or more

Those categories are useful as interpretable anchors even if the final similarity score uses continuous CAP.

Sources:

- FY2025 Radio CSG General Provisions: https://cpb.org/sites/default/files/FY_2025_Radio_CSG_General_Provisions_and_Eligibility_Criteria.pdf
- FY2025 Radio Grant Calculations: https://cpb.org/sites/default/files/Radio%20Community%20Service%20Grant%20Calculations%20-%20FY%202025.pdf

### FCC station and contour data

Use FCC data for station identity, facility ID, licensee, technical facilities, and coverage geometry.

- FCC Contours API documentation: https://geo.fcc.gov/api/contours/
- FCC Contours API demo: https://geo.fcc.gov/api/contours/demo
- FCC Public Inspection Files: https://publicfiles.fcc.gov/
- FCC Public Inspection Files developer resources: https://publicfiles.fcc.gov/developer

WNMU-FM baseline identity should be keyed by FCC facility ID **49572**, with WNMU-FM as the flagship station. WUPX should be treated as part of the WNMU system rather than an independent peer.

### Census ACS demographics

Use the most recent common ACS 5-year release available across all peer markets. The 5-year product is preferable to the 1-year product because rural coverage areas can contain small geographies that are not present in the 1-year dataset.

Candidate demographic dimensions:

- total population / household count
- median age or age distribution
- educational attainment
- household income distribution / median household income
- poverty
- broadband / internet subscription
- optionally employment and housing variables if later shown to have analytic value

Useful Census tables/groups include:

- B01001 / B01002 — age
- B15003 — educational attainment
- B19001 — household income distribution
- B19049 — median household income reference
- B17001 — poverty
- B28002 / related B280xx tables — internet subscription / broadband

Sources:

- Census API: https://api.census.gov/data.html
- 2024 ACS 5-year API: https://api.census.gov/data/2024/acs/acs5.html
- Example income group: https://api.census.gov/data/2024/acs/acs5/groups/B19049.html

## Geography method

### Preferred method

1. Obtain the 60 dBu FM contour for WNMU and every candidate peer.
2. Intersect each contour with Census tract or block-group geography.
3. Aggregate population/household-based variables using the appropriate denominator.
4. For partially intersected geographies, use a defensible allocation method:
   - population-weighted intersection if population raster/block data are available; or
   - area-weighted allocation only as a documented fallback.
5. Store the coverage polygon, geography vintage, ACS vintage, and aggregation method so results can be reproduced.

### Important income caveat

Do not calculate a market median by taking the arithmetic mean of tract medians.

Preferred coverage-wide income calculation:

1. aggregate household counts across B19001 income bins;
2. locate the coverage-wide median household in the combined distribution;
3. estimate the median within the appropriate income band using a documented interpolation method.

If that becomes unnecessarily complex for the first prototype, retain tract-level B19049 medians and use a clearly labeled **household-weighted income index** rather than calling the result a true coverage-area median.

## Candidate peer pool

Do not hand-pick only stations that “feel” similar. Start with the full CPB radio grantee universe and progressively narrow it.

### Stage A — eligibility / structural filters

Initial candidates should generally be:

- CPB CSG-qualified radio grantees
- full-power public/noncommercial radio service
- not student-operated stations
- comparable at the grantee/flagship-system level rather than transmitter level

Useful structural labels to retain rather than immediately exclude on:

- university / college licensee
- state or regional network
- community/nonprofit licensee
- Native/tribal service
- primarily news/talk, music, mixed, or other programming service
- number of full-power transmitters / repeaters
- joint radio/TV licensee

University affiliation should be a significant matching factor for WNMU, but it should not be the sole gate. A highly similar rural independent station may be analytically useful even if its licensee type differs.

### Initial stations worth measuring, not pre-selecting

The following are sensible early candidates to put through the model because they provide useful nearby or structural comparisons. This is **not** a ranking or endorsement of them as final peers:

- WMUK-FM — Western Michigan University, Kalamazoo, Michigan
- WCMU-FM — Central Michigan University, Mount Pleasant, Michigan
- WGVU-FM — Grand Valley State University, Grand Rapids, Michigan
- WKAR-FM — Michigan State University, East Lansing, Michigan
- WEMU-FM — Eastern Michigan University, Ypsilanti, Michigan
- WOUB-FM system — Ohio University, Athens, Ohio
- WSIU-FM system — Southern Illinois University, Carbondale, Illinois
- WNIJ-FM — Northern Illinois University, DeKalb, Illinois
- WMKY-FM — Morehead State University, Morehead, Kentucky
- KASU-FM — Arkansas State University, Jonesboro, Arkansas
- KRCU-FM — Southeast Missouri State University, Cape Girardeau, Missouri
- KXCV-FM system — Northwest Missouri State University, Maryville, Missouri
- KNAU-FM system — Northern Arizona University, Flagstaff, Arizona
- Utah Public Radio / KUSU system — Utah State University, Logan, Utah
- WPSU-FM system — Pennsylvania State University, State College, Pennsylvania

Each must be verified from FCC/CPB data before it can become a scored peer. Large state networks or metropolitan university stations may fall away naturally once CAP, density and demographics are measured.

## Similarity model

### Phase 1 model

Use standardized distances rather than arbitrary yes/no labels.

Provisional feature groups:

#### Coverage / rural structure — 35%

- log coverage-area population: 15%
- population density: 15%
- same CPB rural/non-rural class: 5%

#### Demographics — 35%

- household income distribution / income index: 10%
- educational attainment: 8%
- median age / age structure: 6%
- broadband access: 6%
- poverty rate: 5%

#### Station structure — 20%

- university/public-educational licensee similarity: 8%
- number of transmitters / network scale: 5%
- joint-licensee or radio-only structure: 3%
- broad programming service mix: 4%

#### Financial scale — 10%

- NFFS or another standardized public financial measure: 10%, **only when a common-year, comparable station-level figure can be obtained reliably**

These are initial research weights, not final truth.

### Distance calculation

For continuous features:

- log-transform highly skewed variables such as CAP and NFFS;
- standardize over the eligible candidate universe;
- compute absolute standardized difference from WNMU.

For categorical features:

- use explicit penalties, with the penalty documented for each model version.

For missing features:

- do not treat missing as zero;
- calculate similarity from available dimensions only if a minimum evidence threshold is met;
- expose a completeness score;
- exclude candidates below that threshold from the published peer set.

A simple first scoring expression can be:

`distance = sum(weight_i * normalized_difference_i) / sum(weights_present)`

Then convert to a human-readable similarity index only for presentation, while retaining the raw distance.

## Peer-set output

The first useful production output should contain approximately **8–15 stations**, enough to reduce one-station noise without hiding behind a giant national average.

For each candidate, show:

- station / flagship call sign
- licensee
- community / state
- coverage population
- coverage population density
- rural classification
- university affiliation
- income measure
- education measure
- age measure
- broadband measure
- poverty measure
- network/transmitter count
- financial scale if available
- missing-data count
- similarity distance
- plain-English “why it is similar / different” summary

The app should also show WNMU's value in every column.

## Benchmark calculations

Once the peer set is established, calculate peer benchmarks per metric using the same source period and metric definition as WNMU whenever possible.

Preferred aggregate:

- **median of peer stations**, because small public-radio peer sets can contain large outliers.

Also retain:

- peer mean
- lower/upper quartiles
- peer count
- count with usable data
- period
- provenance

Do not label a peer benchmark if peer stations are not measured on the same metric definition and compatible period.

For NPR Analytics metrics, peer-level data may not be publicly obtainable. In that case the Comparable Stations module can still be valuable as a **market/operational context model**, while the actual NPR performance chart continues to show only WNMU and the source-supplied NPR benchmark. Never fabricate peer audience values.

## Data architecture

If/when this moves from research into the database, use FM-prefixed objects and keep peer research separate from imported NPR observations.

Suggested tables:

- `wnmufm_peer_stations`
  - stable peer/station-system identity
  - flagship call sign
  - FCC facility ID
  - CPB grantee identifier when available
  - licensee
  - university affiliation
  - active/inactive
- `wnmufm_peer_station_transmitters`
  - system-to-transmitter membership
  - facility IDs / calls / technical fields
- `wnmufm_peer_metrics`
  - station-system ID
  - metric key
  - value
  - unit
  - source year
  - source ID
  - extraction method
  - confidence/completeness
- `wnmufm_peer_sources`
  - source URL / dataset
  - retrieval date
  - vintage
  - citation / provenance notes
- `wnmufm_peer_models`
  - model version
  - weights
  - feature definitions
  - inclusion threshold
- `wnmufm_peer_model_members`
  - model version
  - peer station
  - distance / similarity
  - evidence completeness
  - inclusion status

Do not put this material into the NPR raw-import or normalized-observation tables.

## Model versioning

Peer selection can change as data vintages or weights change. Every published peer set therefore needs a model version.

Example:

- `comparable-stations-v1`
- source vintage: ACS 2024 5-year
- FCC retrieval date
- CPB universe vintage
- feature weights
- completeness threshold

Historical analytics reports should retain which peer-model version was used rather than silently recalculating past outputs under a newer model.

## Financial-data opportunity

WNMU's public FY2024 financial statements report WNMU-FM NFFS of **$665,693** for FY2024 and **$742,498** for FY2023. Similar standardized station financial filings may provide a useful scale variable if they can be collected consistently.

WNMU source:

- https://www.wnmufm.org/audited-financial-statements
- FY24 statements surfaced by WNMU/NPR public files.

Do not mix total licensee finances, television finances, or combined TV/radio figures with radio-only WNMU values.

## Implementation phases

### Phase 0 — documentation and source audit

- complete this methodology
- verify all source endpoints
- identify one stable key linking CPB and FCC station records
- determine whether public CPB files expose CAP directly per grantee
- determine whether common-year NFFS can be obtained reliably for enough stations

### Phase 1 — WNMU baseline

Build WNMU's own peer profile first:

- 60 dBu coverage geometry
- CAP
- CAP density
- ACS demographic profile
- university/licensee classification
- transmitter/system structure
- financial scale where reliable

The WNMU baseline should be viewable before any peer score is trusted.

### Phase 2 — candidate universe

- ingest/deduplicate the CPB radio universe
- map flagships/transmitters to FCC IDs
- attach licensee metadata
- calculate the same geography/demographic profile for candidates

### Phase 3 — peer model

- normalize features
- calculate distances
- inspect outliers and missingness
- test sensitivity to alternate weights
- select the first defensible 8–15 station peer set

### Phase 4 — app module

Add a separate **Comparable Stations** analysis section with:

- methodology summary
- WNMU vs peer distributions
- sortable peer table
- “why this station is a peer” detail
- model version/source provenance
- optional weighting controls for research/admin use

### Phase 5 — metric integration

Only where peer audience/performance metrics are genuinely available on compatible definitions:

- show WNMU
- NPR source benchmark
- Comparable Stations median/range

If peer performance data are unavailable, do not create a synthetic audience benchmark from demographics.

## Questions that must be answered before Phase 3

1. Can CPB CAP and density be retrieved directly for individual current radio grantees, or must both be rebuilt from FCC contours?
2. What is the cleanest stable identifier between CPB flagship records and FCC facility/licensee records?
3. Is there a public/common-year source for radio NFFS across most CSG grantees?
4. Should programming-format similarity be manually classified, or can a reliable public structured source support it?
5. Should joint TV/radio licensees receive a structural penalty, or simply retain joint-licensee status as descriptive context?
6. How much should university affiliation matter after coverage/demographic similarity is known?
7. What completeness threshold is needed before a candidate can enter the published peer set?

## What the app should ultimately say

A future chart or report should make the distinction explicit:

**NPR Typical Station**  
Source benchmark supplied by NPR; peer composition not disclosed in the imported report.

**WNMU Comparable Stations**  
WNMU-defined peer group selected using documented coverage, rurality, demographic and station-structure characteristics. Model version and station membership available for inspection.

That wording prevents a national/opaque NPR benchmark from masquerading as a demographic peer comparison while still preserving both useful reference points.
