"""Versioned local name rules and frozen AI files; never calls a model/network."""
import copy
from datetime import datetime
from decimal import Decimal, ROUND_HALF_UP
import json
import math
from pathlib import Path
import re

from .common import digest, require
from .geometry import in_building, point, valid_building

STRONG_SOURCES = frozenset(('building_tag','poi','annotation','name_rule','ai_inferred'))
FUNCTIONS = frozenset(('dining','retail','dormitory','residential','education','office','library','unknown'))
AUTO_WARNINGS = frozenset(('NAME_RULE_EXCLUDED','NAME_RULE_CONFLICT','AI_LOW_CONFIDENCE','EVIDENCE_CONFLICT','GENERIC_USE_SUPERSEDED'))
FROZEN_FIELDS = ('function_evidence','inactive_function_evidence','superseded_function_evidence','function_annotation','needs_ai_review')


def validate_rules(rules):
    require(isinstance(rules,dict) and rules.get('schema_version')=='scene.evidence-rules.v1' and
            isinstance(rules.get('version'),str) and rules['version'].strip(),
            'INVALID_EVIDENCE_RULES','Missing rules identity')
    require(rules.get('sha256')==digest({key:value for key,value in rules.items() if key!='sha256'}),
            'INVALID_EVIDENCE_RULES','Rules digest differs')
    require(type(rules.get('ai_min_confidence_pct')) is int and 0<=rules['ai_min_confidence_pct']<=100 and
            type(rules.get('nearby_poi_radius_m')) is int and rules['nearby_poi_radius_m']>=0,
            'INVALID_EVIDENCE_RULES','Invalid AI threshold or POI radius')
    require(isinstance(rules.get('exclusion_patterns'),list) and
            all(isinstance(value,str) and value for value in rules['exclusion_patterns']) and
            isinstance(rules.get('name_rules'),list),'INVALID_EVIDENCE_RULES','Invalid rules tables')
    seen=set()
    for rule in rules['name_rules']:
        require(isinstance(rule,dict) and set(rule)=={'id','function','pattern'} and
                isinstance(rule['id'],str) and rule['id'] and rule['id'] not in seen and
                isinstance(rule['function'],str) and rule['function'] in FUNCTIONS-{'unknown'} and isinstance(rule['pattern'],str) and rule['pattern'],
                'INVALID_EVIDENCE_RULES','Invalid/duplicate name rule')
        seen.add(rule['id'])
    try:
        for expression in rules['exclusion_patterns']+[rule['pattern'] for rule in rules['name_rules']]:
            re.compile(expression)
    except re.error as error:
        require(False,'INVALID_EVIDENCE_RULES',str(error))
    return rules




def generic_education(evidence):
    return evidence['source']=='building_tag' and evidence['key']=='building' and evidence['value'] in ('university','college','school')


def name_evidence(building,rules):
    name=building.get('name','')
    if any(re.search(expression,name) for expression in rules['exclusion_patterns']):
        return [],'NAME_RULE_EXCLUDED'
    matches=[rule for rule in rules['name_rules'] if re.search(rule['pattern'],name)]
    if len({rule['function'] for rule in matches})>1:
        return [],'NAME_RULE_CONFLICT'
    return [{'function':rule['function'],'source':'name_rule','key':rule['id'],'value':name,'ref':building['osm_id']} for rule in matches],None


