  // -----------------------------
  // Мир: непрерывные координаты
  // -----------------------------
  const DEFAULT_WORLD_W = 100;
  const DEFAULT_WORLD_H = 150;
  const DEFAULT_CANVAS_WIDTH = canvas.width;
  const DEFAULT_CANVAS_HEIGHT = canvas.height;
  const WORLD_MAX = 360;
  const METERS_PER_WORLD_UNIT = 5;
  let worldW = parseFloat(gridColsInput.value);
  let worldH = parseFloat(gridRowsInput.value);

  const PX_PER_UNIT_BASE = 30;
  const MIN_ZOOM = 0.05;
  const MAX_ZOOM = 3.0;
  const WHEEL_ZOOM_SENSITIVITY = 0.0015;
  let zoom = 1.0;
  let PX = PX_PER_UNIT_BASE * zoom;

  let panX = 0, panY = 0;

  function fieldPixelW(){ return worldW * PX; }
  function fieldPixelH(){ return worldH * PX; }

  function fieldCenter() { return { cx: canvas.width/2 + panX, cy: canvas.height/2 + panY }; }
  function fieldTopLeft() {
    const {cx,cy} = fieldCenter();
    return { x: cx - fieldPixelW()/2, y: cy - fieldPixelH()/2 };
  }

  function clampCameraPan(){
    const extraW = Math.max(0, fieldPixelW() - canvas.width);
    const extraH = Math.max(0, fieldPixelH() - canvas.height);
    panX = clamp(panX, -extraW/2, extraW/2);
    panY = clamp(panY, -extraH/2, extraH/2);
  }

  function clientToCanvas(clientX, clientY){
    const rect = canvas.getBoundingClientRect();
    return {
      x: (clientX - rect.left) * (canvas.width / rect.width),
      y: (clientY - rect.top)  * (canvas.height / rect.height)
    };
  }

  function fitZoomForWorld(){
    const zoomX = (canvas.width - 48) / Math.max(1, worldW * PX_PER_UNIT_BASE);
    const zoomY = (canvas.height - 48) / Math.max(1, worldH * PX_PER_UNIT_BASE);
    return clamp(Math.min(1, zoomX, zoomY), MIN_ZOOM, MAX_ZOOM);
  }

  function resetCamera({ keepZoom=false } = {}){
    if (!keepZoom){
      zoom = fitZoomForWorld();
    }
    PX = PX_PER_UNIT_BASE * zoom;
    panX = 0;
    panY = 0;
    clampCameraPan();
  }

  function setZoom(nextZoom, anchorClientX=null, anchorClientY=null){
    const targetZoom = clamp(nextZoom, MIN_ZOOM, MAX_ZOOM);
    const anchorCanvas = (Number.isFinite(anchorClientX) && Number.isFinite(anchorClientY))
      ? clientToCanvas(anchorClientX, anchorClientY)
      : { x: canvas.width/2, y: canvas.height/2 };
    const anchorWorld = (Number.isFinite(anchorClientX) && Number.isFinite(anchorClientY))
      ? (screenToWorld(anchorClientX, anchorClientY) || { x: worldW/2, y: worldH/2 })
      : { x: worldW/2, y: worldH/2 };

    zoom = targetZoom;
    PX = PX_PER_UNIT_BASE * zoom;
    panX = anchorCanvas.x - canvas.width/2 + fieldPixelW()/2 - anchorWorld.x * PX;
    panY = anchorCanvas.y - canvas.height/2 + fieldPixelH()/2 - (worldH - anchorWorld.y) * PX;
    clampCameraPan();
  }

  function panCameraBy(deltaX, deltaY){
    panX += deltaX;
    panY += deltaY;
    clampCameraPan();
  }

  function worldToScreen(p){
    const tl = fieldTopLeft();
    return { x: tl.x + p.x * PX, y: tl.y + (worldH - p.y) * PX };
  }

  function screenToWorld(clientX, clientY){
    const { x:sx, y:sy } = clientToCanvas(clientX, clientY);

    const tl = fieldTopLeft();
    const lx = sx - tl.x;
    const ly = sy - tl.y;

    if (lx < 0 || ly < 0 || lx > fieldPixelW() || ly > fieldPixelH()) return null;

    const wx = lx / PX;
    const wy = worldH - (ly / PX);
    return { x: wx, y: wy };
  }

  function canvasPixelToWorld(px, py){
    const tl = fieldTopLeft();
    return {
      x: clamp((px - tl.x) / PX, 0, worldW),
      y: clamp(worldH - ((py - tl.y) / PX), 0, worldH)
    };
  }

  function setCameraCenterWorld(centerWorld){
    if (!centerWorld) return;
    panX = fieldPixelW() / 2 - centerWorld.x * PX;
    panY = fieldPixelH() / 2 - (worldH - centerWorld.y) * PX;
    clampCameraPan();
  }

  function desiredBoardCanvasCssSize(){
    if (!boardViewportEl){
      return { width: DEFAULT_CANVAS_WIDTH, height: DEFAULT_CANVAS_HEIGHT };
    }

    const styles = window.getComputedStyle(boardViewportEl);
    const padX = (parseFloat(styles.paddingLeft) || 0) + (parseFloat(styles.paddingRight) || 0);
    const padY = (parseFloat(styles.paddingTop) || 0) + (parseFloat(styles.paddingBottom) || 0);
    const availableWidth = Math.max(360, boardViewportEl.clientWidth - padX);

    if (isFullscreenActive()){
      return {
        width: availableWidth,
        height: Math.max(260, boardViewportEl.clientHeight - padY)
      };
    }

    const width = Math.min(1080, availableWidth);
    return {
      width,
      height: Math.round(width * (DEFAULT_CANVAS_HEIGHT / DEFAULT_CANVAS_WIDTH))
    };
  }

  function resizeBoardCanvas({ preserveView=true, resetView=false } = {}){
    const prevCenter = preserveView ? canvasPixelToWorld(canvas.width / 2, canvas.height / 2) : null;
    const cssSize = desiredBoardCanvasCssSize();
    const dpr = window.devicePixelRatio || 1;
    const nextWidth = Math.max(1, Math.round(cssSize.width * dpr));
    const nextHeight = Math.max(1, Math.round(cssSize.height * dpr));

    canvas.style.width = `${Math.round(cssSize.width)}px`;
    canvas.style.height = `${Math.round(cssSize.height)}px`;

    const changed = canvas.width !== nextWidth || canvas.height !== nextHeight;
    if (changed){
      canvas.width = nextWidth;
      canvas.height = nextHeight;
    }

    if (resetView){
      resetCamera();
    } else if (changed && prevCenter){
      setCameraCenterWorld(prevCenter);
    } else {
      clampCameraPan();
    }

    if (changed || resetView){
      render();
    }
  }

  function clamp(v,a,b){ return Math.max(a, Math.min(b, v)); }
  function mix(a,b,t){ return a + (b - a) * t; }
  function stableNoise01(seed){
    const raw = Math.sin(seed * 12.9898 + 78.233) * 43758.5453123;
    return raw - Math.floor(raw);
  }
  function dist(a,b){ return Math.hypot(a.x-b.x, a.y-b.y); }
  function norm(v){
    const L = Math.hypot(v.x,v.y) || 1;
    return { x: v.x/L, y: v.y/L, L };
  }
  function rotateVec(v, ang){
    const c = Math.cos(ang);
    const s = Math.sin(ang);
    return { x: v.x * c - v.y * s, y: v.x * s + v.y * c };
  }
  function hexToRgb(color){
    if (typeof color !== "string") return null;
    const match = color.trim().match(/^#([0-9a-f]{3}|[0-9a-f]{6})$/i);
    if (!match) return null;

    let hex = match[1];
    if (hex.length === 3){
      hex = hex.split("").map((ch) => ch + ch).join("");
    }

    const value = parseInt(hex, 16);
    return {
      r: (value >> 16) & 255,
      g: (value >> 8) & 255,
      b: value & 255
    };
  }
  function mixHexColor(color, target, amount){
    const rgb = hexToRgb(color);
    if (!rgb) return color;

    const mix = clamp(amount, 0, 1);
    const base = target === "white" ? 255 : 0;
    const r = Math.round(rgb.r + (base - rgb.r) * mix);
    const g = Math.round(rgb.g + (base - rgb.g) * mix);
    const b = Math.round(rgb.b + (base - rgb.b) * mix);
    return `rgb(${r}, ${g}, ${b})`;
  }
  function rgbaHex(color, alpha){
    const rgb = hexToRgb(color);
    if (!rgb) return `rgba(30, 136, 229, ${alpha})`;
    return `rgba(${rgb.r}, ${rgb.g}, ${rgb.b}, ${alpha})`;
  }
