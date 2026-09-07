# Transaction Analysis Framework

## Time Context

Before analysis, confirm:

- Current date, weekday, time, A-share trading day status.
- Phase: pre-market before 09:15 on the target trading day, opening auction 09:15-09:25, pre-open observation 09:25-09:30, morning 09:30-11:30, midday 11:30-13:00, afternoon including the applicable closing-auction window until 15:00, after-hours from 15:00, or non-trading day. Confirm exchange-specific session rules where relevant; use non-overlapping boundaries.
- “Yesterday” means the previous A-share trading day, not the natural day.
- “Today” means the current A-share trading day.
- Information cutoff and whether real-time data was obtained.

Verify the exchange calendar rather than inferring a trading day from the weekday. The pre-market information window can begin at the previous close; that does not make the previous evening's current phase “pre-market.” For historical analysis, distinguish information known at the cutoff from subsequent disclosures. A post-close announcement cannot explain an earlier move as an established public cause.

## Stock Identity

Confirm:

- Name, code, exchange, board: main board / ChiNext / STAR / Beijing Stock Exchange.
- ST / *ST status, suspension status.
- Applicable price-limit rule and reference price for that security and date, including listings, risk warnings, resumptions, and other exceptions. Verify from current exchange rules or reliable security metadata; do not infer a fixed percentage solely from ST or board labels. If unresolved, do not claim limit-up/down status.
- Shenwan industry and concept labels.

State: concept labels are trading clues, not proof of main business.

If only a short name is given and ambiguity remains after trying common A-share matches, ask for the code.

## Data Retrieval

Minimum checks for a specific stock:

1. Quote identity and current/recent market data: name, code, exchange, board, ST, suspension, price-limit band, latest price, change, turnover, volume, turnover rate.
2. Announcements: exchange, cninfo, company announcements, abnormal-move notices, risk warnings, reductions, unlocks, results, regulatory letters, inquiry letters.
3. Abnormal-move explanation: stock + 涨停原因 / 异动 / 日期. Treat as market interpretation, not fact.

Supplement when needed:

- Sector/theme performance and recent catalysts.
- Same-theme peer linkage.
- Dragon-Tiger List only for limit-up/down, abnormal surges/drops, consecutive moves, or major volume expansion. Describe seat transaction facts only; do not infer intent.

Build a compact evidence ledger:

- Confirmed facts: S/A/B sources with timestamps.
- Market interpretations: mainstream explanations, theme narratives, or abnormal-move reason summaries.
- Unverified leads: webpage excerpts, forum claims, short-video claims, screenshot-only information, or source-less data.
- Stale items: news or announcements that may be reused as fresh catalysts.
- Missing fields: unavailable quote, sector, announcement, Dragon-Tiger List, or calendar data.

Use a compact row for each material claim: `E1 | claim/value | original source link and grade | publication/data time | units/period | status | supports/contradicts which hypothesis`. Retrieved time is separate from data time. Preserve disagreements and deduplicate syndicated reports by their original source. “No announcement found” describes the sources and date range searched, not proof that none exists.

## Abnormal-Move Classification

Classify before explaining. The numerical thresholds below are screening heuristics, not exchange abnormal-trading rules or proof of causality. State the observation window and baseline, account for board, volatility and corporate actions, and use regulatory labels only when an official disclosure supports them.

### Price Move

Any of:

- Limit-up, limit-down, consecutive limit-up/down.
- Daily rise > 5% or fall < -5%.
- Gap up > 3% or gap down < -3%.
- Intraday short-window rise/fall > 5%.
- Post-14:30 swing > 3%.

### Volume Move

Any of:

- Turnover amount > 2x 5-day average.
- Turnover amount < 50% of 5-day average.
- Turnover rate > 10% or > 20%.
- Volume expansion without price progress.
- Shrinking-volume rise or fall.

Compare a completed session with completed sessions, or intraday cumulative turnover with the same elapsed trading time in comparable sessions. Do not call a 10:00 turnover value “shrinking volume” by dividing it by a full-day average, and do not linearly project a full day as observed data. State whether turnover rate uses free float or total shares. Without the matched baseline, volume abnormality is unknown.

### Pattern Move

Includes:

- Failed board, reseal, intraday spike-and-fade, gap-up fade, sky-to-floor, floor-to-sky, long upper/lower shadow, intraday amplitude > 10%.

### Information Move

Includes:

- Announcement, policy, industry event, product-price move, overseas mapping, M&A/restructuring, equity change, or no clear public catalyst.

If no clear public catalyst:

