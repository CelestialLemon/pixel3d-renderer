import * as THREE from 'three';
import { hourLabel, lookAt, PixelRenderer, quantizePalette, type PixelObject } from 'pixel3d-renderer';
import { buildLevel } from './level';
import { buildModels, ITEMS, type Item } from './models';

// A minimal game on the renderer: walk around a garden with the keyboard and click to place things. The game owns the
// loop, the clock, input, collision and every object's position; each frame it tells the renderer where things are and
// asks it to draw. Everything comes from the package's public API.

const PIXEL = 3;                    // screen pixels per art pixel
const VIEW_HEIGHT = 11;             // metres of world the screen shows top to bottom
const ELEVATION = THREE.MathUtils.degToRad(35);
const SPEED = 2.6;                  // metres per second
const RADIUS = 0.25;                // the walker's footprint, for collision
const HOURS_PER_SECOND = 1 / 8;     // the day passes in three minutes

const canvas = document.querySelector<HTMLCanvasElement>('#view')!;
const hud = { clock: document.querySelector('#clock')!, item: document.querySelector('#item')!, count: document.querySelector('#count')! };

// ---- Build the world once: level geometry and object models share one palette. ----
const level = buildLevel(), models = buildModels();
const { scene } = level;
const all = [...level.geometries, models.body, models.leg, models.cursor, ...Object.values(models.items)];
quantizePalette(all, 64);

const renderer = new PixelRenderer(canvas, scene, { shadowMapSize: 2048 });   // a small level needs no 4096² shadow map

// ---- Game state ----
const player = {
  position: level.start.clone(), facing: 0, stride: 0,
  body: renderer.addObject(models.body), legs: [renderer.addObject(models.leg), renderer.addObject(models.leg)],
};
const cursor = renderer.addObject(models.cursor);
cursor.visible = false;
/** Placed things by tile key ("col,row"). */
const placed = new Map<string, { item: Item; object: PixelObject }>();
let item: Item = 'crate', hour = 17, cameraAz = THREE.MathUtils.degToRad(30), targetAz = cameraAz;
const tileKey = (col: number, row: number) => `${col},${row}`;
const blocked = (x: number, z: number) => {
  for (const [dx, dz] of [[-1, -1], [1, -1], [-1, 1], [1, 1]]) {
    const col = Math.floor(x + dx * RADIUS), row = Math.floor(z + dz * RADIUS);
    if (level.solid(col, row) || placed.has(tileKey(col, row))) return true;
  }
  return false;
};

// ---- Input ----
const keys = new Set<string>();
addEventListener('keydown', (e) => {
  keys.add(e.code);
  if (e.code === 'KeyQ') targetAz -= Math.PI / 4;
  if (e.code === 'KeyE') targetAz += Math.PI / 4;
  const n = ['Digit1', 'Digit2', 'Digit3'].indexOf(e.code);
  if (n >= 0) item = ITEMS[n];
  if (e.code === 'KeyT') hour = (hour + 3) % 24;
});
addEventListener('keyup', (e) => keys.delete(e.code));
addEventListener('blur', () => keys.clear());

// What the pointer is over: the renderer knows which art pixel shows what (PixelRenderer.pick).
let pointer: { x: number; y: number } | null = null, hoverTile: { col: number; row: number } | null = null;
canvas.addEventListener('pointermove', (e) => { pointer = { x: e.clientX, y: e.clientY }; });
canvas.addEventListener('pointerleave', () => { pointer = null; });
canvas.addEventListener('pointerdown', (e) => {
  const hit = renderer.pick(e.clientX, e.clientY);
  if (!hit?.world) return;
  // Clicking a placed thing takes it away again.
  for (const [key, p] of placed) if (p.object === hit.object) { p.object.remove(); placed.delete(key); updateHud(); return; }
  const tile = tileUnder(hit.world, hit.normal!, hit.object);
  if (!tile) return;
  const key = tileKey(tile.col, tile.row), onPlayer = Math.floor(player.position.x) === tile.col && Math.floor(player.position.z) === tile.row;
  if (placed.has(key) || onPlayer) return;
  const object = renderer.addObject(models.items[item]);
  object.setTransform(new THREE.Vector3(tile.col + 0.5, 0, tile.row + 0.5), new THREE.Euler(0, (tile.col * 7 + tile.row * 3) % 4 * 0.2 - 0.3, 0));
  placed.set(key, { item, object });
  updateHud();
});

