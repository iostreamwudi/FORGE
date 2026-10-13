# Coach Page Overrides

> **PROJECT:** FORGE
> **Generated:** 2026-09-10
> **Page Type:** Native mobile conversational utility

> Rules in this file override the Master file only where explicitly stated.

## Page-Specific Rules

### Layout Overrides

- **Width:** Native full-width screen with safe-area-aware horizontal gutters; do not impose a desktop max-width.
- **Structure:** Status and context disclosure → chronological conversation → composer.
- **Priority:** The current user question and real service state come before secondary history controls.
- **History:** Preserve server-provided chronological order; show real timestamps and date dividers without inventing dates.

### Spacing Overrides

- **Content Density:** Standard mobile density; use the Master 4/8pt rhythm.
- **Conversation:** Keep message groups visually distinct without excessive decoration or gradients.
- **Composer:** Reserve bottom safe-area space and keep all actions at least 44pt.

### Typography Overrides

- Use the Master type scale. AI status, timestamps, errors, and consent copy must remain readable under Dynamic Type.

### Color Overrides

- Use the Master semantic tokens only. Do not A/B test visual colors in the client without a documented experiment and user consent.
- AI-connected, consent-required, unavailable, loading, and error states must use text plus icon/status treatment; color cannot be the only signal.

### Component Overrides

- AI must be clearly labeled as AI and never presented as a human coach.
- Use vector Ionicons, native Pressable controls, and stable pressed/disabled/loading states.
- Conversation actions (feedback, regenerate, delete) must be secondary to the message content and must not shift layout.
- Destructive history actions require confirmation and a recoverable or clearly irreversible path.
- Empty, unavailable, unauthorized, loading, and provider-failure states must explain the next action; never render sample answers or fake transcripts.

## Page-Specific Components

- Context disclosure card
- Chronological message list with real server history
- Search and history controls
- Consent/error/loading status region
- Composer with send, cancel, and explicitly unavailable voice entry

## Recommendations

- Use typing/loading indicators only for real asynchronous provider work.
- Streaming text may be added only with a real provider streaming contract; until then keep the honest non-streaming state.
- Keep feedback and regenerate actions attached to AI responses.
- Allow users to inspect, search, and delete their real history.
- Validate VoiceOver/TalkBack, Dynamic Type, Reduce Motion, dark-mode contrast, 375px-equivalent small phones, and landscape before release.
