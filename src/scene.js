/*
 * Corvux — 3D 舞台
 * 「发育内核」的可视化：一列沿曲线堆叠的金属椎骨 + 漂浮粒子 + 鼠标视差
 *
 * 技法来源：Rhine Lab 的金属质感 + 深场粒子
 * 性能约束：首屏 3D 必须在 60fps 下跑，移动端降级到简化版
 */
import * as THREE from "../vendor/three/three.module.js";
import { EffectComposer } from "../vendor/three/postprocessing/EffectComposer.js";
import { RenderPass } from "../vendor/three/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "../vendor/three/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "../vendor/three/postprocessing/OutputPass.js";
import { ShaderPass } from "../vendor/three/postprocessing/ShaderPass.js";
import { fetchWithResume, fetchJSONWithResume } from "./fetch-resume.js";

/* 加载进度上报（两个大资源合计） */
const loaderEl = document.getElementById("loader");
const loaderPct = document.getElementById("loader-pct");
const loaderBar = document.querySelector(".loader-bar i");
const progress = { spine: 0, particles: 0 };
let loaderDone = false;

function reportProgress(key, loaded, total) {
  progress[key] = total > 0 ? loaded / total : 0;
  const avg = (progress.spine + progress.particles) / 2;
  const pct = Math.round(avg * 100);
  if (loaderPct) loaderPct.textContent = pct + "%";
  if (loaderBar) loaderBar.style.width = pct + "%";
  if (pct >= 100 && !loaderDone) {
    loaderDone = true;
    loaderEl?.classList.add("done");
    setTimeout(() => loaderEl?.remove(), 900);
  }
}

const stage = document.getElementById("scene");
const host = document.getElementById("stage");
if (!stage || !host) throw new Error("stage missing");

/* ── 降级判定 ── */
const reduceMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
const isMobile = window.matchMedia("(max-width: 900px)").matches ||
  /Mobi|Android|iPhone|iPad/i.test(navigator.userAgent);
const DPR_CAP = isMobile ? 1.75 : 2;

/* ── 渲染器 ── */
const renderer = new THREE.WebGLRenderer({
  canvas: stage,
  antialias: !isMobile,
  alpha: true,
  powerPreference: "high-performance",
});
renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.35;

const scene = new THREE.Scene();
/* 原站无 Three 式 fog（spine-spec §6.2），此处不设 */

const camera = new THREE.PerspectiveCamera(35, 1, 0.1, 1000);   // 原站 fov=35
const _bufSize = new THREE.Vector2();

/* ── 后期：UnrealBloom（原站 work 变体 strength 0.5 / radius 0.5 / threshold 0）
   原站用 dpr 0.3 低分辨率跑 bloom，这里同样降分辨率省性能 ── */
const BLOOM_STRENGTH = 0.16;   // 原站 0.5，但 three 实现更亮，降到 0.28 等效
const BLOOM_RADIUS = 0.5;
const BLOOM_THRESHOLD = 0.0;

let _refrFrame = 0;
let composer = null;
let bloomPass = null;
let useBloom = !isMobile;   // 移动端关掉，省 GPU

if (useBloom) {
  composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  bloomPass = new UnrealBloomPass(
    new THREE.Vector2(window.innerWidth, window.innerHeight),
    BLOOM_STRENGTH,   // strength
    BLOOM_RADIUS,     // radius
    BLOOM_THRESHOLD   // threshold
  );
  composer.addPass(bloomPass);

  /* 原站合成：color += pow(bloom, 1.8)
     three 的 UnrealBloomPass 是直接叠加辉光，会过曝；
     这里加一层 pow(1.8) 压暗，还原原站"柔雾"而非"亮爆" */
  const bloomComposite = new ShaderPass(
    new THREE.ShaderMaterial({
      uniforms: {
        tDiffuse: { value: null },
        uBloomStrength: { value: 1.0 },
      },
      vertexShader: `
        varying vec2 vUv;
        void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
      `,
      fragmentShader: `
        uniform sampler2D tDiffuse;
        uniform float uBloomStrength;
        varying vec2 vUv;
        void main() {
          vec4 c = texture2D(tDiffuse, vUv);
          /* pow 1.8：压暗辉光，只保留亮部外溢 */
          vec3 bloom = pow(max(c.rgb - 0.35, 0.0), vec3(1.8)) * uBloomStrength;
          gl_FragColor = vec4(c.rgb + bloom * 0.34, 1.0);
        }
      `,
    })
  );
  composer.addPass(bloomComposite);
  composer.addPass(new OutputPass());   // tone mapping(ACES) + sRGB 转换
}
camera.position.set(0, 0, 13.5);

