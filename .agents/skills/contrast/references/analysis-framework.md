# Contrast Analysis Framework

## Time Context

Before analysis, confirm:

- Current date, weekday, and user-facing timezone.
- Information cutoff and whether web search, market-data tools, and real-time quote access are available.
- Market session status for each region:
  - US: pre-market, regular session, after-hours, closed.
  - Japan: TSE morning, lunch break, afternoon, closed.
  - Korea: KRX session or closed.
  - Europe: local exchange session or closed.
- If the data is delayed, end-of-day, or from the previous trading day, state that explicitly.

Use exchange calendars and timezone-aware dates; weekdays alone do not establish open sessions. Keep event time, first disclosure, quote time and retrieval time distinct. For historical analysis, isolate disclosures after the cutoff as later outcomes. Never use a subsequently completed overseas session to explain an earlier A-share decision as information already known.

## Theme Definition

Convert the user's theme into a search plan:

- Core product/service: what the company must actually sell or operate.
- Value-chain position: upstream material, equipment, component, software/platform, brand/customer, infrastructure, distributor.
- Catalyst type: policy, earnings, product price, capex cycle, AI/technology wave, geopolitical event, supply shortage, regulation, M&A, or sentiment.
- Inclusion rules: what counts as a direct peer.
- Exclusion rules: ETFs/funds, private companies, concept-only names, weak distributors, unrelated ADRs, or companies with immaterial exposure.

If the theme is too broad, split it into sub-themes and analyze the most relevant branch first.

## Regional Discovery

Use separate searches for each region:

- US: "{theme} listed stocks", "{theme} Nasdaq NYSE companies", company filings, SEC, Nasdaq/NYSE pages.
- Japan: "{theme} Japan listed company", Japanese terms if known, Nikkei 225 constituents, JPX/TSE profiles, EDINET, TDnet.
- Korea: "{theme} Korea listed company", KOSPI/KOSDAQ, KRX/KIND disclosures, company IR pages.
- Europe: "{theme} European listed company", STOXX Europe 600, LSE, Euronext, Deutsche Boerse/Xetra, SIX, Nasdaq Nordic, local company IR.

Prefer official index constituents and exchange/company sources for identity; use media and industry maps only as discovery leads.

## Candidate Qualification

For each candidate, confirm:

- Company name, ticker, exchange, country/region, currency, listing type.
- Ordinary share vs ADR vs ETF/fund.
- Index membership when relevant: S&P 500/Nasdaq 100, Nikkei 225/TOPIX, KOSPI/KOSDAQ/KOSPI 200, STOXX Europe 600 or local major index.
- Business exposure: direct product, revenue segment, customer/end-market, or documented strategic focus.
- Theme relevance grade:
  - Direct core: main business or material segment is the theme.
  - Direct partial: important but not dominant segment.
  - Upstream/downstream: supplier/customer/channel relationship.
  - Sentiment proxy: often traded with the theme but weak operating exposure.
  - Weak mapping: concept label or media association without hard evidence.

Remove weak mapping names unless the user's goal is to audit false positives.

## Comparable Data Fields

Collect only fields that can be timestamped and sourced:

- Market: last price or last close, daily change, market cap, trading currency, turnover/value traded, 1M/3M/6M performance if available.
- Valuation: P/E, forward P/E, P/S, EV/Sales, EV/EBITDA, P/B where relevant and available.
- Fundamentals: latest revenue, revenue growth, operating margin, gross margin, net income/profitability, guidance, backlog/orders if officially disclosed.
- Segment exposure: revenue share, product line, geography, customers/end-markets, capex plans.
- Catalyst: announcement date, policy date, earnings date, product-price data date, industry event date.
- Liquidity and investability: average volume, ADR ratio when applicable, local holiday/session caveat.

If a field is missing for one region, do not force it. Use "missing" and lower confidence.

### Normalization Before Ranking

- Returns: use the same start/end convention, each exchange's actual session dates, and a consistent price-return or total-return/adjustment basis. Do not rank one market's live partial session against another's full daily close as a like-for-like response. For event comparisons, specify the first tradable session after disclosure in each market and the remaining timing mismatch.
- Relative performance: compare each stock with a relevant local benchmark over the same window, labeled as descriptive excess return rather than causal alpha. No flat price or overseas rally by itself proves underpricing in A-shares.
- Currency and listings: show native currencies; convert market caps or turnover only using a sourced FX rate/date. Distinguish a GBp quote from GBP. ADR share ratios and local/ADR quotes must match before comparison; do not double-count listings of the same economic company.
- Valuation: distinguish trailing vs forward, fiscal year, estimate provider/date, GAAP/IFRS vs adjusted, equity value vs enterprise value, and total-company vs segment economics. Mark P/E for losses or a zero denominator as not meaningful. Do not rank a trailing loss-making P/E against a profitable peer's forward P/E.
- Liquidity and fundamentals: turnover needs matched windows and currency; financial metrics need comparable periods and definitions. A disclosed theme revenue share from an old annual report is historical exposure, not a current estimate. Do not infer it from product presence or aggregate company revenue.

