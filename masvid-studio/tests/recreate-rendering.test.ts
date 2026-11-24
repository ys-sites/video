import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';

test('recreation helpers preserve source pixels, sprite detail and seekable state', async t => {
  const executablePath = await browserExecutable().catch(() => undefined);
  if (!executablePath) return t.skip('Chrome is required for recreation rendering checks');
  const browser = await puppeteer.launch({ executablePath, headless: true });
  t.after(() => browser.close());
  const page = await browser.newPage();
  await page.setContent('<!doctype html><html><body></body></html>');
  await page.addScriptTag({ content: await readFile(new URL('../skills/openmotion-recreate/assets/reconstruction.js', import.meta.url), 'utf8') });

  await t.test('complete glyph texture moves through its mask with exact scale and crop offsets', async () => {
    const result = await page.evaluate(() => {
      const atlas = document.createElement('canvas');
      atlas.width = 64; atlas.height = 96;
      const ink = atlas.getContext('2d')!;
      ink.fillStyle = '#33cc66'; ink.font = '16px monospace';
      ink.fillText('ABC123', 0, 18); ink.fillText('xyz789', 0, 50); ink.fillText('READY', 0, 82);
      const mask = document.createElement('canvas'); mask.width = 64; mask.height = 32;
      const coverage = mask.getContext('2d')!; coverage.fillStyle = 'white'; coverage.fillRect(4, 0, 56, 32);
      const output = document.createElement('canvas'); output.width = 80; output.height = 48;
      const context = output.getContext('2d')!;
      const layer = (window as any).OpenMotionReconstruction.createTextureLayer({ image: atlas, box: [8, 5, 64, 32], offset: [0, -3], motion: [[0, 0, 0], [1, 0, -32]], mask });
      layer.draw(context, 0.5);
      const actual = Array.from(context.getImageData(0, 0, 80, 48).data);
      const expected = document.createElement('canvas'); expected.width = 80; expected.height = 48;
      const expectedContext = expected.getContext('2d')!;
      expectedContext.save(); expectedContext.beginPath(); expectedContext.rect(12, 5, 56, 32); expectedContext.clip();
      expectedContext.drawImage(atlas, 8, 5 - 3 - 16); expectedContext.restore();
      const reference = Array.from(expectedContext.getImageData(0, 0, 80, 48).data);
      context.clearRect(0, 0, 80, 48); layer.draw(context, 1); context.clearRect(0, 0, 80, 48); layer.draw(context, 0.5);
      const repeated = context.getImageData(0, 0, 80, 48).data;
      return { exact: actual.every((value, index) => value === reference[index]), repeat: actual.every((value, index) => value === repeated[index]), visible: actual.some((value, index) => index % 4 === 3 && value > 0) };
    });
    assert.deepEqual(result, { exact: true, repeat: true, visible: true });
  });

  await t.test('moving material has soft boundaries while preserving the stationary layer and caller blend mode', async () => {
    const result = await page.evaluate(() => {
      const image = document.createElement('canvas'); image.width = 32; image.height = 32;
      const texture = image.getContext('2d')!; texture.fillStyle = 'red'; texture.fillRect(0, 0, 32, 32);
      const output = document.createElement('canvas'); output.width = 32; output.height = 32;
      const context = output.getContext('2d')!; context.fillStyle = 'blue'; context.fillRect(0, 0, 32, 32);
      context.globalCompositeOperation = 'multiply';
      const layer = (window as any).OpenMotionReconstruction.createTextureLayer({ image, box: [0, 0, 32, 32], velocity: [0, 3], wrapY: true, edgeFade: [8, 8, 8, 8], composite: 'source-over' });
      layer.draw(context, 2);
      const pixel = (x: number, y: number) => Array.from(context.getImageData(x, y, 1, 1).data);
      return { edge: pixel(0, 16), centre: pixel(16, 16), corner: pixel(0, 0), blend: context.globalCompositeOperation };
    });
    assert(result.edge[0] < 40 && result.edge[2] > 215);
    assert.deepEqual(result.centre, [255, 0, 0, 255]);
    assert(result.corner[0] < result.edge[0]);
    assert.equal(result.blend, 'multiply');
  });

  await t.test('textured particles preserve colour, trail shape, opacity and reverse seeks', async () => {
    const result = await page.evaluate(() => {
      const image = document.createElement('canvas'); image.width = 64; image.height = 64;
      const material = image.getContext('2d')!; material.fillStyle = '#20e040'; material.fillRect(8, 8, 16, 16);
      const sprite = document.createElement('canvas'); sprite.width = 9; sprite.height = 5;
      const shape = sprite.getContext('2d')!;
      shape.fillStyle = 'black'; shape.fillRect(0, 0, 9, 5);
      shape.fillStyle = '#555'; shape.fillRect(1, 2, 7, 1); shape.fillStyle = 'white'; shape.fillRect(4, 1, 1, 3);
      const renderer = (window as any).OpenMotionReconstruction;
      const options = { image, sprite, box: [0, 0, 64, 64], pitch: 4, density: 1, threshold: 0, release: [0, 0], lifetime: [1, 1], speed: [12, 12], acceleration: 0, size: [9, 9], fadeIn: 0, fadeOut: 0, sizeGrowth: 0, composite: 'source-over', trail: 0.3, seed: 11 };
      const field = renderer.createParticleField(options);
      const output = document.createElement('canvas'); output.width = 64; output.height = 64;
      const context = output.getContext('2d')!;
      const frame = (time: number, opacity = 1) => { context.clearRect(0, 0, 64, 64); field.draw(context, time, opacity); return Array.from(context.getImageData(0, 0, 64, 64).data); };
      const first = frame(-1), moving = frame(0.5), empty = frame(2), restored = frame(-1);
      const noOpacity = frame(0.5, 0);
      const separate = renderer.createParticleField({ ...options, dissolve: false });
      context.clearRect(0, 0, 64, 64); separate.draw(context, 0.5, 0);
      const transparentParticles = !Array.from(context.getImageData(0, 0, 64, 64).data).some((value, index) => index % 4 === 3 && value > 0);
      const visibleAlpha = moving.filter((value, index) => index % 4 === 3 && value > 0);
      return { count: field.count, seek: first.every((value, index) => value === restored[index]), ended: empty.every(value => value === 0), zeroOpacity: noOpacity.every(value => value === 0) && transparentParticles, green: moving.some((value, index) => index % 4 === 1 && value > moving[index - 1] * 2), texture: new Set(visibleAlpha).size > 3, restoredAlpha: context.globalAlpha, restoredComposite: context.globalCompositeOperation };
    });
    assert.equal(result.count, 16);
    assert.equal(result.seek, true); assert.equal(result.ended, true); assert.equal(result.zeroOpacity, true);
    assert.equal(result.green, true); assert.equal(result.texture, true);
    assert.equal(result.restoredAlpha, 1); assert.equal(result.restoredComposite, 'source-over');
  });

  await t.test('dark ink particles use their source colour on a white sprite matte', async () => {
    const result = await page.evaluate(() => {
      const image = document.createElement('canvas'); image.width = 16; image.height = 16;
      const source = image.getContext('2d')!; source.fillStyle = 'black'; source.fillRect(0, 0, 16, 16);
      const sprite = document.createElement('canvas'); sprite.width = 7; sprite.height = 7;
      const ink = sprite.getContext('2d')!; ink.fillStyle = 'white'; ink.fillRect(0, 0, 7, 7); ink.fillStyle = 'black'; ink.fillRect(3, 1, 1, 5);
      const field = (window as any).OpenMotionReconstruction.createParticleField({ image, sprite, box: [0, 0, 16, 16], pitch: 8, density: 1, threshold: 0, spriteMatte: 'white', composite: 'source-over', release: [0, 0], lifetime: [1, 1], speed: [0, 0], acceleration: 0, size: [7, 7], dissolve: false });
      const output = document.createElement('canvas'); output.width = 16; output.height = 16;
      const context = output.getContext('2d')!; field.draw(context, 0.3);
      const pixels = Array.from(context.getImageData(0, 0, 16, 16).data);
      return { count: field.count, visible: pixels.some((value, index) => index % 4 === 3 && value > 0), black: pixels.every((value, index) => index % 4 === 3 || value === 0), transparentSurround: pixels[3] === 0 };
    });
    assert.deepEqual(result, { count: 4, visible: true, black: true, transparentSurround: true });
  });

  await t.test('sprite chroma and antialiased edges reconstruct their original black or white matte', async () => {
    const result = await page.evaluate(() => {
      const source = document.createElement('canvas'); source.width = source.height = 16;
      const material = source.getContext('2d')!; material.fillStyle = 'white'; material.fillRect(0, 0, 16, 16);
      const draw = (matte: string, colour: string) => {
        const sprite = document.createElement('canvas'); sprite.width = 8; sprite.height = 4;
        const pixels = sprite.getContext('2d')!; pixels.fillStyle = matte; pixels.fillRect(0, 0, 8, 4);
        pixels.fillStyle = colour; pixels.fillRect(2, 1, 4, 2);
        const output = document.createElement('canvas'); output.width = output.height = 16;
        const context = output.getContext('2d')!; context.fillStyle = matte; context.fillRect(0, 0, 16, 16);
        const field = (window as any).OpenMotionReconstruction.createParticleField({ image: source, sprite, box: [0, 0, 16, 16], pitch: 16, density: 1, release: [0, 0], lifetime: [1, 1], speed: [0, 0], acceleration: 0, size: [8, 8], sizeGrowth: 0, fadeIn: 0, fadeOut: 0, samples: 1, composite: 'source-over', spriteMatte: matte, dissolve: false });
        field.draw(context, .5);
        return Array.from(context.getImageData(6, 7, 1, 1).data);
      };
      return { black: draw('black', 'rgb(32,96,192)'), white: draw('white', 'rgb(64,128,192)') };
    });
    for (const [actual, expected] of [[result.black, [32, 96, 192, 255]], [result.white, [64, 128, 192, 255]]]) {
      assert(actual.every((value, index) => Math.abs(value - expected[index]) <= 1), JSON.stringify({ actual, expected }));
    }
  });

  await t.test('stationary source-over exposure preserves opacity with one or three samples', async () => {
    const result = await page.evaluate(() => {
      const source = document.createElement('canvas'); source.width = source.height = 16;
      const material = source.getContext('2d')!; material.fillStyle = 'black'; material.fillRect(0, 0, 16, 16);
      const sprite = document.createElement('canvas'); sprite.width = sprite.height = 8;
      const ink = sprite.getContext('2d')!; ink.fillStyle = 'black'; ink.fillRect(0, 0, 8, 8);
      const frame = (samples: number, opacity: number, background: boolean) => {
        const output = document.createElement('canvas'); output.width = output.height = 24;
        const context = output.getContext('2d')!;
        if (background) { context.fillStyle = 'white'; context.fillRect(0, 0, 24, 24); }
        context.globalAlpha = opacity;
        const field = (window as any).OpenMotionReconstruction.createParticleField({ image: source, sprite, box: [4, 4, 16, 16], pitch: 16, density: 1, threshold: 0, release: [0, 0], lifetime: [1, 1], speed: [0, 0], acceleration: 0, size: [8, 8], sizeGrowth: 0, fadeIn: 0, fadeOut: 0, samples, composite: 'source-over', spriteMatte: 'alpha', dissolve: false });
        field.draw(context, .5);
        return { pixels: Array.from(context.getImageData(0, 0, 24, 24).data), centre: Array.from(context.getImageData(12, 12, 1, 1).data), alpha: context.globalAlpha, composite: context.globalCompositeOperation };
      };
      return [true, false].flatMap(background => [1, 0.5].map(opacity => ({ one: frame(1, opacity, background), three: frame(3, opacity, background) })));
    });
    for (const { one, three } of result) assert.deepEqual(three, one);
    assert.deepEqual(result[0].three.centre, [0, 0, 0, 255]);
    assert.deepEqual(result[2].three.centre, [0, 0, 0, 255]);
  });

  await t.test('enlarging a sprite preserves the sampled material light budget', async () => {
    const result = await page.evaluate(() => {
      const source = document.createElement('canvas'); source.width = source.height = 16;
      const material = source.getContext('2d')!; material.fillStyle = 'black'; material.fillRect(0, 0, 16, 16); material.fillStyle = 'white'; material.fillRect(6, 6, 4, 4);
      const sprite = document.createElement('canvas'); sprite.width = sprite.height = 8;
      const shape = sprite.getContext('2d')!; shape.fillStyle = 'white'; shape.fillRect(0, 0, 8, 8);
      const energy = (size: number, preserveEnergy: boolean) => {
        const output = document.createElement('canvas'); output.width = output.height = 64;
        const context = output.getContext('2d')!; context.fillStyle = 'black'; context.fillRect(0, 0, 64, 64);
        const field = (window as any).OpenMotionReconstruction.createParticleField({ image: source, sprite, box: [16, 16, 16, 16], pitch: 16, density: 1, release: [0, 0], lifetime: [1, 1], speed: [0, 0], acceleration: 0, size: [size, size], sizeGrowth: 0, fadeIn: 0, fadeOut: 0, samples: 1, dissolve: false, preserveEnergy });
        field.draw(context, .5);
        const pixels = context.getImageData(0, 0, 64, 64).data;
        let total = 0;
        for (let index = 0; index < pixels.length; index += 4) total += pixels[index] / 255;
        return total;
      };
      return { small: energy(8, true), large: energy(16, true), additive: energy(16, false) };
    });
    assert(Math.abs(result.small - 16) < 1, JSON.stringify(result));
    assert(Math.abs(result.large - 16) < 1, JSON.stringify(result));
    assert(result.additive > result.large * 10, JSON.stringify(result));
  });
});