/* ── 灯光：主光 + 背光 + 暖金侧光（Rhine 的关键） ── */





/* ════════════════════════════════════════
   脊椎 —— 1:1 迁移 rhine-lab-art / Active Theory
   · 几何：public/assets/geometry/spine/spine.json（原站 spine.bin 解压版，4244 三角面）
   · 材质：SpineShader（fbr + matcap + MRO + normal map），原站参数原样保留
   · 实例：SpineInstancer 沿样条堆叠
   ════════════════════════════════════════ */
const spine = new THREE.Group();
scene.add(spine);
let SCENE_OFFSET_Y = 0;   // 世界→画面 的 Y 平移量（脊椎与粒子共用）

const SEGMENTS = isMobile ? 11 : 16;
const SPINE_H = 7.6;

/* 脊线：与实例排布一致 */
const spineCurve = new THREE.CatmullRomCurve3(
  [
    new THREE.Vector3(0.0, -SPINE_H / 2, 0.26),
    new THREE.Vector3(0.14, -SPINE_H / 4, 0.04),
    new THREE.Vector3(0.05, 0.0, -0.08),
    new THREE.Vector3(-0.13, SPINE_H / 4, 0.04),
    new THREE.Vector3(0.0, SPINE_H / 2, 0.22),
  ],
  false,
  "catmullrom",
  0.5
);

/* ── 原站纹理 ── */
const texLoader = new THREE.TextureLoader();
texLoader.setCrossOrigin("anonymous");

const loadTex = (url, colorSpace) =>
  new Promise((res) => {
    texLoader.load(
      url,
      (t) => {
        t.wrapS = t.wrapT = THREE.RepeatWrapping;
        t.repeat.set(1.0, 1.0);
        t.anisotropy = renderer.capabilities.getMaxAnisotropy();
        if (colorSpace) t.colorSpace = colorSpace;
        t.needsUpdate = true;
        res(t);
      },
      undefined,
      () => res(null)
    );
  });

/* ── 折射缓冲（原站 tRefraction 的等价实现）──
   原站把场景（粒子等）渲进 WorkRefraction buffer，
   脊椎 shader 用屏幕 UV 采样它，得到"水晶透过背景"的效果。
   这里：每帧先把不含脊椎的场景渲进 RT，再喂给 SpineShader。 */
const refractionRT = new THREE.WebGLRenderTarget(1, 1, {
  minFilter: THREE.LinearFilter,
  magFilter: THREE.LinearFilter,
  type: THREE.HalfFloatType,
});


let spineMat = null;
let coreLine = null;
let spineReady = false;

