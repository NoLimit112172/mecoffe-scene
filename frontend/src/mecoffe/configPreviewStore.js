// Local uploads live only in this tab's memory and are never persisted or put in URLs.
let localPreview = null
export function hasConfigPreviewRoute(query) {
  return query.preview === 'local' || query.session != null || query.config != null
}
export function rememberLocalPreview(value) { localPreview = value }
export function localPreviewInput() { return localPreview }
export function previewQuery(query) {
  return query.preview === 'local' ? {preview:'local'} : {session:query.session,config:query.config}
}
