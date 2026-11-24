import { describe, expect, it } from 'vitest';
import type { GalleryTemplate } from '../../../shared/catalog';
import { readBrandStoryNotes, storyChapterHighlights } from './brandStoryLearning';
import { brandInsights, brandSourceDates, brandWorkDate, brandWorkTime, formatBrandWorkDate, chronologicalItems, discoveryInsertions, groupBrandSeries, inferredPostTime, rankDiscoverySeries } from './brandStoryData';

const template = (id: string, brand?: string, extra = {}): GalleryTemplate => ({ id, brand, title: id, subtitle: '', description: '', collection: 'example', kind: 'reference', tags: [], author: '', ...extra });
describe('review brand series', () => {
  it('groups actual catalogue members without duplication, invented brands or ranks', () => {
    const groups = groupBrandSeries([template('a','Figma'), template('b','Figma'), template('b','Figma'), template('c',' Notion '), template('d'), template('e','')]);
    expect(groups.map(group => [group.name, group.items.map(item => item.id)])).toEqual([['Figma',['a','b']],['Notion',['c']]]);
  });
  it('sums site clicks once per actual work and ignores missing or invalid counts', () => {
    const groups=groupBrandSeries([template('a','Figma'),template('a','Figma'),template('b','Figma'),template('missing','Figma'),template('bad','Figma'),template('c','Notion')],{a:8,b:12,bad:Infinity,c:-5});
    expect(groups[0].workClicks).toBe(20);
    expect(groups[1].workClicks).toBe(0);
  });
  it('weights each work CTR by its exposure denominator instead of averaging rates or using total clicks', () => {
    const groups=groupBrandSeries([template('a','Figma'),template('a','Figma'),template('b','Figma'),template('missing','Figma'),template('bad','Figma'),template('none','Notion')],{}, {a:{exposed:100,clicked:1},b:{exposed:10,clicked:5},bad:{exposed:1,clicked:2}});
    expect(groups[0].workExposures).toBe(110);
    expect(groups[0].workQualifiedClicks).toBe(6);
    expect(groups[0].workCtr).toBeCloseTo(6/110);
    expect(groups[1].workCtr).toBeUndefined();
  });
  it('ranks sampled series by 59% work count and 41% CTR without mutating them', () => {
    const series=(name:string,works:number,workCtr:number)=>({name,items:Array.from({length:works},(_,i)=>template(name+i,name)),purposes:[],workCtr});
    const groups=[series('small quiet',1,.01),series('small popular',1,.2),series('large quiet',10,.01),series('large popular',10,.2)];
    expect(rankDiscoverySeries(groups).map(group=>group.name)).toEqual(['large popular','large quiet','small popular','small quiet']);
    expect(groups[0].name).toBe('small quiet');
    expect(rankDiscoverySeries([series('small',1,0),series('large',10,0)]).map(group=>group.name)).toEqual(['large','small']);
    expect(rankDiscoverySeries([series('second',2,.1),series('first',2,.1)]).map(group=>group.name)).toEqual(['second','first']);
    expect(rankDiscoverySeries([{...series('more clicks',2,.01),workClicks:100},{...series('higher CTR',2,.1),workClicks:10}]).map(group=>group.name)).toEqual(['higher CTR','more clicks']);
  });
  it('keeps random positions and sampled brands while ordering sampled series by CTR', () => {
    const items=Array.from({length:291},(_,i)=>template('sample-'+i,'Brand '+i));
    const groups=groupBrandSeries(items.slice(0,101),{},Object.fromEntries(items.map((item,index)=>[item.id,{exposed:1000,clicked:index}])));
    const ranked=discoveryInsertions(items,groups,true,43);
    const noSignals=discoveryInsertions(items,groups.map(group=>({...group,workCtr:undefined})),true,43);
    expect([...ranked.keys()]).toEqual([...noSignals.keys()]);
    expect([...ranked.values()].map(group=>group.name).sort()).toEqual([...noSignals.values()].map(group=>group.name).sort());
    const counts=[...ranked.values()].map(group=>group.workCtr!);
    expect(counts).toEqual([...counts].sort((a,b)=>b-a));
  });
  it('labels only supported, plausible source post ids with an inferred posting time', () => {
    expect(inferredPostTime({sourceUrl:'https://x.com/figma/status/2069827742800253230'})).toBe(1782320364080);
    expect(inferredPostTime({sourceUrl:'https://example.com/status/2069827742800253230'})).toBeUndefined();
    expect(inferredPostTime({sourceUrl:'https://x.com/figma/status/999999999999999999999999'})).toBeUndefined();
    expect(inferredPostTime({sourceUrl:'not a url'})).toBeUndefined();
  });
  it('reads LinkedIn activity dates and rejects other identities and unsafe hosts', () => {
    const airtable = {sourceUrl:'https://www.linkedin.com/posts/airtable_airtableai-nocodeai-activity-7343347865622036481-yJJC'};
    expect(new Date(inferredPostTime(airtable)!).toISOString()).toBe('2025-06-24T18:42:43.970Z');
    expect(brandWorkDate(airtable)).toMatchObject({value:'2025-06-24',precision:'day'});
    expect(inferredPostTime({sourceUrl:'https://www.linkedin.com/feed/update/urn:li:activity:7366161234095693824/'})).toBe(1756229694866);
    for (const sourceUrl of ['https://linkedin.com.evil.test/posts/airtable-activity-7343347865622036481-x', 'https://www.linkedin.com/jobs/view/7343347865622036481', 'https://www.linkedin.com/posts/a-activity-9999999999999999999-x', 'http://www.linkedin.com/posts/a-activity-7343347865622036481-x']) {
      expect(inferredPostTime({sourceUrl})).toBeUndefined();
    }
  });
  it('preserves source precision and uses the same dates for chronology and display', () => {
    const lark=template('lark','Lark',{sourceUrl:'https://www.ordinaryfolk.co/project/lark-magic-share'});
    expect(brandWorkDate(lark)).toMatchObject({value:'2020',precision:'year'});
    expect(formatBrandWorkDate(brandWorkDate(lark)!)).toBe('2020');
    expect(brandWorkTime(lark)).toBe(Date.UTC(2020,0,1));
    expect(formatBrandWorkDate({value:'2025-05',precision:'month'})).toBe('2025/05');
    const entries=[template('august','Airtable',{sourceUrl:'https://www.linkedin.com/posts/airtable_today-were-rolling-out-ai-generated-interface-activity-7366161234095693824-buUw'}),template('june','Airtable',{sourceUrl:'https://www.linkedin.com/posts/airtable_airtableai-nocodeai-activity-7343347865622036481-yJJC'})];
    expect(chronologicalItems(groupBrandSeries(entries)[0],true).map(item=>item.id)).toEqual(['june','august']);
    expect(brandWorkDate({sourceUrl:'https://ramp.com/'})).toBeUndefined();
    for (const date of Object.values(brandSourceDates)) {
      expect(date.value).toMatch(date.precision==='year'?/^\d{4}$/:date.precision==='month'?/^\d{4}-\d{2}$/:/^\d{4}-\d{2}-\d{2}$/);
      expect(new URL(date.sourceUrl).protocol).toBe('https:');
      expect(date.evidence.length).toBeGreaterThan(15);
    }
  });
  it('keeps unknown dates last and never mutates the catalogue order', () => {
    const series = groupBrandSeries([template('unknown','Figma'), template('new','Figma',{sourceUrl:'https://x.com/figma/status/2069827742800253230'}), template('old','Figma',{sourceUrl:'https://x.com/figma/status/1900000000000000000'})])[0];
    expect(chronologicalItems(series).map(item => item.id)).toEqual(['new','old','unknown']);
    expect(chronologicalItems(series, true).map(item => item.id)).toEqual(['old','new','unknown']);
    expect(series.items.map(item => item.id)).toEqual(['unknown','new','old']);
  });
  it('spaces seeded discovery across all brands without duplicates or catalogue reordering', () => {
    const items = Array.from({length:291},(_,i)=>template('item-'+i,'Brand '+i));
    const groups = groupBrandSeries(items.slice(0,101));
    const slots = discoveryInsertions(items,groups,true,43);
    const positions = [...slots.keys()];
    expect(positions[0]).toBeGreaterThanOrEqual(6);
    expect(positions[0]).toBeLessThanOrEqual(8);
    expect(positions.every((position,index) => index === 0 || position - positions[index-1] >= 10 && position - positions[index-1] <= 14)).toBe(true);
    expect(new Set([...slots.values()].map(group=>group.name)).size).toBe(slots.size);
    expect(slots).toEqual(discoveryInsertions(items,groups,true,43));
    expect(slots).not.toEqual(discoveryInsertions(items,groups,true,44));
    const eligible = new Set(Array.from({length:100},(_,seed)=>[...discoveryInsertions(items,groups,true,seed).values()].map(group=>group.name)).flat());
    expect(eligible.size).toBe(101);
    expect(discoveryInsertions(items,groups,false).size).toBe(0);
    expect(discoveryInsertions(items.slice(0,4),groups,true).size).toBe(0);
    expect(items.map(item=>item.id)).toEqual(Array.from({length:291},(_,i)=>'item-'+i));
  });
  it('covers every catalogue brand with distinct, traceable video observations', async () => {
    const { readFile, readdir } = await import('node:fs/promises');
    const base = new URL('../../../library/templates/catalog/', import.meta.url);
    const entries = await Promise.all((await readdir(base,{withFileTypes:true})).filter(entry=>entry.isDirectory()).map(async entry=>{
      try { const record=JSON.parse(await readFile(new URL(entry.name+'/template.json',base),'utf8')); return { ...record.entry, id: record.templateId }; } catch { return null; }
    }));
    const branded = entries.filter(entry=>entry?.brand?.trim());
    const names = [...new Set(branded.map(entry=>entry.brand.trim()))];
    expect(names.length).toBeGreaterThan(90);
    expect(names.filter(name=>!brandInsights[name]?.videoInsight)).toEqual([]);
    expect(new Set(names.map(name=>brandInsights[name].videoInsight)).size).toBe(names.length);
    for (const name of names) {
      const insight=brandInsights[name];
      expect(insight.evidenceTemplateIds.length).toBeGreaterThan(0);
      expect(insight.evidenceTemplateIds.every(id=>branded.some(entry=>entry.id===id && entry.brand.trim()===name))).toBe(true);
    }
  });
});

describe('authored brand learning notes', () => {
  it('keeps specific prose and real chapter times while ignoring code and invalid segments', () => {
    const source = '# Launch\n\nA result before the interface.\n\n```motion-demo\n{"params":[]}\n```\n\n## 内容替换\n- Replace your own result and interface.\n\n## 制作参数\nPrivate implementation details.\n\n```motion-board\n'+JSON.stringify({stages:[{start:0,end:5,label:'结果'},{start:5,end:10,label:'操作'},{start:10,end:20,label:'证明'},{start:-1,end:2,label:'bad'},{start:4,end:3,label:'bad'},{start:80,end:90,label:'outside'},{start:5,end:8,label:'duplicate'}]})+'\n```';
    const result=readBrandStoryNotes(source,20);
    expect(result.summary).toBe('A result before the interface.');
    expect(result.adaptation).toBe('Replace your own result and interface.');
    expect(result.chapters.map(x=>x.start)).toEqual([0,5,10]);
    expect(storyChapterHighlights(result.chapters).map(x=>x.label)).toEqual(['结果','操作','证明']);
    expect(readBrandStoryNotes('```motion-board\n{broken}\n```').chapters).toEqual([]);
    expect(storyChapterHighlights([])).toEqual([]);
  });
});