For derived figures, show formula, sourced inputs, units and assumptions; use an available calculation tool instead of mental arithmetic. Keep incompatible fields side by side with the reason, without producing a numeric ranking. Missing values are not zero; missing prices are not “not yet traded.”

## Evidence Ledger

Before conclusions, build a compact ledger:

- Confirmed facts: S/A/B sources with timestamps.
- Company evidence: filings, IR, official releases.
- Market data: quote source, timestamp, delay caveat.
- Market interpretations: C-level explanations and media narratives.
- Unverified leads: webpage excerpts, social posts, screenshots, unsourced lists.
- Stale items: old catalyst reused as new.
- Missing fields: unavailable quote, market cap, valuation, revenue mix, or index membership.

For material claims use `E1 | claim/value | original source and grade | publication/data time | units/period | status | supports/contradicts`. Identify common originals behind reposts. Read the actual original passage before confirming the claim. Record conflicting like-for-like figures instead of silently selecting the newest retrieval.

## Cross-Market Comparison Axes

Compare each region and stock on:

- Theme fit: directness and economic materiality.
- Data support: source quality and completeness.
- Market reaction: price move, relative strength, volume/turnover, breadth of same-theme peers.
- Catalyst freshness: new, incremental, old-but-repriced, stale repeat, rumor-only.
- Pricing state: no observable reaction, initial reaction, partially priced, consensus/crowded, exhaustion risk, or unknown when data is insufficient.
- Fundamental confirmation: revenue growth, margin trend, guidance, orders/backlog, capex, product cycle.
- Liquidity/capacity: market cap, turnover, index membership.
- A-share read-through: product chain similarity, customer overlap, valuation anchor, sentiment linkage, policy difference.
- Risk: weak mapping, stale catalyst, valuation/crowding, FX, local regulation, reporting calendar, liquidity.

## Pricing-State Rules

Classify pricing before making judgments:

- No observable reaction: current comparable data shows no clear move; this does not establish that the information is unpriced.
- Initial reaction: first visible response to a new catalyst.
- Partially priced: price reacted, but peer breadth or fundamental evidence remains incomplete.
- Consensus/crowded: many peers and narratives already converged.
- Exhaustion risk: sharp multi-session rise, weak follow-through, stale catalyst reuse, or high valuation with slowing evidence.
- Unknown: data is missing, stale, incompatible, or does not cover the catalyst window.

State which observations support each label. A consensus or expectation-gap claim needs a dated expectation source or clearly limited proxy; company guidance, sell-side estimates and media opinion are different evidence. Do not use a guessed consensus or an unexplained score to rank underpricing.

Never infer that A-shares must follow because an overseas peer moved. Say what signal it provides and what would verify or invalidate the mapping.

## A-Share Read-Through

When connecting to A-share research, separate:

- Direct read-through: same product, same customer/capex cycle, same commodity/product price, or same global policy driver.
- Indirect read-through: overseas leader validates demand or valuation frame, but A-share company has different exposure.
- Sentiment-only read-through: theme names may react together, but economics are weak.
- No read-through: overseas peer is too different in product, market, regulation, or business model.

Use conditional language:

```text
海外映射的有效性取决于 A 股公司是否具备相同收入暴露、订单/产能验证和板块联动，而不是仅靠概念标签。
```

Build the bridge explicitly: overseas fact -> demand/supply/product-price/capex change -> documented A-share exposure -> revenue/cost/margin/cash-flow effect -> timing and limiting condition. Check whether the same event benefits one participant but harms another, such as a material price rise increasing an upstream producer's realizations and a downstream manufacturer's costs. Supply restrictions may constrain a supposed beneficiary; substitution requires evidence of qualification, capacity and access.

For the main mapping hypothesis, give supporting evidence IDs, the strongest counterevidence or alternative explanation, and a future observable event that distinguishes them. Separate business validation from stock-price follow-through. If the user follows up on an earlier map, preserve the original hypothesis/cutoff and report supported / weakened / invalidated / pending with new evidence; absent observations remain pending. Do not invent the original hypothesis or automatically schedule follow-up.

## Risk Framework

Output up to 6 concrete risks, preferably at least 2 when supported. Separate observed risks, conditional risks and unchecked areas; do not invent facts to satisfy a quota:

- Mapping risk: concept overlap but business exposure weak.
- Data risk: quote, valuation, or segment data missing/stale.
- Timing risk: overseas market open while A-share closed, or delayed data.
- Crowding risk: overseas leader has already priced the catalyst.
- Valuation risk: high multiples unsupported by fundamentals.
- Currency/listing risk: ADR vs local share, FX translation, local holiday or liquidity.
- Catalyst risk: old news, unconfirmed rumor, policy uncertainty, earnings date risk.
- Region risk: regulation, export controls, tariff/geopolitical exposure, local accounting differences.

## Confidence

High confidence usually needs verified identity, A/B market data, A-level business exposure, clear catalyst, and at least partial comparable fields across regions.

Medium confidence fits partial data, clear candidate identity, and reasonable source support, but incomplete valuation, segment, or real-time data.

Low confidence fits missing market data, weak exposure, concept-label-only mapping, old catalyst, or heavy reliance on C/D-level sources.

Always state confidence and reason.
