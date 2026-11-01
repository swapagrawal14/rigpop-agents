---
name: rigpop
description: Make short talking-doodle videos (reels, explainers, skits, duets) from a dialogue script. Use when the user asks for an animated video, a reel, a cartoon explainer, characters talking, or a voiced short; renders a 9:16 MP4 with free TTS voices, lip-sync, gestures and word-by-word captions.
---

# Rigpop: talking doodle videos from a script

You write a small Markdown script; `rigpop render` turns it into a finished MP4:
voiced (free Microsoft Edge neural TTS), lip-synced, blinking, gesturing, with
karaoke captions. No API keys, no browser, ffmpeg is bundled.

## Workflow

1. `npx rigpop-agents characters` to see the cast (or `--json`).
2. Write `script.md` (format below). Keep it short: 6 to 12 lines is a 25 to 50 s reel.
3. `npx rigpop-agents check script.md`: fix any errors it prints.
4. Optional look check: `npx rigpop-agents still script.md --at 3 -o peek.png`, then view the PNG.
5. `npx rigpop-agents render script.md -o reel.mp4 --json` and report the `output` path and `duration`.

If TTS fails (no network), retry with `--silent` for a preview and tell the user voices need internet.

## Script format

```markdown
---
title: Doctor's orders          # optional title card at the top
subtitle: Swapnil x Aarav        # optional second line
outro: follow for more           # optional pill shown in the last 1.6 s
background: dots                 # dots | grid | plain | #hexcolor | path/to/image.png
size: 720x1280                   # default 9:16. Use 1280x720 for landscape, 1080x1080 square
music: bgm.mp3                   # optional, looped quietly under voices
music_volume: 0.12
cast:
  S:
    character: doodle-swapnil    # bundled id, a PNG doodle, or a character folder
    name: Swapnil                # caption name tag
    voice: en-IN-NeerjaExpressiveNeural
  A:
    character: aarav
    voice: en-IN-PrabhatNeural
    pitch: +18Hz                 # optional voice tweaks
    rate: +5%
---

S (happy): [wave] Hello Aarav! Did you brush today?
A: Umm... does chewing gum count? [pause 0.4]
S (excited): No! [point] Two minutes, twice a day.
```

Rules:
- One spoken line per row: `KEY: text` or `KEY (mood): text`. KEY must be in `cast`
  (or be a bundled character id, which auto-casts it).
- Moods: neutral, happy, excited, calm, sad, angry, whisper. They change voice pitch/speed and how bouncy the doodle is.
- Gesture tags `[wave] [point] [open] [thumbs]` fire at the word they sit before.
  Characters also gesture on their own on words like hello, tip, great, why.
- `[pause 0.5]` adds silence after the line.
- Lines starting with `#` or `>` are comments.
- 1 speaker is centred; 2 is a duet; 3+ share the stage. The talker is drawn in front.

## Characters

| id | what | gestures |
|---|---|---|
| doodle-swapnil | soft doodle girl in scrubs | wave point open thumbs |
| aarav | soft doodle boy in a hoodie | wave point open thumbs |
| biscuit | doodle tabby cat | wave point open thumbs |
| dr-swapnil | blue-ink comic dentist in scrubs | wave point open thumbs |
| swapnil-classic | original talking head | none |
| mochi | blob, talking head | none |
| froggo | frog, talking head | none |

Custom doodle: set `character: ./my-doodle.png` (it squashes and bounces while talking).
For full lip-sync, make a folder with `character.json` (w, h, patches for A/O/E/blink boxes,
poses list) plus `<name>_base.png`, `<name>_A.png`, `<name>_O.png`, `<name>_E.png`,
`<name>_blink.png`, optional `<name>_pose_wave.png` etc. Rigpop Talk
(https://rigpop-talk.vercel.app) exports this setup from any uploaded drawing.

## Voices

`npx rigpop-agents voices` lists picks. Any Edge neural voice id works, e.g.
`hi-IN-SwaraNeural` for Hindi, `ja-JP-NanamiNeural` for Japanese. Write the dialogue in the voice's language.

## Writing tips

- Hook in line 1, a twist or payoff by the end, a sign-off line.
- 4 to 14 words per line reads best as captions.
- Alternate speakers; vary moods; put a gesture on punchlines.
