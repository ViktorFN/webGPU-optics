export const wgslShaders = `
struct Uniforms {
    res: vec2<f32>,
    lightPos: vec2<f32>,
    lightDir: vec2<f32>,
    cameraPos: vec2<f32>,
    beamWidth: f32,
    dispersion: f32,
    envN: f32,
    baseAlpha: f32,
    colorType: i32,
    wavelength: f32,
    totalRays: f32,
    cameraZoom: f32,
    seedOffset: f32,
    numSegments: i32,
    numArcs: i32,
    numCircles: i32,
    numGroups: i32,
    pad: vec3<f32>,
};

struct Segment {
    p1: vec2<f32>,
    p2: vec2<f32>,
    props: vec4<f32>,
};

struct Arc {
    c: vec2<f32>,
    r: f32,
    normalSign: f32,
    dir: vec2<f32>,
    cosHalfAngle: f32,
    pad: f32,
    props: vec4<f32>,
};

struct Circle {
    c: vec2<f32>,
    r: f32,
    pad: f32,
    props: vec4<f32>,
};

struct GroupBBox {
    bbox: vec4<f32>,
    startIdx: i32,
    count: i32,
    pad: vec2<f32>,
};

@group(0) @binding(0) var<uniform> u: Uniforms;
@group(0) @binding(1) var<storage, read> segments: array<Segment>;
@group(0) @binding(2) var<storage, read> groupBBoxes: array<GroupBBox>;
@group(0) @binding(3) var<storage, read> arcs: array<Arc>;
@group(0) @binding(4) var<storage, read> circles: array<Circle>;

var<private> seedState: vec2<f32>;
fn rand() -> f32 {
    var p3: vec3<f32> = fract(vec3<f32>(seedState.x, seedState.y, seedState.x) * 0.1031);
    p3 += dot(p3, p3.yzx + 33.33);
    seedState += vec2<f32>(0.123, 0.456);
    return fract((p3.x + p3.y) * p3.z);
}

fn spectralColor(x: f32) -> vec3<f32> {
    let r = exp(-pow((x - 0.8) / 0.25, 2.0));
    let g = exp(-pow((x - 0.5) / 0.25, 2.0));
    let b = exp(-pow((x - 0.2) / 0.25, 2.0));
    return vec3<f32>(r, g, b);
}

fn getIOR(baseN: f32, lambda: f32, C: f32) -> f32 {
    if (baseN <= 1.001) { return baseN; }
    let invL2 = 1.0 / (lambda * lambda);
    let invL02 = 1.0 / (0.55 * 0.55);
    return baseN + C * (invL2 - invL02);
}

fn checkSegment(ro: vec2<f32>, rd: vec2<f32>, seg: Segment, minT: ptr<function, f32>, bestNormal: ptr<function, vec2<f32>>, bestProps: ptr<function, vec4<f32>>) {
    let a = seg.p1;
    let b = seg.p2;
    let v = b - a;
    let w = ro - a;
    let denom = rd.x * v.y - rd.y * v.x;
    if (abs(denom) < 1e-6) { return; }
    let t = (v.x * w.y - v.y * w.x) / denom;
    let s = (rd.x * w.y - rd.y * w.x) / denom;
    if (t > 0.05 && t < *minT && s >= 0.0 && s <= 1.0) {
        *minT = t;
        *bestNormal = normalize(vec2<f32>(v.y, -v.x));
        *bestProps = seg.props;
    }
}

fn checkArc(ro: vec2<f32>, rd: vec2<f32>, arc: Arc, minT: ptr<function, f32>, bestNormal: ptr<function, vec2<f32>>, bestProps: ptr<function, vec4<f32>>) {
    let c = arc.c;
    let r = arc.r;
    let normalSign = arc.normalSign;
    let dir = arc.dir;
    let cosHalfAngle = arc.cosHalfAngle;

    let oc = ro - c;
    let a = dot(rd, rd);
    let b = 2.0 * dot(oc, rd);
    let c_val = dot(oc, oc) - r * r;
    let disc = b * b - 4.0 * a * c_val;
    if (disc >= 0.0) {
        let sqrtD = sqrt(disc);
        let t1 = (-b - sqrtD) / (2.0 * a);
        let t2 = (-b + sqrtD) / (2.0 * a);
        if (t1 > 0.05 && t1 < *minT) {
            let hitPos = ro + rd * t1;
            let toHit = normalize(hitPos - c);
            if (dot(toHit, dir) >= cosHalfAngle) {
                *minT = t1;
                *bestNormal = toHit * normalSign;
                *bestProps = arc.props;
            }
        }
        if (t2 > 0.05 && t2 < *minT) {
            let hitPos = ro + rd * t2;
            let toHit = normalize(hitPos - c);
            if (dot(toHit, dir) >= cosHalfAngle) {
                *minT = t2;
                *bestNormal = toHit * normalSign;
                *bestProps = arc.props;
            }
        }
    }
}

fn checkCircle(ro: vec2<f32>, rd: vec2<f32>, circ: Circle, minT: ptr<function, f32>, bestNormal: ptr<function, vec2<f32>>, bestProps: ptr<function, vec4<f32>>) {
    let c = circ.c;
    let r = circ.r;
    let oc = ro - c;
    let a = dot(rd, rd);
    let b = 2.0 * dot(oc, rd);
    let c_val = dot(oc, oc) - r * r;
    let disc = b * b - 4.0 * a * c_val;
    if (disc >= 0.0) {
        let sqrtD = sqrt(disc);
        let t1 = (-b - sqrtD) / (2.0 * a);
        let t2 = (-b + sqrtD) / (2.0 * a);
        var t = -1.0;
        if (t1 > 0.05) { t = t1; }
        else if (t2 > 0.05) { t = t2; }
        if (t > 0.05 && t < *minT) {
            *minT = t;
            *bestNormal = normalize((ro + rd * t) - c);
            *bestProps = circ.props;
        }
    }
}

fn rayIntersectsAABB(ro: vec2<f32>, invRd: vec2<f32>, bbox: vec4<f32>, tmin: ptr<function, f32>, tmax: ptr<function, f32>) -> bool {
    if (bbox.x > bbox.z) { return false; }
    let t0 = (bbox.xy - ro) * invRd;
    let t1 = (bbox.zw - ro) * invRd;
    let tmin2 = min(t0, t1);
    let tmax2 = max(t0, t1);
    *tmin = max(tmin2.x, tmin2.y);
    *tmax = min(tmax2.x, tmax2.y);
    return *tmax >= *tmin && *tmax > 0.0;
}

struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) color: vec3<f32>,
    @location(1) alpha: f32,
};

@vertex
fn vs_main(@builtin(instance_index) instance_index: u32, @builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    let id = f32(instance_index);
    let step = i32(vertex_index);
    seedState = vec2<f32>(id, 1.337 + u.seedOffset);

    let rndY = fract(id / u.totalRays + u.seedOffset);
    var wl = fract(id * 0.618033988749895 + u.seedOffset);
    if (u.colorType == 1) { wl = 0.8; }
    else if (u.colorType == 2) { wl = 0.5; }
    else if (u.colorType == 3) { wl = 0.2; }
    else if (u.colorType == 4) { wl = clamp(1.0 - (u.wavelength - 380.0) / (750.0 - 380.0), 0.0, 1.0); }

    let lambda = mix(0.4, 0.7, wl);
    let color = spectralColor(wl);
    let perp = vec2<f32>(-u.lightDir.y, u.lightDir.x);
    var ro = u.lightPos + perp * (rndY - 0.5) * u.beamWidth;
    var rd = u.lightDir;

    var currentN = u.envN;
    var currentAbs = 0.0;
    var currentScat = 0.0;
    var intensity = 1.0;

    for (var i = 0; i < 96; i++) {
        if (i >= step) { break; }
        if (intensity < 0.001) { break; }

        var minT = 99999.0;
        var normal = vec2<f32>(0.0);
        var hitProps = vec4<f32>(1.0, 0.0, 0.0, 0.0);

        let invRd = 1.0 / rd;
        for (var g = 0; g < 128; g++) {
            if (g >= u.numGroups) { break; }
            let group = groupBBoxes[g];

            var tminBox: f32;
            var tmaxBox: f32;
            if (rayIntersectsAABB(ro, invRd, group.bbox, &tminBox, &tmaxBox)) {
                if (tminBox > minT) { continue; }

                let count = group.count;
                for (var j = 0; j < 4096; j++) {
                    if (j >= count) { break; }
                    let segIdx = group.startIdx + j;
                    checkSegment(ro, rd, segments[segIdx], &minT, &normal, &hitProps);
                }
            }
        }

        for (var j = 0; j < 50; j++) {
            if (j >= u.numArcs) { break; }
            checkArc(ro, rd, arcs[j], &minT, &normal, &hitProps);
        }
        for (var j = 0; j < 10; j++) {
            if (j >= u.numCircles) { break; }
            checkCircle(ro, rd, circles[j], &minT, &normal, &hitProps);
        }

        var mu_s = 0.0;
        if (currentScat > 0.0) {
            let lambda_ratio = 0.55 / lambda;
            mu_s = currentScat * pow(lambda_ratio, 4.0);
        }
        var t_scatter = 99999.0;
        if (mu_s > 0.0) {
            let xi = clamp(rand(), 1e-7, 0.999999);
            t_scatter = -log(xi) / mu_s;
        }

        if (t_scatter < minT) {
            minT = t_scatter;
            ro = ro + rd * minT;
            if (currentAbs > 0.0) { intensity *= exp(-minT * currentAbs); }
            let angle = rand() * 6.28318530718;
            rd = vec2<f32>(cos(angle), sin(angle));
            continue;
        }

        if (minT > 9999.0) {
            ro = ro + rd * 2500.0;
            if (currentN > 1.0) { intensity *= exp(-2500.0 * currentAbs); }
            break;
        }

        let hitPos = ro + rd * minT;
        if (currentAbs > 0.0) { intensity *= exp(-minT * currentAbs); }

        if (hitProps.y == 1.0) {
            // Mirror
            if (dot(rd, normal) > 0.0) { normal = -normal; }
            rd = reflect(rd, normal);
            intensity *= 0.98;
        } else if (hitProps.y == 2.0) {
            // Absorber
            ro = hitPos;
            intensity = 0.0;
            break;
        } else {
            let entering = dot(rd, normal) < 0.0;
            if (!entering) { normal = -normal; }
            let n1 = getIOR(currentN, lambda, u.dispersion);
            var n2 = u.envN;
            if (entering) { n2 = getIOR(hitProps.x, lambda, u.dispersion); }
            let ratio = n1 / n2;
            let cosI = -dot(rd, normal);
            let sinT2 = ratio * ratio * (1.0 - cosI * cosI);

            if (sinT2 > 1.0) {
                rd = reflect(rd, normal);
            } else {
                let cosT = sqrt(1.0 - sinT2);
                let r0 = pow((n1 - n2) / (n1 + n2), 2.0);
                let R = r0 + (1.0 - r0) * pow(1.0 - cosI, 5.0);

                seedState += hitPos * 0.01 + vec2<f32>(f32(i * 13), f32(i * 97));
                if (rand() < R) {
                    rd = reflect(rd, normal);
                } else {
                    rd = normalize(ratio * rd + (ratio * cosI - cosT) * normal);
                    if (entering) {
                        currentN = hitProps.x;
                        currentAbs = hitProps.z;
                        currentScat = hitProps.w;
                    } else {
                        currentN = u.envN;
                        currentAbs = 0.0;
                        currentScat = 0.0;
                    }
                }
            }
        }
        ro = hitPos;
    }

    let screenPos = ro * u.cameraZoom + u.cameraPos;
    var clipPos = (screenPos / u.res) * 2.0 - 1.0;
    clipPos.y = -clipPos.y;

    var out: VertexOutput;
    out.position = vec4<f32>(clipPos, 0.0, 1.0);
    out.color = color;
    out.alpha = intensity * u.baseAlpha;
    return out;
}

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    return vec4<f32>(in.color * in.alpha, 1.0);
}
`;

