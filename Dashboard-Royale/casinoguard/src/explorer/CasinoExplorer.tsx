import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { Line, OrbitControls, OrthographicCamera } from '@react-three/drei'
import * as THREE from 'three'
import { loadData, useData } from '../lib/data'
import { scoreMachines, type MachinePerf } from '../lib/q1'
import { MONTHS } from '../lib/period'
import { num, pct, usd } from '../lib/format'
import type { Q1Data, Q3Data, Ticket } from '../lib/types'
import { ZONE_COLORS } from '../components/chart'

/**
 * 3D Casino Explorer: every machine at its recorded slot (floor_locations x/y
 * in metres), coloured by zone or by Q1 performance, with the validated Q1
 * bottom-10 marked by red glowing bases. Machine facing is not in the data;
 * machines face perpendicular to their bank's row, toward the zone's centre.
 */

// ---------------------------------------------------------------------------
// Data
// ---------------------------------------------------------------------------

interface FloorData {
  as_of: string
  floors: { floor_id: string; name: string }[]
  zones: { zone_id: string; name: string; x: number; y: number }[]
  banks: { bank_id: string; zone_id: string; x: number; y: number; capacity: number | null }[]
  slots: { location_id: string; zone_id: string; bank_id: string; x: number; y: number }[]
  entrances: { location_id: string; zone_id: string; name: string; x: number; y: number }[]
  outlets: { location_id: string; zone_id: string; name: string; x: number; y: number; capacity: number | null }[]
  walkways: { walkway_id: string; zone_a: string; zone_b: string; length_m: number; closed_from_utc: string | null; closed_to_utc: string | null; closure_reason: string | null }[]
  placements: { machine_id: string; location_id: string; config_id: string; from_utc: string }[]
  placement_history: Record<string, { location_id: string; config_id: string; from_utc: string; to_utc: string | null }[]>
}

interface PlacedMachine {
  index: number
  perf: MachinePerf
  slot: FloorData['slots'][number]
  x: number
  z: number
  rot: number
  bottomRank: number | null
}

type ColorMode = 'zone' | 'theo' | 'occupancy'

const FULL_PERIOD_DAYS = 181
type OrbitControlsImpl = React.ComponentRef<typeof OrbitControls>
const MACHINE_MAX_ZOOM = 60
const MARKER_ZOOM = 9

// ---------------------------------------------------------------------------
// Reusable slot-machine model: five parts, each drawn as one instanced mesh.
// ---------------------------------------------------------------------------

const REDUCED_MOTION = typeof window !== 'undefined' && window.matchMedia?.('(prefers-reduced-motion: reduce)').matches

const PARTS = {
  plinth: { size: [1.08, 0.14, 0.86], offset: [0, 0.07, 0], tilt: 0 },
  cabinet: { size: [0.94, 1.42, 0.66], offset: [0, 0.14 + 0.71, -0.02], tilt: 0 },
  deck: { size: [0.9, 0.07, 0.3], offset: [0, 0.9, 0.38], tilt: -0.32 },
  screen: { size: [0.76, 0.54, 0.03], offset: [0, 1.2, 0.32], tilt: 0 },
  topper: { size: [0.94, 0.24, 0.48], offset: [0, 1.56 + 0.12, -0.06], tilt: 0 },
} as const
type Part = keyof typeof PARTS
const PART_KEYS = Object.keys(PARTS) as Part[]
const HOVER_LIFT = 0.12

const boxes = Object.fromEntries(
  Object.entries(PARTS).map(([k, p]) => [k, new THREE.BoxGeometry(...p.size)]),
) as Record<Part, THREE.BoxGeometry>

const _rot = new THREE.Matrix4(), _tilt = new THREE.Matrix4(), _off = new THREE.Vector3()
function partMatrix(m: PlacedMachine, part: Part, target: THREE.Matrix4, lift = 0) {
  const { offset: [ox, oy, oz], tilt } = PARTS[part]
  _rot.makeRotationY(m.rot)
  _off.set(ox, oy, oz).applyMatrix4(_rot)
  target.copy(_rot)
  if (tilt) target.multiply(_tilt.makeRotationX(tilt))
  return target.setPosition(m.x + _off.x, _off.y + lift, m.z + _off.z)
}