Promise.all([
  fetchJSONWithResume("./assets/geometry/spine/spine.json", (l, t) => reportProgress("spine", l, t)).then((d) => d),
  loadTex("./assets/images/pbr/alien_cracked_2_basecolor.png", THREE.SRGBColorSpace),
  loadTex("./assets/images/pbr/cliffs_MRO.png"),
  loadTex("./assets/images/pbr/damaged_road_normal.png"),
  loadTex("./assets/images/room/matcap-test.jpg", THREE.SRGBColorSpace),
  import("./spine-shader.js"),
]).then(([data, tBaseColor, tMRO, tNormal, tMatcap, shaderMod]) => {
  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(data.position, 3));
  geo.setAttribute("normal", new THREE.Float32BufferAttribute(data.normal, 3));
  if (data.uv?.length) geo.setAttribute("uv", new THREE.Float32BufferAttribute(data.uv, 2));
  if (!data.uv?.length) {
    /* 无 uv 时用球面投影兜底 */
    const pos = geo.attributes.position;
    const uv = new Float32Array(pos.count * 2);
    const v = new THREE.Vector3();
    for (let i = 0; i < pos.count; i++) {
      v.fromBufferAttribute(pos, i).normalize();
      uv[i * 2] = 0.5 + Math.atan2(v.z, v.x) / (Math.PI * 2);
      uv[i * 2 + 1] = 0.5 - Math.asin(v.y) / Math.PI;
    }
    geo.setAttribute("uv", new THREE.BufferAttribute(uv, 2));
  }
  geo.computeBoundingBox();

  const bb = geo.boundingBox;
  const size = new THREE.Vector3();
  bb.getSize(size);
  const center = new THREE.Vector3();
  bb.getCenter(center);
  geo.translate(-center.x, -center.y, -center.z);

  /* ── 原站材质参数，逐项照搬 ── */
  spineMat = new THREE.ShaderMaterial({
    vertexShader: shaderMod.spineVertexShader,
    fragmentShader: shaderMod.spineFragmentShader,
    uniforms: {
      tBaseColor: { value: tBaseColor },
      tMRO: { value: tMRO },
      tNormal: { value: tNormal },
      tMatcap: { value: tMatcap },
      tRefraction: { value: refractionRT.texture },
      uColor: { value: new THREE.Color("#d1fff4") },   // 原站
      uNormalStrength: { value: 0.19 },                 // 原站
      uLight: { value: new THREE.Vector4(1, 1, 1, 0.4) }, // 原站
      uReflection: { value: new THREE.Vector2(2.7, 0.85) }, // 原站
      resolution: { value: new THREE.Vector2(1, 1) },
    },
    side: THREE.DoubleSide,
  });

  /* ── 1:1 照抄原版 SpineInstancer（spine-spec 已逆向确认）──────────
     出处 public/assets/js/app.1780406240914.js @1589237
       for (i=0..39) { mesh.position.y = -0.65*i + 4; mesh.rotation.y = 0.4*i }
     出处 uil.json：
       MESH_Element_5_Workscale    = [3.5, 3.5, 3.5]
       MESH_Element_5_Workposition = [0, 3.446, 0]
     关键：MeshBatch 的 instance.vs 里 `_pos *= scale` 先乘再 `+= offset`，
           offset 不被 scale 放大 → 椎骨放大 3.5 倍、间距仍是 0.65，
           所以单节高 0.335*3.5 = 1.1725，间距 0.65 → 相邻重叠 45%。
     ─────────────────────────────────────────────────────────── */
  const SEG = 40;
  const Y_STEP = -0.65;
  const Y_START = 4.0;
  const Y_ROT = 0.4;
  const MESH_SCALE = 3.5;
  const MESH_POS = new THREE.Vector3(0, 3.446, 0);

  /* 用 40 个独立 Mesh（共享同一 geometry + material）
     原版用 MeshBatch 做 GPU instancing，但**视觉完全等价**于 40 个 clone：
     自定义 ShaderMaterial 不会自动套用 instanceMatrix，用独立 mesh 更稳，
     且 40 个 draw call 在任何设备上都可以忽略。 */
  const spineRoot = new THREE.Group();
  spineRoot.position.copy(MESH_POS);       // 原版 group.position.copy(mesh.position)
  spine.add(spineRoot);

  for (let i = 0; i < SEG; i++) {
    const mesh = new THREE.Mesh(geo, spineMat);
    mesh.position.set(0, Y_STEP * i + Y_START, 0);
    mesh.rotation.y = Y_ROT * i;
    mesh.scale.setScalar(MESH_SCALE);      // ← 原版 MESH_Element_5_Workscale = 3.5
    spineRoot.add(mesh);
  }

  /* 把整根脊椎的 Y 中心移到原点，方便相机取景 */
  const topY = MESH_POS.y + Y_START;                       // 7.446
  const botY = MESH_POS.y + Y_STEP * (SEG - 1) + Y_START;   // -17.904
  const spineCenterY = (topY + botY) / 2;                   // -5.229
  spineRoot.position.y -= spineCenterY;                     // 把脊椎中心移到原点
  spineRoot.renderOrder = 5;                                // 原站 INPUT_Config_5_Work_renderOrder = 5
  /* 记录同一个平移量，粒子组稍后套用 → 保持原站相对位置 */
  SCENE_OFFSET_Y = -spineCenterY;
  /* 中央能量线 */
  const corePts = spineCurve.getPoints(96);
  const coreGeo = new THREE.BufferGeometry().setFromPoints(corePts);
  coreLine = new THREE.LineBasicMaterial({
    color: 0xd1fff4,
    transparent: true,
    opacity: 0.5,
    blending: THREE.AdditiveBlending,
    depthWrite: false,
  });
  spine.add(new THREE.Line(coreGeo, coreLine));

  spineReady = true;
}).catch((e) => console.warn("spine init failed:", e.message));

