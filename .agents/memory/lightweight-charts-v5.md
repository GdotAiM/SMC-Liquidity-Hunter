---
name: Lightweight Charts v5 API
description: Breaking API changes in lightweight-charts v5 vs v4 — series creation and markers.
---

## Installed version
`lightweight-charts@5.2.0` (pnpm, in artifacts/liquidity-hunter)

## Breaking changes from v4 → v5

### Series creation
```ts
// v4 (BROKEN in v5)
const series = chart.addCandlestickSeries({ upColor: '...' });

// v5 (CORRECT)
import { CandlestickSeries } from 'lightweight-charts';
const series = chart.addSeries(CandlestickSeries, { upColor: '...' });
```

### Markers
```ts
// v4 (BROKEN in v5)
series.setMarkers(markers);

// v5 (CORRECT)
import { createSeriesMarkers } from 'lightweight-charts';
createSeriesMarkers(series, markers);
```

### What DID NOT change
- `createChart(container, options)` — unchanged
- `ColorType`, `LineStyle`, `CrosshairMode` — unchanged
- `series.createPriceLine(options)` — unchanged
- `series.priceToCoordinate(price)` — unchanged
- `chart.timeScale().timeToCoordinate(time)` — unchanged
- `chart.timeScale().subscribeVisibleTimeRangeChange(cb)` — unchanged
- `series.setData(data)` — unchanged

**Why:** v5 introduced a plugin-based series architecture where series types are first-class exported definitions rather than chart methods. This allows custom series types to follow the same API.

**How to apply:** Any time you use lightweight-charts in this project, import the series definition (e.g. `CandlestickSeries`, `LineSeries`) and call `chart.addSeries(definition, options)`. Never use `chart.addCandlestickSeries()` etc.