function Machines({ machines, colors, hovered, selected, onHover, onSelect }: {
  machines: PlacedMachine[]
  colors: THREE.Color[]
  hovered: number | null
  selected: number | null
  onHover: (index: number | null) => void
  onSelect: (index: number) => void
}) {
  const refs = {
    plinth: useRef<THREE.InstancedMesh>(null),
    cabinet: useRef<THREE.InstancedMesh>(null),
    deck: useRef<THREE.InstancedMesh>(null),
    screen: useRef<THREE.InstancedMesh>(null),
    topper: useRef<THREE.InstancedMesh>(null),
  }

  // Positions: hovered and selected machines rise slightly off their base.
  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4()
    for (const part of PART_KEYS) {
      const mesh = refs[part].current
      if (!mesh) continue
      machines.forEach((m, i) => {
        const lift = part === 'plinth' ? 0 : i === hovered || i === selected ? HOVER_LIFT : 0
        mesh.setMatrixAt(i, partMatrix(m, part, matrix, lift))
      })
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines, hovered, selected])

  useLayoutEffect(() => {
    const { cabinet, deck, topper, plinth } = Object.fromEntries(PART_KEYS.map((k) => [k, refs[k].current])) as Record<Part, THREE.InstancedMesh | null>
    if (!cabinet || !deck || !topper || !plinth) return
    const body = new THREE.Color('#262c38'), hot = new THREE.Color('#465165'), gold = new THREE.Color('#d4b169')
    const base = new THREE.Color('#12161f'), red = new THREE.Color('#5c1818'), deckC = new THREE.Color('#1a1e27')
    machines.forEach((m, i) => {
      cabinet.setColorAt(i, i === selected ? gold : i === hovered ? hot : body)
      deck.setColorAt(i, i === selected ? gold : deckC)
      topper.setColorAt(i, colors[i])
      plinth.setColorAt(i, m.bottomRank ? red : base)
    })
    for (const mesh of [cabinet, deck, topper, plinth]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines, colors, hovered, selected])

  // Screens: the data colour with a slow, staggered shimmer (off for reduced motion).
  const tick = useRef(0)
  const tmp = useMemo(() => new THREE.Color(), [])
  useFrame(({ clock }, delta) => {
    const screen = refs.screen.current
    if (!screen) return
    tick.current += delta
    if (tick.current < 0.08 && screen.instanceColor) return
    tick.current = 0
    const t = clock.elapsedTime
    machines.forEach((m, i) => {
      const k = REDUCED_MOTION ? 1 : 0.9 + 0.14 * Math.sin(t * 1.4 + i * 0.73 + m.x * 0.05)
      screen.setColorAt(i, tmp.copy(colors[i]).multiplyScalar(i === selected ? 1.25 : k))
    })
    if (screen.instanceColor) screen.instanceColor.needsUpdate = true
  })

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId === undefined ? null : e.instanceId)
  const handlers = {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(pick(e)); document.body.style.cursor = 'pointer' },
    onPointerOut: () => { onHover(null); document.body.style.cursor = '' },
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const i = pick(e); if (i !== null) onSelect(i) },
  }
  const n = machines.length

  return (
    <group>
      <instancedMesh ref={refs.plinth} args={[boxes.plinth, undefined, n]} receiveShadow {...handlers}><meshStandardMaterial roughness={0.85} metalness={0.1} /></instancedMesh>
      <instancedMesh ref={refs.cabinet} args={[boxes.cabinet, undefined, n]} castShadow receiveShadow {...handlers}><meshStandardMaterial roughness={0.38} metalness={0.55} envMapIntensity={0.6} /></instancedMesh>
      <instancedMesh ref={refs.deck} args={[boxes.deck, undefined, n]} castShadow {...handlers}><meshStandardMaterial roughness={0.5} metalness={0.4} /></instancedMesh>
      <instancedMesh ref={refs.screen} args={[boxes.screen, undefined, n]} {...handlers}><meshBasicMaterial toneMapped={false} /></instancedMesh>
      <instancedMesh ref={refs.topper} args={[boxes.topper, undefined, n]} castShadow {...handlers}><meshBasicMaterial toneMapped={false} /></instancedMesh>
    </group>
  )
}

/** Gold ring and a soft light beam over the selected machine. */
function SelectionMarker({ machine }: { machine: PlacedMachine | null }) {
  const group = useRef<THREE.Group>(null)
  const ring = useRef<THREE.Mesh>(null)
  const beamMat = useRef<THREE.MeshBasicMaterial>(null)
  useFrame(({ clock }) => {
    if (!machine) return
    const t = clock.elapsedTime
    if (ring.current && !REDUCED_MOTION) ring.current.rotation.z = t * 0.8
    if (beamMat.current) beamMat.current.opacity = REDUCED_MOTION ? 0.14 : 0.1 + 0.06 * (Math.sin(t * 2.2) + 1) / 2
  })
  if (!machine) return null
  return (
    <group ref={group} position={[machine.x, 0, machine.z]}>
      <mesh ref={ring} rotation-x={-Math.PI / 2} position-y={0.05} raycast={() => null}>
        <ringGeometry args={[0.95, 1.12, 48, 1, 0, Math.PI * 1.6]} />
        <meshBasicMaterial color="#e6c47c" transparent opacity={0.95} toneMapped={false} depthWrite={false} />
      </mesh>
      <mesh position-y={4} raycast={() => null}>
        <cylinderGeometry args={[0.55, 0.85, 8, 32, 1, true]} />
        <meshBasicMaterial ref={beamMat} color="#f3d896" transparent opacity={0.12} side={THREE.DoubleSide} blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </mesh>
    </group>
  )
}

/** Red glowing bases under the Q1 bottom-10, pulsing gently. */
const BottomTenGlow = memo(function BottomTenGlow({ machines }: { machines: PlacedMachine[] }) {
  const ring = useRef<THREE.InstancedMesh>(null)
  const halo = useRef<THREE.InstancedMesh>(null)
  const ringMat = useRef<THREE.MeshBasicMaterial>(null)
  const haloMat = useRef<THREE.MeshBasicMaterial>(null)
  const targets = useMemo(() => machines.filter((m) => m.bottomRank), [machines])

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4()
    targets.forEach((m, i) => {
      matrix.makeRotationX(-Math.PI / 2).setPosition(m.x, 0.045, m.z) // just above the zone pad
      ring.current?.setMatrixAt(i, matrix)
      halo.current?.setMatrixAt(i, matrix)
    })
    if (ring.current) ring.current.instanceMatrix.needsUpdate = true
    if (halo.current) halo.current.instanceMatrix.needsUpdate = true
  }, [targets])

  useFrame(({ clock }) => {
    const t = (Math.sin(clock.elapsedTime * 2.4) + 1) / 2
    if (ringMat.current) ringMat.current.opacity = 0.6 + 0.35 * t
    if (haloMat.current) haloMat.current.opacity = 0.18 + 0.2 * t
  })

  if (!targets.length) return null
  return (
    <group>
      <instancedMesh ref={halo} args={[undefined, undefined, targets.length]} raycast={() => null}>
        <circleGeometry args={[1.9, 40]} />
        <meshBasicMaterial ref={haloMat} color="#ff2d2d" transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
      <instancedMesh ref={ring} args={[undefined, undefined, targets.length]} raycast={() => null}>
        <ringGeometry args={[0.85, 1.15, 40]} />
        <meshBasicMaterial ref={ringMat} color="#ff4040" transparent blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
      </instancedMesh>
    </group>
  )
})

// ---------------------------------------------------------------------------
// Floor: zone areas from their slots' real extent, walkways, entrances, outlets
// ---------------------------------------------------------------------------

