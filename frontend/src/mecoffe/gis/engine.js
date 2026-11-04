/** Display adapter boundary. A future Cesium engine consumes this SAME scene
 * and replay controller: init, setPeople, setLayers, setBasemap, select,
 * focusPerson, resetCamera, requestFrame, dispose. Never imports a decision engine.
 */
export async function createGisDisplay(options){
  const {engine='maplibre'}=options
  if(engine!=='maplibre')throw new Error(`显示引擎暂不支持：${engine}`)
  const {MapLibreScene}=await import('./MapLibreScene.js')
  return new MapLibreScene(options).init()
}
