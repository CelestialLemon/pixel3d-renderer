// URL query parameters shared by the demo pages.
export const params = new URLSearchParams(location.search);

/** Numeric parameter, or `fallback` when missing or not a number. */
export const num = (key: string, fallback: number) => {
  const value = params.get(key);
  return value !== null && value !== '' && Number.isFinite(+value) ? +value : fallback;
};

/** Switch that is on unless the parameter is `0`. */
export const on = (key: string) => params.get(key) !== '0';

export const $ = <T extends HTMLElement>(id: string) => document.getElementById(id) as T;

/** Render settings from `outline|dither|clean|contacts|clouds|glow|vignette=0`. */
export const settingsFromParams = () => ({
  outlines: on('outline'), dither: on('dither'), cleanup: on('clean'), contacts: on('contacts'),
  clouds: on('clouds'), glow: on('glow'), vignette: on('vignette'),
});
