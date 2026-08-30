/* eslint-disable react/no-unknown-property */
import { useEffect, useMemo, useRef, useState } from 'react';
import { Canvas, extend, useFrame } from '@react-three/fiber';
import { Environment, Lightformer, useGLTF, useTexture } from '@react-three/drei';
import { BallCollider, CuboidCollider, Physics, RigidBody, useRopeJoint, useSphericalJoint } from '@react-three/rapier';
import { MeshLineGeometry, MeshLineMaterial } from 'meshline';
import * as THREE from 'three';
import cardGLB from './card.glb';
import lanyardTexture from './lanyard.png';
import './lanyard.css';

extend({ MeshLineGeometry, MeshLineMaterial });

const blankPixel = 'data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+M9QDwADhgGAWjR9awAAAABJRU5ErkJggg==';
const frontRect = { x: 0, y: 0, w: 0.5, h: 0.755 };
const backRect = { x: 0.5, y: 0, w: 0.5, h: 0.757 };

function createCardTexture(baseMap, frontImage, backImage, frontTexture, backTexture, imageFit) {
  if (!baseMap || (!frontImage && !backImage) || !baseMap.image) return baseMap;
  const { width, height } = baseMap.image;
  const canvas = document.createElement('canvas');
  canvas.width = width;
  canvas.height = height;
  const context = canvas.getContext('2d');
  if (!context) return baseMap;
  context.drawImage(baseMap.image, 0, 0, width, height);

  const drawFitted = (image, rect) => {
    if (!image?.width || !image?.height) return;
    const x = rect.x * width;
    const y = rect.y * height;
    const rectWidth = rect.w * width;
    const rectHeight = rect.h * height;
    const scale = (imageFit === 'contain' ? Math.min : Math.max)(rectWidth / image.width, rectHeight / image.height);
    const drawWidth = image.width * scale;
    const drawHeight = image.height * scale;
    context.save();
    context.beginPath();
    context.rect(x, y, rectWidth, rectHeight);
    context.clip();
    context.drawImage(image, x + (rectWidth - drawWidth) / 2, y + (rectHeight - drawHeight) / 2, drawWidth, drawHeight);
    context.restore();
  };

  if (frontImage) drawFitted(frontTexture.image, frontRect);
  if (backImage) drawFitted(backTexture.image, backRect);
  const composite = new THREE.CanvasTexture(canvas);
  composite.colorSpace = THREE.SRGBColorSpace;
  composite.flipY = baseMap.flipY;
  composite.anisotropy = 16;
  composite.needsUpdate = true;
  return composite;
}

