// M15 validation only. No rendering, fetching, placement or legacy-path changes.
import contract from '../../../adapter/scene_service/contract.json' with {type:'json'}
import contractV2 from '../../../adapter/scene_service/contract-v2.json' with {type:'json'}
import contractV3 from '../../../adapter/scene_service/contract-v3.json' with {type:'json'}
import {sha256HexJs} from './sha256.js'

export class SceneResultError extends Error {
  constructor(code,message){super(message);this.name='SceneResultError';this.code=code}
}
const requireValue=(test,code,message)=>{if(!test)throw new SceneResultError(code,message)}
const object=value=>value!==null&&typeof value==='object'&&!Array.isArray(value)
function text(value){
  requireValue(typeof value==='string','INVALID_JSON','Expected string')
  for(const c of value){const cp=c.codePointAt(0);requireValue(cp<0xd800||cp>0xdfff,'INVALID_JSON','Unpaired surrogate')}
  return JSON.stringify(value)
}
const unicodeCompare=(a,b)=>{
  const x=Array.from(a,c=>c.codePointAt(0)),y=Array.from(b,c=>c.codePointAt(0))
  for(let i=0;i<Math.min(x.length,y.length);i++)if(x[i]!==y[i])return x[i]-y[i]
  return x.length-y.length
}
/** Code-point key ordering, literal UTF-8 and safe integers match Python exactly. */
export function canonicalSceneJson(value){
  if(value===null||typeof value==='boolean')return JSON.stringify(value)
  if(typeof value==='string')return text(value)
  if(typeof value==='number'){requireValue(Number.isSafeInteger(value),'INVALID_JSON','SceneResult v1 numbers must be safe integers');return String(value===0?0:value)}
  if(Array.isArray(value))return '['+value.map(canonicalSceneJson).join(',')+']'
  requireValue(object(value),'INVALID_JSON','Unsupported JSON value')
  return '{'+Object.keys(value).sort(unicodeCompare).map(k=>text(k)+':'+canonicalSceneJson(value[k])).join(',')+'}'
}
export const sceneDigest=value=>sha256HexJs(new TextEncoder().encode(canonicalSceneJson(value)))
function check(value,schema,path='$'){
  if(schema.anyOf){
    for(const candidate of schema.anyOf){try{check(value,candidate,path);return}catch(error){if(!(error instanceof SceneResultError))throw error}}
    throw new SceneResultError('INVALID_SCENE',`${path}: no matching contract variant`)
  }
  if(Object.hasOwn(schema,'const'))requireValue(value===schema.const,'INVALID_SCENE',`${path}: unexpected constant`)
  if(schema.enum)requireValue(schema.enum.includes(value),'INVALID_SCENE',`${path}: unexpected enum value`)
  const kind=schema.type
  if(kind){const matches={null:value===null,string:typeof value==='string',integer:Number.isSafeInteger(value),boolean:typeof value==='boolean',array:Array.isArray(value),object:object(value)};requireValue(matches[kind],'INVALID_SCENE',`${path}: expected ${kind}`)}
  if(kind==='object'){
    const props=schema.properties||{}
    requireValue((schema.required||[]).every(k=>Object.hasOwn(value,k)),'INVALID_SCENE',`${path}: missing fields`)
    for(const [key,item]of Object.entries(value)){
      const target=Object.hasOwn(props,key)?props[key]:schema.additionalProperties
      requireValue(object(target),'INVALID_SCENE',`${path}: unexpected field ${key}`);check(item,target,`${path}.${key}`)
    }
  }else if(kind==='array'){
    requireValue(value.length>=(schema.minItems||0),'INVALID_SCENE',`${path}: too few items`)
    if(schema.uniqueItems)requireValue(new Set(value.map(canonicalSceneJson)).size===value.length,'INVALID_SCENE',`${path}: duplicate items`)
    value.forEach((item,i)=>check(item,schema.items,`${path}[${i}]`))
  }else if(kind==='string'){
    requireValue(Array.from(value).length>=(schema.minLength||0)&&(!schema.minLength||value.trim().length>0),'INVALID_SCENE',`${path}: empty text`)
    if(schema.pattern)requireValue(new RegExp(schema.pattern+'(?![\\s\\S])').test(value),'INVALID_SCENE',`${path}: invalid format`)
  }else if(kind==='integer')requireValue(value>=(schema.minimum??value)&&value<=(schema.maximum??value),'INVALID_SCENE',`${path}: integer out of range`)
}
function indexed(items,key,code='REF_MISMATCH'){
  requireValue(Array.isArray(items)&&items.every(x=>object(x)&&typeof x[key]==='string'&&x[key]),code,`Invalid ${key} records`)
  const result=new Map(items.map(x=>[x[key],x]));requireValue(result.size===items.length,code,`Duplicate ${key}`);return result
}
function brandCatalog(plan){
  const economy=plan.economy||{},brands=indexed(economy.brands||[],'brand_id','BRAND_NAME_MISMATCH'),names=new Map(),seen=new Set()
  for(const product of economy.products||[]){
    const id=product.brand_id,name=product.product_name
    requireValue(brands.has(id)&&typeof name==='string'&&name.trim()&&!names.has(name)&&!seen.has(id),'BRAND_NAME_MISMATCH','Expected one unique product per brand')
    requireValue(typeof brands.get(id).owner_entity_id==='string','REF_MISMATCH','Missing brand owner')
    names.set(name,brands.get(id));seen.add(id)
  }
  requireValue(seen.size===brands.size,'BRAND_NAME_MISMATCH','Missing product-to-brand mapping');return names
}
const equal=(a,b)=>canonicalSceneJson(a)===canonicalSceneJson(b)
const sameKeys=(list,values)=>list.length===values.size&&list.every(k=>values.has(k))