```text
暂未发现明确公开催化，需警惕无公开信息支撑的情绪或交易性异动。不得猜测内幕消息。
```

### No Significant Move

Only when sufficient comparable quote data shows no abnormal-move condition is met, write:

```text
该股近期无显著异动。
```

Then output company overview, sector state, potential catalysts, risks, and follow-up signals. Do not force a move narrative.

If the relevant quote or baseline is missing, instead write “数据不足，暂无法判断是否存在显著异动。”

## Six-Layer Logic Breakdown

### 1. Trigger Layer

Separate:

- Confirmed trigger.
- Market-interpreted trigger.
- Unconfirmed trigger.

Classify freshness:

- New: first public appearance in the current information window.
- Incremental: new data, new order, new policy detail, product-price change, or event progress adds to an existing theme.
- Old-but-repriced: old information becomes relevant because market style, peer movement, or policy context changed.
- Stale repeat: old news is being reused without new information.
- Rumor-only: no public original source found.

For a proposed business catalyst, trace product/customer exposure to revenue, cost, margin or cash flow. Distinguish planned capacity, qualified product, signed order, delivered goods and recognized revenue. Use disclosed exposure and periods; do not multiply headline industry market size by an invented company share. If quantifying an effect, show formula, sourced inputs and labeled assumptions, or leave the magnitude unknown.

### 2. Resonance Layer

Check:

- Individual move vs sector resonance.
- Same-theme stocks moving together.
- Index environment.
- Continuation of yesterday’s strong theme.

Compare matched stock, sector and broad-market return windows. A simple stock-minus-benchmark return is descriptive relative performance, not a causal attribution or risk-adjusted alpha. Test whether the sector move, a company-specific event, or trading/liquidity feedback better fits the timing; explain the strongest alternative and the observation that would distinguish it from the leading hypothesis.

If the stock limit-ups but the sector does not follow:

```text
更可能是个股事件或独立情绪驱动，板块确认度不足。
```

If the sector is strong but the stock is weak:

```text
个股可能存在辨识度不足、基本面瑕疵、已有兑现压力或资金认可度不足。
```

### 3. Price-Volume Behavior Layer

Describe observable facts only:

- Volume expansion, high turnover, limit-up, failed board, reseal, spike-and-fade, gap-up fade, relative sector strength, turnover vs recent average.

Use:

```text
从量价行为看，市场分歧较大 / 承接较强 / 追高意愿减弱。
```

Avoid intent words: 主力吸筹、洗盘、对倒、控盘、资金抢筹、机构建仓.

### 4. Durability Layer

Check:

- One-off vs durable catalyst.
- Follow-up announcements, policy, results, orders, product prices, industry data.
- Theme phase: early, middle, late.
- High-position realization risk.

### 5. Pricing Layer

Check:

- Prior share-price rise.
- Whether same-theme stocks have been fully traded.
- Whether the logic is already consensus.
- Realization risk and expectation gap.

Classify pricing state:

- No observable reaction: sufficiently current, matched data shows no clear response; this does not establish that information is unpriced.
- Initial reaction: first move with limited consensus.
- Partially priced: price has reacted, but sector/peer confirmation is incomplete.
- Consensus/crowded: many peers and narratives already converged.
- Exhaustion risk: high-position acceleration, weak back-row, failed-board feedback, or repeated old catalyst.
- Unknown: missing or stale quote, baseline, or catalyst timing prevents classification. Do not turn this into “not yet traded.”

### 6. Crowding Layer

Check:

- Consecutive acceleration and gap-up pressure.
- Whether front-row strength depends on back-row follow-through.
- Whether capacity names confirm or only small-cap emotional names move.
- Whether weakly related stocks are being pulled into the theme.
- Whether the same catalyst has been traded for multiple sessions without new evidence.

## Expectation-Gap Rules

Only write “存在预期差” when all can be stated:

1. Market consensus: a dated, attributable expectation or clearly labeled proxy for how the market understands the stock/theme. One commentator is not consensus; distinguish an analyst forecast, management guidance and an actual result.
2. Potential new understanding: what public information could change that view.
3. Specific gap: the difference between old and new view.
4. Evidence: announcements, industry news, policy, or performance data.
5. Type: earnings, industry position, policy benefit, valuation, sentiment, or event expectation gap.
6. Pricing state: supported market-reaction classification, or unknown.
7. Whether priced: evidence for and against reflection in price; a small price move does not prove neglect, and a large move does not prove full pricing.

If not clear:

```text
暂无法确认明确预期差。
```

