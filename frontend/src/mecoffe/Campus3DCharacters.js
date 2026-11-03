// Original procedural low-poly characters: no downloaded models or textures.
// The batch reads presentation transforms; it never owns routes or positions.
import * as THREE from 'three'
import { prototypeParams } from './assetCatalog.js'

const CHARACTER_PARAMS = prototypeParams('character.solid')
export const CHARACTER_ROLE_COLORS = Object.freeze(CHARACTER_PARAMS.role_colors)

const SKIN = CHARACTER_PARAMS.skin
const HAIR = CHARACTER_PARAMS.hair
const TAU = Math.PI * 2

function hashOf(value) {
  let hash = 2166136261
  for (const char of String(value)) hash = Math.imul(hash ^ char.codePointAt(0), 16777619)
  return hash >>> 0
}

export function characterAppearance(person = {}) {
  const hash = hashOf(person.id || 'character')
  const student = ['undergraduate_consumer', 'graduate_consumer'].includes(person.role)
  return {
    shirt: CHARACTER_ROLE_COLORS[person.role] || '#6389a3',
    trousers: person.role === 'merchant' ? '#3f4853' : person.role === 'teacher_consumer' ? '#394b59' : '#344d6a',
    shoes: '#27323b',
    skin: SKIN[hash % SKIN.length],
    hair: HAIR[(hash >>> 3) % HAIR.length],
    hairStyle: (hash >>> 5) % 3,
    backpack: student,
    backpackColor: person.role === 'graduate_consumer' ? '#d5a868' : '#c59a59',
    apron: person.role === 'merchant',
    cap: person.role === 'merchant',
    collar: person.role === 'teacher_consumer',
    phaseOffset: (hash % 1024) / 1024 * TAU,
  }
}

// Seconds is an absolute, caller-controlled animation clock. Calling update
// with an unchanged value freezes every joint, including idle breathing.
export function walkingPose(seconds = 0, id = '', walking = false, hasCoffee = false) {
  const time = Number.isFinite(seconds) ? seconds : 0
  const seed = (hashOf(id) % 1024) / 1024 * TAU
  const phase = time * TAU * 1.7 + seed
  const stride = walking ? Math.sin(phase) : 0
  return {
    leftLeg: stride * 0.62,
    rightLeg: -stride * 0.62,
    leftArm: walking ? -stride * 0.5 : -0.04,
    rightArm: hasCoffee ? -0.95 : walking ? stride * 0.5 : -0.04,
    leftForearm: -0.08,
    rightForearm: hasCoffee ? -0.35 : -0.08,
    bob: walking ? Math.abs(Math.sin(phase * 2)) * 0.12 : Math.sin(time * 0.9 + seed) * 0.025,
    headTilt: Math.sin(time * 0.65 + seed) * 0.018,
    coffee: Boolean(hasCoffee),
  }
}

export function facingAngle(dx, dz, fallback = 0) {
  return Number.isFinite(dx) && Number.isFinite(dz) && Math.hypot(dx, dz) > 1e-9
    ? Math.atan2(dx, dz) : fallback
}

/**
 * One InstancedMesh per body part, rather than one draw call per person.
 * entry.figure remains the existing (unrendered) root containing hit/halo.
 * Forward is +Z; the renderer's atan2(dx,dz) rotation therefore stays valid.
 */