/* ════════════════════════════════════════
   粒子 —— 1:1 迁移 FlowerParticleShader（spine-spec 已逆向确认）
   · 点云：public/assets/geometry/particles/flower_spine.bin
           = 原站 flower_spine-256.bin 用 DracoPy 解出（65536 点）
           ⚠️ 必须锁 256 档：512/1024 是"扁平盘"，形状完全不同
   · 每点：position(3) + color(3)，颜色来自点云自带属性
   · gl_PointSize = 0.0275 * DPR * 2.0 * vScale * (1000.0/dist) * uSizeBias
   · 原站 flower.group.rotation.y = 100°（固定），形态由 uScroll 驱动
   ════════════════════════════════════════ */
const particles = new THREE.Group();
scene.add(particles);

const PARTICLE_COUNT = 65536;   // 原站 256 档实测点数
const U_SIZE_BIAS = 1.0;        // 原站高配桌面值（spine-spec 确认）
const FLOWER_ROT_Y = (100 * Math.PI) / 180;   // 原站固定 100°

const pGeo = new THREE.BufferGeometry();
let pMat = null;
let pPoints = null;
let uScroll = { value: 0 };
let uSparkle = { value: 0 };

fetch("./assets/geometry/particles/flower_spine.bin")
  .then((r) => r.arrayBuffer())
  .then((ab) => {
    const f32 = new Float32Array(ab);
    const n = f32.length / 6;    // 每点 6 个 float（xyz + rgb）

    if (n !== PARTICLE_COUNT) {
      console.warn(`particle count ${n} != expected ${PARTICLE_COUNT}`);
    }

    const posArr = new Float32Array(n * 3);
    const colArr = new Float32Array(n * 3);
    const seedArr = new Float32Array(n);
    for (let i = 0; i < n; i++) {
      posArr[i * 3]     = f32[i * 6];
      posArr[i * 3 + 1] = f32[i * 6 + 1];
      posArr[i * 3 + 2] = f32[i * 6 + 2];
      colArr[i * 3]     = f32[i * 6 + 3];
      colArr[i * 3 + 1] = f32[i * 6 + 4];
      colArr[i * 3 + 2] = f32[i * 6 + 5];
      seedArr[i] = Math.random() * 6.2831853;
    }

    pGeo.setAttribute("position", new THREE.BufferAttribute(posArr, 3));
    pGeo.setAttribute("aColor", new THREE.BufferAttribute(colArr, 3));
    pGeo.setAttribute("aSeed", new THREE.BufferAttribute(seedArr, 1));

    /* FlowerParticleShader 的等价实现
       gl_PointSize = 0.0275 * DPR * 2.0 * vScale * (1000.0/dist) * uSizeBias
       vScale 含：距离平滑 + 3 秒周期的脉动(±30%) + 每点随机 0.5~1.5 缩放 */
    pMat = new THREE.ShaderMaterial({
      transparent: false,
      depthWrite: true,
      blending: THREE.NormalBlending,   // 原站 shader_normal_blending
      uniforms: {
        uTime: { value: 0 },
        uPixelRatio: { value: renderer.getPixelRatio() },
        uScroll: uScroll,
        uSizeBias: { value: U_SIZE_BIAS },
        uSparkle: uSparkle,
      },
      vertexShader: /* glsl */ `
        attribute vec3 aColor;
        attribute float aSeed;
        uniform float uTime;
        uniform float uPixelRatio;
        uniform float uScroll;
        uniform float uSizeBias;
        uniform float uSparkle;
        varying vec3 vColor;
        varying float vAlpha;

        /* 原站 rgb2hsv.fs 的等价实现 */
        vec3 rgb2hsv(vec3 c) {
          vec4 K = vec4(0.0, -1.0 / 3.0, 2.0 / 3.0, -1.0);
          vec4 p = mix(vec4(c.bg, K.wz), vec4(c.gb, K.xy), step(c.b, c.g));
          vec4 q = mix(vec4(p.xyw, c.r), vec4(c.r, p.yzx), step(p.x, c.r));
          float d = q.x - min(q.w, q.y);
          float e = 1.0e-10;
          return vec3(abs(q.z + (q.w - q.y) / (6.0 * d + e)), d / (q.x + e), q.x);
        }
        vec3 hsv2rgb(vec3 c) {
          vec4 K = vec4(1.0, 2.0 / 3.0, 1.0 / 3.0, 3.0);
          vec3 p = abs(fract(c.xxx + K.xyz) * 6.0 - K.www);
          return c.z * mix(K.xxx, clamp(p - K.xxx, 0.0, 1.0), c.y);
        }

        void main() {
          vec3 pos = position;

          /* uScroll 0→1：聚拢 → 甩开（原站形态主变量） */
          float spread = 1.0 + uScroll * 1.6;
          pos.xz *= spread;
          float swirl = uScroll * aSeed * 0.9;
          float cs = cos(swirl), sn = sin(swirl);
          pos.xz = vec2(pos.x * cs - pos.z * sn, pos.x * sn + pos.z * cs);

          /* 轻微呼吸（原站 vScale 里的 3 秒周期项） */
          pos *= 1.0 + sin(uTime * 3.3 + aSeed) * 0.012;

          vec4 mv = modelViewMatrix * vec4(pos, 1.0);
          gl_Position = projectionMatrix * mv;

          float dist = length(mv.xyz);

          /* 原站 vScale 分解 */
          float distFade = smoothstep(3.0, 15.0, dist);
          float pulse = 1.0 + (0.5 + sin(uTime * 5.0 + aSeed * 20.0) * 0.5) * 0.3;
          float randScale = mix(0.5, 1.5, fract(aSeed * 0.1591));

          float vScale = distFade * pulse * randScale;

          /* 原站公式：0.0275 * DPR * 2.0 * vScale * (1000.0 / dist) * uSizeBias */
          /* 原站公式：0.0275 * DPR * 2.0 * vScale * (1000.0/dist) * uSizeBias
             点云半径最大 9.39、相机距轴 9.6 → 少数点几乎贴镜头，
             1000/dist 会放大成巨大光斑，因此加上限（原站靠 bloom 与大屏掩盖了这点） */
          float size = 0.0275 * uPixelRatio * 2.0 * vScale * (900.0 / max(dist, 2.2)) * uSizeBias;
          gl_PointSize = clamp(size, 0.0, 15.0);

          /* 远处压暗（原站 mix(0.6,1.0, smoothstep(15,6,dist)) 的等价） */
          vAlpha = mix(0.6, 1.0, smoothstep(15.0, 6.0, dist));

          /* ── 原站调色链（FlowerParticleShader fragment 等价）──
             rgb2hsv → 色相抖动 → 饱和度 → hsv2rgb → sparkle → 远处压暗 → gamma */
          vec3 col = aColor;

          /* sparkle：极少数点闪白（原站 pow(vRandom.x,10.0)*0.5，随 uSparkle 衰减） */
          float sp = pow(fract(aSeed * 0.3183), 10.0) * 0.5
                   * (1.0 - smoothstep(2.0, 0.2, uSparkle));
          col = mix(col, vec3(1.0), sp);

          /* 色相抖动（原站 cnoise*0.03 - 0.03 + vCameraPos.y*0.02）
             用 aSeed 代替 cnoise，相机高度项照抄 */
          vec3 hsv = rgb2hsv(col);
          hsv.x += sin(aSeed * 7.3) * 0.03 - 0.03;
          hsv.x += cameraPosition.y * 0.02;
          /* 饱和度 mix(0.5, 0.8, vRandom.w) → 用 aSeed 派生 */
          hsv.y *= mix(0.5, 0.8, fract(aSeed * 0.618));
          col = hsv2rgb(hsv);

          /* 远处压暗（原站 mix(0.6,1.0,smoothstep(15,6,dist))） */
          col *= mix(0.6, 1.0, smoothstep(15.0, 6.0, dist));

          /* gamma 1.4 提亮去灰（原站 pow(color*1.2, 1.4)） */
          vColor = pow(col * 0.95, vec3(1.4));
        }
      `,
      fragmentShader: /* glsl */ `
        varying vec3 vColor;
        varying float vAlpha;
        void main() {
          /* 圆形 alpha discard（原站行为） */
          vec2 c = gl_PointCoord - 0.5;
          float d = dot(c, c);
          if (d > 0.25) discard;

          /* matcap 泡泡感（原站 tMap=matcap3 + blendSoftLight 0.8）
             球面高光：中心亮、边缘暗，模拟一颗小泡泡 */
          float sphere = smoothstep(0.25, 0.0, d);
          vec3 col = vColor * mix(0.62, 1.30, sphere);

          /* 柔边（避免硬圆点） */
          float edge = smoothstep(0.25, 0.14, d);
          gl_FragColor = vec4(col, vAlpha * edge);
        }
      `,
    });

    pPoints = new THREE.Points(pGeo, pMat);
    pPoints.rotation.y = FLOWER_ROT_Y;   // 原站固定 100°，不跟脊椎
    pPoints.renderOrder = 6;             // 原站 INPUT_Config_6_Work_renderOrder = 6
    /* 与脊椎使用同一个世界→画面平移量，保持原站相对关系
       原站：脊椎中心 y = (7.446 + -17.904)/2 = -5.229
             粒子点云中心 y ≈ -0.015
             → 粒子比脊椎中心高约 5.21，这是原站的相对位置，保留 */
    particles.add(pPoints);
    /* 粒子组套用与脊椎相同的 Y 平移（原站：粒子以世界 0 为心，
       脊椎中心在 -5.229，两者原本就有 5.2 的相对偏移，这里只抵消整体平移） */
    particles.position.y = SCENE_OFFSET_Y;
  })
  .catch((e) => console.warn("particle point cloud failed:", e.message));