/** The free ground tile at a picked point, if it is one: the top of grass or path, or the cursor lying on it. */
function tileUnder(world: THREE.Vector3, normal: THREE.Vector3, object: PixelObject | null) {
  if (object && object !== cursor) return null;
  if (normal.y < 0.7 || Math.abs(world.y) > 0.05) return null;
  const col = Math.floor(world.x), row = Math.floor(world.z);
  return level.solid(col, row) ? null : { col, row };
}

function updateHud() {
  hud.item.textContent = item;
  hud.count.textContent = String(placed.size);
}

// ---- Loop ----
function fit() {
  const w = Math.max(1, Math.ceil(innerWidth / PIXEL)), h = Math.max(1, Math.ceil(innerHeight / PIXEL));
  if (renderer.width !== w || renderer.height !== h) renderer.resize(w, h);
  canvas.style.width = `${w * PIXEL}px`; canvas.style.height = `${h * PIXEL}px`;
}
addEventListener('resize', fit);
fit();

const forward = new THREE.Vector3(), right = new THREE.Vector3(), move = new THREE.Vector3(), euler = new THREE.Euler();
let last = performance.now(), time = 0, lookHour = Number.NaN;

function frame(now: number) {
  const dt = Math.min((now - last) / 1000, 0.1);
  last = now; time += dt;

  // The camera turns in 45° steps, eased; walking is relative to where it looks.
  cameraAz += (targetAz - cameraAz) * Math.min(1, dt * 10);
  forward.set(-Math.sin(cameraAz), 0, -Math.cos(cameraAz));
  right.set(-forward.z, 0, forward.x);
  move.set(0, 0, 0);
  if (keys.has('KeyW') || keys.has('ArrowUp')) move.add(forward);
  if (keys.has('KeyS') || keys.has('ArrowDown')) move.sub(forward);
  if (keys.has('KeyD') || keys.has('ArrowRight')) move.add(right);
  if (keys.has('KeyA') || keys.has('ArrowLeft')) move.sub(right);
  const walking = move.lengthSq() > 0;
  if (walking) {
    move.normalize().multiplyScalar(SPEED * dt);
    const p = player.position;
    if (!blocked(p.x + move.x, p.z)) p.x += move.x;   // one axis at a time, so the walker slides along walls
    if (!blocked(p.x, p.z + move.z)) p.z += move.z;
    player.facing = Math.atan2(move.x, move.z);
    player.stride += dt * 9;
  } else player.stride = 0;

  // Pose the walker: a little bob and swinging legs while walking.
  const swing = Math.sin(player.stride) * 0.6, bob = walking ? Math.abs(Math.cos(player.stride)) * 0.04 : 0;
  const at = player.position.clone().setY(bob);
  player.body.setTransform(at, euler.set(0, player.facing, 0));
  player.legs.forEach((leg, i) => {
    const side = (i ? 1 : -1) * 0.09;
    const hip = new THREE.Vector3(Math.cos(player.facing) * side, 0.45, -Math.sin(player.facing) * side).add(at);
    leg.setTransform(hip, euler.set(i ? swing : -swing, player.facing, 0, 'YXZ'));
  });

  // The clock: the look only changes when the hour has moved a little, since a new sun redraws the shadow map.
  hour = (hour + dt * HOURS_PER_SECOND) % 24;
  if (!(Math.abs(hour - lookHour) < 0.02)) { renderer.setLook(lookAt(hour)); lookHour = hour; }
  hud.clock.textContent = hourLabel(hour);

  // Draw. The pick for the hover cursor reads last frame's image, which is what the player is looking at.
  if (pointer) {
    const hit = renderer.pick(pointer.x, pointer.y);
    hoverTile = hit?.world ? tileUnder(hit.world, hit.normal!, hit.object) : null;
  } else hoverTile = null;
  cursor.visible = !!hoverTile && !placed.has(tileKey(hoverTile.col, hoverTile.row));
  if (hoverTile) cursor.setTransform(new THREE.Vector3(hoverTile.col + 0.5, 0.005, hoverTile.row + 0.5));

  renderer.placeCamera(player.position.clone().setY(0.6), cameraAz, ELEVATION, VIEW_HEIGHT);
  renderer.renderGeometry(time);
  renderer.renderStyle(time);
  requestAnimationFrame(frame);
}
updateHud();
requestAnimationFrame(frame);

// For the smoke check (tools/example-check.ts): read-only views of the game state.
Object.assign(window, { walker: { player, placed, renderer } });
