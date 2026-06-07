# Transaction Analysis Framework

## Time Context

Before analysis, confirm:

- Current date, weekday, time, A-share trading day status.
- Phase: pre-market 00:00-09:15, auction 09:15-09:25, morning 09:30-11:30, midday 11:30-13:00, afternoon 13:00-15:00, after-hours after 15:00, or non-trading day.
- “Yesterday” means the previous A-share trading day, not the natural day.
- “Today” means the current A-share trading day.
- Information cutoff and whether real-time data was obtained.

## Stock Identity

Confirm:

- Name, code, exchange, board: main board / ChiNext / STAR / Beijing Stock Exchange.
- ST / *ST status, suspension status.
- Price-limit band: 10% / 20% / 30% / 5%.
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

## Abnormal-Move Classification

Classify before explaining.

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

If no abnormal-move condition is met, write:

```text
该股近期无显著异动。
```

Then output company overview, sector state, potential catalysts, risks, and follow-up signals. Do not force a move narrative.

## Five-Layer Logic Breakdown

### 1. Trigger Layer

Separate:

- Confirmed trigger.
- Market-interpreted trigger.
- Unconfirmed trigger.

### 2. Resonance Layer

Check:

- Individual move vs sector resonance.
- Same-theme stocks moving together.
- Index environment.
- Continuation of yesterday’s strong theme.

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

## Expectation-Gap Rules

Only write “存在预期差” when all can be stated:

1. Market consensus: how the market currently understands the stock/theme.
2. Potential new understanding: what public information could change that view.
3. Specific gap: the difference between old and new view.
4. Evidence: announcements, industry news, policy, or performance data.
5. Type: earnings, industry position, policy benefit, valuation, sentiment, or event expectation gap.
6. Whether priced: whether share price has already reflected it.

If not clear:

```text
暂无法确认明确预期差。
```

## Bull/Bear Debate

Cover:

- Bull logic: core reason, needed confirmation, ideal path.
- Bear logic: core concern, exit reason, expected path.
- Current balance: which side is better supported by price-volume behavior, market tape, and sector linkage.
- Key dispute node: next-day after limit-up, gap-up, sector divergence, announcement landing, Dragon-Tiger List, results window, or regulatory attention.

Must include judgment, confidence, confidence reason, and invalidation condition.

## Validation Signals

For each key logic, give up to 3 each:

Strong confirmation:

- Gap holds, volume continues to support, stable limit-up seal, fast reseal after failed board, multiple peers rise, back-row follows, same-theme promotion, continued policy/news fermentation, company announcement confirms logic.

Weakening:

- Gap-up fade, gap fill, volume expansion without progress, sector spike-and-fade, no back-row follow, previous strong stocks weaken, failed board without reseal.

Invalidation:

- Break below previous close, break key platform/MA, sector relies on only one stock, catalyst clarified/denied by company, regulatory attention, abnormal-move risk warning, market mainline switches, same-theme core stock weakens.

## Risk Framework

Output at least 2 concrete risks, up to 5.

Check:

- Price risk: consecutive surges/limit-ups, high position, gap-up realization, valuation overdraw.
- Fundamentals: losses, sharp earnings decline, gross-margin decline, cash-flow deterioration, high debt, goodwill impairment, weak main-business link.
- Regulation: ST/*ST, delisting risk, regulatory letter, inquiry letter, abnormal-move notice, risk warning.
- Shareholder/liquidity: reduction, unlock, high pledge, low average turnover, abnormal turnover, liquidity gaps.
- Sentiment: late-stage theme, crowding, no durable catalyst, sector ebb, previous strong direction negative feedback.

## Confidence

High confidence usually needs S/A support, complete quote data, clear sector linkage, clear catalyst, peer confirmation, and strong business relevance.

Medium confidence fits partial data, mainstream interpretation, some sector linkage, but limited announcement confirmation or business relevance still needing verification.

Low confidence fits missing real-time data, no announcement confirmation, concept-label-only logic, sector not following, individual emotional pulse, many missing fields, or unclear catalyst.

Always state reason:

```text
置信度：中。原因是行情异动明确，但公告端暂未发现直接催化，板块联动仍需确认。
```
