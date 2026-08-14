/**
 * "1 images · 0 folders" is the kind of thing that makes an interface feel
 * unfinished. Counts that are shown to people go through here.
 *
 * The plural form defaults to the singular plus "s"; pass it where English
 * disagrees.
 */
export function count(value: number, singular: string, plural = `${singular}s`): string {
  return `${value} ${value === 1 ? singular : plural}`;
}
