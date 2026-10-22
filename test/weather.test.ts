import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_WEATHER, type Weather } from 'pixel3d-renderer';
import { CloudDrift, cloudEdges, hazeUniform, mergeWeather, precipitationUniform } from '../src/renderer/weather.ts';

test('the default weather is no rain, the old clouds, the old gusts and no haze, and is frozen', () => {
  assert.deepEqual({ ...DEFAULT_WEATHER }, { precipitation: 'none', intensity: 0.5, cloudCover: 0.2, cloudSpeed: 1, wind: 0, gusts: 1, haze: 0, hazeColor: 0xcfd6d8, hazeTop: 4 });
  assert.ok(Object.isFrozen(DEFAULT_WEATHER));
});

test('mergeWeather applies the given fields and rejects anything out of range without changing anything', () => {
  const w = mergeWeather(DEFAULT_WEATHER, { precipitation: 'snow', intensity: 1, wind: 3, cloudSpeed: 0, intensity2: 5 } as Partial<Weather>);
  assert.deepEqual(w, { ...DEFAULT_WEATHER, precipitation: 'snow', intensity: 1, wind: 3, cloudSpeed: 0 });
  assert.deepEqual(mergeWeather(w, { gusts: undefined }), w);
  for (const bad of [{ intensity: -0.01 }, { intensity: 1.01 }, { cloudCover: Number.NaN }, { cloudSpeed: 10.5 }, { wind: -1 },
    { gusts: 3.01 }, { gusts: Number.POSITIVE_INFINITY }, { wind: '1' }, { precipitation: 'hail' }, { precipitation: null }]) {
    assert.throws(() => mergeWeather(w, bad as Partial<Weather>), RangeError, JSON.stringify(bad));
  }
  assert.throws(() => mergeWeather(w, { intensity: 0.5, wind: 9 }), RangeError);
  for (const bad of [{ haze: -0.1 }, { haze: 1.1 }, { haze: Number.NaN }, { hazeTop: 1001 }, { hazeTop: Number.NaN }, { hazeColor: -1 },
    { hazeColor: 0x1000000 }, { hazeColor: 0.5 }, { hazeColor: '#ffffff' }, { hazeColor: Number.NaN }]) {
    assert.throws(() => mergeWeather(w, bad as Partial<Weather>), RangeError, JSON.stringify(bad));
  }
  assert.equal(w.intensity, 1);   // the input is never changed
});

test('cloud cover maps to the old threshold at the default and spans clear to overcast', () => {
  assert.deepEqual(cloudEdges(0.2).map(Math.fround), [Math.fround(0.6), Math.fround(0.66)]);
  assert.ok(cloudEdges(0)[0] > 0.98, 'clear: the shadow starts above the field maximum');
  assert.ok(cloudEdges(1)[1] < 0.01, 'overcast: the shadow is full below the field minimum');
  let last = Infinity;
  for (let c = 0; c <= 1.0001; c += 0.01) {
    const [lo, hi] = cloudEdges(Math.min(c, 1));
    assert.ok(lo < last, `the threshold falls as cover rises (${c})`);
    assert.ok(Math.abs(hi - lo - 0.06) < 1e-12);
    last = lo;
  }
});

test('the cloud drift is time x speed, and a change of speed never moves the clouds', () => {
  const d = new CloudDrift();
  assert.deepEqual(d.at(8), [Math.fround(8) * Math.fround(0.028), Math.fround(8) * Math.fround(0.011)]);
  const before = d.at(100);
  d.setSpeed(4);
  assert.deepEqual(d.at(100), before);
  const after = d.at(110);
  assert.ok(Math.abs(after[0] - (before[0] + 10 * 4 * 0.028)) < 1e-9 && Math.abs(after[1] - (before[1] + 10 * 4 * 0.011)) < 1e-9);
  d.setSpeed(0);
  assert.deepEqual(d.at(500), d.at(110));
  const late = new CloudDrift(2);
  assert.ok(Math.abs(late.at(10)[0] - 10 * 2 * 0.028) < 1e-12);
});

test('the precipitation uniform: kind, intensity and a wind slant that follows the camera', () => {
  assert.equal(precipitationUniform(DEFAULT_WEATHER, 1, 0)[0], 0);
  const rain = { ...DEFAULT_WEATHER, precipitation: 'rain' as const, intensity: 0.7 };
  assert.deepEqual(precipitationUniform(rain, 1, 0).slice(0, 2), [1, 0.7]);
  assert.equal(precipitationUniform({ ...rain, intensity: 0 }, 1, 0)[0], 0, 'nothing falls at intensity 0');
  assert.equal(precipitationUniform({ ...rain, precipitation: 'snow' }, 1, 0)[0], 2);
  const right = precipitationUniform(rain, 1, 0)[2], left = precipitationUniform(rain, -1, 0)[2];
  assert.ok(right > 0 && Math.abs(left + right) < 1e-12, 'the slant flips with the camera');
  assert.ok(precipitationUniform({ ...rain, wind: 3 }, 1, 0)[2] > right, 'more wind, more slant');
  assert.ok(Math.abs(precipitationUniform({ ...rain, precipitation: 'snow', wind: 3, gusts: 3 }, 1, 0)[2]) <= 1.5);
});

test('the haze is set with its colour and height, and packs for the shaders', () => {
  const w = mergeWeather(DEFAULT_WEATHER, { haze: 0.6, hazeColor: 0xc49a62, hazeTop: 2.5 });
  assert.deepEqual([w.haze, w.hazeColor, w.hazeTop], [0.6, 0xc49a62, 2.5]);
  assert.deepEqual(hazeUniform(w), [0.6, 2.5]);
  assert.equal(mergeWeather(w, { hazeColor: 0 }).hazeColor, 0, 'black is a colour');
  assert.equal(hazeUniform(DEFAULT_WEATHER)[0], 0, 'no haze by default');
});