function zoneBounds(floor: FloorData) {
  const bounds = new Map<string, { minX: number; maxX: number; minZ: number; maxZ: number }>()
  for (const s of floor.slots) {
    const b = bounds.get(s.zone_id) ?? { minX: Infinity, maxX: -Infinity, minZ: Infinity, maxZ: -Infinity }
    b.minX = Math.min(b.minX, s.x); b.maxX = Math.max(b.maxX, s.x)
    b.minZ = Math.min(b.minZ, s.y); b.maxZ = Math.max(b.maxZ, s.y)
    bounds.set(s.zone_id, b)
  }
  return bounds
}

// Procedural textures (drawn once): a patterned casino carpet and a soft light pool.
let carpetTexture: THREE.CanvasTexture | null = null
function carpet() {
  if (carpetTexture) return carpetTexture
  const n = 256, c = document.createElement('canvas')
  c.width = c.height = n
  const g = c.getContext('2d')!
  g.fillStyle = '#1a2440'
  g.fillRect(0, 0, n, n)
  const img = g.getImageData(0, 0, n, n)
  for (let i = 0; i < img.data.length; i += 4) {
    const v = (Math.random() - 0.5) * 10
    img.data[i] += v; img.data[i + 1] += v; img.data[i + 2] += v * 1.4
  }
  g.putImageData(img, 0, 0)
  g.strokeStyle = 'rgba(212, 177, 105, 0.2)'
  g.lineWidth = 2
  g.beginPath(); g.moveTo(n / 2, 0); g.lineTo(n, n / 2); g.lineTo(n / 2, n); g.lineTo(0, n / 2); g.closePath(); g.stroke()
  g.strokeStyle = 'rgba(120, 140, 200, 0.07)'
  g.beginPath(); g.moveTo(n / 2, n * 0.18); g.lineTo(n * 0.82, n / 2); g.lineTo(n / 2, n * 0.82); g.lineTo(n * 0.18, n / 2); g.closePath(); g.stroke()
  g.fillStyle = 'rgba(212, 177, 105, 0.22)'
  for (const [x, y] of [[n / 2, n / 2], [0, 0], [n, 0], [0, n], [n, n]]) { g.beginPath(); g.arc(x, y, 3.2, 0, Math.PI * 2); g.fill() }
  carpetTexture = new THREE.CanvasTexture(c)
  carpetTexture.wrapS = carpetTexture.wrapT = THREE.RepeatWrapping
  carpetTexture.colorSpace = THREE.SRGBColorSpace
  carpetTexture.anisotropy = 8
  return carpetTexture
}

let poolTexture: THREE.CanvasTexture | null = null
function lightPool() {
  if (poolTexture) return poolTexture
  const n = 128, c = document.createElement('canvas')
  c.width = c.height = n
  const g = c.getContext('2d')!
  const grad = g.createRadialGradient(n / 2, n / 2, 0, n / 2, n / 2, n / 2)
  grad.addColorStop(0, 'rgba(255,255,255,1)')
  grad.addColorStop(0.45, 'rgba(255,255,255,0.35)')
  grad.addColorStop(1, 'rgba(255,255,255,0)')
  g.fillStyle = grad
  g.fillRect(0, 0, n, n)
  poolTexture = new THREE.CanvasTexture(c)
  poolTexture.colorSpace = THREE.SRGBColorSpace
  return poolTexture
}

// The floor footprint: every slot, entrance and outlet, with a margin.
const FLOOR = { minX: -6, maxX: 142, minZ: -10, maxZ: 120 }
const FLOOR_W = FLOOR.maxX - FLOOR.minX, FLOOR_D = FLOOR.maxZ - FLOOR.minZ
const FLOOR_C: [number, number] = [(FLOOR.minX + FLOOR.maxX) / 2, (FLOOR.minZ + FLOOR.maxZ) / 2]
const WARM = new THREE.Color('#ffd9a0')

