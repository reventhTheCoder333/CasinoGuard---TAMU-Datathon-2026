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

// ---------------------------------------------------------------------------
// Reusable slot-machine model: four parts, each drawn as one instanced mesh.
// ---------------------------------------------------------------------------

const PARTS = {
  plinth: { size: [1.1, 0.14, 0.86], offset: [0, 0.07, 0] },
  cabinet: { size: [0.96, 1.42, 0.68], offset: [0, 0.14 + 0.71, 0] },
  screen: { size: [0.78, 0.56, 0.03], offset: [0, 1.12, 0.35] },
  topper: { size: [0.96, 0.26, 0.5], offset: [0, 1.56 + 0.13, -0.06] },
} as const

const boxes = Object.fromEntries(
  Object.entries(PARTS).map(([k, p]) => [k, new THREE.BoxGeometry(...p.size)]),
) as Record<keyof typeof PARTS, THREE.BoxGeometry>

function partMatrix(m: PlacedMachine, part: keyof typeof PARTS, target: THREE.Matrix4) {
  const [ox, oy, oz] = PARTS[part].offset
  const rotation = new THREE.Matrix4().makeRotationY(m.rot)
  const offset = new THREE.Vector3(ox, oy, oz).applyMatrix4(rotation)
  target.copy(rotation).setPosition(m.x + offset.x, offset.y, m.z + offset.z)
  return target
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
    screen: useRef<THREE.InstancedMesh>(null),
    topper: useRef<THREE.InstancedMesh>(null),
  }

  useLayoutEffect(() => {
    const matrix = new THREE.Matrix4()
    for (const part of Object.keys(PARTS) as (keyof typeof PARTS)[]) {
      const mesh = refs[part].current
      if (!mesh) continue
      machines.forEach((m, i) => mesh.setMatrixAt(i, partMatrix(m, part, matrix)))
      mesh.instanceMatrix.needsUpdate = true
      mesh.computeBoundingSphere()
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines])

  useLayoutEffect(() => {
    const cabinet = refs.cabinet.current, screen = refs.screen.current, topper = refs.topper.current, plinth = refs.plinth.current
    if (!cabinet || !screen || !topper || !plinth) return
    const body = new THREE.Color('#2a303c'), hot = new THREE.Color('#4a5466'), gold = new THREE.Color('#d4b169')
    const base = new THREE.Color('#161a22'), red = new THREE.Color('#7a1d1d')
    machines.forEach((m, i) => {
      cabinet.setColorAt(i, i === selected ? gold : i === hovered ? hot : body)
      screen.setColorAt(i, colors[i])
      topper.setColorAt(i, colors[i])
      plinth.setColorAt(i, m.bottomRank ? red : base)
    })
    for (const mesh of [cabinet, screen, topper, plinth]) if (mesh.instanceColor) mesh.instanceColor.needsUpdate = true
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [machines, colors, hovered, selected])

  const pick = (e: ThreeEvent<PointerEvent | MouseEvent>) => (e.instanceId === undefined ? null : e.instanceId)
  const handlers = {
    onPointerMove: (e: ThreeEvent<PointerEvent>) => { e.stopPropagation(); onHover(pick(e)); document.body.style.cursor = 'pointer' },
    onPointerOut: () => { onHover(null); document.body.style.cursor = '' },
    onClick: (e: ThreeEvent<MouseEvent>) => { e.stopPropagation(); const i = pick(e); if (i !== null) onSelect(i) },
  }
  const n = machines.length

  return (
    <group>
      <instancedMesh ref={refs.plinth} args={[boxes.plinth, undefined, n]} {...handlers}><meshStandardMaterial roughness={0.9} /></instancedMesh>
      <instancedMesh ref={refs.cabinet} args={[boxes.cabinet, undefined, n]} {...handlers}><meshStandardMaterial roughness={0.45} metalness={0.35} /></instancedMesh>
      <instancedMesh ref={refs.screen} args={[boxes.screen, undefined, n]} {...handlers}><meshBasicMaterial toneMapped={false} /></instancedMesh>
      <instancedMesh ref={refs.topper} args={[boxes.topper, undefined, n]} {...handlers}><meshStandardMaterial roughness={0.35} emissive="#111" /></instancedMesh>
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
      matrix.makeRotationX(-Math.PI / 2).setPosition(m.x, 0.02, m.z)
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

const FloorScene = memo(function FloorScene({ floor, focusZone }: { floor: FloorData; focusZone: string | null }) {
  const bounds = useMemo(() => zoneBounds(floor), [floor])
  const hub = new Map(floor.zones.map((z) => [z.zone_id, z]))
  const pad = 2.5

  return (
    <group>
      <mesh rotation-x={-Math.PI / 2} position={[67, -0.01, 54]} receiveShadow>
        <planeGeometry args={[160, 140]} />
        <meshStandardMaterial color="#0f131b" roughness={1} />
      </mesh>
      <gridHelper args={[160, 32, '#1d2330', '#161b25']} position={[67, 0, 54]} />

      {floor.zones.map((z) => {
        const b = bounds.get(z.zone_id)
        if (!b) return null
        const w = b.maxX - b.minX + pad * 2, d = b.maxZ - b.minZ + pad * 2
        const cx = (b.minX + b.maxX) / 2, cz = (b.minZ + b.maxZ) / 2
        const color = ZONE_COLORS[z.zone_id] ?? '#5b6270'
        const dim = focusZone && focusZone !== z.zone_id
        const corners: [number, number, number][] = [
          [b.minX - pad, 0.01, b.minZ - pad], [b.maxX + pad, 0.01, b.minZ - pad],
          [b.maxX + pad, 0.01, b.maxZ + pad], [b.minX - pad, 0.01, b.maxZ + pad], [b.minX - pad, 0.01, b.minZ - pad],
        ]
        return (
          <group key={z.zone_id}>
            <mesh rotation-x={-Math.PI / 2} position={[cx, 0.005, cz]}>
              <planeGeometry args={[w, d]} />
              <meshBasicMaterial color={color} transparent opacity={dim ? 0.03 : 0.1} depthWrite={false} />
            </mesh>
            <Line points={corners} color={color} lineWidth={1} transparent opacity={dim ? 0.25 : 0.8} />
          </group>
        )
      })}

      {floor.walkways.map((w) => {
        const a = hub.get(w.zone_a), b = hub.get(w.zone_b)
        if (!a || !b) return null
        return <Line key={w.walkway_id} points={[[a.x, 0.03, a.y], [b.x, 0.03, b.y]]} color="#3a4250" lineWidth={1} dashed dashSize={1.2} gapSize={0.8} />
      })}

    </group>
  )
})

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
  const place = (node: HTMLElement, pos: THREE.Vector3) => {
    v.copy(pos).project(camera)
    const x = ((v.x + 1) / 2) * size.width, y = ((1 - v.y) / 2) * size.height
    node.style.transform = `translate(${x}px, ${y}px) translate(-50%, -50%)`
  }
  useFrame(() => {
    anchors.forEach((a, i) => { const node = nodes.current?.[i]; if (node) place(node, a.pos) })
    if (tipNode.current && tipAnchor) place(tipNode.current, tipAnchor)
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
    ...floor.entrances.map((e) => ({ key: e.location_id, text: `⇥ ${e.name}`, kind: 'marker' as const, pos: new THREE.Vector3(e.x, 0.1, e.y) })),
    ...floor.outlets.map((o) => ({ key: o.location_id, text: `◍ ${o.name}`, kind: 'marker' as const, pos: new THREE.Vector3(o.x, 0.1, o.y) })),
  ]
  return [...zones, ...markers]
}

// ---------------------------------------------------------------------------
// Camera: isometric view, focus on a zone, reset
// ---------------------------------------------------------------------------

interface View { target: THREE.Vector3; zoom: number }

function CameraRig({ view, controls }: { view: View; controls: React.RefObject<OrbitControlsImpl | null> }) {
  const { camera } = useThree()
  const goal = useRef<View | null>(null)

  useEffect(() => { goal.current = { target: view.target.clone(), zoom: view.zoom } }, [view])

  useFrame((_, delta) => {
    const c = controls.current
    if (!goal.current || !c) return
    const ortho = camera as THREE.OrthographicCamera
    // Time-based easing: the same glide at 30, 60 or 120 fps, and no stall on slow devices.
    const k = 1 - Math.exp(-Math.min(delta, 0.5) * 7)
    const shift = goal.current.target.clone().sub(c.target).multiplyScalar(k)
    c.target.add(shift)
    camera.position.add(shift)
    ortho.zoom += (goal.current.zoom - ortho.zoom) * k
    ortho.updateProjectionMatrix()
    c.update()
    if (shift.length() < 0.01 && Math.abs(goal.current.zoom - ortho.zoom) < 0.01) goal.current = null
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
  const [view, setView] = useState<View>({ target: ORIGIN_TARGET.clone(), zoom: 6 })

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
    controls.current?.reset()
    setView({ target: ORIGIN_TARGET.clone(), zoom })
  }, [fit])

  // Fit the whole floor once the viewport is measured.
  const fitted = useRef(false)
  useEffect(() => {
    if (fitted.current || viewport.w === 1200) return
    fitted.current = true
    setView({ target: ORIGIN_TARGET.clone(), zoom: fit(0, 135, -4, 112) })
  }, [viewport, fit])

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
          <button className="btn sm" onClick={resetView}>Reset view</button>
          <button className="btn sm gold" onClick={onClose} aria-label="Close 3D explorer">Close ✕</button>
        </div>
      </header>

      <div className="x3d-stage" ref={(el) => {
        if (!el) return
        const r = el.getBoundingClientRect()
        if (Math.round(r.width) !== viewport.w || Math.round(r.height) !== viewport.h) setViewport({ w: Math.round(r.width), h: Math.round(r.height) })
      }}>
        {error && <div className="x3d-center">Couldn't load floor data: {error}</div>}
        {!error && (!floor || !machines.length) && <div className="x3d-center">Loading the floor…</div>}
        {floor && machines.length > 0 && (
          <Canvas dpr={[1, 2]} gl={{ antialias: true }} onPointerMissed={() => setSelected(null)}>
            <color attach="background" args={['#0b0e14']} />
            <OrthographicCamera makeDefault position={[67 + 90, 90, 54 + 90]} zoom={view.zoom} near={-500} far={1000} />
            <OrbitControls ref={controls} target={ORIGIN_TARGET} enableDamping dampingFactor={0.12} maxPolarAngle={Math.PI / 2.3} minZoom={2} maxZoom={MACHINE_MAX_ZOOM} />
            <CameraRig view={view} controls={controls} />
            <hemisphereLight args={['#c9d4e8', '#0b0e14', 0.75]} />
            <directionalLight position={[60, 120, 40]} intensity={1.1} />
            <FloorScene floor={floor} focusZone={focusZone} />
            <BottomTenGlow machines={machines} />
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
          <span className="muted">Drag to rotate · scroll to zoom · right-drag to pan · facing direction is illustrative</span>
        </div>

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
