import { wgslShaders, wgslQuadShaders } from './shaders';
import { getPrismGeometry, getPolygonGeometry, getFiberGeometry, getLensUIGeometry, vadd, vec, vrot, distToSegment } from './math';
import { AppState, OpticElement, Vector2 } from '../types';
import { playSound } from './audio';

export class OpticsEngine {
    canvas: HTMLCanvasElement;
    uiCanvas: HTMLCanvasElement;
    ctx: CanvasRenderingContext2D;
    
    device!: GPUDevice;
    context!: GPUCanvasContext;
    format!: GPUTextureFormat;
    
    pipeline!: GPURenderPipeline;
    quadPipeline!: GPURenderPipeline;
    
    uniformBuffer!: GPUBuffer;
    segmentsBuffer!: GPUBuffer;
    groupBBoxBuffer!: GPUBuffer;
    arcsBuffer!: GPUBuffer;
    circlesBuffer!: GPUBuffer;
    
    bindGroup!: GPUBindGroup;
    quadBindGroup!: GPUBindGroup;
    
    accumTexture!: GPUTexture;
    accumView!: GPUTextureView;
    
    accumFramesBuffer!: GPUBuffer;
    quadSampler!: GPUSampler;
    
    accumulatedFrames: number = 0;
    
    width: number = 0;
    height: number = 0;
    
    getState: () => AppState;
    onStateChange: (recordHistory?: boolean) => void;
    
    renderRequested = false;
    initialized = false;
    
    hoveredVertex: { elemIdx: number, vIdx: number } | null = null;
    draggingVertex: { elemIdx: number, vIdx: number } | null = null;
    draggingElement: number | null = null;
    hoveredHandle: 'rotation' | 'scale' | null = null;
    draggingHandle: 'rotation' | 'scale' | null = null;
    draggingCamera: boolean = false;
    dragOffset: Vector2 = { x: 0, y: 0 };
    cameraDragStart: Vector2 = { x: 0, y: 0 };
    initialCameraPos: Vector2 = { x: 0, y: 0 };
    initialRotation: number = 0;
    initialAngle: number = 0;
    initialDist: number = 0;
    initialSize: number = 0;
    initialSize2: number = 0;
    initialPts: Vector2[] = [];

    constructor(
        glCanvas: HTMLCanvasElement, 
        uiCanvas: HTMLCanvasElement, 
        getState: () => AppState,
        onStateChange: (recordHistory?: boolean) => void
    ) {
        this.canvas = glCanvas;
        this.uiCanvas = uiCanvas;
        this.ctx = uiCanvas.getContext('2d')!;
        this.getState = getState;
        this.onStateChange = onStateChange;
        
        this.setupEvents(uiCanvas);
    }