export class CharacterBatch {
  constructor({ scene, entries } = {}) {
    if (!scene || !entries) throw new Error('CharacterBatch needs a scene and the existing person entries')
    this.scene = scene
    this.actors = [...entries.values()].sort((a, b) => String(a.person.id).localeCompare(String(b.person.id)))
    this.indices = new Map(this.actors.map((entry, index) => [entry.person.id, index]))
    this.appearances = this.actors.map(entry => characterAppearance(entry.person))
    this.group = new THREE.Group()
    this.group.name = 'mecoffe-procedural-characters'
    this.meshes = new Map()
    this.material = new THREE.MeshStandardMaterial({ color: 0xffffff, flatShading: true, roughness: 0.83 })
    this.faceMaterial = new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1 })
    this.matrix = new THREE.Matrix4()
    this.worldMatrix = new THREE.Matrix4()
    this.rootMatrix = new THREE.Matrix4()
    this.inverseBatch = new THREE.Matrix4()
    this.hiddenMatrix = new THREE.Matrix4().makeScale(0, 0, 0)
    this.position = new THREE.Vector3()
    this.rotation = new THREE.Euler()
    this.quaternion = new THREE.Quaternion()
    this.scale = new THREE.Vector3(1, 1, 1)
    this.quality = 'high'
    this.disposed = false
    this.makeMeshes()
    this.scene.add(this.group)
    this.update(0)
  }

  makePart(name, geometry, colorFor, { face = false } = {}) {
    const mesh = new THREE.InstancedMesh(geometry, face ? this.faceMaterial : this.material, this.actors.length)
    mesh.name = `character-${name}`
    mesh.userData.characterPart = name
    mesh.instanceMatrix.setUsage(THREE.DynamicDrawUsage)
    mesh.frustumCulled = false // Instances move; their visible region is not the unit mesh's initial bounds.
    mesh.castShadow = !face
    mesh.receiveShadow = false
    for (let i = 0; i < this.actors.length; i += 1) {
      mesh.setMatrixAt(i, this.hiddenMatrix)
      mesh.setColorAt(i, new THREE.Color(colorFor(this.appearances[i])))
    }
    if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    this.meshes.set(name, mesh)
    this.group.add(mesh)
  }

  makeMeshes() {
    const box = (x, y, z) => new THREE.BoxGeometry(x, y, z)
    const shirt = appearance => appearance.shirt
    const skin = appearance => appearance.skin
    const trousers = appearance => appearance.trousers
    const dark = () => '#29333b'
    this.makePart('torso', box(2.15, 2.6, 1.22), shirt)
    this.makePart('hips', box(1.75, 0.55, 1.05), trousers)
    this.makePart('neck', new THREE.CylinderGeometry(0.36, 0.4, 0.5, 6), skin)
    this.makePart('head', new THREE.SphereGeometry(0.96, 8, 6), skin)
    this.makePart('hair', new THREE.SphereGeometry(1.0, 8, 4, 0, TAU, 0, Math.PI * 0.56), appearance => appearance.hair)
    this.makePart('back-hair', box(1.45, 1.1, 0.5), appearance => appearance.hair)
    for (const side of ['left', 'right']) {
      this.makePart(`${side}-eye`, box(0.14, 0.17, 0.09), dark, { face: true })
      this.makePart(`${side}-ear`, new THREE.SphereGeometry(0.2, 5, 4), skin)
      this.makePart(`${side}-leg`, box(0.72, 2.6, 0.88), trousers)
      this.makePart(`${side}-shoe`, box(0.86, 0.58, 1.4), appearance => appearance.shoes)
      this.makePart(`${side}-sleeve`, box(0.62, 1.4, 0.65), shirt)
      this.makePart(`${side}-forearm`, box(0.45, 1.05, 0.48), skin)
      this.makePart(`${side}-hand`, box(0.5, 0.4, 0.5), skin)
      this.makePart(`${side}-strap`, box(0.14, 2.15, 0.12), appearance => appearance.backpackColor)
    }
    this.makePart('nose', new THREE.SphereGeometry(0.14, 5, 4), skin, { face: true })
    this.makePart('mouth', box(0.24, 0.05, 0.06), () => '#955e4d', { face: true })
    this.makePart('backpack', box(1.35, 1.75, 0.67), appearance => appearance.backpackColor)
    this.makePart('collar', box(0.75, 0.45, 0.14), () => '#f2efe5')
    this.makePart('apron', box(1.58, 2.15, 0.13), () => '#f5e6c6')
    this.makePart('apron-strap', box(0.27, 0.62, 0.15), () => '#f5e6c6')
    this.makePart('cap', new THREE.CylinderGeometry(1.03, 1.03, 0.36, 8), () => '#f2e7cf')
    this.makePart('cap-brim', box(1.28, 0.12, 0.75), () => '#f2e7cf')
    this.makePart('cup', new THREE.CylinderGeometry(0.35, 0.27, 0.86, 8), () => '#f7eed8')
    this.makePart('cup-lid', new THREE.CylinderGeometry(0.38, 0.38, 0.12, 8), () => '#71523b')
    this.makePart('cup-band', new THREE.CylinderGeometry(0.326, 0.31, 0.25, 8), appearance => appearance.shirt)
  }

  local(x, y, z, rx = 0, ry = 0, rz = 0, sx = 1, sy = 1, sz = 1) {
    this.position.set(x, y, z)
    this.rotation.set(rx, ry, rz)
    this.quaternion.setFromEuler(this.rotation)
    this.scale.set(sx, sy, sz)
    return this.matrix.compose(this.position, this.quaternion, this.scale)
  }

  put(name, index, local, visible = true) {
    const mesh = this.meshes.get(name)
    if (!visible) { mesh.setMatrixAt(index, this.hiddenMatrix); return }
    this.worldMatrix.multiplyMatrices(this.rootMatrix, local)
    mesh.setMatrixAt(index, this.worldMatrix)
  }

  update(elapsedSeconds = 0) {
    if (this.disposed) return
    this.group.updateWorldMatrix(true, false)
    this.inverseBatch.copy(this.group.matrixWorld).invert()
    for (let index = 0; index < this.actors.length; index += 1) {
      const entry = this.actors[index]
      if (entry.presentationVisible === false) {
        for (const mesh of this.meshes.values()) mesh.setMatrixAt(index, this.hiddenMatrix)
        continue
      }
      entry.figure.updateWorldMatrix(true, false)
      this.rootMatrix.multiplyMatrices(this.inverseBatch, entry.figure.matrixWorld)
      const appearance = this.appearances[index]
      const carrying = Boolean(entry.hasCoffee || entry.walker?.phase === 'return')
      const moving = entry.walker?.phase === 'outbound' || entry.walker?.phase === 'return'
      const pose = walkingPose(elapsedSeconds, entry.person.id, moving, carrying)
      const bob = pose.bob
      this.put('torso', index, this.local(0, 4.82 + bob, 0))
      this.put('hips', index, this.local(0, 3.45 + bob * 0.4, 0))
      this.put('neck', index, this.local(0, 6.25 + bob, 0))
      this.put('head', index, this.local(0, 7.18 + bob, 0, 0, 0, pose.headTilt))
      this.put('hair', index, this.local(0, 7.23 + bob, -0.04, 0, 0, pose.headTilt))
      this.put('back-hair', index, this.local(0, 6.82 + bob, -0.72), appearance.hairStyle === 1 && !appearance.cap)
      this.put('nose', index, this.local(0, 7.06 + bob, 0.99))
      this.put('mouth', index, this.local(0, 6.8 + bob, 0.9))
      for (const [side, sign] of [['left', -1], ['right', 1]]) {
        this.put(`${side}-eye`, index, this.local(sign * 0.29, 7.32 + bob, 0.88))
        this.put(`${side}-ear`, index, this.local(sign * 0.91, 7.06 + bob, 0))
        const leg = pose[`${side}Leg`]
        const hip = new THREE.Matrix4().makeTranslation(sign * 0.5, 3.4 + bob * 0.4, 0)
          .multiply(new THREE.Matrix4().makeRotationX(leg))
        this.put(`${side}-leg`, index, hip.clone().multiply(new THREE.Matrix4().makeTranslation(0, -1.3, 0)))
        this.put(`${side}-shoe`, index, hip.clone().multiply(new THREE.Matrix4().makeTranslation(0, -2.83, 0.24)))
        const shoulder = new THREE.Matrix4().makeTranslation(sign * 1.3, 5.85 + bob, 0)
          .multiply(new THREE.Matrix4().makeRotationX(pose[`${side}Arm`]))
        this.put(`${side}-sleeve`, index, shoulder.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.7, 0)))
        const elbow = shoulder.clone().multiply(new THREE.Matrix4().makeTranslation(0, -1.4, 0))
          .multiply(new THREE.Matrix4().makeRotationX(pose[`${side}Forearm`]))
        this.put(`${side}-forearm`, index, elbow.clone().multiply(new THREE.Matrix4().makeTranslation(0, -0.525, 0)))
        this.put(`${side}-hand`, index, elbow.clone().multiply(new THREE.Matrix4().makeTranslation(0, -1.12, 0)))
        this.put(`${side}-strap`, index, this.local(sign * 0.66, 4.9 + bob, 0.68), appearance.backpack)
        if (side === 'right') {
          const hand = new THREE.Vector3(0, -1.12, 0.08).applyMatrix4(elbow)
          this.put('cup', index, this.local(hand.x, hand.y + 0.34, hand.z + 0.08), carrying)
          this.put('cup-lid', index, this.local(hand.x, hand.y + 0.81, hand.z + 0.08), carrying)
          this.put('cup-band', index, this.local(hand.x, hand.y + 0.34, hand.z + 0.08), carrying)
        }
      }
      this.put('backpack', index, this.local(0, 4.9 + bob, -0.86), appearance.backpack)
      this.put('collar', index, this.local(0, 5.87 + bob, 0.68), appearance.collar)
      this.put('apron', index, this.local(0, 4.55 + bob, 0.7), appearance.apron)
      this.put('apron-strap', index, this.local(0, 5.83 + bob, 0.7), appearance.apron)
      this.put('cap', index, this.local(0, 8.05 + bob, -0.02), appearance.cap)
      this.put('cap-brim', index, this.local(0, 7.93 + bob, 0.77), appearance.cap)
    }
    for (const mesh of this.meshes.values()) mesh.instanceMatrix.needsUpdate = true
  }

  setQuality(quality) {
    this.quality = quality === 'low' ? 'low' : 'high'
    for (const [name, mesh] of this.meshes) {
      mesh.castShadow = this.quality === 'high' && !/eye|nose|mouth/.test(name)
    }
  }

  dispose() {
    if (this.disposed) return
    this.disposed = true
    this.group.removeFromParent()
    for (const mesh of this.meshes.values()) {
      mesh.geometry.dispose()
      mesh.dispose()
    }
    this.material.dispose()
    this.faceMaterial.dispose()
    this.group.clear()
    this.meshes.clear()
  }
}
