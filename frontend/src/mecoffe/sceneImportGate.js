// DEV stays available. The embed's existing MECOFFE_PUBLIC_ envPrefix exposes
// this one opt-in build value; URL parameters cannot enable a closed build.
export const sceneLocalImportEnabled=typeof import.meta.env!=='undefined'&&
  (import.meta.env.DEV===true||
    (import.meta.env.MODE==='embed'&&import.meta.env.MECOFFE_PUBLIC_SCENE_LOCAL_IMPORT==='true'))
