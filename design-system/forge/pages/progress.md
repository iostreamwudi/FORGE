# FORGE Progress Page Override

## Intent

The Progress tab is a conclusion-first mobile progress report, not a dashboard of disconnected charts. The first viewport must answer: “Am I improving, and what evidence supports that?”

## Structure

1. Header: `FORGE · 进展`, title `进展`, muted period pill.
2. Hero conclusion card: one sentence, three supporting metrics.
3. Weight trend: current value, direction, lightweight trend bars, explicit dates.
4. Strength trend: exercise label, current performance, PR semantics.
5. Training execution: weekly completion, volume, PR count, progress track.
6. Coach handoff: ask FORGE to explain the trend.

## Guardrails

- Keep the first conclusion visible before any chart detail.
- Use direct labels and a text summary; color is never the only signal.
- Prefer lightweight native Views over chart libraries for this small local dataset.
- Keep every actionable handoff at least 44pt and provide an accessibility label.
- Use existing black/gray/white + Lime/Mint tokens; no gradients, glow, or glass effects.
- Current values are labeled as local experience data until persistence is connected.