const FloorScene = memo(function FloorScene({ floor, focusZone }: { floor: FloorData; focusZone: string | null }) {
  const bounds = useMemo(() => zoneBounds(floor), [floor])
  const hub = new Map(floor.zones.map((z) => [z.zone_id, z]))
  const pad = 2.5
  const texture = useMemo(() => {
    const t = carpet().clone()
    t.needsUpdate = true
    t.repeat.set(FLOOR_W / 4, FLOOR_D / 4)
    return t
  }, [])
  const trim = 0.28

  return (
    <group>
      {/* Surround and carpeted floor with a gold trim */}
      <mesh rotation-x={-Math.PI / 2} position={[FLOOR_C[0], -0.06, FLOOR_C[1]]} receiveShadow>
        <planeGeometry args={[FLOOR_W + 120, FLOOR_D + 120]} />
        <meshStandardMaterial color="#05070d" roughness={1} />
      </mesh>
      <mesh rotation-x={-Math.PI / 2} position={[FLOOR_C[0], -0.02, FLOOR_C[1]]} receiveShadow>
        <planeGeometry args={[FLOOR_W, FLOOR_D]} />
        <meshStandardMaterial map={texture} color="#e4e8f2" roughness={0.92} metalness={0} />
      </mesh>
      {[
        [FLOOR_C[0], FLOOR.minZ, FLOOR_W + trim, trim], [FLOOR_C[0], FLOOR.maxZ, FLOOR_W + trim, trim],
        [FLOOR.minX, FLOOR_C[1], trim, FLOOR_D + trim], [FLOOR.maxX, FLOOR_C[1], trim, FLOOR_D + trim],
      ].map(([x, z, w, d], i) => (
        <mesh key={i} position={[x, 0.05, z]} castShadow receiveShadow>
          <boxGeometry args={[w, 0.14, d]} />
          <meshStandardMaterial color="#c9a45c" metalness={0.85} roughness={0.28} />
        </mesh>
      ))}

      {/* Walkways: paths between zone hubs */}
      {floor.walkways.map((w) => {
        const a = hub.get(w.zone_a), b = hub.get(w.zone_b)
        if (!a || !b) return null
        const dx = b.x - a.x, dz = b.y - a.y, len = Math.hypot(dx, dz)
        return (
          <group key={w.walkway_id}>
            <mesh rotation-x={-Math.PI / 2} rotation-z={-Math.atan2(dz, dx)} position={[(a.x + b.x) / 2, 0.004, (a.y + b.y) / 2]} receiveShadow>
              <planeGeometry args={[len, 3.2]} />
              <meshStandardMaterial color="#1a2236" roughness={0.9} transparent opacity={0.85} />
            </mesh>
            <Line points={[[a.x, 0.02, a.y], [b.x, 0.02, b.y]]} color="#c9a45c" lineWidth={1} transparent opacity={0.35} dashed dashSize={1.2} gapSize={1} />
          </group>
        )
      })}

      {/* Zones: inlaid pads, a glowing edge and a warm light pool */}
      {floor.zones.map((z) => {
        const b = bounds.get(z.zone_id)
        if (!b) return null
        const w = b.maxX - b.minX + pad * 2, d = b.maxZ - b.minZ + pad * 2
        const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
        const color = ZONE_COLORS[z.zone_id] ?? '#5b6270'
        const dim = focusZone && focusZone !== z.zone_id
        const padColor = new THREE.Color('#0f1526').lerp(new THREE.Color(color), dim ? 0.06 : 0.16)
        const corners: [number, number, number][] = [
          [b.minX - pad, 0.05, b.minZ - pad], [b.maxX + pad, 0.05, b.minZ - pad],
          [b.maxX + pad, 0.05, b.maxZ + pad], [b.minX - pad, 0.05, b.maxZ + pad], [b.minX - pad, 0.05, b.minZ - pad],
        ]
        return (
          <group key={z.zone_id}>
            <mesh position={[cx, 0.015, cz]} receiveShadow>
              <boxGeometry args={[w, 0.03, d]} />
              <meshStandardMaterial color={padColor} roughness={0.75} metalness={0.15} />
            </mesh>
            <Line points={corners} color={color} lineWidth={1.4} transparent opacity={dim ? 0.2 : 0.75} />
            <mesh rotation-x={-Math.PI / 2} position={[cx, 0.035, cz]} raycast={() => null}>
              <planeGeometry args={[Math.max(w, d) * 1.25, Math.max(w, d) * 1.25]} />
              <meshBasicMaterial map={lightPool()} color={WARM.clone().lerp(new THREE.Color(color), 0.35)} transparent opacity={dim ? 0.05 : 0.26}
                blending={THREE.AdditiveBlending} depthWrite={false} toneMapped={false} />
            </mesh>
          </group>
        )
      })}

      {/* Entrances: gold pylons with a lit floor ring */}
      {floor.entrances.map((e) => (
        <group key={e.location_id} position={[e.x, 0, e.y]}>
          <mesh position-y={1.6} castShadow>
            <cylinderGeometry args={[0.22, 0.3, 3.2, 20]} />
            <meshStandardMaterial color="#c9a45c" metalness={0.9} roughness={0.25} />
          </mesh>
          <mesh position-y={3.35}>
            <sphereGeometry args={[0.34, 20, 16]} />
            <meshBasicMaterial color="#ffe2a3" toneMapped={false} />
          </mesh>
          <mesh rotation-x={-Math.PI / 2} position-y={0.04} raycast={() => null}>
            <ringGeometry args={[1.1, 1.35, 40]} />
            <meshBasicMaterial color="#e6c47c" transparent opacity={0.7} toneMapped={false} depthWrite={false} />
          </mesh>
        </group>
      ))}

      {/* Bars and restaurants: round counters with a gold rim */}
      {floor.outlets.map((o) => (
        <group key={o.location_id} position={[o.x, 0, o.y]}>
          <mesh position-y={0.55} castShadow receiveShadow>
            <cylinderGeometry args={[2.4, 2.5, 1.1, 40]} />
            <meshStandardMaterial color="#1c1712" roughness={0.55} metalness={0.25} />
          </mesh>
          <mesh position-y={1.11} rotation-x={-Math.PI / 2}>
            <torusGeometry args={[2.38, 0.07, 10, 48]} />
            <meshStandardMaterial color="#c9a45c" metalness={0.9} roughness={0.25} />
          </mesh>
          <mesh position-y={1.12} rotation-x={-Math.PI / 2}>
            <circleGeometry args={[1.4, 32]} />
            <meshBasicMaterial color="#3a2a14" toneMapped={false} />
          </mesh>
        </group>
      ))}
    </group>
  )
})

/** Key light with soft shadows over the whole floor, plus a cool rim light. */
function Lights() {
  const key = useRef<THREE.DirectionalLight>(null)
  useLayoutEffect(() => {
    const l = key.current
    if (!l) return
    l.target.position.set(FLOOR_C[0], 0, FLOOR_C[1])
    l.target.updateMatrixWorld()
    const cam = l.shadow.camera
    cam.left = -110; cam.right = 110; cam.top = 110; cam.bottom = -110; cam.near = 1; cam.far = 420
    cam.updateProjectionMatrix()
  }, [])
  return (
    <>
      <hemisphereLight args={['#c3cfea', '#0a0d16', 0.7]} />
      <ambientLight intensity={0.12} />
      <directionalLight ref={key} position={[FLOOR_C[0] - 70, 140, FLOOR_C[1] + 55]} intensity={1.8} color="#ffe6c4"
        castShadow shadow-mapSize={[2048, 2048]} shadow-bias={-0.0004} shadow-normalBias={0.03} shadow-radius={4} />
      <directionalLight position={[FLOOR_C[0] + 90, 60, FLOOR_C[1] - 80]} intensity={0.35} color="#8fb0ff" />
    </>
  )
}

// ---------------------------------------------------------------------------
// Labels: plain DOM nodes over the canvas, positioned from 3D anchors each frame
// ---------------------------------------------------------------------------

