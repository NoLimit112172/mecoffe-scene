// Role markers are presentation colours, independent of the avatar library.
export const CHARACTER_ROLE_COLORS = Object.freeze({
  undergraduate_consumer:'#397fca', graduate_consumer:'#8864c5', teacher_consumer:'#39806b', merchant:'#e58b48',
})
export const CHARACTER_BASE_COLORS = Object.freeze({
  undergraduate_consumer:'#4888bf', graduate_consumer:'#8b6ab0', teacher_consumer:'#4b9a83', merchant:'#dc8a3e',
})

// Unknown roles keep a stable display colour without assuming an occupation.
export function genericRoleColor(role) {
  const palette=['#3888aa','#8a78b4','#58916a','#bd794b','#597abe','#a66a8a','#738b47','#348b88']
  let hash=2166136261
  for(const ch of String(role))hash=Math.imul(hash^ch.codePointAt(0),16777619)>>>0
  return palette[hash%palette.length]
}

export function displayRoleColor(role, known={}) {
  return Object.hasOwn(known,role)?known[role]:genericRoleColor(role)
}
