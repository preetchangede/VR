const KEY = 'sunsmith.settings.v1';

/** Player comfort and accessibility settings (persisted). */
export class Settings {
  /** Caps ignition/supernova flashes (photosensitivity). On by default. */
  reduceFlashes = true;
  musicVolume = 0.8;
  masterVolume = 1;
  subtitles = true;

  constructor() {
    try {
      const raw = localStorage.getItem(KEY);
      if (raw) Object.assign(this, JSON.parse(raw));
    } catch {
      /* ignore */
    }
  }

  save() {
    try {
      localStorage.setItem(
        KEY,
        JSON.stringify({
          reduceFlashes: this.reduceFlashes,
          musicVolume: this.musicVolume,
          masterVolume: this.masterVolume,
          subtitles: this.subtitles,
        }),
      );
    } catch {
      /* ignore */
    }
  }
}