interface Anchor { key: string; text: string; kind: 'zone' | 'marker'; color?: string; pos: THREE.Vector3 }

function Projector({ anchors, nodes, tipAnchor, tipNode }: {
  anchors: Anchor[]
  nodes: React.RefObject<(HTMLDivElement | null)[]>
  tipAnchor: THREE.Vector3 | null
  tipNode: React.RefObject<HTMLDivElement | null>
}) {
  const { camera, size } = useThree()
  const v = useMemo(() => new THREE.Vector3(), [])
  const place = (node: HTMLElement, pos: THREE.Vector3, anchor = '-50%, -50%') => {
    v.copy(pos).project(camera)
    const x = ((v.x + 1) / 2) * size.width, y = ((1 - v.y) / 2) * size.height
    node.style.transform = `translate(${x}px, ${y}px) translate(${anchor})`
  }
  useFrame(() => {
    // Zone names sit above their anchor and markers below their point, so they do not collide.
    // Entrance and outlet names appear once zoomed in, so the overview stays uncluttered.
    const showMarkers = (camera as THREE.OrthographicCamera).zoom >= MARKER_ZOOM
    anchors.forEach((a, i) => {
      const node = nodes.current?.[i]
      if (!node) return
      place(node, a.pos, a.kind === 'zone' ? '-50%, -115%' : '-50%, 10px')
      if (a.kind === 'marker') node.style.opacity = showMarkers ? '1' : '0'
    })
    if (tipNode.current && tipAnchor) place(tipNode.current, tipAnchor, '-50%, -120%')
  })
  return null
}

function labelAnchors(floor: FloorData): Anchor[] {
  const bounds = zoneBounds(floor)
  const zones = floor.zones.flatMap((z) => {
    const b = bounds.get(z.zone_id)
    return b ? [{ key: z.zone_id, text: z.name, kind: 'zone' as const, color: ZONE_COLORS[z.zone_id], pos: new THREE.Vector3((b.minX + b.maxX) / 2, 0.1, b.minZ - 3.7) }] : []
  })
  const markers = [
    ...floor.entrances.map((e) => ({ key: e.location_id, text: e.name, kind: 'marker' as const, pos: new THREE.Vector3(e.x, 0.1, e.y) })),
    ...floor.outlets.map((o) => ({ key: o.location_id, text: o.name, kind: 'marker' as const, pos: new THREE.Vector3(o.x, 1.2, o.y) })),
  ]
  return [...zones, ...markers]
}

// ---------------------------------------------------------------------------
// Camera: isometric view, focus on a zone, reset
// ---------------------------------------------------------------------------

interface View { target: THREE.Vector3; zoom: number; theta?: number; phi?: number }

const ISO_THETA = Math.PI / 4            // camera azimuth of the default isometric view
const ISO_PHI = Math.acos(1 / Math.sqrt(3)) // ~54.7° from vertical
const TOP_PHI = 0.06

