// URL query parameters shared by the demo pages.
export const params = new URLSearchParams(location.search);

/** Numeric parameter, or `fallback` when missing or not a number. */
export const num = (key: string, fallback: number) => {
  const value = params.get(key);
  return value !== null && value !== '' && Number.isFinite(+value) ? +value : fallback;
};

/** Palette size parameter: a whole number of at least 1, or `fallback` (the quantizer rejects anything else). */
export const paletteSize = (key: string, fallback: number) => {
  const value = num(key, fallback);
  return Number.isInteger(value) && value >= 1 ? value : fallback;
};

/** Switch that is on unless the parameter is `0`. */
export const on = (key: string) => params.get(key) !== '0';

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Render settings from `outline|dither|clean|contacts|clouds|glow|vignette=0`. */
export const settingsFromParams = () => ({
  outlines: on('outline'), dither: on('dither'), cleanup: on('clean'), contacts: on('contacts'),
  clouds: on('clouds'), glow: on('glow'), vignette: on('vignette'),
});
