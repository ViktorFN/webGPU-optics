import { Vector2, OpticElement } from '../types';

export function vec(x: number, y: number): Vector2 { return { x, y }; }
export function vadd(a: Vector2, b: Vector2): Vector2 { return vec(a.x + b.x, a.y + b.y); }
export function vrot(v: Vector2, angle: number): Vector2 { 
    const c = Math.cos(angle), s = Math.sin(angle); 
    return vec(v.x * c - v.y * s, v.x * s + v.y * c); 
}

export function getBezierPoint(t: number, p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2): Vector2 { 
    let u=1-t, tt=t*t, uu=u*u, uuu=uu*u, ttt=tt*t; 
    let p = vec(uuu*p0.x, uuu*p0.y); 
    p = vadd(p, vec(3*uu*t*p1.x, 3*uu*t*p1.y)); 
    p = vadd(p, vec(3*u*tt*p2.x, 3*u*tt*p2.y)); 
    p = vadd(p, vec(ttt*p3.x, ttt*p3.y)); 
    return p; 
}

export function getBezierDerivative(t: number, p0: Vector2, p1: Vector2, p2: Vector2, p3: Vector2): Vector2 { 
    let u=1-t; 
    let d = vec(3*u*u*(p1.x-p0.x), 3*u*u*(p1.y-p0.y)); 
    d = vadd(d, vec(6*u*t*(p2.x-p1.x), 6*u*t*(p2.y-p1.y))); 
    d = vadd(d, vec(3*t*t*(p3.x-p2.x), 3*t*t*(p3.y-p2.y))); 
    return d; 
}

export function getFiberGeometry(f: OpticElement) {
    let N = 60; 
    let halfT = (f.thickness || 40) / 2; 
    let topPts: Vector2[] = [], botPts: Vector2[] = []; 
    let angle = (f.rotation || 0) * Math.PI / 180;
    const pts = f.pts!;
    for (let i = 0; i <= N; i++) {
        let t = i / N; 
        let p = getBezierPoint(t, pts[0], pts[1], pts[2], pts[3]); 
        let d = getBezierDerivative(t, pts[0], pts[1], pts[2], pts[3]);
        let len = Math.hypot(d.x, d.y); 
        let nx = -d.y / len; 
        let ny = d.x / len;
        topPts.push(vadd(p, vec(-nx * halfT, -ny * halfT))); 
        botPts.push(vadd(p, vec(nx * halfT, ny * halfT)));
    }
    topPts = topPts.map(p => vadd(vec(f.x, f.y), vrot(p, angle))); 
    botPts = botPts.map(p => vadd(vec(f.x, f.y), vrot(p, angle)));
    let edges = [];
    for (let i = 0; i < N; i++) edges.push({p1: topPts[i], p2: topPts[i+1]}); 
    edges.push({p1: topPts[N], p2: botPts[N]}); 
    for (let i = N; i > 0; i--) edges.push({p1: botPts[i], p2: botPts[i-1]}); 
    edges.push({p1: botPts[0], p2: topPts[0]}); 
    return edges;
}

export function getPrismGeometry(p: OpticElement) { 
    const angle = p.rotation * Math.PI / 180; 
    const size = p.size || 140;
    const h = size * Math.sqrt(3) / 2; 
    const v = [vec(0, -h*2/3), vec(size/2, h/3), vec(-size/2, h/3)].map(v => vadd(vec(p.x, p.y), vrot(v, angle))); 
    return [{p1: v[0], p2: v[1]}, {p1: v[1], p2: v[2]}, {p1: v[2], p2: v[0]}]; 
}

export function getPolygonGeometry(p: OpticElement) { 
    const angle = (p.rotation || 0) * Math.PI / 180; 
    const v = p.vertices!.map(pt => vadd(vec(p.x, p.y), vrot(pt, angle))); 
    let edges = []; 
    for (let i = 0; i < v.length; i++) edges.push({ p1: v[i], p2: v[(i + 1) % v.length] }); 
    return edges; 
}

export function getLensUIGeometry(lens: OpticElement) {
    let pts: Vector2[] = []; 
    let R = lens.curvatureRadius || 200; 
    let H = (lens.height || 180) / 2; 
    let T = lens.thickness || 50; 
    let steps = 64; 
    let safeH = Math.min(H, R * 0.999); 
    let dx = Math.sqrt(R*R - safeH*safeH);
    if (lens.lensType === 'convex') {
        for(let i=0; i<=steps; i++) { let y = -safeH + (2*safeH)*(i/steps); pts.push(vec(-dx + Math.sqrt(R*R - y*y), y)); }
        for(let i=0; i<=steps; i++) { let y = safeH - (2*safeH)*(i/steps); pts.push(vec(dx - Math.sqrt(R*R - y*y), y)); }
    } else { 
        let cx_right = T/2 + dx; let cx_left = -T/2 - dx;
        for(let i=0; i<=steps; i++) { let y = -safeH + (2*safeH)*(i/steps); pts.push(vec(cx_right - Math.sqrt(R*R - y*y), y)); }
        for(let i=0; i<=steps; i++) { let y = safeH - (2*safeH)*(i/steps); pts.push(vec(cx_left + Math.sqrt(R*R - y*y), y)); }
    }
    let angle = (lens.rotation || 0) * Math.PI / 180; 
    let edges = [];
    for(let i=0; i<pts.length; i++) pts[i] = vadd(vec(lens.x, lens.y), vrot(pts[i], angle));
    for(let i=0; i<pts.length; i++) edges.push({p1: pts[i], p2: pts[(i+1)%pts.length]});
    return edges;
}