function CameraRig({ view, controls }: { view: View; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()
  const goal = useRef<View | null>(null)
  const sph = useMemo(() => new THREE.Spherical(), [])
  const off = useMemo(() => new THREE.Vector3(), [])

  useEffect(() => { goal.current = { ...view, target: view.target.clone() } }, [view])

  useFrame((_, delta) => {
    const c = controls.current
    const g = goal.current
    if (!g || !c) return
    const ortho = camera as THREE.OrthographicCamera
    // Time-based easing: the same glide at 30, 60 or 120 fps, and no stall on slow devices.
    const k = 1 - Math.exp(-Math.min(delta, 0.5) * 6)
    const shift = g.target.clone().sub(c.target).multiplyScalar(k)
    c.target.add(shift)
    camera.position.add(shift)
    ortho.zoom += (g.zoom - ortho.zoom) * k
    let angleLeft = 0
    if (g.theta !== undefined || g.phi !== undefined) {
      off.copy(camera.position).sub(c.target)
      sph.setFromVector3(off)
      if (g.theta !== undefined) {
        let d = g.theta - sph.theta
        d = Math.atan2(Math.sin(d), Math.cos(d)) // shortest way round
        sph.theta += d * k
        angleLeft = Math.max(angleLeft, Math.abs(d))
      }
      if (g.phi !== undefined) {
        const d = g.phi - sph.phi
        sph.phi += d * k
        angleLeft = Math.max(angleLeft, Math.abs(d))
      }
      camera.position.copy(c.target).add(off.setFromSpherical(sph))
    }
    ortho.updateProjectionMatrix()
    c.update()
    if (shift.length() < 0.01 && Math.abs(g.zoom - ortho.zoom) < 0.01 && angleLeft < 0.002) goal.current = null
  })
  return null
}

// ---------------------------------------------------------------------------
// Explorer
// ---------------------------------------------------------------------------

const ORIGIN_TARGET = new THREE.Vector3(67, 0, 54)

export default function CasinoExplorer({ onClose }: { onClose: () => void }) {
  const floorData = useData<FloorData>('floor')
  const q1 = useData<Q1Data>('q1')
  const [colorMode, setColorMode] = useState<ColorMode>('zone')
  const [focusZone, setFocusZone] = useState<string | null>(null)
  const [hovered, setHovered] = useState<number | null>(null)
  const [selected, setSelected] = useState<number | null>(null)
  const [showLabels, setShowLabels] = useState(true)
  const [viewport, setViewport] = useState({ w: 1200, h: 800 })
  const controls = useRef<OrbitControlsImpl | null>(null)
  const labelNodes = useRef<(HTMLDivElement | null)[]>([])
  const tipNode = useRef<HTMLDivElement | null>(null)
  const [view, setView] = useState<View>({ target: ORIGIN_TARGET.clone(), zoom: 3 })

  // The validated Q1 scoring for the full Jan–Jun period, as on the Q1 page.
  const perf = useMemo(() => (q1.data ? scoreMachines(q1.data, MONTHS, FULL_PERIOD_DAYS) : []), [q1.data])

  const machines = useMemo<PlacedMachine[]>(() => {
    if (!floorData.data || !perf.length) return []
    const floor = floorData.data
    const slots = new Map(floor.slots.map((s) => [s.location_id, s]))
    const hubs = new Map(floor.zones.map((z) => [z.zone_id, z]))
    const perfById = new Map(perf.map((p) => [p.machine_id, p]))
    const bankSlots = new Map<string, FloorData['slots']>()
    floor.slots.forEach((s) => bankSlots.set(s.bank_id, [...(bankSlots.get(s.bank_id) ?? []), s]))

    return floor.placements.flatMap((pl) => {
      const slot = slots.get(pl.location_id), p = perfById.get(pl.machine_id)
      if (!slot || !p) return []
      // Face perpendicular to the bank's row, toward the zone centre.
      const row = bankSlots.get(slot.bank_id) ?? [slot]
      const first = row[0], last = row[row.length - 1]
      let dx = last.x - first.x, dz = last.y - first.y
      if (Math.hypot(dx, dz) < 0.01) { dx = 1; dz = 0 }
      let nx = -dz, nz = dx
      const hub = hubs.get(slot.zone_id)
      if (hub && (hub.x - slot.x) * nx + (hub.y - slot.y) * nz < 0) { nx = -nx; nz = -nz }
      return [{ index: 0, perf: p, slot, x: slot.x, z: slot.y, rot: Math.atan2(nx, nz), bottomRank: p.rank !== null && p.rank <= 10 ? p.rank : null }]
    }).map((m, index) => ({ ...m, index }))
  }, [floorData.data, perf])

  const colors = useMemo(() => {
    if (colorMode === 'zone') return machines.map((m) => new THREE.Color(ZONE_COLORS[m.slot.zone_id] ?? '#5b6270'))
    const value = (m: PlacedMachine) => (colorMode === 'theo' ? m.perf.theo_per_hour : m.perf.occupancy)
    const vals = machines.map(value).filter((v) => Number.isFinite(v)).sort((a, b) => a - b)
    const lo = vals[Math.floor(vals.length * 0.05)] ?? 0, hi = vals[Math.floor(vals.length * 0.95)] ?? 1
    const low = new THREE.Color('#1c3a66'), high = new THREE.Color('#9ec5f4')
    return machines.map((m) => {
      const v = value(m)
      if (!Number.isFinite(v)) return new THREE.Color('#3a4250')
      return low.clone().lerp(high, Math.min(1, Math.max(0, (v - lo) / (hi - lo || 1))))
    })
  }, [machines, colorMode])

  // Fit a region into the viewport (orthographic zoom = pixels per metre, isometric foreshortening ~0.7).
  const fit = useCallback((minX: number, maxX: number, minZ: number, maxZ: number) => {
    const span = Math.max(maxX - minX, maxZ - minZ) * 1.25 + 6
    return Math.min(MACHINE_MAX_ZOOM, Math.min(viewport.w, viewport.h) / span)
  }, [viewport])

  const resetView = useCallback(() => {
    setFocusZone(null)
    const zoom = fit(0, 135, -4, 112)
    setView({ target: ORIGIN_TARGET.clone(), zoom, theta: ISO_THETA, phi: ISO_PHI })
  }, [fit])

  // Fit the whole floor once the viewport is measured.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || viewport.w === 1200) return
    fitted.current = true
    // Intro: glide from a wide, rotated angle into the isometric overview.
    setView({ target: ORIGIN_TARGET.clone(), zoom: fit(0, 135, -4, 112), theta: ISO_THETA, phi: ISO_PHI })
  }, [viewport, fit])

  // On-screen camera controls: zoom, rotate 45°, top-down / isometric tilt.
  const current = () => {
    const c = controls.current
    if (!c) return null
    const off = c.object.position.clone().sub(c.target)
    return { target: c.target.clone(), zoom: (c.object as THREE.OrthographicCamera).zoom, sph: new THREE.Spherical().setFromVector3(off) }
  }
  const zoomBy = (f: number) => { const c = current(); if (c) setView({ target: c.target, zoom: Math.min(MACHINE_MAX_ZOOM, Math.max(2, c.zoom * f)) }) }
  const rotateBy = (d: number) => { const c = current(); if (c) setView({ target: c.target, zoom: c.zoom, theta: c.sph.theta + d }) }
  const [topDown, setTopDown] = useState(false)
  const toggleTilt = () => { const c = current(); if (!c) return; setTopDown((t) => !t); setView({ target: c.target, zoom: c.zoom, phi: topDown ? ISO_PHI : TOP_PHI }) }

  const focus = (zoneId: string | null) => {
    if (!zoneId || !floorData.data) return resetView()
    const b = zoneBounds(floorData.data).get(zoneId)
    if (!b) return
    setFocusZone(zoneId)
    setView({ target: new THREE.Vector3((b.minX + b.maxX) / 2, 0, (b.minZ + b.maxZ) / 2), zoom: fit(b.minX, b.maxX, b.minZ, b.maxZ) })
  }

  const flyTo = (m: PlacedMachine) => setView({ target: new THREE.Vector3(m.x, 0, m.z), zoom: Math.max(view.zoom, 22) })

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { if (selected !== null) setSelected(null); else onClose() }
    }
    window.addEventListener('keydown', onKey)
    document.body.style.overflow = 'hidden'
    return () => { window.removeEventListener('keydown', onKey); document.body.style.overflow = ''; document.body.style.cursor = '' }
  }, [onClose, selected])

  const floor = floorData.data
  const anchors = useMemo(() => (floor ? labelAnchors(floor) : []), [floor])
  const zoneName = (id: string) => floor?.zones.find((z) => z.zone_id === id)?.name ?? id
  const bottom = machines.filter((m) => m.bottomRank).sort((a, b) => a.bottomRank! - b.bottomRank!)
  const selectedMachine = selected !== null ? machines[selected] : null
  const hoveredMachine = hovered !== null ? machines[hovered] : null
  const error = floorData.error || q1.error

  return (
    <div className="x3d" role="dialog" aria-label="3D Casino Explorer">
      <header className="x3d-bar">
        <div className="x3d-title">
          <span className="brand-name" style={{ fontSize: 15 }}>3D Casino Explorer</span>
          <span className="small muted">{machines.length} machines at their recorded slots · end of analysis period</span>
        </div>
        <div className="x3d-controls">
          <label className="x3d-select">Floor
            <select value="MAIN" onChange={() => undefined} title="The dataset has one gaming floor">
              {(floor?.floors ?? [{ floor_id: 'MAIN', name: 'Main gaming floor' }]).map((f) => <option key={f.floor_id} value={f.floor_id}>{f.name}</option>)}
            </select>
          </label>
          <label className="x3d-select">Zone
            <select value={focusZone ?? ''} onChange={(e) => focus(e.target.value || null)}>
              <option value="">All zones</option>
              {floor?.zones.map((z) => <option key={z.zone_id} value={z.zone_id}>{z.name}</option>)}
            </select>
          </label>
          <div className="seg" role="group" aria-label="Colour machines by">
            {([['zone', 'Zone'], ['theo', 'Theo / avail. hr'], ['occupancy', 'Occupancy']] as const).map(([k, l]) => (
              <button key={k} className={colorMode === k ? 'on' : ''} onClick={() => setColorMode(k)}>{l}</button>
            ))}
          </div>
          <label className="x3d-check"><input type="checkbox" checked={showLabels} onChange={(e) => setShowLabels(e.target.checked)} /> Labels</label>
          <button className="btn sm" onClick={() => { setTopDown(false); resetView() }}>Reset view</button>
          <button className="btn sm gold" onClick={onClose} aria-label="Close 3D explorer">Close ✕</button>
        </div>
      </header>

      <div className="x3d-stage" ref={(el) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        if (Math.round(r.width) !== viewport.w || Math.round(r.height) !== viewport.h) setViewport({ w: Math.round(r.width), h: Math.round(r.height) })
      }}>
        {error && <div className="x3d-center">Couldn't load floor data: {error}</div>}
        {!error && (!floor || !machines.length) && <div className="x3d-center"><div className="x3d-loading"><span className="x3d-spinner" aria-hidden="true" />Loading the floor…</div></div>}
        {floor && machines.length > 0 && (
          <Canvas dpr={[1, 1.75]} shadows="soft" gl={{ antialias: true, powerPreference: 'high-performance' }} onPointerMissed={() => setSelected(null)}>
            <color attach="background" args={['#080c16']} />
            <OrthographicCamera makeDefault position={[67 + 40, 110, 54 + 150]} zoom={view.zoom} near={-500} far={1000} />
            <OrbitControls ref={controls} target={ORIGIN_TARGET} enableDamping dampingFactor={0.1} rotateSpeed={0.6} zoomSpeed={0.9} panSpeed={0.9}
              zoomToCursor screenSpacePanning minPolarAngle={0.02} maxPolarAngle={Math.PI / 2.35} minZoom={2} maxZoom={MACHINE_MAX_ZOOM} />
            <CameraRig view={view} controls={controls} />
            <Lights />
            <FloorScene floor={floor} focusZone={focusZone} />
            <BottomTenGlow machines={machines} />
            <SelectionMarker machine={selected !== null ? machines[selected] ?? null : null} />
            <Machines machines={machines} colors={colors} hovered={hovered} selected={selected} onHover={setHovered} onSelect={(i) => setSelected(i)} />
            <Projector anchors={anchors} nodes={labelNodes} tipNode={tipNode}
              tipAnchor={hoveredMachine ? new THREE.Vector3(hoveredMachine.x, 2.4, hoveredMachine.z) : null} />
          </Canvas>
        )}

        {floor && machines.length > 0 && (
          <div className="x3d-labels" aria-hidden="true">
            {showLabels && anchors.map((a, i) => (
              <div key={a.key} ref={(el) => { labelNodes.current[i] = el }} className={a.kind === 'zone' ? 'x3d-label' : 'x3d-marker'}>
                <span style={a.color ? { borderColor: a.color } : undefined}>{a.text}</span>
              </div>
            ))}
            <div ref={tipNode} className="x3d-tip" style={{ visibility: hoveredMachine && hovered !== selected ? 'visible' : 'hidden' }}>
              <span>{hoveredMachine && <><b>{hoveredMachine.perf.machine_id}</b> · {hoveredMachine.perf.theme}{hoveredMachine.bottomRank ? ` · Q1 #${hoveredMachine.bottomRank}` : ''}</>}</span>
            </div>
          </div>
        )}

        <div className="x3d-legend">
          {colorMode === 'zone' ? (
            floor?.zones.map((z) => <span key={z.zone_id}><i style={{ background: ZONE_COLORS[z.zone_id] }} />{z.name}</span>)
          ) : (
            <span className="x3d-ramp">Low <i /> High {colorMode === 'theo' ? 'theo per available hour' : 'occupancy'} (Jan–Jun)</span>
          )}
          <span><i className="x3d-red" />Q1 bottom-10 candidate</span>
          <span className="muted">Drag to rotate · scroll to zoom toward the cursor · right-drag to pan · facing direction is illustrative</span>
        </div>

        {floor && machines.length > 0 && (
          <div className={`x3d-nav ${selectedMachine ? 'with-panel' : ''}`} role="toolbar" aria-label="Camera">
            <button onClick={() => zoomBy(1.35)} aria-label="Zoom in" title="Zoom in">+</button>
            <button onClick={() => zoomBy(1 / 1.35)} aria-label="Zoom out" title="Zoom out">−</button>
            <span className="x3d-nav-sep" />
            <button onClick={() => rotateBy(Math.PI / 4)} aria-label="Rotate left" title="Rotate 45° left">⟲</button>
            <button onClick={() => rotateBy(-Math.PI / 4)} aria-label="Rotate right" title="Rotate 45° right">⟳</button>
            <button onClick={toggleTilt} aria-pressed={topDown} aria-label={topDown ? 'Isometric view' : 'Top-down view'} title={topDown ? 'Isometric view' : 'Top-down view'}>{topDown ? '◇' : '▢'}</button>
            <span className="x3d-nav-sep" />
            <button onClick={() => { setTopDown(false); resetView() }} aria-label="Reset view" title="Reset view">⌂</button>
          </div>
        )}

        <aside className="x3d-list">
          <div className="x3d-list-title">Q1 bottom 10 <span className="muted small">casino-wide, Jan–Jun</span></div>
          {bottom.map((m) => (
            <button key={m.perf.machine_id} className={selected === m.index ? 'on' : ''} onClick={() => { setSelected(m.index); flyTo(m) }}>
              <span className="x3d-rank">{m.bottomRank}</span>{m.perf.machine_id}<span className="muted small">{zoneName(m.slot.zone_id)}</span>
            </button>
          ))}
        </aside>

        {selectedMachine && <MachinePanel machine={selectedMachine} floor={floor!} rankedCount={perf.filter((p) => p.rank !== null).length} zoneName={zoneName} onClose={() => setSelected(null)} onFly={() => flyTo(selectedMachine)} />}
      </div>
    </div>
  )
}

