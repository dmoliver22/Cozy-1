// Cat Jar (starter): drop squishy cats into a glass jar. Replaced by the full
// prototype; kept tiny so the page, the build and the kit can be checked.
import '@fontsource/baloo-2/latin-700.css';
import '@fontsource/baloo-2/latin-800.css';
import '@fontsource/nunito/latin-700.css';
import '../proto.css';
import { AudioEngine } from '../../audio/audio';
import { BASE_BREEDS } from '../../physics/breeds';
import { capsule, roundedBox } from '../../physics/shapes';
import { SoftBody } from '../../physics/softbody';
import { World } from '../../physics/world';
import { CatPainter, Lerp, Loop, bindPointer, makeStage, unlockAudioOnGesture } from '../kit';

const W = 380;
const H = 680;
const world = new World();
const cats: SoftBody[] = [];
const painter = new CatPainter();
const lerp = new Lerp();
const audio = new AudioEngine();
unlockAudioOnGesture(audio);

// the jar: a floor and two walls
world.addStatic(roundedBox(40, 600, 300, 16, 6, { material: 'glass' }));
world.addStatic(capsule(48, 300, 48, 604, 6, { material: 'glass' }));
world.addStatic(capsule(332, 300, 332, 604, 6, { material: 'glass' }));

const stage = makeStage(document.getElementById('game') as HTMLCanvasElement);
const view = (): { s: number; ox: number; oy: number } => {
  const s = Math.min(stage.w / W, stage.h / H);
  return { s, ox: (stage.w - W * s) / 2, oy: (stage.h - H * s) / 2 };
};

let n = 0;
bindPointer(stage.canvas, {
  up(x) {
    const v = view();
    const wx = Math.max(80, Math.min(300, (x - v.ox) / v.s));
    const b = world.addBody(new SoftBody(BASE_BREEDS[n++ % BASE_BREEDS.length], wx, 160));
    cats.push(b);
    audio.click();
  },
});

new Loop(
  () => {
    lerp.remember(cats);
    world.step();
  },
  (alpha, dt) => {
    const { ctx } = stage;
    stage.screen();
    ctx.fillStyle = '#efe0c8';
    ctx.fillRect(0, 0, stage.w, stage.h);
    const v = view();
    stage.world(v.s, v.ox, v.oy);
    ctx.strokeStyle = 'rgba(120,170,200,0.8)';
    ctx.lineWidth = 12;
    ctx.lineCap = 'round';
    ctx.beginPath();
    ctx.moveTo(48, 300);
    ctx.lineTo(48, 604);
    ctx.lineTo(332, 604);
    ctx.lineTo(332, 300);
    ctx.stroke();
    painter.tick(dt);
    lerp.begin(cats, alpha);
    for (const b of cats) painter.draw(ctx, b);
    lerp.end();
  },
).start();

(window as unknown as { __jar: unknown }).__jar = { world, cats };
