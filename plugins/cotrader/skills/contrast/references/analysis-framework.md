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

## Evidence Ledger

Before conclusions, build a compact ledger:

- Confirmed facts: S/A/B sources with timestamps.
- Company evidence: filings, IR, official releases.
- Market data: quote source, timestamp, delay caveat.
- Market interpretations: C-level explanations and media narratives.
- Unverified leads: webpage excerpts, social posts, screenshots, unsourced lists.
- Stale items: old catalyst reused as new.
- Missing fields: unavailable quote, market cap, valuation, revenue mix, or index membership.

## Cross-Market Comparison Axes

Compare each region and stock on:

- Theme fit: directness and economic materiality.
- Data support: source quality and completeness.
- Market reaction: price move, relative strength, volume/turnover, breadth of same-theme peers.
- Catalyst freshness: new, incremental, old-but-repriced, stale repeat, rumor-only.
- Pricing state: not yet traded, initial reaction, partially priced, consensus/crowded, exhaustion risk.
- Fundamental confirmation: revenue growth, margin trend, guidance, orders/backlog, capex, product cycle.
- Liquidity/capacity: market cap, turnover, index membership.
- A-share read-through: product chain similarity, customer overlap, valuation anchor, sentiment linkage, policy difference.
- Risk: weak mapping, stale catalyst, valuation/crowding, FX, local regulation, reporting calendar, liquidity.

## Pricing-State Rules

Classify pricing before making judgments:

- Not yet traded: no obvious move or data not yet updated.
- Initial reaction: first visible response to a new catalyst.
- Partially priced: price reacted, but peer breadth or fundamental evidence remains incomplete.
- Consensus/crowded: many peers and narratives already converged.
- Exhaustion risk: sharp multi-session rise, weak follow-through, stale catalyst reuse, or high valuation with slowing evidence.

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

## Risk Framework

Output at least 2 concrete risks, up to 6:

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
