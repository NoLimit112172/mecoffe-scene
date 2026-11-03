// Casting synthetic display avatars. Source people and their attributes are
// read-only; appearance labels below come from the model publisher.
import { rocketboxHash } from './rocketboxCharacterModel.js'

export function profileGender(person) {
  const value=String(person.gender??'').trim().toLowerCase()
  if(['m','male','男','男性'].includes(value))return 'male'
  if(['f','female','女','女性'].includes(value))return 'female'
  return null // Never infer gender from a name, photograph or role.
}
export function campusModelForPerson(person,models) {
  const gender=profileGender(person),outfit=person.role==='teacher_consumer'?'business':'casual'
  const eligible=models.filter(m=>m.ethnicity==='Asian'&&m.age_group==='adult'&&m.category===outfit&&(!gender||m.gender===gender))
    .sort((a,b)=>a.id.localeCompare(b.id,'en'))
  if(!eligible.length)throw new Error(`校园人物缺少匹配外观：${person.id} / ${gender||'性别未提供'} / ${outfit}`)
  return eligible[rocketboxHash(person.id)%eligible.length].id
}
export function campusAssignments(people,models) {
  return new Map(people.map(person=>[String(person.id),campusModelForPerson(person,models)]))
}