function Band({ maxSpeed = 50, minSpeed = 0, isMobile, frontImage, backImage, imageFit, lanyardImage, lanyardWidth, onCardClick }) {
  const band = useRef();
  const fixed = useRef();
  const joints = [useRef(), useRef(), useRef()];
  const card = useRef();
  const [dragged, setDragged] = useState(false);
  const [hovered, setHovered] = useState(false);
  const [curve] = useState(() => new THREE.CatmullRomCurve3([new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3(), new THREE.Vector3()]));
  const vector = useMemo(() => new THREE.Vector3(), []);
  const direction = useMemo(() => new THREE.Vector3(), []);
  const angularVelocity = useMemo(() => new THREE.Vector3(), []);
  const rotation = useMemo(() => new THREE.Vector3(), []);
  const { nodes, materials } = useGLTF(cardGLB);
  const bandTexture = useTexture(lanyardImage || lanyardTexture);
  const frontTexture = useTexture(frontImage || blankPixel);
  const backTexture = useTexture(backImage || blankPixel);
  const cardTexture = useMemo(() => createCardTexture(materials.base?.map, frontImage, backImage, frontTexture, backTexture, imageFit), [materials.base?.map, frontImage, backImage, frontTexture, backTexture, imageFit]);
  const segmentProps = { type: 'dynamic', canSleep: true, colliders: false, angularDamping: 4, linearDamping: 4 };

  useRopeJoint(fixed, joints[0], [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(joints[0], joints[1], [[0, 0, 0], [0, 0, 0], 1]);
  useRopeJoint(joints[1], joints[2], [[0, 0, 0], [0, 0, 0], 1]);
  useSphericalJoint(joints[2], card, [[0, 0, 0], [0, 1.5, 0]]);

  useEffect(() => {
    if (!hovered) return undefined;
    document.body.style.cursor = dragged ? 'grabbing' : 'grab';
    return () => { document.body.style.cursor = 'auto'; };
  }, [hovered, dragged]);

  useFrame((state, delta) => {
    if (dragged && card.current) {
      vector.set(state.pointer.x, state.pointer.y, 0.5).unproject(state.camera);
      direction.copy(vector).sub(state.camera.position).normalize();
      vector.add(direction.multiplyScalar(state.camera.position.length()));
      [card, fixed, ...joints].forEach(reference => reference.current?.wakeUp());
      card.current.setNextKinematicTranslation({ x: vector.x - dragged.x, y: vector.y - dragged.y, z: vector.z - dragged.z });
    }
    if (!fixed.current || !card.current || !band.current || joints.some(reference => !reference.current)) return;
    joints.slice(0, 2).forEach(reference => {
      if (!reference.current.lerped) reference.current.lerped = new THREE.Vector3().copy(reference.current.translation());
      const distance = Math.max(0.1, Math.min(1, reference.current.lerped.distanceTo(reference.current.translation())));
      reference.current.lerped.lerp(reference.current.translation(), delta * (minSpeed + distance * (maxSpeed - minSpeed)));
    });
    curve.points[0].copy(joints[2].current.translation());
    curve.points[1].copy(joints[1].current.lerped);
    curve.points[2].copy(joints[0].current.lerped);
    curve.points[3].copy(fixed.current.translation());
    band.current.geometry.setPoints(curve.getPoints(isMobile ? 16 : 32));
    angularVelocity.copy(card.current.angvel());
    rotation.copy(card.current.rotation());
    card.current.setAngvel({ x: angularVelocity.x, y: angularVelocity.y - rotation.y * 0.25, z: angularVelocity.z });
  });

  curve.curveType = 'chordal';
  bandTexture.wrapS = bandTexture.wrapT = THREE.RepeatWrapping;

  // The upstream component assumes a full-screen canvas. Center the hanging
  // card in the compact login viewport so its swing is not clipped at the edge.
  return <group position={[-1.1, 4, 0]}>
    <RigidBody ref={fixed} {...segmentProps} type="fixed" />
    {joints.map((reference, index) => <RigidBody key={index} position={[(index + 1) * 0.5, 0, 0]} ref={reference} {...segmentProps}><BallCollider args={[0.1]} /></RigidBody>)}
    <RigidBody position={[2, 0, 0]} ref={card} {...segmentProps} type={dragged ? 'kinematicPosition' : 'dynamic'}>
      <CuboidCollider args={[0.8, 1.125, 0.01]} />
      <group
        scale={2.25}
        position={[0, -1.2, -0.05]}
        onPointerOver={() => setHovered(true)}
        onPointerOut={() => setHovered(false)}
        onPointerDown={event => { event.target.setPointerCapture(event.pointerId); setDragged(new THREE.Vector3().copy(event.point).sub(vector.copy(card.current.translation()))); }}
        onPointerUp={event => { event.target.releasePointerCapture(event.pointerId); setDragged(false); }}
        onClick={onCardClick}
      >
        <mesh geometry={nodes.card.geometry}><meshPhysicalMaterial map={cardTexture} clearcoat={isMobile ? 0 : 1} clearcoatRoughness={0.15} roughness={0.9} metalness={0.8} /></mesh>
        <mesh geometry={nodes.clip.geometry} material={materials.metal} material-roughness={0.3} />
        <mesh geometry={nodes.clamp.geometry} material={materials.metal} />
      </group>
    </RigidBody>
    <mesh ref={band}><meshLineGeometry /><meshLineMaterial color="white" depthTest={false} resolution={isMobile ? [1000, 2000] : [1000, 1000]} useMap map={bandTexture} repeat={[-4, 1]} lineWidth={lanyardWidth} /></mesh>
  </group>;
}

export function Lanyard({ position = [0, 0, 30], gravity = [0, -40, 0], fov = 20, transparent = true, frontImage, backImage, imageFit = 'cover', lanyardImage, lanyardWidth = 1, onCardClick }) {
  const [isMobile, setIsMobile] = useState(() => window.innerWidth < 768);
  useEffect(() => {
    const update = () => setIsMobile(window.innerWidth < 768);
    window.addEventListener('resize', update);
    return () => window.removeEventListener('resize', update);
  }, []);
  return <div className="lanyard-wrapper" aria-label="一战晟铭登录吊牌">
    <Canvas camera={{ position, fov }} dpr={[1, isMobile ? 1.5 : 2]} gl={{ alpha: transparent }} onCreated={({ gl }) => gl.setClearColor(new THREE.Color(0x000000), transparent ? 0 : 1)}>
      <ambientLight intensity={Math.PI} />
      <Physics gravity={gravity} timeStep={isMobile ? 1 / 30 : 1 / 60}><Band {...{ isMobile, frontImage, backImage, imageFit, lanyardImage, lanyardWidth, onCardClick }} /></Physics>
      <Environment blur={0.75}>
        <Lightformer intensity={2} color="white" position={[0, -1, 5]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[-1, -1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={3} color="white" position={[1, 1, 1]} rotation={[0, 0, Math.PI / 3]} scale={[100, 0.1, 1]} />
        <Lightformer intensity={10} color="white" position={[-10, 0, 14]} rotation={[0, Math.PI / 2, Math.PI / 3]} scale={[100, 10, 1]} />
      </Environment>
    </Canvas>
  </div>;
}

useGLTF.preload(cardGLB);