/* ════════════════════════════════════════
   鼠标视差 + 滚动耦合
   ════════════════════════════════════════ */
const pointer = { x: 0, y: 0, tx: 0, ty: 0 };
let scrollT = 0;

if (!reduceMotion) {
  window.addEventListener(
    "pointermove",
    (e) => {
      pointer.tx = (e.clientX / window.innerWidth - 0.5) * 2;
      pointer.ty = (e.clientY / window.innerHeight - 0.5) * 2;
    },
    { passive: true }
  );
}

/* 滚动进度 0..1：页面顶部为 0（原站进入时 scrollProgress≈0，粒子聚拢），
   滚过 hero 后为 1（粒子被甩开）。
   注意 .stage 现在是 position:fixed，不能再用它的 rect 计算。 */
let rawScroll = 0;      // 0..1 平滑前
let smoothScroll = 0;   // 0..1 阻尼后

function updateScrollT() {
  const max = Math.max(document.documentElement.scrollHeight - window.innerHeight, 1);
  rawScroll = Math.min(Math.max(window.scrollY / max, 0), 1);
  scrollT = rawScroll;
}
window.addEventListener("scroll", updateScrollT, { passive: true });
window.addEventListener("resize", updateScrollT, { passive: true });
updateScrollT();

/* ════════════════════════════════════════
   尺寸
   ════════════════════════════════════════ */
