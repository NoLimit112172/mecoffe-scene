// Shared building/decoration atlas helpers. No character frames are composed.
export function indexPixelAtlases(atlases) {
  const frames = new Map()
  atlases.forEach((atlas, sheet) => {
    for (const [key, frame] of Object.entries(atlas.frames || {})) frames.set(key, { ...frame, sheet, key })
  })
  return { frames }
}

export function atlasFrameDraw(frame, x = 0, y = 0) {
  const crop = frame.frame
  const trim = frame.spriteSourceSize || { x:0, y:0, w:frame.rotated ? crop.h : crop.w, h:frame.rotated ? crop.w : crop.h }
  return {
    source:[crop.x,crop.y,crop.w,crop.h],
    translate:frame.rotated ? [x+trim.x,y+trim.y+trim.h] : [x+trim.x,y+trim.y],
    rotation:frame.rotated ? -Math.PI/2 : 0,
    destination:frame.rotated ? [0,0,trim.h,trim.w] : [0,0,trim.w,trim.h],
  }
}
