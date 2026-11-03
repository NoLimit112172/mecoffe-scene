/** Repository assets live below Vite's base; external/blob URLs stay intact. */
export function publicUrl(value, base = import.meta.env?.BASE_URL || '/') {
  if(typeof value!=='string'||!value)return value
  if(/^(?:[a-z][a-z\d+.-]*:|\/\/|#)/i.test(value))return value
  const prefix=base.endsWith('/')?base:base+'/'
  if(prefix!=='/'&&value.startsWith(prefix))return value
  return prefix+value.replace(/^\/+/, '')
}

export const IS_PAGES = import.meta.env?.MODE === 'pages'