function resize() {
  const w = host.clientWidth;
  const h = host.clientHeight;
  if (w === 0 || h === 0) return;

  renderer.setSize(w, h, false);
  if (composer) {
    composer.setSize(w, h);
    /* 主画面保持全分辨率；降采样交给 UnrealBloomPass 内部（原站 dpr:0.3 只作用于 bloom RT） */
    composer.setPixelRatio(Math.min(window.devicePixelRatio || 1, DPR_CAP));
  }
  camera.aspect = w / h;

  /* 相机：原站运行时约在距轴 9.6 处、fov 35（spine-spec 逆向）
     该距离垂直可视高度 = 2*9.6*tan(17.5°) ≈ 6.06 单位
     → 脊椎总高 25.35 / 6.06 ≈ 4.2 屏高，是"贯穿好几屏的巨柱"，
       单节 1.17 高 ≈ 0.19 屏高。这正是参考图的观感。 */
  /* 相机位置由滚动驱动（见动画循环），这里只更新投影矩阵 */
  camera.updateProjectionMatrix();

  if (pMat) pMat.uniforms.uPixelRatio.value = renderer.getPixelRatio();

  /* 原站 SpineShader 需要 resolution（屏幕 UV） */
  const pr = renderer.getPixelRatio();
  renderer.getDrawingBufferSize(_bufSize);
  if (spineMat) {
    spineMat.uniforms.resolution.value.set(_bufSize.x, _bufSize.y);
  }
  refractionRT.setSize(_bufSize.x, _bufSize.y);
}