export const wgslQuadShaders = `
struct VertexOutput {
    @builtin(position) position: vec4<f32>,
    @location(0) uv: vec2<f32>,
};

@vertex
fn vs_main(@builtin(vertex_index) vertex_index: u32) -> VertexOutput {
    var pos = array<vec2<f32>, 4>(
        vec2<f32>(-1.0, -1.0),
        vec2<f32>( 1.0, -1.0),
        vec2<f32>(-1.0,  1.0),
        vec2<f32>( 1.0,  1.0)
    );
    var out: VertexOutput;
    out.position = vec4<f32>(pos[vertex_index], 0.0, 1.0);
    out.uv = vec2<f32>(pos[vertex_index].x * 0.5 + 0.5, 0.5 - pos[vertex_index].y * 0.5);
    return out;
}

@group(0) @binding(0) var accumTex: texture_2d<f32>;
@group(0) @binding(1) var samp: sampler;
@group(0) @binding(2) var<uniform> accumFrames: f32;

@fragment
fn fs_main(in: VertexOutput) -> @location(0) vec4<f32> {
    var color = textureSample(accumTex, samp, in.uv).rgb;
    color /= accumFrames;
    color = 1.0 - exp(-color * 1.5);
    return vec4<f32>(color, 1.0);
}
`;