    async init() {
        if (!navigator.gpu) throw new Error("WebGPU not supported");
        const adapter = await navigator.gpu.requestAdapter();
        if (!adapter) throw new Error("No appropriate GPUAdapter found");
        this.device = await adapter.requestDevice();
        this.context = this.canvas.getContext('webgpu') as GPUCanvasContext;
        this.format = navigator.gpu.getPreferredCanvasFormat();
        
        this.context.configure({
            device: this.device,
            format: this.format,
            alphaMode: 'premultiplied',
        });
        
        // WGSL Uniforms struct is 112 bytes due to alignment/padding rules.
        this.uniformBuffer = this.device.createBuffer({ size: 112, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        this.segmentsBuffer = this.device.createBuffer({ size: 4096 * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.groupBBoxBuffer = this.device.createBuffer({ size: 128 * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.arcsBuffer = this.device.createBuffer({ size: 50 * 48, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        this.circlesBuffer = this.device.createBuffer({ size: 10 * 32, usage: GPUBufferUsage.STORAGE | GPUBufferUsage.COPY_DST });
        
        this.accumFramesBuffer = this.device.createBuffer({ size: 16, usage: GPUBufferUsage.UNIFORM | GPUBufferUsage.COPY_DST });
        
        this.quadSampler = this.device.createSampler({
            magFilter: 'linear',
            minFilter: 'linear',
        });
        
        const shaderModule = this.device.createShaderModule({ code: wgslShaders });
        const quadModule = this.device.createShaderModule({ code: wgslQuadShaders });
        
        this.pipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: shaderModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: shaderModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: 'rgba16float',
                    blend: {
                        color: { srcFactor: 'one', dstFactor: 'one', operation: 'add' },
                        alpha: { srcFactor: 'one', dstFactor: 'one', operation: 'add' }
                    }
                }],
            },
            primitive: {
                topology: 'line-strip',
            },
        });
        
        this.quadPipeline = this.device.createRenderPipeline({
            layout: 'auto',
            vertex: {
                module: quadModule,
                entryPoint: 'vs_main',
            },
            fragment: {
                module: quadModule,
                entryPoint: 'fs_main',
                targets: [{
                    format: this.format,
                }],
            },
            primitive: {
                topology: 'triangle-strip',
            },
        });
        
        this.bindGroup = this.device.createBindGroup({
            layout: this.pipeline.getBindGroupLayout(0),
            entries: [
                { binding: 0, resource: { buffer: this.uniformBuffer } },
                { binding: 1, resource: { buffer: this.segmentsBuffer } },
                { binding: 2, resource: { buffer: this.groupBBoxBuffer } },
                { binding: 3, resource: { buffer: this.arcsBuffer } },
                { binding: 4, resource: { buffer: this.circlesBuffer } },
            ],
        });
        
        this.initialized = true;
        
        const dpr = window.devicePixelRatio || 1;
        this.resize(window.innerWidth, window.innerHeight, dpr);
    }

    resize(w: number, h: number, dpr: number) {
        this.width = w * dpr;
        this.height = h * dpr;
        
        this.canvas.width = this.width;
        this.canvas.height = this.height;
        this.uiCanvas.width = this.width;
        this.uiCanvas.height = this.height;
        
        this.ctx.setTransform(1, 0, 0, 1, 0, 0);
        this.ctx.scale(dpr, dpr);
        
        if (this.initialized) {
            if (this.accumTexture) {
                this.accumTexture.destroy();
            }
            
            this.accumTexture = this.device.createTexture({
                size: [this.width, this.height, 1],
                format: 'rgba16float',
                usage: GPUTextureUsage.RENDER_ATTACHMENT | GPUTextureUsage.TEXTURE_BINDING,
            });
            this.accumView = this.accumTexture.createView();
            
            this.quadBindGroup = this.device.createBindGroup({
                layout: this.quadPipeline.getBindGroupLayout(0),
                entries: [
                    { binding: 0, resource: this.accumView },
                    { binding: 1, resource: this.quadSampler },
                    { binding: 2, resource: { buffer: this.accumFramesBuffer } },
                ],
            });
        }
        
        const state = this.getState();
        if (!state.lightSource.initialized) {
            state.lightSource.y = h * 0.5;
            state.lightSource.x = w > 800 ? 300 : w * 0.2;
            state.lightSource.initialized = true;
        }
        this.requestRender();
    }

    requestRender() {
        this.accumulatedFrames = 0;
        if (!this.renderRequested) {
            this.renderRequested = true;
            requestAnimationFrame(() => this.renderLoop());
        }
    }

    renderLoop() {
        this.renderRequested = false;
        if (!this.initialized) return;
        
        const state = this.getState();
        const maxFrames = state.globals.quality === 'high' ? 100 : (state.globals.quality === 'medium' ? 20 : 5);
        
        if (this.accumulatedFrames < maxFrames) {
            this.renderGPU();
            this.accumulatedFrames++;
            
            if (this.accumulatedFrames < maxFrames) {
                this.renderRequested = true;
                requestAnimationFrame(() => this.renderLoop());
            }
        }
        
        this.renderUI();
    }

    renderGPU() {
        const state = this.getState();
        
        if (this.accumulatedFrames === 0) {
            this.updateSceneData(state);
        }
        
        // Keep this in sync with WGSL `Uniforms` (112 bytes / 28 floats).
        const uniforms = new Float32Array(28);
        uniforms[0] = this.width;
        uniforms[1] = this.height;
        uniforms[2] = state.lightSource.x;
        uniforms[3] = state.lightSource.y;
        const rad = state.globals.angle * Math.PI / 180;
        uniforms[4] = Math.cos(rad);
        uniforms[5] = Math.sin(rad);
        uniforms[6] = state.camera.x;
        uniforms[7] = state.camera.y;
        uniforms[8] = state.globals.beamWidth;
        uniforms[9] = state.globals.dispersion;
        uniforms[10] = state.globals.envN;
        
        const RAYS_PER_FRAME = 5000;
        let density = RAYS_PER_FRAME / Math.max(state.globals.beamWidth, 1.0);
        let targetAlpha = (12.0 / density) * state.globals.intensity;
        targetAlpha = Math.max(targetAlpha, 0.005 * state.globals.intensity);
        uniforms[11] = targetAlpha;
        
        uniforms[12] = new Float32Array(new Int32Array([state.globals.colorType || 0]).buffer)[0];
        uniforms[13] = state.globals.wavelength;
        uniforms[14] = RAYS_PER_FRAME;
        uniforms[15] = state.camera.zoom;
        uniforms[16] = Math.random();
        
        // Update counts from scene data
        let numSegs = 0;
        let numArcs = 0;
        let numCircles = 0;
        let numGroups = 0;
        state.elements.forEach(el => {
            if (el.type === 'mirror' || el.type === 'absorber') {
                numSegs += 1;
                numGroups++;
            } else if (el.type === 'prism') {
                numSegs += getPrismGeometry(el).length;
                numGroups++;
            } else if (el.type === 'polygon') {
                numSegs += getPolygonGeometry(el).length;
                numGroups++;
            } else if (el.type === 'fiber') {
                numSegs += getFiberGeometry(el).length;
                numGroups++;
            } else if (el.type === 'glass') {
                numSegs += el.points?.length || 0;
                numGroups++;
            } else if (el.type === 'lens') {
                numArcs += 2;
                if (el.lensType !== 'convex') numSegs += 2;
                numGroups++;
            } else if (el.type === 'raindrop') {
                numCircles += 1;
                numGroups++;
            }
        });
        
        uniforms[17] = new Float32Array(new Int32Array([numSegs]).buffer)[0];
        uniforms[18] = new Float32Array(new Int32Array([numArcs]).buffer)[0];
        uniforms[19] = new Float32Array(new Int32Array([numCircles]).buffer)[0];
        uniforms[20] = new Float32Array(new Int32Array([numGroups]).buffer)[0];
        
        this.device.queue.writeBuffer(this.uniformBuffer, 0, uniforms);
        
        const accumFramesData = new Float32Array([this.accumulatedFrames + 1]);
        this.device.queue.writeBuffer(this.accumFramesBuffer, 0, accumFramesData);
        
        const commandEncoder = this.device.createCommandEncoder();
        
        const passEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.accumView,
                loadOp: this.accumulatedFrames === 0 ? 'clear' : 'load',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                storeOp: 'store',
            }],
        });
        
        passEncoder.setPipeline(this.pipeline);
        passEncoder.setBindGroup(0, this.bindGroup);
        passEncoder.draw(96, RAYS_PER_FRAME); // 96 vertices per ray (bounces)
        passEncoder.end();
        
        const quadPassEncoder = commandEncoder.beginRenderPass({
            colorAttachments: [{
                view: this.context.getCurrentTexture().createView(),
                loadOp: 'clear',
                clearValue: { r: 0, g: 0, b: 0, a: 1 },
                storeOp: 'store',
            }],
        });
        
        quadPassEncoder.setPipeline(this.quadPipeline);
        quadPassEncoder.setBindGroup(0, this.quadBindGroup);
        quadPassEncoder.draw(4);
        quadPassEncoder.end();
        
