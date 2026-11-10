import { useEffect, useRef, useState, type CSSProperties } from 'react';
import * as THREE from 'three';

type Props = { color: string; player: number };

/** A small, actual WebGL pawn. A CSS pawn remains underneath as a fallback. */
export function Pawn3D({ color, player }: Props) {
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const [ready, setReady] = useState(false);

  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    let renderer: THREE.WebGLRenderer | undefined;
    const geometry: THREE.BufferGeometry[] = [];
    const materials: THREE.Material[] = [];

    try {
      renderer = new THREE.WebGLRenderer({ canvas, antialias: true, alpha: true, powerPreference: 'low-power' });
      renderer.setSize(140, 200, false);
      renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, 2));
      renderer.setClearColor(0x000000, 0);
      renderer.outputColorSpace = THREE.SRGBColorSpace;
      renderer.toneMapping = THREE.ACESFilmicToneMapping;
      renderer.toneMappingExposure = 1.4;

      const scene = new THREE.Scene();
      const camera = new THREE.PerspectiveCamera(30, 140 / 200, 0.1, 100);
      camera.position.set(5, 3.15, 9.2);
      camera.lookAt(0, 1.45, 0);
      const ambient = new THREE.AmbientLight(0xffffff, 1.5);
      const key = new THREE.DirectionalLight(0xfff0d9, 4.1);
      key.position.set(-4, 7, 7);
      const rim = new THREE.DirectionalLight(0x9cb8ff, 2.3);
      rim.position.set(4, 4, -5);
      scene.add(ambient, key, rim);

      const paint = new THREE.MeshPhysicalMaterial({ color, metalness: player === 1 ? 0.42 : 0.12, roughness: 0.22, clearcoat: 0.95, clearcoatRoughness: 0.16 });
      const band = new THREE.MeshPhysicalMaterial({ color, metalness: 0.56, roughness: 0.28, clearcoat: 0.8 });
      materials.push(paint, band);

      // Keep the turned-wood silhouette, but reduce the overly tall neck so it
      // sits inside a single tile and does not obscure a wall behind it.
      const profile = [
        [0, 0], [.66, 0], [.71, .07], [.69, .18], [.6, .23], [.55, .3],
        [.44, .45], [.37, .75], [.27, 1.22], [.24, 1.65], [.3, 2.12],
        [.38, 2.36], [.36, 2.48], [.28, 2.54], [0, 2.54],
      ].map(([radius, height]) => new THREE.Vector2(radius, height * 0.86));
      const bodyGeometry = new THREE.LatheGeometry(profile, 48);
      const headGeometry = new THREE.SphereGeometry(.47, 48, 32);
      const ringGeometry = new THREE.TorusGeometry(.54, .075, 12, 48);
      geometry.push(bodyGeometry, headGeometry, ringGeometry);

      const body = new THREE.Mesh(bodyGeometry, paint);
      const head = new THREE.Mesh(headGeometry, paint);
      head.position.y = 2.60;
      const ring = new THREE.Mesh(ringGeometry, band);
      ring.rotation.x = Math.PI / 2;
      ring.position.y = .27;
      scene.add(body, head, ring);

      renderer.render(scene, camera);
      setReady(true);
    } catch {
      setReady(false);
    }

    return () => {
      geometry.forEach(item => item.dispose());
      materials.forEach(item => item.dispose());
      renderer?.dispose();
    };
  }, [color, player]);

  return <span className={`q-pawn${ready ? ' q-model-ready' : ''}`} style={{ '--pawn-color': color } as CSSProperties}>
    <span className="q-pawn-head" />
    <canvas ref={canvasRef} width={140} height={200} aria-hidden="true" />
  </span>;
}