// ---------------------------------------------------------------------------
// Side panel: the machine's recorded attributes, Q1 metrics and Q3 tickets
// ---------------------------------------------------------------------------

function MachinePanel({ machine, floor, rankedCount, zoneName, onClose, onFly }: {
  machine: PlacedMachine
  floor: FloorData
  rankedCount: number
  zoneName: (id: string) => string
  onClose: () => void
  onFly: () => void
}) {
  const [tickets, setTickets] = useState<Ticket[] | null>(null)
  const [ticketError, setTicketError] = useState<string | null>(null)
  const m = machine.perf
  const history = floor.placement_history[m.machine_id]
  const placement = floor.placements.find((p) => p.machine_id === m.machine_id)

  useEffect(() => {
    let live = true
    setTickets(null)
    loadData<Q3Data>('q3')
      .then((d) => live && setTickets(d.tickets.filter((t) => t.machine_id === m.machine_id)))
      .catch((e) => live && setTicketError(String(e)))
    return () => { live = false }
  }, [m.machine_id])

  const faults = tickets?.filter((t) => t.event_type === 'fault_repair') ?? []
  const row = (label: string, value: React.ReactNode) => <div className="x3d-row"><span className="muted">{label}</span><span className="strong tabnum">{value}</span></div>

  return (
    <aside className="x3d-panel" aria-label={`Machine ${m.machine_id}`}>
      <div className="x3d-panel-head">
        <div>
          <div className="small muted">{zoneName(machine.slot.zone_id)} · bank {machine.slot.bank_id} · slot {machine.slot.location_id}</div>
          <h2 style={{ fontSize: 18, margin: '2px 0' }}>{m.machine_id}</h2>
          <div className="small secondary">{m.theme} · {m.manufacturer}</div>
        </div>
        <button className="btn sm" onClick={onClose} aria-label="Close machine details">✕</button>
      </div>

      {machine.bottomRank && (
        <div className="callout warn" style={{ marginBottom: 10 }}>
          <b>Q1 bottom-10 candidate #{machine.bottomRank}</b> — preliminary, not a replacement order. See the Q1 page for the scoring method.
        </div>
      )}

      <h4>Q1 performance (Jan–Jun)</h4>
      {row('Casino-wide rank (worst = 1)', m.rank !== null ? `${m.rank} of ${rankedCount} eligible` : 'not ranked (not eligible)')}
      {row('Rank within zone', m.zone_rank !== null ? `${m.zone_rank} / ${m.zone_count}` : '—')}
      {row('Coin-in', usd(m.coin_in, 0))}
      {row('Theoretical win', usd(m.theo, 0))}
      {row('House win', usd(m.house_win, 0))}
      {row('Luck (house win − theo)', usd(m.luck, 0))}
      {row('Theo per available hour', Number.isFinite(m.theo_per_hour) ? usd(m.theo_per_hour, 2) : '—')}
      {row('Occupancy', Number.isFinite(m.occupancy) ? pct(m.occupancy, 1) : '—')}
      {row('Availability', Number.isFinite(m.availability) ? pct(m.availability, 1) : '—')}

      <h4>Machine</h4>
      {row('Configuration', `${m.config_id} · RTP ${pct(m.configured_rtp, 0)} · ${m.volatility}`)}
      {row('Lease class', m.lease_class.replace(/_/g, ' '))}
      {row('Installed', m.install_date)}
      {row('Floor position', `x ${num(machine.x, 1)} m, y ${num(machine.z, 1)} m`)}
      {placement && row('In this slot since', placement.from_utc.slice(0, 10))}
      {history && (
        <p className="small muted" style={{ margin: '4px 0 0' }}>
          Moved during the period: {history.map((h) => `${h.location_id} (${h.from_utc.slice(0, 10)}${h.to_utc ? ` → ${h.to_utc.slice(0, 10)}` : ' →'})`).join(', ')}
        </p>
      )}

      <h4>Maintenance (Q3)</h4>
      {ticketError ? <p className="small neg">{ticketError}</p> : !tickets ? <p className="small muted">Loading tickets…</p> : (
        <>
          {row('Fault repairs', faults.length)}
          {row('Repair cost', usd(m.repair_cost, 0))}
          {row('Fault downtime', `${num(faults.reduce((a, t) => a + t.downtime_hours, 0), 1)} h`)}
          {row('Other tickets', tickets.length - faults.length)}
        </>
      )}

      <div className="row mt-s" style={{ gap: 6 }}>
        <button className="btn sm" onClick={onFly}>Zoom to machine</button>
        <Link to="/q1" className="btn sm">Open Q1 →</Link>
      </div>
    </aside>
  )
}
