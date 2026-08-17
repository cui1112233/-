export function playTaskSound(kind, enabled = true, volume = 60) {
  const normalizedVolume = Number.isFinite(Number(volume)) ? Math.min(100, Math.max(0, Math.round(Number(volume)))) : 60;
  if (!enabled || normalizedVolume === 0) return;

  try {
    const AudioContextClass = globalThis.AudioContext || globalThis.webkitAudioContext;
    if (!AudioContextClass) return;

    const context = new AudioContextClass();
    const frequencies = kind === 'success' ? [660, 880] : [440, 300];
    frequencies.forEach((frequency, index) => {
      const startTime = context.currentTime + index * 0.12;
      const oscillator = context.createOscillator();
      const gain = context.createGain();
      oscillator.frequency.setValueAtTime(frequency, startTime);
      gain.gain.setValueAtTime(0.12 * normalizedVolume / 100, startTime);
      gain.gain.exponentialRampToValueAtTime(0.01, startTime + 0.1);
      oscillator.connect(gain);
      gain.connect(context.destination);
      oscillator.start(startTime);
      oscillator.stop(startTime + 0.1);
    });
  } catch {
    // Web Audio is optional; blocked or unavailable audio must remain silent.
  }
}
