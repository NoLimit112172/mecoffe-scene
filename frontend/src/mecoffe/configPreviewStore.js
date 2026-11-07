// Imported inputs live only in this tab's memory and never enter URLs or storage.
let localPreview = null
export function hasConfigPreviewRoute(query) {
  return query.preview === 'local' || query.session != null || query.config != null || query.run != null
}
export function rememberLocalPreview(value) { localPreview = value }
export function localPreviewInput() { return localPreview }
export function previewQuery(query) {
  if (query.preview === 'local') return {preview:'local'}
  return query.run != null ? {session:query.session,run:query.run} : {session:query.session,config:query.config}
}