def validate_ai_file(value,map_ref,building_ids):
    require(isinstance(value,dict) and set(value)<={'schema_version','map_ref','buildings','synthetic'} and
            value.get('schema_version')=='scene.ai-evidence.v1' and isinstance(value.get('buildings'),dict),
            'INVALID_AI_EVIDENCE','Expected scene.ai-evidence.v1')
    require(value.get('map_ref')==map_ref,'REF_MISMATCH','AI evidence must bind the exact prepared input map')
    require(set(value['buildings'])<=set(building_ids),'INVALID_AI_EVIDENCE','AI evidence references an unknown building')
    fields={'functions','confidence','rationale','model','prompt_version','generated_at'}
    for identifier,entry in value['buildings'].items():
        require(isinstance(entry,dict) and set(entry)==fields,'INVALID_AI_EVIDENCE',f'{identifier}: incomplete/unknown AI fields')
        functions=entry['functions']
        require(isinstance(functions,list) and functions and all(isinstance(f,str) and f in FUNCTIONS for f in functions),
                'UNKNOWN_FUNCTION',f'{identifier}: invalid AI function')
        require(len(set(functions))==len(functions) and ('unknown' not in functions or len(functions)==1),
                'INVALID_AI_EVIDENCE',f'{identifier}: duplicate/mixed unknown functions')
        confidence=entry['confidence']
        require(type(confidence) in (int,float) and 0<=confidence<=1 and math.isfinite(confidence),
                'INVALID_AI_EVIDENCE',f'{identifier}: confidence must be in [0,1]')
        require(all(isinstance(entry[key],str) and entry[key].strip() for key in ('rationale','model','prompt_version','generated_at')) and
                len(entry['rationale'])<=500 and re.search(r'[\u4e00-\u9fff]',entry['rationale']),
                'INVALID_AI_EVIDENCE',f'{identifier}: missing model, prompt or short Chinese rationale')
        try:
            timestamp=datetime.fromisoformat(entry['generated_at'].replace('Z','+00:00'))
            valid_time='T' in entry['generated_at'] and timestamp.utcoffset() is not None
        except ValueError:
            valid_time=False
        require(valid_time,'INVALID_AI_EVIDENCE',f'{identifier}: generated_at must be an ISO timestamp with timezone')
    return value


def apply_auto_evidence(package,rules,ai_file,warn):
    rules=validate_rules(rules)
    buildings=package['campus']['buildings']
    if ai_file is not None:
        validate_ai_file(ai_file,package.get('evidence_input_ref',package['map_ref']),[b['osm_id'] for b in buildings])
    package['evidence_rules']=copy.deepcopy(rules)
    if ai_file is not None:
        package['ai_evidence']=copy.deepcopy(ai_file)
    threshold=Decimal(rules['ai_min_confidence_pct'])/100
    for building in buildings:
        identifier=building['osm_id']
        base=building['function_evidence']
        names,name_warning=name_evidence(building,rules)
        if name_warning:
            warn(name_warning,'Name rules were excluded or conflicted; weak keywords remain weak',[identifier])
        prediction=ai_file['buildings'].get(identifier) if ai_file is not None else None
        inferred=[];low=[]
        if prediction:
            percent=int((Decimal(str(prediction['confidence']))*100).quantize(Decimal('1'),rounding=ROUND_HALF_UP))
            records=[{'function':function,'source':'ai_inferred','key':'ai_evidence','value':prediction['rationale'],
                      'ref':identifier,'confidence_pct':percent} for function in sorted(prediction['functions']) if function!='unknown']
            if Decimal(str(prediction['confidence']))>=threshold:
                inferred=records
            else:
                low=records
                warn('AI_LOW_CONFIDENCE','AI prediction retained but below the frozen map policy threshold',[identifier])
        annotations=[e for e in base if e['source']=='annotation']
        specific=[e for e in base if e['source'] in ('building_tag','poi') and not generic_education(e)]
        generic=[e for e in base if generic_education(e)]
        functions=lambda records:{e['function'] for e in records}-{'unknown'}
        if annotations:
            selected=functions(annotations)
            if building['function_annotation'].get('mode','add')=='add':
                selected|=functions(specific)
        elif specific:
            selected=functions(specific)
        elif names:
            selected=functions(names)
        elif inferred:
            selected=functions(inferred)
        else:
            selected=functions(generic)
        candidates=base+names+inferred
        active=[e for e in candidates if e['source']=='name_keyword' or e['function'] in selected or
                (e['function']=='unknown' and not selected)]
        inactive=[e for e in candidates if e not in active]+low
        suppressed=[e for e in inactive if generic_education(e)]
        if suppressed:
            building.setdefault('superseded_function_evidence',[]).extend(copy.deepcopy(suppressed))
            warn('GENERIC_USE_SUPERSEDED','Generic education tag retained as superseded evidence, not a teaching candidate',[identifier])
        conflict=bool(functions(specific)-selected or functions(names)-selected or functions(inferred)-selected or
                      functions(building.get('superseded_function_evidence',[]))-selected or len(functions(specific))>1)
        if conflict:
            warn('EVIDENCE_CONFLICT','Lower-priority or same-tier function evidence conflicts; no automatic override',[identifier])
        building['function_evidence']=active
        building['inactive_function_evidence']=inactive
        building['needs_ai_review']=not any(e['source'] in STRONG_SOURCES and not generic_education(e) and e['function']!='unknown' for e in active) or conflict or name_warning=='NAME_RULE_CONFLICT'
