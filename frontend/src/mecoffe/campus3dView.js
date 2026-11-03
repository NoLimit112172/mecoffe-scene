// Camera framing is based on the actual campus polygons, not road extents or
// the empty corners of their rectangular bounding box. Coordinates are metres:
// OSM x/east and y/north become Three.js x and -z, with height on the y axis.
import * as THREE from 'three'

function boundaryPoints(campus) {
  const rings = campus.boundary_polygons?.length
    ? campus.boundary_polygons.map(polygon => polygon.outer)
    : [campus.boundary]
  const points = rings.flatMap(ring => ring || [])
  if (points.length < 3 || points.some(point => !Array.isArray(point)
    || point.length < 2 || !Number.isFinite(point[0]) || !Number.isFinite(point[1]))) {
    throw new Error('校园边界缺少有效的米制坐标')
  }
  return points
}

export function campusBoundaryBounds(campus, margin = 12) {
  if (!Number.isFinite(margin) || margin < 0) throw new Error('地面余量必须是非负米数')
  const points = boundaryPoints(campus)
  const xs = points.map(point => point[0])
  const ys = points.map(point => point[1])
  const minX = Math.min(...xs) - margin
  const maxX = Math.max(...xs) + margin
  const minY = Math.min(...ys) - margin
  const maxY = Math.max(...ys) + margin
  return {
    minX, maxX, minY, maxY,
    width: maxX - minX,
    height: maxY - minY,
    center: new THREE.Vector3((minX + maxX) / 2, 0, -(minY + maxY) / 2),
  }
}

// At a fixed eye depth, choose a lateral camera coordinate that makes the
// projected minimum and maximum symmetric. Centering their world coordinates
// instead leaves perspective views visibly shifted toward the front parcel.
function projectedCenter(coordinates, depths) {
  let low = Math.min(...coordinates)
  let high = Math.max(...coordinates)
  for (let step = 0; step < 64; step += 1) {
    const middle = (low + high) / 2
    const projected = coordinates.map((coordinate, i) => (coordinate - middle) / depths[i])
    if (Math.min(...projected) + Math.max(...projected) > 0) low = middle
    else high = middle
  }
  return (low + high) / 2
}

/**
 * Return a perspective overview filling `fill` of the limiting screen axis.
 * The fit covers all actual outer boundary vertices and, by default, building
 * roof/footprint vertices. Interior holes remain holes in the renderer; they do
 * not expand the camera bounds. No road extent or arbitrary ground margin is
 * allowed to push the overview farther away.
 */
export function fitCampusView(campus, {
  aspect, fov = 42, fill = 0.8, direction,
  includeBuildings = true,
} = {}) {
  if (!Number.isFinite(aspect) || aspect <= 0) throw new Error('相机宽高比必须大于零')
  if (!Number.isFinite(fov) || fov <= 1 || fov >= 179) throw new Error('相机视野角无效')
  if (!Number.isFinite(fill) || fill <= 0 || fill >= 1) throw new Error('校园屏幕占比必须介于零和一之间')
  // This campus is longer north/south. An eastern overview presents that long
  // axis horizontally on landscape displays; portrait keeps the southern view.
  // Both remain genuinely perspective views with visible building side faces.
  const cameraDirection = (direction || (aspect >= 1.25
    ? new THREE.Vector3(0.85, 0.9, 0.22)
    : new THREE.Vector3(0.22, 0.9, 0.85))).clone()
  if (!Number.isFinite(cameraDirection.lengthSq()) || cameraDirection.lengthSq() === 0) {
    throw new Error('相机朝向无效')
  }
  cameraDirection.normalize()
  const referenceUp = Math.abs(cameraDirection.y) > 0.98
    ? new THREE.Vector3(0, 0, -1) : new THREE.Vector3(0, 1, 0)
  const right = new THREE.Vector3().crossVectors(referenceUp, cameraDirection).normalize()
  const up = new THREE.Vector3().crossVectors(cameraDirection, right).normalize()
  const points = boundaryPoints(campus).map(([x, y]) => new THREE.Vector3(x, 0, -y))
  if (includeBuildings) {
    for (const building of campus.buildings || []) {
      const height = Number.isFinite(building.height_m) ? Math.max(0, building.height_m) : 0
      for (const [x, y] of building.polygon || []) {
        if (!Number.isFinite(x) || !Number.isFinite(y)) throw new Error('建筑轮廓坐标无效')
        points.push(new THREE.Vector3(x, 0, -y), new THREE.Vector3(x, height + 0.2, -y))
      }
    }
  }
  const horizontal = points.map(point => point.dot(right))
  const vertical = points.map(point => point.dot(up))
  const longitudinal = points.map(point => point.dot(cameraDirection))
  const tanVertical = Math.tan(THREE.MathUtils.degToRad(fov) / 2)
  const tanHorizontal = tanVertical * aspect

  // Each point yields an interval for the lateral eye coordinate. The smallest
  // depth at which all intervals overlap is the exact perspective fit for that
  // axis. Solving this directly avoids the extra empty bbox corners and a
  // second arbitrary distance multiplier used by the old overview.
  const requiredDepth = (coordinates, tangent) => {
    const scale = fill * tangent
    const maximumLow = Math.max(...coordinates.map((value, i) => value + scale * longitudinal[i]))
    const minimumHigh = Math.min(...coordinates.map((value, i) => value - scale * longitudinal[i]))
    return (maximumLow - minimumHigh) / (2 * scale)
  }
  const eyeDepth = Math.max(requiredDepth(horizontal, tanHorizontal), requiredDepth(vertical, tanVertical),
    Math.max(...longitudinal) + 1) + 1e-6
  const depths = longitudinal.map(value => eyeDepth - value)
  const centerHorizontal = projectedCenter(horizontal, depths)
  const centerVertical = projectedCenter(vertical, depths)
  const targetDepth = (Math.min(...longitudinal) + Math.max(...longitudinal)) / 2
  const target = new THREE.Vector3()
    .addScaledVector(right, centerHorizontal)
    .addScaledVector(up, centerVertical)
    .addScaledVector(cameraDirection, targetDepth)
  const distance = eyeDepth - targetDepth
  const position = target.clone().addScaledVector(cameraDirection, distance)
  return { position, target, distance, points, fill, bounds: campusBoundaryBounds(campus) }
}
