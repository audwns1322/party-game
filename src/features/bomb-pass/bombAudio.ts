/** Locally synthesized original explosion sound: no downloaded audio or licensing dependency. */
export function playBombExplosion(context: AudioContext) {
  if (context.state === 'suspended') void context.resume().catch(() => undefined);
  const now = context.currentTime;
  const seconds = 0.72;

  const buffer = context.createBuffer(1, Math.ceil(context.sampleRate * seconds), context.sampleRate);
  const channel = buffer.getChannelData(0);
  for (let index = 0; index < channel.length; index++) {
    const decay = Math.pow(1 - index / channel.length, 2.1);
    channel[index] = (Math.random() * 2 - 1) * decay;
  }

  const noise = context.createBufferSource();
  noise.buffer = buffer;
  const filter = context.createBiquadFilter();
  filter.type = 'lowpass';
  filter.frequency.setValueAtTime(1900, now);
  filter.frequency.exponentialRampToValueAtTime(110, now + seconds);
  const noiseGain = context.createGain();
  noiseGain.gain.setValueAtTime(0.0001, now);
  noiseGain.gain.exponentialRampToValueAtTime(0.34, now + 0.012);
  noiseGain.gain.exponentialRampToValueAtTime(0.0001, now + seconds);
  noise.connect(filter).connect(noiseGain).connect(context.destination);
  noise.start(now);
  noise.stop(now + seconds);

  const bass = context.createOscillator();
  bass.type = 'sine';
  bass.frequency.setValueAtTime(148, now);
  bass.frequency.exponentialRampToValueAtTime(38, now + 0.56);
  const bassGain = context.createGain();
  bassGain.gain.setValueAtTime(0.0001, now);
  bassGain.gain.exponentialRampToValueAtTime(0.5, now + 0.016);
  bassGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.6);
  bass.connect(bassGain).connect(context.destination);
  bass.start(now);
  bass.stop(now + 0.6);
}

/** Short, non-musical turn cue, separate from the explosion. */
export function playBombTurn(context: AudioContext) {
  if (context.state !== 'running') return;
  const now=context.currentTime;
  for (const [offset,frequency] of [[0,680],[0.11,980]]) {
    const tone=context.createOscillator();
    const gain=context.createGain();
    tone.type='triangle';tone.frequency.value=frequency;
    gain.gain.setValueAtTime(0.0001,now+offset);
    gain.gain.exponentialRampToValueAtTime(0.13,now+offset+0.015);
    gain.gain.exponentialRampToValueAtTime(0.0001,now+offset+0.09);
    tone.connect(gain).connect(context.destination);tone.start(now+offset);tone.stop(now+offset+0.1);
  }
}