export function generatePolygon(el: OpticElement, transform: (x: number, y: number) => number[], props: number[]) {
    const pts = el.pts!.map(p => transform(p.x, p.y));
    let segs = [];
    let sProps = [];
    for (let i = 0; i < pts.length; i++) {
        segs.push(...pts[i], ...pts[(i + 1) % pts.length]);
        sProps.push(...props);
    }
    return { segs, sProps };
}

export function generateLens(el: OpticElement, transform: (x: number, y: number) => number[], props: number[]) {
    let a = [], aLim = [], aProps = [];
    let R = el.curvatureRadius || 200;
    let H = (el.height || 180) / 2;
    let T = el.thickness || 50;
    let safeH = Math.min(H, R * 0.999);
    let dx = Math.sqrt(R*R - safeH*safeH);
    
    if (el.lensType === 'convex') {
        let c1 = transform(-dx, 0);
        let c2 = transform(dx, 0);
        let dir1 = transform(1, 0); dir1 = [dir1[0]-el.x, dir1[1]-el.y];
        let dir2 = transform(-1, 0); dir2 = [dir2[0]-el.x, dir2[1]-el.y];
        let cosHalf = Math.cos(Math.asin(safeH/R));
        
        a.push(...c1, R, 1); aLim.push(...dir1, cosHalf, 0); aProps.push(...props);
        a.push(...c2, R, 1); aLim.push(...dir2, cosHalf, 0); aProps.push(...props);
    } else {
        let cx_right = T/2 + dx;
        let cx_left = -T/2 - dx;
        let c1 = transform(cx_right, 0);
        let c2 = transform(cx_left, 0);
        let dir1 = transform(-1, 0); dir1 = [dir1[0]-el.x, dir1[1]-el.y];
        let dir2 = transform(1, 0); dir2 = [dir2[0]-el.x, dir2[1]-el.y];
        let cosHalf = Math.cos(Math.asin(safeH/R));
        
        a.push(...c1, R, -1); aLim.push(...dir1, cosHalf, 0); aProps.push(...props);
        a.push(...c2, R, -1); aLim.push(...dir2, cosHalf, 0); aProps.push(...props);
    }
    return { a, aLim, aProps };
}

export function generateFiber(el: OpticElement, transform: (x: number, y: number) => number[], props: number[]) {
    let segs = [], sProps = [], a = [], aLim = [], aProps = [];
    let N = 20;
    let halfT = (el.thickness || 40) / 2;
    let topPts = [], botPts = [];
    const pts = el.pts!;
    
    for (let i = 0; i <= N; i++) {
        let t = i / N;
        let p = getBezierPoint(t, pts[0], pts[1], pts[2], pts[3]);
        let d = getBezierDerivative(t, pts[0], pts[1], pts[2], pts[3]);
        let len = Math.hypot(d.x, d.y);
        let nx = -d.y / len;
        let ny = d.x / len;
        
        let tp = transform(p.x - nx * halfT, p.y - ny * halfT);
        let bp = transform(p.x + nx * halfT, p.y + ny * halfT);
        topPts.push(tp);
        botPts.push(bp);
    }
    
    for (let i = 0; i < N; i++) {
        segs.push(...topPts[i], ...topPts[i+1]); sProps.push(...props);
        segs.push(...botPts[i], ...botPts[i+1]); sProps.push(...props);
    }
    segs.push(...topPts[0], ...botPts[0]); sProps.push(...props);
    segs.push(...topPts[N], ...botPts[N]); sProps.push(...props);
    
    return { segs, sProps, a, aLim, aProps };
}

export function distToSegment(p: Vector2, v: Vector2, w: Vector2) {
    const l2 = (w.x - v.x) ** 2 + (w.y - v.y) ** 2;
    if (l2 === 0) return Math.hypot(p.x - v.x, p.y - v.y);
    let t = ((p.x - v.x) * (w.x - v.x) + (p.y - v.y) * (w.y - v.y)) / l2;
    t = Math.max(0, Math.min(1, t));
    return Math.hypot(p.x - (v.x + t * (w.x - v.x)), p.y - (v.y + t * (w.y - v.y)));
}