const ro = new ResizeObserver(resize);
ro.observe(host);
resize();

/* ════════════════════════════════════════
   动画循环
   ════════════════════════════════════════ */
const clock = new THREE.Clock();
let rafId = 0;
let visible = true;

/* 页面切走时停渲染，省电 */
document.addEventListener("visibilitychange", () => {
  visible = !document.hidden;
  if (visible) clock.start();
});

function tick() {
  rafId = requestAnimationFrame(tick);
  if (!visible) return;

  const t = clock.getElapsedTime();

  /* 指针阻尼 */
  pointer.x += (pointer.tx - pointer.x) * 0.05;
  pointer.y += (pointer.ty - pointer.y) * 0.05;

  if (!reduceMotion) {
    /* ── 原站行为 ──
       脊椎：40 节固定 rotation.y = 0.4*i，**完全静止**（无时间项）
       花：rotation.y 固定 100°，形态全靠 uScroll
       唯一在动的是相机（GazeCamera 鼠标视差）与粒子 shader 内部时间 */

    /* uScroll：页面进入时 ≈0，看到的是聚拢的花（原站 scrollProgress） */
    uScroll.value = scrollT;

    /* 粒子：uTime 驱动脉动，uSparkle 每帧 += 0.005 */
    if (pMat) {
      pMat.uniforms.uTime.value = t;
      uSparkle.value += 0.005;
    }
    smoothScroll += (rawScroll - smoothScroll) * 0.13;   // 补偿低帧率下的迟滞

    const p = smoothScroll;

    /* 相机：沿 y 上移（脊柱相对下移）+ z 前推一点制造透视变化 */
    const targetY = p * 11.5;
    const targetZ = 13.5 - p * 2.2;

    /* 脊柱整体：缓慢自转（滚动驱动，原站 uRotate 语义）*/
    spine.rotation.y = p * Math.PI * 1.15;
    spine.rotation.z = Math.sin(p * Math.PI) * 0.05;

    /* 相机跟随：指针视差 + 滚动位置 */
    camera.position.x += (pointer.x * 0.9 - camera.position.x) * 0.04;
    camera.position.y += (targetY - pointer.y * 0.5 - camera.position.y) * 0.05;
    camera.position.z += (targetZ - camera.position.z) * 0.05;
    camera.lookAt(0, targetY - 1.2, 0);

    if (coreLine) coreLine.opacity = 0.30 + Math.sin(t * 0.8) * 0.18;
  }

  /* ① 折射预渲染：隐藏脊椎，把「背景 + 粒子」渲进 refractionRT */
  /* 折射隔帧更新：视觉几乎无差，成本省一半 */
  _refrFrame = (_refrFrame + 1) % 2;
  if (spineReady && spineMat && _refrFrame === 0) {
    spine.visible = false;
    renderer.setRenderTarget(refractionRT);
    renderer.setClearColor(0x000000, 0);
    renderer.clear();
    renderer.render(scene, camera);
    renderer.setRenderTarget(null);
    spine.visible = true;
  }

  /* ② 主渲染 */
  if (composer) {
    composer.render();
  } else {
    renderer.render(scene, camera);
  }
}

tick();

/* 页面卸载清理 */
window.addEventListener("pagehide", () => {
  cancelAnimationFrame(rafId);
  ro.disconnect();
  renderer.dispose();
});