/** Optional context {map,snapshot,plan,source_refs} verifies external references. */
export function validateSceneResult(value,context={}){
  const v3=value?.schema_version==='scene.result.v3',v2=v3||value?.schema_version==='scene.result.v2'
  const strong=e=>v2?['building_tag','poi','annotation','name_rule','ai_inferred'].includes(e.source):e.source!=='name_keyword'
  canonicalSceneJson(value);check(value,v3?contractV3:v2?contractV2:contract)
  const {result_sha256,...body}=value
  requireValue(result_sha256===sceneDigest(body),'HASH_MISMATCH','SceneResult hash mismatch')
  requireValue(value.assignment_meta.rules_sha256===sceneDigest(value.rules),'HASH_MISMATCH','Rules hash mismatch')
  const map=value.mode==='map'
  if(!map)requireValue(value.map_ref===null&&!value.assignments.length&&!value.service_points.length&&typeof value.reason==='string'&&value.reason.trim()&&equal(value.rules,{}),'INVALID_SCENE','none requires reason and empty spatial data/rules')
  else requireValue(value.map_ref!==null&&Object.keys(value.rules).length,'INVALID_SCENE','map requires map reference and adopted rules')
  indexed(value.assignments,'entity_id');indexed(value.service_points,'service_id');indexed(value.service_points,'brand_id');indexed(value.service_points,'brand_name')
  if(map){
    const roles=new Set(value.assignments.map(x=>x.role)),brands=new Set(value.service_points.map(x=>x.brand_name)),people=new Set(value.assignments.map(x=>x.entity_id))
    requireValue(sameKeys(Object.keys(value.rules.role_prefs),roles)&&sameKeys(Object.keys(value.rules.brand_prefs),brands),'REF_MISMATCH','Adopted rules do not cover result')
    requireValue(Object.keys(value.rules.overrides.entities).every(k=>people.has(k))&&Object.keys(value.rules.overrides.brands).every(k=>brands.has(k)),'REF_MISMATCH','Unknown override selector')
    requireValue(value.service_points.every(x=>people.has(x.owner_entity_id)),'REF_MISMATCH','Service owner missing from assignments')
  }
  for(const item of [...value.assignments,...value.service_points]){
    if(v3){
      requireValue(!Object.hasOwn(item,'entity_id')||item.evidence.every(e=>e.layer==='primary'),'INVALID_SCENE','People cannot use interior-service evidence')
      requireValue(new Set(item.evidence.map(e=>e.layer)).size<=1,'INVALID_SCENE','A placement must use one evidence layer')
    }
    if(v2)requireValue(item.evidence.every(e=>(e.source==='ai_inferred')===Object.hasOwn(e,'confidence_pct')),'INVALID_SCENE','Only AI evidence requires integer confidence_pct')
    const group=Object.hasOwn(item,'entity_id')?'entities':'brands',name=item.entity_id??item.brand_name
    const pref=group==='entities'?value.rules.role_prefs[item.role]:value.rules.brand_prefs[name]
    requireValue(item.fallback_used===null||item.fallback_used===pref.fallback,'REF_MISMATCH','Undeclared fallback')
    if(item.status==='out_of_scene')requireValue(item.building_id===null&&item.entrance_id===null&&item.fallback_used==='out_of_scene','INVALID_SCENE','Invalid out-of-scene entry')
    else requireValue(item.building_id&&item.entrance_id&&item.fallback_used!=='out_of_scene','INVALID_SCENE','Placed entry needs building and entrance')
    if(item.status==='placed'&&item.fallback_used===null){
      const group=Object.hasOwn(item,'entity_id')?'entities':'brands',name=item.entity_id??item.brand_name
      requireValue(value.rules.overrides?.[group]?.[name]===item.building_id||item.evidence.some(strong),'INVALID_SCENE','Strict placement needs evidence or explicit override')
    }
  }
  if(context.source_refs)requireValue(equal(value.source_refs,context.source_refs),'REF_MISMATCH','Source references differ')
  if(context.map&&map){
    requireValue(equal(value.map_ref,context.map.map_ref),'REF_MISMATCH','Map reference differs')
    requireValue(v3===(context.map.evidence_rules?.version==='auto-evidence.2'),'REF_MISMATCH','Result contract differs from frozen map policy')
    const buildings=indexed(context.map.campus.buildings,'osm_id'),entrances=indexed(context.map.entrances.entrances,'id')
    for(const item of [...value.assignments,...value.service_points])if(item.status==='placed'){
      const b=buildings.get(item.building_id),e=entrances.get(item.entrance_id)
      requireValue(b&&e&&e.building_id===item.building_id&&b.scene_eligible===true&&e.scene_reachable===true,'REF_MISMATCH','Unknown, mismatched or unreachable place')
      if(v3)requireValue(!b.functions.some(f=>['transport','utility','construction'].includes(f)),'REF_MISMATCH','Non-placeable primary use cannot be overridden')
      const records=[...(b.function_evidence||[]),...(v3&&!Object.hasOwn(item,'entity_id')?b.service_evidence||[]:[])]
      requireValue(item.evidence.every(e=>records.some(known=>equal(e,known))),'REF_MISMATCH','Evidence absent from map')
      const group=Object.hasOwn(item,'entity_id')?'entities':'brands',name=item.entity_id??item.brand_name
      const pref=group==='entities'?value.rules.role_prefs[item.role]:value.rules.brand_prefs[name]
      requireValue(item.fallback_used!==null||value.rules.overrides[group][name]===item.building_id||item.evidence.some(e=>strong(e)&&e.function!=='unknown'&&pref.functions.includes(e.function)),'REF_MISMATCH','Evidence does not satisfy preference')
    }
  }
  if(context.snapshot){
    const s=context.snapshot,people=indexed(s.nodes,'entity_id')
    requireValue(['snapshot_id','snapshot_revision'].every(k=>value.source_refs[k]===s[k]),'REF_MISMATCH','Snapshot reference differs')
    if(map){
      requireValue(sameKeys(value.assignments.map(x=>x.entity_id),people),'REF_MISMATCH','Population coverage differs')
      requireValue(value.assignments.every(x=>people.get(x.entity_id).role===x.role),'REF_MISMATCH','Role differs')
      requireValue(value.service_points.every(x=>people.has(x.owner_entity_id)),'REF_MISMATCH','Unknown owner')
    }
  }
  if(context.plan){
    const p=context.plan
    requireValue(['plan_id','plan_revision'].every(k=>value.source_refs[k]===p[k]),'REF_MISMATCH','Plan reference differs')
    if(p.population)requireValue(['snapshot_id','snapshot_revision'].every(k=>value.source_refs[k]===p.population[k]),'REF_MISMATCH','Plan population differs')
    if(map){const catalog=brandCatalog(p)
      requireValue(sameKeys(value.service_points.map(x=>x.brand_name),catalog),'REF_MISMATCH','Brand coverage differs')
      requireValue(value.service_points.every(x=>x.brand_id===catalog.get(x.brand_name).brand_id&&x.owner_entity_id===catalog.get(x.brand_name).owner_entity_id),'REF_MISMATCH','Brand mapping differs')
    }
  }
  return structuredClone(value)
}
