import assert from 'node:assert/strict';
import { test } from 'node:test';
import { DEFAULT_DAY_CYCLE, dayCycle, hourLabel, lookAt, nearestPreset, PRESETS, type LookKey } from 'pixel3d-renderer';

const noon = DEFAULT_DAY_CYCLE.keys.find((k) => k.hour === 12)!;

test('the default cycle hits its keys exactly and wraps around the clock', () => {
  const l = lookAt(12);
  assert.equal(l.sunAz, 0); assert.equal(l.sunEl, 60); assert.equal(l.lampOn, 0); assert.equal(l.night, 0);
  assert.deepEqual(lookAt(36), l);
  assert.deepEqual(lookAt(-12), l);
  assert.equal(lookAt(24).hour, 0);
  assert.equal(lookAt(0).night, 1);
});

test('the default presets and labels', () => {
  assert.deepEqual(PRESETS, { Morning: 8, Noon: 12, 'Golden hour': 17.5, Dusk: 19.5, Night: 22 });
  assert.equal(nearestPreset(11), 'Noon');
  assert.equal(nearestPreset(1), 'Night', 'distance wraps through midnight');
  assert.equal(hourLabel(17.5), '17:30');
});

test('a custom cycle with keys at any hours interpolates smoothly through midnight', () => {
  const day: LookKey = { ...noon, hour: 8, sunAz: 60 }, night: LookKey = { ...noon, hour: 20, sunAz: -60 };
  const c = dayCycle([day, night], { Dawn: 6, Midnight: 0 });
  assert.equal(c.lookAt(8).sunAz, 60);
  assert.equal(c.lookAt(20).sunAz, -60);
  assert.equal(c.lookAt(2).sunAz, 0, 'midway from 20:00 to 08:00');
  assert.ok(Math.abs(c.lookAt(23.999).sunAz - c.lookAt(0).sunAz) < 0.05);
  assert.equal(c.nearestPreset(23.5), 'Midnight');
  assert.deepEqual({ ...dayCycle([noon]).lookAt(3), hour: 0 }, { ...dayCycle([noon]).lookAt(15), hour: 0 }, 'one key is a fixed look');
});

test('a cycle owns its keys', () => {
  const key: LookKey = { ...noon, litTint: [0.01, 0.02] }, c = dayCycle([key]);
  key.sunEl = 5; key.litTint[0] = 1;
  assert.equal(c.lookAt(12).sunEl, 60);
  assert.equal(c.lookAt(12).litTint[0], 0.01);
});

test('rejects keys and presets outside the day or out of order', () => {
  assert.throws(() => dayCycle([]));
  assert.throws(() => dayCycle([{ ...noon, hour: 25 }]));
  assert.throws(() => dayCycle([{ ...noon, hour: 12 }, { ...noon, hour: 12 }]));
  assert.throws(() => dayCycle([{ ...noon, hour: 12 }, { ...noon, hour: 6 }]));
  assert.throws(() => dayCycle([noon], { Late: 30 }));
});
