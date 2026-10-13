# Phase 1 walkthrough video

The 2-minute narrated walkthrough Kevin gets with the roadmap: where the
platform stands today, what Phase 1 adds, and the road to finished. It is
built from code so it can be re-rendered whenever the roadmap changes.

- `walkthrough.src.html`: the eight scenes and every animation, keyed to
  timeline seconds. Same palette, type and layouts as the Figma storyboard
  (Figma file `G2GV4D1qKxbGMPnJtQu3jC`).
- `logo-dark-bg.svg`: inlined into the page at render time.
- `render.mjs`: renders 1920×1080 frames at 30 fps with Playwright and
  encodes them with ffmpeg, adding the narration track if one is given.

```
node scripts/video/render.mjs video-out narration.wav
```

## Narration

Voice: ElevenLabs "Nora" via Higgsfield (`text2speech_v2`), the same voice as
the Matt Penner video. Each line was trimmed of leading/trailing silence and
sped up 6%, then placed at its scene start (seconds): 0.50, 9.26, 31.20,
51.20, 75.11, 94.31, 108.17, 124.79. Total length 132.13 s, loudness
normalized to −16 LUFS.

1. Kevin, this is your Sleep Outcomes Platform: where it stands today, and the road from here to finished.
2. Today, it's a working prototype. Thirty screens. Two thousand realistic test patients. Three hundred twenty automated tests, and three outside AI code audits. But it runs on one laptop, every patient is made up, and the wearable data is simulated.
3. Phase One changes that. We call it Live and Real. You and your staff sign in from your own phones. Staff testers scan a code at the front desk, consent, and connect their Garmin. Then every night, their sleep syncs on its own.
4. Phase One also makes it smart. Ask a question in plain English, and get a chart and a straight answer. Ask it out loud, from the Claude app on your phone. And each night, an AI research coordinator checks the data, flags gaps, writes coach notes, and sends you a Monday update.
5. And it stays trustworthy. Revoke consent, and syncing stops, the data is purged, and a certificate is issued. A data-quality scorecard keeps every night research-grade, and your dashboard shows every phase, live.
6. Phase One uses test data and staff testers only. No patient data until Phase Two, and every addition is shown working before Phase One closes.
7. From there, Phase Two brings real patients under HIPAA. Phase Three opens the Mattress Hub door and the positional sleep study. And Phase Four turns the data into research and revenue.
8. One question for you, Kevin: what does success look like, in your words?

Line 3 is sent to the voice as "We call it Lyve and Real": spelled "Live", the
voice reads it as the verb (rhymes with "give"). In the final cut, only that
sentence was re-recorded and spliced into the original line at the pauses on
either side, so every later word keeps its timing.

Every on-screen beat lands about 0.2 s before the word it illustrates; the
beat times were set from a word-level transcript of the final narration.
Charts in the video are labeled as illustrations with made-up numbers; the phone sleep card and the deletion certificate are labeled as samples.
