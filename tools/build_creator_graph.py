#!/usr/bin/env python3
"""Build a scoped Graphify index from reviewed creator reference summaries.

This is a curated graph, not a frame-by-frame analysis of the media.
"""
import json
import shutil
from pathlib import Path
from graphify.detect import detect
from graphify.build import build_from_json
from graphify.cluster import cluster, score_all
from graphify.analyze import god_nodes, surprising_connections, suggest_questions
from graphify.report import generate
from graphify.export import to_json
from graphify.diagnostics import diagnose_extraction

ROOT = Path(__file__).resolve().parent.parent
BASE = ROOT / 'resources' / 'creator-styles'
CORPUS = BASE / 'graph-corpus'
OUT = BASE / 'graphify-out'

def main():
    OUT.mkdir(parents=True, exist_ok=True)
    shutil.copyfile(ROOT / 'skills' / 'creator-video' / 'SKILL.md', CORPUS / 'creator-video-skill.md')
    rulebooks = sorted((ROOT / 'skills' / 'creator-video' / 'references' / 'rulebooks').glob('*.md'))
    for f in rulebooks:
        shutil.copyfile(f, CORPUS / ('rulebook-' + f.name))
    manifests = sorted((BASE / 'sources').glob('*.manifest.json'))
    lines = ['# Creator asset packages', '', 'Copied source packages and their manifests. Each manifest records individual names and SHA-256 values. This index records availability, not visual or audio analysis.', '']
    for f in manifests:
        data = json.loads(f.read_text(encoding='utf-8'))
        name = f.name.removesuffix('.manifest.json')
        lines.append(f"- {name}: {len(data['files'])} files; `../sources/{f.name}`.")
    lines.extend(['', 'Kelsey talking-to-camera references and excluded montage/tour references are kept separate. Legacy and current editor projects are separately packaged.'])
    (CORPUS / 'additional-assets.md').write_text('\n'.join(lines) + '\n', encoding='utf-8')
    # Only the curated corpus is scanned; it contains no original media.
    detection = detect(CORPUS, gitignore=False)
    nodes, edges = [], []
    def node(id, label, file, kind='document'):
        path = CORPUS / file
        if not path.is_file(): raise FileNotFoundError(path)
        nodes.append({'id': id, 'label': label, 'file_type': kind, 'source_file': str(path), 'source_location': None, '_origin': 'semantic'})
    def edge(a, b, file, relation='references', inferred=False):
        edges.append({'source': a, 'target': b, 'relation': relation, 'confidence': 'INFERRED' if inferred else 'EXTRACTED', 'confidence_score': 0.85 if inferred else 1.0, 'source_file': str(CORPUS / file), 'source_location': None, 'weight': 1.0, '_origin': 'semantic'})
    docs = [
        ('index','Original local source index','asset-index.md'), ('packages','Additional creator asset packages','additional-assets.md'),
        ('captions','Speech-timed captions workflow','captions-workflow.md'), ('skill','Creator video skill','creator-video-skill.md'),
        ('kelsey','Kelsey reference profile','kelssie3-profile.md'), ('teardown','Six-video talking-to-camera teardown','kelssie3-teardown.md'),
        ('legacy','Legacy Instagram creator reference','legacy-kelsie-teardown.md'), ('metrics','Creator metrics and limitations','kelssie3-metrics.json'),
        ('style','Measured style settings','kelssie3-style.json'), ('videos','Selected video records','kelssie3-videos.json')]
    for ident,label,file in docs: node(ident,label,file)
    concepts = [
        ('vlog','Vlog implementation','creator-video-skill.md'), ('ingest','Reference ingestion and SHA-256 verification','creator-video-skill.md'),
        ('words','Speech-timed running captions','kelssie3-teardown.md'), ('matte','Hero text behind subject','kelssie3-teardown.md'),
        ('proof','Proof or metaphor timed to speech','kelssie3-teardown.md'), ('uncertainty','Approximate reference timing and transcript errors','kelssie3-teardown.md'),
        ('review','Frame-specific review notes','captions-workflow.md'), ('audio','Word timing and waveform review','captions-workflow.md'),
        ('limits','Small sample and inconsistent metric baselines','kelssie3-profile.md')]
    for ident,label,file in concepts: node(ident,label,file,'concept')
    for a,b,file in [('skill','vlog','creator-video-skill.md'),('skill','ingest','creator-video-skill.md'),('skill','kelsey','creator-video-skill.md'),('kelsey','teardown','kelssie3-profile.md'),('kelsey','limits','kelssie3-profile.md'),('teardown','words','kelssie3-teardown.md'),('teardown','matte','kelssie3-teardown.md'),('teardown','proof','kelssie3-teardown.md'),('teardown','uncertainty','kelssie3-teardown.md'),('captions','audio','captions-workflow.md'),('captions','review','captions-workflow.md')]: edge(a,b,file)
    for f in rulebooks:
        ident = 'rulebook_' + f.stem.replace('-', '_')
        node(ident, 'Editing rule book: ' + f.stem.split('-', 1)[-1], 'rulebook-' + f.name)
        edge('skill', ident, 'creator-video-skill.md', 'semantically_similar_to', True)
    edge('index','packages','additional-assets.md','semantically_similar_to',True)
    edge('captions','matte','captions-workflow.md','semantically_similar_to',True)
    edge('audio','uncertainty','captions-workflow.md','semantically_similar_to',True)
    edge('teardown','style','kelssie3-teardown.md')
    edge('teardown','videos','kelssie3-teardown.md','semantically_similar_to',True)
    for f in sorted(CORPUS.glob('transcript-*.txt')):
        ident = 'transcript_' + f.stem.removeprefix('transcript-')
        node(ident,'Reference transcript ' + f.stem.removeprefix('transcript-'),f.name)
        edge('teardown',ident,'kelssie3-teardown.md','semantically_similar_to',True)
    for f in manifests:
        name = f.name.removesuffix('.manifest.json')
        ident = 'package_' + name.replace('-','_')
        node(ident,'Source package: ' + name,'additional-assets.md','concept')
        edge('packages',ident,'additional-assets.md')
    extraction = {'nodes':nodes,'edges':edges,'hyperedges':[],'input_tokens':0,'output_tokens':0}
    graph = build_from_json(extraction,root=str(CORPUS),directed=False)
    if not graph.number_of_nodes(): raise RuntimeError('Graphify returned an empty graph')
    communities = cluster(graph); cohesion = score_all(graph,communities)
    labels = {c:'Creator references ' + str(c) for c in communities}
    questions = suggest_questions(graph,communities,labels)
    if not to_json(graph,communities,str(OUT/'graph.json'),community_labels=labels): raise RuntimeError('Graphify refused to replace a larger existing graph')
    report = generate(graph,communities,cohesion,labels,god_nodes(graph),surprising_connections(graph,communities),detection,{'input':0,'output':0},str(CORPUS),suggested_questions=questions)
    (OUT/'GRAPH_REPORT.md').write_text(report,encoding='utf-8')
    (OUT/'extraction.json').write_text(json.dumps(extraction,indent=2,ensure_ascii=False),encoding='utf-8')
    (OUT/'scope.json').write_text(json.dumps({'scope':'curated text, transcripts and package manifests; media binaries not analyzed by Graphify', 'corpus':str(CORPUS),'detected_files':detection['total_files'],'packages':len(manifests),'limitations':['Three JSON data files are indexed as named source documents; no AST nodes were extracted.','Contact-sheet times and auto-transcripts require verification against source video.','No claim of complete audio or frame analysis.']},indent=2),encoding='utf-8')
    diagnostic = diagnose_extraction(extraction,directed=False,root=str(CORPUS))
    print('Graphify graph:',graph.number_of_nodes(),'nodes,',graph.number_of_edges(),'edges;',len(manifests),'source packages')
    print('Graph diagnostics:',{k:diagnostic.get(k,0) for k in ('dangling_endpoint_edges','missing_endpoint_edges','self_loop_edges','undirected_same_endpoint_collapsed_edges')})

if __name__ == '__main__': main()
