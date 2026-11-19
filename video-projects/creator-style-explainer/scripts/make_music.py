"""Synthesise an original, royalty-free music bed for the explainer.

100 BPM, Am7 - Fmaj7 - Cmaj7 - G6 loop: soft kick on every beat, off-beat hats,
a ducked pad, a plucked bass and an eighth-note arpeggio. Only numpy is used,
so the result has no third-party samples or licences attached.

Usage: python scripts/make_music.py <seconds> <out.wav>
"""
import sys
import wave

import numpy as np

SR = 48000
BPM = 100
BEAT = 60 / BPM
BAR = BEAT * 4

# MIDI notes per chord (pad voicing), bass root and arpeggio notes.
CHORDS = [
    ([57, 60, 64, 67], 45, [69, 72, 76, 79]),  # Am7
    ([53, 57, 60, 64], 41, [65, 69, 72, 76]),  # Fmaj7
    ([48, 52, 55, 59], 48, [67, 71, 72, 76]),  # Cmaj7
    ([55, 59, 62, 64], 43, [67, 71, 74, 76]),  # G6
]


def hz(m):
    return 440.0 * 2 ** ((m - 69) / 12)


def lowpass(x, cutoff):
    """One-pole low-pass filter."""
    a = np.exp(-2 * np.pi * cutoff / SR)
    y = np.empty_like(x)
    acc = 0.0
    for i, v in enumerate(x):
        acc = (1 - a) * v + a * acc
        y[i] = acc
    return y


def main(seconds, out):
    n = int(seconds * SR)
    t = np.arange(n) / SR
    mix = np.zeros(n)
    rng = np.random.default_rng(7)

    # Kick on every beat + a duck envelope for the pad.
    duck = np.ones(n)
    kick_len = int(0.35 * SR)
    kt = np.arange(kick_len) / SR
    kick = np.sin(2 * np.pi * (45 * kt + (110 / 18) * (1 - np.exp(-18 * kt)))) * np.exp(-9 * kt)
    beat = 0
    while beat * BEAT < seconds:
        s = int(beat * BEAT * SR)
        e = min(n, s + kick_len)
        mix[s:e] += 0.55 * kick[: e - s]
        d = 1 - 0.55 * np.exp(-np.arange(e - s) / SR * 7)
        duck[s:e] = np.minimum(duck[s:e], d)
        beat += 1

    # Off-beat hats: short high-passed noise bursts.
    hat_len = int(0.06 * SR)
    for k in range(int(seconds / BEAT) + 1):
        s = int((k + 0.5) * BEAT * SR)
        if s >= n:
            break
        e = min(n, s + hat_len)
        noise = rng.standard_normal(e - s)
        noise = noise - lowpass(noise, 6000)
        mix[s:e] += 0.10 * noise * np.exp(-np.arange(e - s) / SR * 60)

    pad = np.zeros(n)
    bass = np.zeros(n)
    arp = np.zeros(n)
    bar = 0
    while bar * BAR < seconds:
        notes, root, arp_notes = CHORDS[bar % 4]
        s = int(bar * BAR * SR)
        e = min(n, int((bar + 1) * BAR * SR) + int(0.3 * SR))
        seg = t[s:e] - t[s]
        env = np.minimum(1, seg / 0.25) * np.minimum(1, (seg[-1] - seg + 1e-9) / 0.3)
        for m in notes:
            f = hz(m)
            pad[s:e] += env * (np.sin(2 * np.pi * f * seg) + 0.5 * np.sin(2 * np.pi * f * 1.004 * seg)) / 6
        for b in range(4):  # bass pluck on each beat
            bs = s + int(b * BEAT * SR)
            be = min(n, bs + int(BEAT * SR))
            bt = np.arange(be - bs) / SR
            bass[bs:be] += np.sin(2 * np.pi * hz(root) * bt) * np.exp(-4 * bt) * 0.5
        for q in range(8):  # eighth-note arpeggio
            a_s = s + int(q * BEAT / 2 * SR)
            a_e = min(n, a_s + int(0.4 * SR))
            at = np.arange(a_e - a_s) / SR
            f = hz(arp_notes[[0, 1, 2, 3, 2, 1, 2, 3][q]])
            tone = np.sin(2 * np.pi * f * at) + 0.3 * np.sin(4 * np.pi * f * at)
            arp[a_s:a_e] += tone * np.exp(-7 * at) * 0.16
        bar += 1

    pad = lowpass(pad, 1800) * duck
    mix += 0.55 * pad + 0.6 * lowpass(bass, 400) + arp

    # Fade in fast (hook), fade out over the last 2.5 s.
    fade = np.minimum(1, t / 0.15) * np.clip((seconds - t) / 2.5, 0, 1)
    mix *= fade
    mix /= np.max(np.abs(mix)) + 1e-9
    mix *= 0.8

    pcm = (np.stack([mix, mix], axis=1) * 32767).astype(np.int16)
    with wave.open(out, "wb") as w:
        w.setnchannels(2)
        w.setsampwidth(2)
        w.setframerate(SR)
        w.writeframes(pcm.tobytes())
    print(f"wrote {out} ({seconds:.2f}s)")


if __name__ == "__main__":
    main(float(sys.argv[1]), sys.argv[2])
