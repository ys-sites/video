import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, rm, readFile } from 'node:fs/promises';
import path from 'node:path';
import { tmpdir } from 'node:os';
import puppeteer from 'puppeteer-core';
import { browserExecutable } from '../browser.ts';
import { brandSampleScript } from '../gateway/brand-sampler.mjs';
import { captureBrandLogos } from '../gateway/brand-assets.ts';
import { validateBrandStyle, type BrandSample } from '../shared/brand-kit.ts';

const html = `<!doctype html><html data-theme="light"><head><title>Fixture | Brand</title><meta name="description" content="Fixture brand context"><meta name="twitter:image" content="/social.png"><style>
@layer theme { html[data-theme="light"] { --brand-accent: oklch(65% .2 150); --font-heading: Arial; --space-unit: 8px; } }
body { margin:0; font-family:Arial; background:#fafafa; color:#123456 }
.hidden { opacity:0 } h1 { font-size:60px; font-weight:700 } h2 { font-size:40px; font-weight:600 } h3 { font-size:40px; font-weight:600 }
header { height:80px; padding:24px; background:#eee; display:flex; gap:24px }
.primary { padding:12px 24px; background:linear-gradient(90deg, rgb(12 140 80), oklch(65% .2 150)); color:#fff; border-radius:24px; border:none }
.card { width:300px; height:140px; border:1px solid #ddd; border-radius:16px; background:rgb(240 240 250 / .5); backdrop-filter:blur(12px); box-shadow:0 4px 24px #12345640; padding:24px; margin:24px }
.pill { display:inline-block; padding:4px 16px; border-radius:99px; border:1px solid #ccc; background:rgba(10,20,30,0) }
[role=tab] { padding:8px 16px; border:0; background:transparent } .stat { width:200px; height:100px; margin:24px } .stat strong { font-size:48px }
section { padding:24px; margin:24px; } .hero { position:relative; min-height:300px; background:radial-gradient(circle, #123456, #77ccaa) }
.hero::before { content:''; position:absolute; inset:0; background:linear-gradient(45deg, #fe22aa, #11cccc); pointer-events:none }
</style></head><body>
<div class="hidden"><h1>Hidden title</h1><button style="background:#ff00ff">Invisible</button></div>
<header><button aria-label="Menu"><svg width="24" height="24"><path d="M0 0h24v24H0z"/></svg></button><a href="/"><svg aria-label="Fixture logo" width="110" height="40"><path fill="#118844" d="M0 0h110v40H0z"/></svg></a><button style="background:#ddd;padding:12px">Contact sales</button><a class="primary" role="button" href="#start">Start now</a></header>
<h1>Visible title</h1><h2>Heading two</h2><h3>Heading three</h3><p>Brand body copy</p>
<span class="pill">New</span><button role="tab">Overview</button><div class="stat"><strong>128</strong><span>Teams</span></div><article class="card">Card material</article>
<svg aria-label="Forbes logo" width="32" height="32"><path d="M0 0h32v32H0z"/></svg><section class="hero"><h2>Background evidence</h2></section><section><p>Spaced section</p></section>
</body></html>`;
test('ported extraction preserves hierarchy, alpha, themed tokens, gradient CTAs, materials and brand logos', async t => {
  const executablePath = await browserExecutable().catch(() => undefined);
  if (!executablePath) return t.skip('Chrome is required for computed-style extraction');
  const browser = await puppeteer.launch({ executablePath, headless:true });
  t.after(() => browser.close());
  const directory = await mkdtemp(path.join(tmpdir(), 'brand-extraction-fixture-'));
  t.after(() => rm(directory, { recursive:true, force:true }));
  await mkdir(path.join(directory,'assets'));
  const page = await browser.newPage();
  await page.setViewport({ width:1440, height:900 });
  await page.setRequestInterception(true);
  page.on('request', request => void request.respond({ status:200, contentType:'text/html', body:html }));
  await page.goto('https://brand.example/');
  const sample = await page.evaluate(brandSampleScript) as BrandSample;
  assert.equal(sample.name,'Fixture');
  assert.equal(sample.tokens?.ogImage, 'https://brand.example/social.png');
  assert.equal(sample.style.primary,'#0C8C50','a gradient CTA supplies its color instead of a secondary grey button');
  assert.deepEqual(validateBrandStyle(sample.style),sample.style);
  assert.equal(sample.design?.typography.find(t => t.role === 'display')?.sampleText, 'Visible title');
  assert(sample.typography.some(t => t.role === 'heading-2'));
  assert(sample.typography.some(t => t.role === 'heading-3'), 'equally styled heading levels retain their roles');
  assert.equal(sample.tokens?.cssVariables['--brand-accent'], 'oklch(65% .2 150)');
  assert(!sample.colors.includes('#FF00FF'), 'hidden ancestors do not contribute brand colors');
  assert(sample.design?.buttons.some(button => button.label === 'Start now' && button.backgroundImage?.includes('linear-gradient')));
  assert.equal(sample.design?.chips?.[0].background,'transparent');
  assert.match(sample.design?.cards[0].background || '', /^#[A-F0-9]{8}$/);
  assert(sample.design?.tabs?.length);
  assert(sample.design?.statCells?.length);
  assert(sample.design?.shadows.length);
  assert(sample.design?.glass?.some(glass => glass.backdropFilter === 'blur(12px)'));
  assert(sample.gradients.length >= 2, 'includes pseudo-element and normal gradients');
  assert(sample.spacing.includes('24px'));
  assert(sample.tokens?.svgs.every(svg => !svg.outerHTML), 'no executable source SVG is persisted');
  const logos = await captureBrandLogos(page, directory, 'Fixture');
  assert.equal(logos.length,1,'a menu icon is not a brand logo');
  assert.equal(logos[0].label, 'Fixture logo');
  assert.equal((await readFile(path.join(directory,logos[0].path))).subarray(1,4).toString(),'PNG');
});