        this.device.queue.submit([commandEncoder.finish()]);
    }

    updateSceneData(state: AppState) {
        const segmentsData = new Float32Array(4096 * 8); // 4096 segments, 8 floats each
        const groupBBoxData = new Float32Array(128 * 8); // 128 groups, 8 floats each
        const arcsData = new Float32Array(50 * 12); // 50 arcs, 12 floats each
        const circlesData = new Float32Array(10 * 8); // 10 circles, 8 floats each
        
        let segIdx = 0;
        let arcIdx = 0;
        let circIdx = 0;
        let groupIdx = 0;
        
        state.elements.forEach(el => {
            let typeId = 0;
            if (el.type === 'mirror') typeId = 1;
            if (el.type === 'absorber') typeId = 2;
            if (el.type === 'glass' || el.type === 'prism' || el.type === 'polygon' || el.type === 'fiber') typeId = 3;
            
            if (typeId > 0) {
                let minX = Infinity, minY = Infinity, maxX = -Infinity, maxY = -Infinity;
                const startSegIdx = segIdx;
                
                if (el.type === 'prism' || el.type === 'polygon' || el.type === 'fiber') {
                    const edges = el.type === 'prism' ? getPrismGeometry(el) : (el.type === 'polygon' ? getPolygonGeometry(el) : getFiberGeometry(el));
                    for (let i = 0; i < edges.length; i++) {
                        const p1 = edges[i].p1;
                        const p2 = edges[i].p2;
                        
                        minX = Math.min(minX, p1.x, p2.x);
                        minY = Math.min(minY, p1.y, p2.y);
                        maxX = Math.max(maxX, p1.x, p2.x);
                        maxY = Math.max(maxY, p1.y, p2.y);
                        
                        const baseIdx = segIdx * 8;
                        segmentsData[baseIdx] = p1.x;
                        segmentsData[baseIdx + 1] = p1.y;
                        segmentsData[baseIdx + 2] = p2.x;
                        segmentsData[baseIdx + 3] = p2.y;
                        segmentsData[baseIdx + 4] = typeId === 3 ? (el.n || 1.5) : state.globals.envN;
                        segmentsData[baseIdx + 5] = typeId;
                        segmentsData[baseIdx + 6] = el.absorption || 0;
                        segmentsData[baseIdx + 7] = el.scattering || 0;
                        
                        segIdx++;
                    }
                } else if (el.type === 'glass') {
                    const pts = el.points || [];
                    for (let i = 0; i < pts.length; i++) {
                        const p1 = pts[i];
                        const p2 = pts[(i + 1) % pts.length];

                        minX = Math.min(minX, p1.x, p2.x);
                        minY = Math.min(minY, p1.y, p2.y);
                        maxX = Math.max(maxX, p1.x, p2.x);
                        maxY = Math.max(maxY, p1.y, p2.y);

                        const baseIdx = segIdx * 8;
                        segmentsData[baseIdx] = p1.x;
                        segmentsData[baseIdx + 1] = p1.y;
                        segmentsData[baseIdx + 2] = p2.x;
                        segmentsData[baseIdx + 3] = p2.y;
                        segmentsData[baseIdx + 4] = el.n || 1.5;
                        segmentsData[baseIdx + 5] = 3;
                        segmentsData[baseIdx + 6] = el.absorption || 0;
                        segmentsData[baseIdx + 7] = el.scattering || 0;

                        segIdx++;
                    }
                } else if (el.type === 'mirror' || el.type === 'absorber') {
                    const rRad = (el.rotation || 0) * Math.PI / 180;
                    const len = el.length || 150;
                    const p1 = vadd(vec(el.x, el.y), vrot(vec(-len/2, 0), rRad));
                    const p2 = vadd(vec(el.x, el.y), vrot(vec(len/2, 0), rRad));
                    
                    minX = Math.min(p1.x, p2.x);
                    minY = Math.min(p1.y, p2.y);
                    maxX = Math.max(p1.x, p2.x);
                    maxY = Math.max(p1.y, p2.y);
                    
                    const baseIdx = segIdx * 8;
                    segmentsData[baseIdx] = p1.x;
                    segmentsData[baseIdx + 1] = p1.y;
                    segmentsData[baseIdx + 2] = p2.x;
                    segmentsData[baseIdx + 3] = p2.y;
                    segmentsData[baseIdx + 4] = typeId === 3 ? (el.n || 1.5) : state.globals.envN;
                    segmentsData[baseIdx + 5] = typeId;
                    segmentsData[baseIdx + 6] = el.absorption || 0;
                    segmentsData[baseIdx + 7] = el.scattering || 0;
                    
                    segIdx++;
                }
                
                groupBBoxData[groupIdx * 8] = minX;
                groupBBoxData[groupIdx * 8 + 1] = minY;
                groupBBoxData[groupIdx * 8 + 2] = maxX;
                groupBBoxData[groupIdx * 8 + 3] = maxY;
                groupBBoxData[groupIdx * 8 + 4] = new Float32Array(new Int32Array([startSegIdx]).buffer)[0];
                groupBBoxData[groupIdx * 8 + 5] = new Float32Array(new Int32Array([segIdx - startSegIdx]).buffer)[0];
                groupBBoxData[groupIdx * 8 + 6] = 0;
                groupBBoxData[groupIdx * 8 + 7] = 0;
                groupIdx++;
            } else if (el.type === 'lens') {
                const R = el.curvatureRadius || 200;
                const H = (el.height || 180) / 2;
                const T = el.thickness || 50;
                const safeH = Math.min(H, R * 0.999);
                const dx = Math.sqrt(R * R - safeH * safeH);
                const cosHA = dx / R;
                const angle = (el.rotation || 0) * Math.PI / 180;
                
                if (el.lensType === 'convex') {
                    const c1 = vadd(vec(el.x, el.y), vrot(vec(-dx, 0), angle));
                    const dir1 = vrot(vec(1, 0), angle);
                    let baseIdx = arcIdx * 12;
                    arcsData[baseIdx] = c1.x;
                    arcsData[baseIdx + 1] = c1.y;
                    arcsData[baseIdx + 2] = R;
                    arcsData[baseIdx + 3] = 1.0;
                    arcsData[baseIdx + 4] = dir1.x;
                    arcsData[baseIdx + 5] = dir1.y;
                    arcsData[baseIdx + 6] = cosHA;
                    arcsData[baseIdx + 7] = 0; // pad
                    arcsData[baseIdx + 8] = el.n || 1.5;
                    arcsData[baseIdx + 9] = 3; // material type (glass)
                    arcsData[baseIdx + 10] = el.absorption || 0;
                    arcsData[baseIdx + 11] = el.scattering || 0;
                    arcIdx++;
                    
                    const c2 = vadd(vec(el.x, el.y), vrot(vec(dx, 0), angle));
                    const dir2 = vrot(vec(-1, 0), angle);
                    baseIdx = arcIdx * 12;
                    arcsData[baseIdx] = c2.x;
                    arcsData[baseIdx + 1] = c2.y;
                    arcsData[baseIdx + 2] = R;
                    arcsData[baseIdx + 3] = 1.0;
                    arcsData[baseIdx + 4] = dir2.x;
                    arcsData[baseIdx + 5] = dir2.y;
                    arcsData[baseIdx + 6] = cosHA;
                    arcsData[baseIdx + 7] = 0; // pad
                    arcsData[baseIdx + 8] = el.n || 1.5;
                    arcsData[baseIdx + 9] = 3; // material type (glass)
                    arcsData[baseIdx + 10] = el.absorption || 0;
                    arcsData[baseIdx + 11] = el.scattering || 0;
                    arcIdx++;
                    
                    groupBBoxData[groupIdx * 8] = el.x - R; // approximate
                    groupBBoxData[groupIdx * 8 + 1] = el.y - R;
                    groupBBoxData[groupIdx * 8 + 2] = el.x + R;
                    groupBBoxData[groupIdx * 8 + 3] = el.y + R;
                    groupBBoxData[groupIdx * 8 + 4] = new Float32Array(new Int32Array([segIdx]).buffer)[0];
                    groupBBoxData[groupIdx * 8 + 5] = new Float32Array(new Int32Array([0]).buffer)[0];
                    groupBBoxData[groupIdx * 8 + 6] = 0;
                    groupBBoxData[groupIdx * 8 + 7] = 0;
                    groupIdx++;
                } else {
                    const c1 = vadd(vec(el.x, el.y), vrot(vec(T/2 + dx, 0), angle));
                    const dir1 = vrot(vec(-1, 0), angle);
                    let baseIdx = arcIdx * 12;
                    arcsData[baseIdx] = c1.x;
                    arcsData[baseIdx + 1] = c1.y;
                    arcsData[baseIdx + 2] = R;
                    arcsData[baseIdx + 3] = -1.0;
                    arcsData[baseIdx + 4] = dir1.x;
                    arcsData[baseIdx + 5] = dir1.y;
                    arcsData[baseIdx + 6] = cosHA;
                    arcsData[baseIdx + 7] = 0; // pad
                    arcsData[baseIdx + 8] = el.n || 1.5;
                    arcsData[baseIdx + 9] = 3; // material type (glass)
                    arcsData[baseIdx + 10] = el.absorption || 0;
                    arcsData[baseIdx + 11] = el.scattering || 0;
                    arcIdx++;
                    
                    const c2 = vadd(vec(el.x, el.y), vrot(vec(-T/2 - dx, 0), angle));
                    const dir2 = vrot(vec(1, 0), angle);
                    baseIdx = arcIdx * 12;
                    arcsData[baseIdx] = c2.x;
                    arcsData[baseIdx + 1] = c2.y;
                    arcsData[baseIdx + 2] = R;
                    arcsData[baseIdx + 3] = -1.0;
                    arcsData[baseIdx + 4] = dir2.x;
                    arcsData[baseIdx + 5] = dir2.y;
                    arcsData[baseIdx + 6] = cosHA;
                    arcsData[baseIdx + 7] = 0; // pad
                    arcsData[baseIdx + 8] = el.n || 1.5;
                    arcsData[baseIdx + 9] = 3; // material type (glass)
                    arcsData[baseIdx + 10] = el.absorption || 0;
                    arcsData[baseIdx + 11] = el.scattering || 0;
                    arcIdx++;
                    
                    const startSegIdx = segIdx;
                    const pTL = vadd(vec(el.x, el.y), vrot(vec(-T/2, -H), angle));
                    const pTR = vadd(vec(el.x, el.y), vrot(vec(T/2, -H), angle));
                    const pBL = vadd(vec(el.x, el.y), vrot(vec(-T/2, H), angle));
                    const pBR = vadd(vec(el.x, el.y), vrot(vec(T/2, H), angle));
                    
                    baseIdx = segIdx * 8;
                    segmentsData[baseIdx] = pTL.x; segmentsData[baseIdx + 1] = pTL.y;
                    segmentsData[baseIdx + 2] = pTR.x; segmentsData[baseIdx + 3] = pTR.y;
                    segmentsData[baseIdx + 4] = el.n || 1.5; segmentsData[baseIdx + 5] = 3;
                    segmentsData[baseIdx + 6] = el.absorption || 0; segmentsData[baseIdx + 7] = el.scattering || 0;
                    segIdx++;
                    
                    baseIdx = segIdx * 8;
                    segmentsData[baseIdx] = pBR.x; segmentsData[baseIdx + 1] = pBR.y;
                    segmentsData[baseIdx + 2] = pBL.x; segmentsData[baseIdx + 3] = pBL.y;
                    segmentsData[baseIdx + 4] = el.n || 1.5; segmentsData[baseIdx + 5] = 3;
                    segmentsData[baseIdx + 6] = el.absorption || 0; segmentsData[baseIdx + 7] = el.scattering || 0;
                    segIdx++;
                    
                    groupBBoxData[groupIdx * 8] = el.x - R; // approximate
                    groupBBoxData[groupIdx * 8 + 1] = el.y - R;
                    groupBBoxData[groupIdx * 8 + 2] = el.x + R;
                    groupBBoxData[groupIdx * 8 + 3] = el.y + R;
                    groupBBoxData[groupIdx * 8 + 4] = new Float32Array(new Int32Array([startSegIdx]).buffer)[0];
                    groupBBoxData[groupIdx * 8 + 5] = new Float32Array(new Int32Array([segIdx - startSegIdx]).buffer)[0];
                    groupBBoxData[groupIdx * 8 + 6] = 0;
                    groupBBoxData[groupIdx * 8 + 7] = 0;
                    groupIdx++;
                }
            } else if (el.type === 'raindrop') {
                const baseIdx = circIdx * 8;
                circlesData[baseIdx] = el.x;
                circlesData[baseIdx + 1] = el.y;
                circlesData[baseIdx + 2] = el.radius || 100;
                circlesData[baseIdx + 3] = 0; // pad
                circlesData[baseIdx + 4] = el.n || 1.333; // water IOR
                circlesData[baseIdx + 5] = 3; // material type (glass)
                circlesData[baseIdx + 6] = el.absorption || 0;
                circlesData[baseIdx + 7] = el.scattering || 0;
                circIdx++;
                
                groupBBoxData[groupIdx * 8] = el.x - (el.radius || 100);
                groupBBoxData[groupIdx * 8 + 1] = el.y - (el.radius || 100);
                groupBBoxData[groupIdx * 8 + 2] = el.x + (el.radius || 100);
                groupBBoxData[groupIdx * 8 + 3] = el.y + (el.radius || 100);
                groupBBoxData[groupIdx * 8 + 4] = new Float32Array(new Int32Array([segIdx]).buffer)[0];
                groupBBoxData[groupIdx * 8 + 5] = new Float32Array(new Int32Array([0]).buffer)[0];
                groupBBoxData[groupIdx * 8 + 6] = 0;
                groupBBoxData[groupIdx * 8 + 7] = 0;
                groupIdx++;
            }
        });
        
        this.device.queue.writeBuffer(this.segmentsBuffer, 0, segmentsData);
        this.device.queue.writeBuffer(this.groupBBoxBuffer, 0, groupBBoxData);
        this.device.queue.writeBuffer(this.arcsBuffer, 0, arcsData);
        this.device.queue.writeBuffer(this.circlesBuffer, 0, circlesData);
    }

    getHandlePos(e: OpticElement) {
        let maxDist = 40; 
        if(e.type==='raindrop') maxDist=e.radius || 100; 
        if(e.type==='lens') maxDist=(e.height || 180)/2; 
        if(e.type==='prism') maxDist=(e.size || 140)/1.5; 
        if(e.type==='mirror') maxDist=(e.length || 150)/2; 
        if(e.type==='polygon' || e.type==='fiber') {
            let pts = e.type === 'fiber' ? e.pts! : e.vertices!;
            maxDist = Math.max(...pts.map(p => Math.hypot(p.x, p.y)));
        }
        return vadd(vec(e.x, e.y), vrot(vec(0, -maxDist - 30), (e.rotation || 0) * Math.PI / 180));
    }

    getScaleHandlePos(e: OpticElement) {
        let maxDist = 40; 
        if(e.type==='raindrop') maxDist=e.radius || 100; 
        if(e.type==='lens') maxDist=(e.height || 180)/2; 
        if(e.type==='prism') maxDist=(e.size || 140)/1.5; 
        if(e.type==='mirror') maxDist=(e.length || 150)/2; 
        if(e.type==='polygon' || e.type==='fiber') {
            let pts = e.type === 'fiber' ? e.pts! : e.vertices!;
            maxDist = Math.max(...pts.map(p => Math.hypot(p.x, p.y)));
        }
        return vadd(vec(e.x, e.y), vrot(vec(maxDist + 30, 0), (e.rotation || 0) * Math.PI / 180));
    }

    renderUI() {
        const state = this.getState();
        this.ctx.clearRect(0, 0, this.width, this.height); 
        this.ctx.save();
        this.ctx.translate(state.camera.x, state.camera.y);
        this.ctx.scale(state.camera.zoom, state.camera.zoom);
        
        if (state.globals.snapping) {
            this.ctx.fillStyle = 'rgba(255, 255, 255, 0.04)';
            const s = state.globals.gridSize;
            const startX = Math.floor(-state.camera.x / state.camera.zoom / s) * s;
            const startY = Math.floor(-state.camera.y / state.camera.zoom / s) * s;
            const endX = startX + this.width / state.camera.zoom + s;
            const endY = startY + this.height / state.camera.zoom + s;
            
            for (let x=startX; x<endX; x+=s) { 
                for (let y=startY; y<endY; y+=s) { 
                    this.ctx.beginPath(); this.ctx.arc(x, y, 1.5 / state.camera.zoom, 0, Math.PI*2); this.ctx.fill(); 
                } 
            }
        }

        state.elements.forEach((elem, index) => { 
            const sel = index === state.selectedElement; 
            if (elem.type === 'prism') this.drawPolygonObj(getPrismGeometry(elem), sel, '#8b5cf6', 'rgba(139, 92, 246, 0.05)', index, elem); 
            else if (elem.type === 'polygon') this.drawPolygonObj(getPolygonGeometry(elem), sel, '#22c55e', 'rgba(34, 197, 94, 0.05)', index, elem); 
            else if (elem.type === 'fiber') this.drawFiberObj(elem, sel, '#10b981', 'rgba(16, 185, 129, 0.05)', index); 
            else if (elem.type === 'lens') this.drawPolygonObj(getLensUIGeometry(elem), sel, '#06b6d4', 'rgba(34, 211, 238, 0.05)', null, elem); 
            else if (elem.type === 'raindrop') this.drawRaindrop(elem, sel); 
            else if (elem.type === 'mirror') this.drawMirror(elem, sel); 
            
            if (sel && elem.type !== 'raindrop') {
                const handlePos = this.getHandlePos(elem);
                this.ctx.beginPath();
                this.ctx.moveTo(elem.x, elem.y);
                this.ctx.lineTo(handlePos.x, handlePos.y);
                this.ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                this.ctx.setLineDash([4 / state.camera.zoom, 4 / state.camera.zoom]);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
                
                this.ctx.beginPath();
                this.ctx.arc(handlePos.x, handlePos.y, 6 / state.camera.zoom, 0, Math.PI*2);
                this.ctx.fillStyle = this.hoveredHandle === 'rotation' ? '#fff' : '#a8a29e';
                this.ctx.fill();
            }
            if (sel) {
                const scaleHandlePos = this.getScaleHandlePos(elem);
                this.ctx.beginPath();
                this.ctx.moveTo(elem.x, elem.y);
                this.ctx.lineTo(scaleHandlePos.x, scaleHandlePos.y);
                this.ctx.strokeStyle = 'rgba(255,255,255,0.2)';
                this.ctx.setLineDash([4 / state.camera.zoom, 4 / state.camera.zoom]);
                this.ctx.stroke();
                this.ctx.setLineDash([]);
                
                this.ctx.beginPath();
                const sSize = 10 / state.camera.zoom;
                this.ctx.rect(scaleHandlePos.x - sSize/2, scaleHandlePos.y - sSize/2, sSize, sSize);
                this.ctx.fillStyle = this.hoveredHandle === 'scale' ? '#fff' : '#a8a29e';
                this.ctx.fill();
            }
        });
        this.drawLightSourceUI();
        this.ctx.restore();
    }

    drawLightSourceUI() { 
        const state = this.getState();
        const { x, y } = state.lightSource; 
        const zoom = state.camera.zoom;
        this.ctx.fillStyle = 'rgba(255, 255, 255, 0.05)'; 
        this.ctx.beginPath(); this.ctx.arc(x, y, 40 / zoom, 0, Math.PI*2); this.ctx.fill(); 
        this.ctx.fillStyle = '#fff'; 
        this.ctx.beginPath(); this.ctx.arc(x, y, 6 / zoom, 0, Math.PI*2); this.ctx.fill(); 
        this.ctx.shadowBlur = 15; this.ctx.shadowColor = '#fff'; this.ctx.fill(); this.ctx.shadowBlur = 0; 
    }
    
    applyGlassStyle(selected: boolean, mainColor: string) { 
        const zoom = this.getState().camera.zoom;
        this.ctx.shadowBlur = selected ? 15 / zoom : 0; 
        this.ctx.shadowColor = mainColor; 
        this.ctx.strokeStyle = selected ? '#fff' : mainColor; 
        this.ctx.lineWidth = (selected ? 1.5 : 1) / zoom; 
    }
    
    drawPolygonObj(edges: {p1: Vector2, p2: Vector2}[], selected: boolean, colorLine: string, colorFill: string, elemIndex: number | null, e: OpticElement) { 
        if(edges.length < 2) return; 
        this.ctx.save(); this.ctx.beginPath(); this.ctx.moveTo(edges[0].p1.x, edges[0].p1.y); 
        for(let i=0; i<edges.length; i++) this.ctx.lineTo(edges[i].p2.x, edges[i].p2.y); 
        this.ctx.fillStyle = colorFill; this.ctx.fill(); 
        this.applyGlassStyle(selected, colorLine); this.ctx.stroke(); 
        
        if(selected && elemIndex !== null && e.type === 'polygon') { 
            this.ctx.shadowBlur = 0; 
            let angle = (e.rotation||0)*Math.PI/180;
            const zoom = this.getState().camera.zoom;
            e.vertices!.forEach((v, i) => { 
                let p = vadd(vec(e.x, e.y), vrot(v, angle));
                const hov = this.hoveredVertex && this.hoveredVertex.elemIdx === elemIndex && this.hoveredVertex.vIdx === i; 
                this.ctx.fillStyle = hov ? '#fff' : colorLine; 
                this.ctx.beginPath(); this.ctx.arc(p.x, p.y, (hov ? 6 : 4) / zoom, 0, Math.PI*2); this.ctx.fill(); 
            }); 
        } 
        this.ctx.restore(); 
    }

    drawFiberObj(f: OpticElement, selected: boolean, colorLine: string, colorFill: string, elemIndex: number) {
        const edges = getFiberGeometry(f); if(edges.length < 2) return;
        this.ctx.save(); this.ctx.beginPath(); this.ctx.moveTo(edges[0].p1.x, edges[0].p1.y); 
        for(let i=0; i<edges.length; i++) this.ctx.lineTo(edges[i].p2.x, edges[i].p2.y); 
        this.ctx.fillStyle = colorFill; this.ctx.fill(); 
        this.applyGlassStyle(selected, colorLine); this.ctx.stroke(); 
        
        if (selected) {
            this.ctx.shadowBlur = 0; let angle = (f.rotation||0)*Math.PI/180; 
            let pts = f.pts!.map(p => vadd(vec(f.x, f.y), vrot(p, angle)));
            this.ctx.beginPath(); this.ctx.moveTo(pts[0].x, pts[0].y); 
            this.ctx.bezierCurveTo(pts[1].x, pts[1].y, pts[2].x, pts[2].y, pts[3].x, pts[3].y); 
            this.ctx.strokeStyle = 'rgba(255,255,255,0.2)'; this.ctx.stroke();
            this.ctx.beginPath(); this.ctx.moveTo(pts[0].x, pts[0].y); this.ctx.lineTo(pts[1].x, pts[1].y); 
            this.ctx.moveTo(pts[2].x, pts[2].y); this.ctx.lineTo(pts[3].x, pts[3].y); 
            const zoom = this.getState().camera.zoom;
            this.ctx.setLineDash([2 / zoom, 2 / zoom]); this.ctx.strokeStyle = 'rgba(255,255,255,0.4)'; this.ctx.stroke(); this.ctx.setLineDash([]);
            pts.forEach((p, i) => { 
                const hov = this.hoveredVertex && this.hoveredVertex.elemIdx === elemIndex && this.hoveredVertex.vIdx === i; 
                this.ctx.fillStyle = hov ? '#fff' : colorLine; 
                this.ctx.beginPath(); this.ctx.arc(p.x, p.y, (hov ? 6 : 4) / zoom, 0, Math.PI*2); this.ctx.fill(); 
            });
        } 
        this.ctx.restore();
    }

    drawRaindrop(d: OpticElement, s: boolean) { 
        this.ctx.save(); this.ctx.beginPath(); this.ctx.arc(d.x, d.y, d.radius || 100, 0, Math.PI*2); 
        this.ctx.fillStyle = 'rgba(2,132,199,0.05)'; this.ctx.fill(); 
        this.applyGlassStyle(s, '#0ea5e9'); this.ctx.stroke(); this.ctx.restore(); 
    }
    
    drawMirror(m: OpticElement, s: boolean) { 
        this.ctx.save(); this.ctx.translate(m.x, m.y); this.ctx.rotate(m.rotation*Math.PI/180); 
        this.ctx.fillStyle='rgba(148,163,184,0.3)'; 
        const len = m.length || 150;
        this.ctx.fillRect(-len/2, -3, len, 6); 
        this.ctx.beginPath(); this.ctx.moveTo(-len/2,0); this.ctx.lineTo(len/2,0); 
        this.applyGlassStyle(s, '#fff'); this.ctx.stroke(); this.ctx.restore(); 
    }

    screenToWorld(clientX: number, clientY: number): Vector2 {
        const state = this.getState();
        const rect = this.ctx.canvas.getBoundingClientRect();
        const x = clientX - rect.left;
        const y = clientY - rect.top;
        return {
            x: (x - state.camera.x) / state.camera.zoom,
            y: (y - state.camera.y) / state.camera.zoom
        };
    }

    getElementAt(x: number, y: number) { 
        const state = this.getState();
        for(let i=state.elements.length-1; i>=0; i--) { 
            const e = state.elements[i]; 
            if(e.type === 'polygon' || e.type === 'fiber' || e.type === 'prism' || e.type === 'lens') { 
                let inside = false; 
                let edges: {p1: Vector2, p2: Vector2}[] = [];
                if (e.type === 'polygon') edges = getPolygonGeometry(e);
                else if (e.type === 'prism') edges = getPrismGeometry(e);
                else if (e.type === 'fiber') edges = getFiberGeometry(e);
                else if (e.type === 'lens') edges = getLensUIGeometry(e);

                let polyPts = edges.map(ed => ed.p1);
                for(let j=0, k=polyPts.length-1; j<polyPts.length; k=j++) { 
                    const pj = polyPts[j], pk = polyPts[k]; 
                    if (((pj.y > y) !== (pk.y > y)) && (x < (pk.x - pj.x) * (y - pj.y) / (pk.y - pj.y) + pj.x)) inside = !inside; 
                } 
                if (inside) return i; 
            } else { 
                const d = Math.hypot(x-e.x, y-e.y); 
                let maxDist = 40; 
                if(e.type==='raindrop') maxDist=e.radius || 100; 
                if(e.type==='mirror') maxDist=(e.length || 150)/2; 
                if(d < maxDist) return i; 
            } 
        } 
        return null; 
    }

    checkVertexHover(x: number, y: number) { 
        this.hoveredVertex = null; 
        this.hoveredHandle = null;
        const state = this.getState();
        const hitRadius = 15 / state.camera.zoom;
        if (state.selectedElement !== null) { 
            const e = state.elements[state.selectedElement]; 
            if (e.type !== 'raindrop') {
                const handlePos = this.getHandlePos(e);
                if (Math.hypot(x - handlePos.x, y - handlePos.y) < hitRadius) {
                    this.hoveredHandle = 'rotation';
                    return true;
                }
            }
            const scaleHandlePos = this.getScaleHandlePos(e);
            if (Math.hypot(x - scaleHandlePos.x, y - scaleHandlePos.y) < hitRadius) {
                this.hoveredHandle = 'scale';
                return true;
            }
            if (e.type === 'polygon' || e.type === 'fiber') {
                const angle = (e.rotation||0)*Math.PI/180; 
                let pts = e.type === 'fiber' ? e.pts!.map(pt => vadd(vec(e.x, e.y), vrot(pt, angle))) : e.vertices!.map(pt => vadd(vec(e.x, e.y), vrot(pt, angle))); 
                for (let i = 0; i < pts.length; i++) { 
                    if (Math.hypot(x - pts[i].x, y - pts[i].y) < hitRadius) { 
                        this.hoveredVertex = { elemIdx: state.selectedElement, vIdx: i }; 
                        return true; 
                    } 
                } 
            } 
        } 
        return false; 
    }

    snap(val: number, gridSize: number, snapping: boolean) {
        return snapping ? Math.round(val / gridSize) * gridSize : val;
    }

    setupEvents(canvas: HTMLCanvasElement) {
        canvas.addEventListener('mousemove', (e) => { 
            const state = this.getState();
            let needsRender = false;
            const s = state.globals.gridSize;
            const snapOn = state.globals.snapping;
            const worldPos = this.screenToWorld(e.clientX, e.clientY);

            if (state.lightSource.dragging) { 
                state.lightSource.x = this.snap(worldPos.x, s, snapOn); 
                state.lightSource.y = this.snap(worldPos.y, s, snapOn); 
                needsRender = true; 
            }
            else if (this.draggingHandle === 'rotation' && state.selectedElement !== null) {
                const el = state.elements[state.selectedElement];
                const angle = Math.atan2(worldPos.y - el.y, worldPos.x - el.x);
                let newRot = (angle - this.initialAngle) * 180 / Math.PI + this.initialRotation;
                if (snapOn) newRot = Math.round(newRot / 15) * 15;
                el.rotation = (newRot + 360) % 360;
                needsRender = true;
            }
            else if (this.draggingHandle === 'scale' && state.selectedElement !== null) {
                const el = state.elements[state.selectedElement];
                const dist = Math.hypot(worldPos.x - el.x, worldPos.y - el.y);
                let scaleFactor = dist / this.initialDist;
                if (snapOn) scaleFactor = Math.round(scaleFactor * 10) / 10;
                
                if (el.type === 'raindrop') el.radius = Math.max(10, this.initialSize * scaleFactor);
                else if (el.type === 'lens') { el.height = Math.max(20, this.initialSize * scaleFactor); el.thickness = Math.max(10, this.initialSize2 * scaleFactor); }
                else if (el.type === 'prism') el.size = Math.max(20, this.initialSize * scaleFactor);
                else if (el.type === 'mirror') el.length = Math.max(20, this.initialSize * scaleFactor);
                else if (el.type === 'polygon' || el.type === 'fiber') {
                    const pts = el.type === 'fiber' ? el.pts! : el.vertices!;
                    for (let i = 0; i < pts.length; i++) {
                        pts[i] = { x: this.initialPts[i].x * scaleFactor, y: this.initialPts[i].y * scaleFactor };
                    }
                }
                needsRender = true;
            }
            else if (this.draggingVertex !== null) { 
                let el = state.elements[this.draggingVertex.elemIdx];
                let snappedX = this.snap(worldPos.x, s, snapOn);
                let snappedY = this.snap(worldPos.y, s, snapOn);
                let newPt = vrot(vec(snappedX - el.x, snappedY - el.y), -(el.rotation || 0) * Math.PI / 180);
                if(el.type === 'polygon') { el.vertices![this.draggingVertex.vIdx] = newPt; needsRender = true; }
                else if(el.type === 'fiber') { el.pts![this.draggingVertex.vIdx] = newPt; needsRender = true; }
            } 
            else if (this.draggingElement !== null) { 
                state.elements[this.draggingElement].x = this.snap(worldPos.x - this.dragOffset.x, s, snapOn); 
                state.elements[this.draggingElement].y = this.snap(worldPos.y - this.dragOffset.y, s, snapOn); 
                needsRender = true; 
            } 
            else if (this.draggingCamera) {
                state.camera.x = this.initialCameraPos.x + (e.clientX - this.cameraDragStart.x);
                state.camera.y = this.initialCameraPos.y + (e.clientY - this.cameraDragStart.y);
                needsRender = true;
            }
            else { 
                const oldHover = this.hoveredVertex; 
                const oldHandle = this.hoveredHandle;
                this.checkVertexHover(worldPos.x, worldPos.y); 
                if (oldHover?.elemIdx !== this.hoveredVertex?.elemIdx || oldHover?.vIdx !== this.hoveredVertex?.vIdx || oldHandle !== this.hoveredHandle) needsRender = true; 
            }
            canvas.style.cursor = this.draggingCamera ? 'grabbing' : this.hoveredHandle === 'rotation' ? 'grab' : this.hoveredHandle === 'scale' ? 'nwse-resize' : this.hoveredVertex ? 'crosshair' : (this.getElementAt(worldPos.x, worldPos.y) !== null || Math.hypot(worldPos.x-state.lightSource.x, worldPos.y-state.lightSource.y) < 40 / state.camera.zoom) ? 'move' : 'default';
            if (this.draggingHandle === 'rotation') canvas.style.cursor = 'grabbing';
            if (this.draggingHandle === 'scale') canvas.style.cursor = 'nwse-resize';
            if (needsRender) this.requestRender(); 
        });

        canvas.addEventListener('mousedown', (e) => { 
            const state = this.getState();
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            
            if (e.button === 1 || (e.button === 0 && e.shiftKey)) {
                this.draggingCamera = true;
                this.cameraDragStart = { x: e.clientX, y: e.clientY };
                this.initialCameraPos = { x: state.camera.x, y: state.camera.y };
                return;
            }

            if (Math.hypot(worldPos.x-state.lightSource.x, worldPos.y-state.lightSource.y) < 40 / state.camera.zoom) { 
                state.lightSource.dragging = true; playSound('click'); this.requestRender(); return; 
            }
            if (this.checkVertexHover(worldPos.x, worldPos.y)) { 
                if (this.hoveredHandle === 'rotation' && state.selectedElement !== null) {
                    this.draggingHandle = 'rotation';
                    const el = state.elements[state.selectedElement];
                    this.initialRotation = el.rotation || 0;
                    this.initialAngle = Math.atan2(worldPos.y - el.y, worldPos.x - el.x);
                } else if (this.hoveredHandle === 'scale' && state.selectedElement !== null) {
                    this.draggingHandle = 'scale';
                    const el = state.elements[state.selectedElement];
                    this.initialDist = Math.hypot(worldPos.x - el.x, worldPos.y - el.y);
                    if (el.type === 'raindrop') this.initialSize = el.radius || 100;
                    else if (el.type === 'lens') { this.initialSize = el.height || 180; this.initialSize2 = el.thickness || 50; }
                    else if (el.type === 'prism') this.initialSize = el.size || 140;
                    else if (el.type === 'mirror') this.initialSize = el.length || 150;
                    else if (el.type === 'polygon' || el.type === 'fiber') {
                        const pts = el.type === 'fiber' ? el.pts! : el.vertices!;
                        this.initialPts = pts.map(p => ({...p}));
                    }
                } else {
                    this.draggingVertex = this.hoveredVertex; 
                }
                playSound('click'); return; 
            }
            const idx = this.getElementAt(worldPos.x, worldPos.y); 
            if (idx !== null) { 
                state.selectedElement = idx; 
                this.draggingElement = idx; 
                this.dragOffset = { x: worldPos.x - state.elements[idx].x, y: worldPos.y - state.elements[idx].y }; 
                playSound('click'); 
                this.onStateChange(false);
            } else { 
                state.selectedElement = null; 
                this.draggingCamera = true;
                this.cameraDragStart = { x: e.clientX, y: e.clientY };
                this.initialCameraPos = { x: state.camera.x, y: state.camera.y };
                this.onStateChange(false);
            } 
            this.requestRender(); 
        });
        
        window.addEventListener('mouseup', () => { 
            const state = this.getState();
            if (state.lightSource.dragging || this.draggingElement !== null || this.draggingVertex !== null || this.draggingHandle !== null) {
                this.onStateChange(true);
            }
            state.lightSource.dragging = false; 
            this.draggingElement = null; 
            this.draggingVertex = null; 
            this.draggingHandle = null;
            this.draggingCamera = false;
        });
        
        canvas.addEventListener('wheel', (e) => { 
            const state = this.getState();
            const rect = canvas.getBoundingClientRect();
            const canvasX = e.clientX - rect.left;
            const canvasY = e.clientY - rect.top;
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const idx = this.getElementAt(worldPos.x, worldPos.y); 
            
            if (e.ctrlKey || e.metaKey || idx === null) {
                e.preventDefault();
                const zoomFactor = e.deltaY > 0 ? 0.9 : 1.1;
                const newZoom = Math.max(0.1, Math.min(state.camera.zoom * zoomFactor, 10));
                
                // Zoom towards mouse position
                state.camera.x = canvasX - ((canvasX - state.camera.x) / state.camera.zoom) * newZoom;
                state.camera.y = canvasY - ((canvasY - state.camera.y) / state.camera.zoom) * newZoom;
                state.camera.zoom = newZoom;
                
                this.requestRender();
            } else if(idx !== null && state.elements[idx].type !== 'raindrop') { 
                e.preventDefault(); 
                state.elements[idx].rotation = (state.elements[idx].rotation + (e.deltaY > 0 ? 5 : -5) + 360) % 360; 
                playSound('slide'); 
                this.onStateChange(true);
                this.requestRender(); 
            } 
        }, {passive:false});
        
        canvas.addEventListener('dblclick', (e) => {
            const state = this.getState();
            const worldPos = this.screenToWorld(e.clientX, e.clientY);
            const hitRadius = 15 / state.camera.zoom;
            const lineHitRadius = 10 / state.camera.zoom;
            if (state.selectedElement !== null && state.elements[state.selectedElement].type === 'polygon') {
                const poly = state.elements[state.selectedElement]; 
                const edges = getPolygonGeometry(poly);
                for (let i = 0; i < edges.length; i++) { 
                    if (Math.hypot(worldPos.x - edges[i].p1.x, worldPos.y - edges[i].p1.y) < hitRadius) { 
                        if (poly.vertices!.length > 3) { 
                            poly.vertices!.splice(i, 1); 
                            playSound('delete'); 
                            this.requestRender(); 
                            this.checkVertexHover(worldPos.x, worldPos.y); 
                        } 
                        return; 
                    } 
                }
                const mousePos = vec(worldPos.x, worldPos.y);
                for (let i = 0; i < edges.length; i++) { 
                    if (distToSegment(mousePos, edges[i].p1, edges[i].p2) < lineHitRadius) { 
                        poly.vertices!.splice(i + 1, 0, vrot(vec(worldPos.x - poly.x, worldPos.y - poly.y), -(poly.rotation || 0) * Math.PI / 180)); 
                        playSound('click'); 
                        this.requestRender(); 
                        return; 
                    } 
                }
            }
        });
    }
}