A possible new understanding may still be presented as “待验证的预期差假设,” with the missing consensus/pricing evidence identified. Do not award a precise probability or expectation-gap score without a stated basis.

## Bull/Bear Debate

Cover:

- Bull logic: core reason, needed confirmation, ideal path.
- Bear logic: core concern, contradictory evidence, expected path.
- Current balance: which side is better supported by price-volume behavior, market tape, and sector linkage.
- Key dispute node: next-day after limit-up, gap-up, sector divergence, announcement landing, Dragon-Tiger List, results window, or regulatory attention.

Must include judgment, confidence, confidence reason, and invalidation condition.

Do not invent an equally strong opposing story for balance. State when one side lacks evidence. Assign `H1`, `H2` only to the core hypotheses worth tracking, and connect them to evidence IDs.

## Validation Signals

For each key logic, give up to 3 each:

Choose future windows relative to the analysis cutoff, not already elapsed windows. For each signal, state the observable metric/event, comparison baseline, source to recheck and deadline. Use numeric thresholds only with a sourced baseline or as explicit research assumptions. Reaching a deadline without the required observation means pending, not confirmation or disproof.

Prioritize by workbench timing:

- 09:15-09:25: auction strength,撤单, front-row/back-row matching, and negative feedback.
- 09:25-09:45: gap hold/fade, first pullback support, peer diffusion, failed-board/reseal quality.
- 10:00-11:30: sector breadth, capacity-name confirmation, turnover quality, new branch emergence.
- Afternoon: trend continuation, emotional fatigue, regulatory/announcement updates, and late-session risk.

Interpret auction cancellation or order-book changes only with timestamped observations and the exchange's applicable rules; a single screenshot cannot establish cancellation behavior.

Strong confirmation:

- Gap holds, volume continues to support, stable limit-up seal, fast reseal after failed board, multiple peers rise, back-row follows, same-theme promotion, continued policy/news fermentation, company announcement confirms logic.

Weakening:

- Gap-up fade, gap fill, volume expansion without progress, sector spike-and-fade, no back-row follow, previous strong stocks weaken, failed board without reseal.

Invalidation:

- Break below previous close, break key platform/MA, sector relies on only one stock, catalyst clarified/denied by company, regulatory attention, abnormal-move risk warning, market mainline switches, same-theme core stock weakens.

Apply these to the specific hypothesis: price weakness can invalidate a continuation hypothesis without disproving business exposure. A regulatory inquiry or risk warning requires reading its content; issuance alone does not disprove an order or establish misconduct.

## Hypothesis Follow-Up

Reuse the original ID, statement, cutoff, confidence and predeclared signals. For each, report new evidence, observed result, status (supported / weakened / invalidated / pending), and the next check. Separate missed data, flawed causal reasoning, and changed market conditions. If no original record is available, say “无原始假设记录，仅做事后归因”; do not claim prediction accuracy. A correct price direction with an unsupported cause is not a validated thesis. Do not schedule monitoring unless requested.

## Risk Framework

Output up to 5 concrete risks, preferably at least 2 when supported. Separate observed risk facts, conditional exposures and unchecked areas; do not invent risks to fill a quota or equate an incomplete search with low risk.

Check:

- Price risk: consecutive surges/limit-ups, high position, gap-up realization, valuation overdraw.
- Fundamentals: losses, sharp earnings decline, gross-margin decline, cash-flow deterioration, high debt, goodwill impairment, weak main-business link.
- Regulation: ST/*ST, delisting risk, regulatory letter, inquiry letter, abnormal-move notice, risk warning.
- Shareholder/liquidity: reduction, unlock, high pledge, low average turnover, abnormal turnover, liquidity gaps.
- Sentiment: late-stage theme, crowding, no durable catalyst, sector ebb, previous strong direction negative feedback.
- Research workflow: weak association, stale catalyst reused as fresh news, source-less webpage number, or screenshot-only claim.

## Confidence

High confidence usually needs S/A support, complete quote data, clear sector linkage, clear catalyst, peer confirmation, and strong business relevance.

Medium confidence fits partial data, mainstream interpretation, some sector linkage, but limited announcement confirmation or business relevance still needing verification.

Low confidence fits missing real-time data, no announcement confirmation, concept-label-only logic, sector not following, individual emotional pulse, many missing fields, or unclear catalyst.

Always state reason:

Distinguish confidence in the observed move, its cause, and its continuation. A verified price spike can coexist with low confidence in attribution. High source quality alone does not make a forward outcome highly likely.

```text
置信度：中。原因是行情异动明确，但公告端暂未发现直接催化，板块联动仍需确认。
```
