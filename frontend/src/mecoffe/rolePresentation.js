// Role titles only use explicit metadata. Never infer an identity from a name,
// biography or role identifier; the original role key remains on each person.
export const ROLE_LABEL_LIMIT=14
const useful=value=>typeof value==='string'&&value.trim().length>0

export function presentRole(role,description,limit=ROLE_LABEL_LIMIT){
  if(!useful(description))return {label:role,description:''}
  const full=description,plain=description.replace(/\s+/gu,' ').trim(),letters=Array.from(plain)
  const length=Number.isSafeInteger(limit)&&limit>0?limit:ROLE_LABEL_LIMIT
  return {label:letters.length>length?letters.slice(0,length).join('')+'…':plain,description:full}
}

// Snapshot.nodes is a dictionary payload in the team contract. An explicitly
// provided role_description can therefore travel with a frozen snapshot.
// The current native plan has no role-description field; policy IDs/background
// text are not reinterpreted as identity descriptions.
export function snapshotRoleDescriptions(snapshot){
  const descriptions=new Map()
  for(const node of snapshot?.nodes||[]){
    if(typeof node?.role!=='string'||!useful(node.role_description))continue
    if(!descriptions.has(node.role))descriptions.set(node.role,new Set())
    descriptions.get(node.role).add(node.role_description)
  }
  return new Map([...descriptions].map(([role,values])=>{
    const ordered=[...values].sort((a,b)=>a<b?-1:a>b?1:0)
    // Prefer an explicitly supplied Chinese description when one exists. The
    // stable lexical choice also makes conflicting metadata order-independent.
    return [role,ordered.find(value=>/\p{Script=Han}/u.test(value))||ordered[0]]
  }))
}
