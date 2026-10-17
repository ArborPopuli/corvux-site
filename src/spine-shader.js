/*
 * SpineShader —— 1:1 迁移自 rhine-lab-art 的 Active Theory 管线
 * 原站参数：uColor #d1fff4 / uNormalStrength 0.19 / uLight [1,1,1,0.4] / uReflection [2.7,0.85]
 *
 * 依赖链：fbr.vs → fbr.fs（含 matcap.vs）→ SpineShader
 * 说明：原站使用 MRT（multi-render-target）输出 Color + WorkRefraction 两个 draw buffer；
 *       这里简化为单输出，保留全部光照/法线/反射计算。
 */

const COMMON = /* glsl */ `
const float PI = 3.14159265359;
const float PI2 = 6.28318530718;
const float RECIPROCAL_PI = 0.31830988618;
const float RECIPROCAL_PI2 = 0.15915494;
const float LOG2 = 1.442695;
const float EPSILON = 1e-6;
const float LN2 = 0.6931472;

float prange(float oldValue, float oldMin, float oldMax, float newMin, float newMax) {
    float oldRange = oldMax - oldMin;
    float newRange = newMax - newMin;
    return (((oldValue - oldMin) * newRange) / oldRange) + newMin;
}

float pcrange(float oldValue, float oldMin, float oldMax, float newMin, float newMax) {
    return clamp(prange(oldValue, oldMin, oldMax, newMin, newMax), min(newMax, newMin), max(newMin, newMax));
}

vec2 reflectMatcap(vec3 worldPos, vec3 worldNormal) {
    vec3 viewDir = normalize(cameraPosition - worldPos);
    vec3 x = normalize(vec3(viewDir.z, 0.0, - viewDir.x));
    vec3 y = cross(viewDir, x);
    vec2 uv = vec2(dot(x, worldNormal), dot(y, worldNormal)) * 0.495 + 0.5;
    return uv;
}

vec3 unpackNormalFBR( vec3 eye_pos, vec3 surf_norm, sampler2D normal_map, float intensity, float scale, vec2 uv ) {
    vec3 q0 = dFdx( eye_pos.xyz );
    vec3 q1 = dFdy( eye_pos.xyz );
    vec2 st0 = dFdx( uv.st );
    vec2 st1 = dFdy( uv.st );

    vec3 N = normalize(surf_norm);

    vec3 q1perp = cross( q1, N );
    vec3 q0perp = cross( N, q0 );

    vec3 T = q1perp * st0.x + q0perp * st1.x;
    vec3 B = q1perp * st0.y + q0perp * st1.y;

    float det = max( dot( T, T ), dot( B, B ) );
    float scalefactor = ( det == 0.0 ) ? 0.0 : inversesqrt( det );

    vec3 mapN = texture2D( normal_map, uv * scale ).xyz * 2.0 - 1.0;
    mapN.xy *= intensity;

    return normalize( T * ( mapN.x * scalefactor ) + B * ( mapN.y * scalefactor ) + N * mapN.z );
}

float geometricOcclusion(float NdL, float NdV, float roughness) {
    float r = roughness;
    float attenuationL = 2.0 * NdL / (NdL + sqrt(r * r + (1.0 - r * r) * (NdL * NdL)));
    float attenuationV = 2.0 * NdV / (NdV + sqrt(r * r + (1.0 - r * r) * (NdV * NdV)));
    return attenuationL * attenuationV;
}

float microfacetDistribution(float roughness, float NdH) {
    float roughnessSq = roughness * roughness;
    float f = (NdH * roughnessSq - NdH) * NdH + 1.0;
    return roughnessSq / (PI * f * f);
}

vec3 getFBR(vec3 baseColor, vec2 uv, vec3 normal) {
    vec3 mro = texture2D(tMRO, uv).rgb;
    float roughness = mro.g;

    vec2 aUV = reflectMatcap(vMPos, normal);
    vec2 bUV = ((aUV - 0.5) * 0.5 - vec2(0.1)) + 0.5;
    vec2 mUV = mix(aUV, bUV, roughness);

    vec3 V = normalize(cameraPosition - vMPos);
    vec3 L = normalize(uLight.xyz);
    vec3 H = normalize((L + V) / 2.);

    float NdL = pcrange(clamp(dot(normal, L), 0.001, 1.0), 0.0, 1.0, 0.4, 1.0);
    float NdV = pcrange(clamp(abs(dot(normal, V)), 0.001, 1.0), 0.0, 1.0, 0.4, 1.0);
    float NdH = clamp(dot(normal, H), 0.0, 1.0);

    float G = geometricOcclusion(NdL, NdV, roughness);
    float D = microfacetDistribution(roughness, NdH);

    vec3 specContrib = G * D / (4.0 * NdL * NdV) * uColor;
    vec3 color = NdL * specContrib * uLight.w;

    return ((baseColor * texture2D(tMatcap, mUV).rgb) + color) * mro.b;
}

vec3 getFBR(vec3 baseColor, vec2 uv) {
    vec3 normal = unpackNormalFBR(vEyePos, vWorldNormal, tNormal, uNormalStrength, 1.0, uv);
    return getFBR(baseColor, uv, normal);
}

`;

export const spineVertexShader = /* glsl */ `
uniform sampler2D tBaseColor;
uniform sampler2D tRefraction;
uniform vec2 uReflection;

varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vPos;
varying vec3 vEyePos;
varying vec2 vUv;
varying vec3 vMPos;
varying vec3 vCameraPos;
varying vec4 vWorldPos;

void setupFBR(vec3 p0) {
    vNormal = normalMatrix * normal;
    vWorldNormal = mat3(modelMatrix[0].xyz, modelMatrix[1].xyz, modelMatrix[2].xyz) * normal;
    vUv = uv;
    vPos = p0;
    vec4 mPos = modelMatrix * vec4(p0, 1.0);
    vMPos = mPos.xyz / mPos.w;
    vEyePos = vec3(modelViewMatrix * vec4(p0, 1.0));
}

void main() {
    vec3 pos = position;
    setupFBR(position);
    vNormal = normalMatrix * normal;
    vCameraPos = cameraPosition;
    vWorldPos = modelMatrix * vec4(position, 1.0);

    gl_Position = projectionMatrix * modelViewMatrix * vec4(pos, 1.0);
}
`;

export const spineFragmentShader = /* glsl */ `
uniform sampler2D tBaseColor;
uniform sampler2D tRefraction;
uniform sampler2D tMRO;
uniform sampler2D tMatcap;
uniform sampler2D tNormal;
uniform vec4 uLight;
uniform vec3 uColor;
uniform float uNormalStrength;
uniform vec2 uReflection;
uniform vec2 resolution;

varying vec3 vNormal;
varying vec3 vWorldNormal;
varying vec3 vPos;
varying vec3 vEyePos;
varying vec2 vUv;
varying vec3 vMPos;
varying vec3 vCameraPos;
varying vec4 vWorldPos;

${COMMON}

void main() {
    vec2 uv = vUv;
    uv.x += vWorldPos.x * 0.2;

    vec3 baseColor = texture2D(tBaseColor, uv).rgb;
    vec3 color = getFBR(baseColor, uv);

    vec3 normal = unpackNormalFBR(vEyePos, vWorldNormal, tNormal, uNormalStrength, 1.0, vUv);
    normal.y -= vWorldPos.y * 0.02;

    vec2 screenuv = gl_FragCoord.xy / resolution;
    screenuv += normal.xy * 0.1 * uReflection.x;

    color += texture2D(tRefraction, screenuv).rgb * uReflection.y;

    gl_FragColor = vec4(color, 1.0);
}
`;
