  // -----------------------------
  // Геометрия / пересечения
  // -----------------------------
  function pointToSegment(p, a, b){
    const abx = b.x-a.x, aby = b.y-a.y;
    const apx = p.x-a.x, apy = p.y-a.y;
    const ab2 = abx*abx + aby*aby;
    if (ab2 === 0){
      return { d: dist(p,a), proj:{x:a.x,y:a.y}, t:0 };
    }
    const t = clamp((apx*abx + apy*aby)/ab2, 0, 1);
    const proj = { x: a.x + t*abx, y: a.y + t*aby };
    return { d: dist(p,proj), proj, t };
  }

  function orient(a,b,c){ return (b.x-a.x)*(c.y-a.y) - (b.y-a.y)*(c.x-a.x); }
  function onSeg(a,b,c){
    return Math.min(a.x,b.x)-1e-9 <= c.x && c.x <= Math.max(a.x,b.x)+1e-9 &&
           Math.min(a.y,b.y)-1e-9 <= c.y && c.y <= Math.max(a.y,b.y)+1e-9;
  }
  function segmentsIntersect(p1,p2,q1,q2){
    const o1 = orient(p1,p2,q1);
    const o2 = orient(p1,p2,q2);
    const o3 = orient(q1,q2,p1);
    const o4 = orient(q1,q2,p2);

    if ((o1>0 && o2<0 || o1<0 && o2>0) &&
        (o3>0 && o4<0 || o3<0 && o4>0)) return true;

    if (Math.abs(o1) < 1e-9 && onSeg(p1,p2,q1)) return true;
    if (Math.abs(o2) < 1e-9 && onSeg(p1,p2,q2)) return true;
    if (Math.abs(o3) < 1e-9 && onSeg(q1,q2,p1)) return true;
    if (Math.abs(o4) < 1e-9 && onSeg(q1,q2,p2)) return true;
    return false;
  }

  function segDistToPoint(a,b,p){
    return pointToSegment(p,a,b).d;
  }

  function dot(a,b){
    return a.x*b.x + a.y*b.y;
  }

  function boatAxisUnit(heading, hasHeading){
    if (hasHeading && Number.isFinite(heading)){
      return { x: Math.cos(heading), y: Math.sin(heading) };
    }
    return { x: 0, y: 1 };
  }

  function boatCapsuleAt(pos, heading, hasHeading){
    const axis = boatAxisUnit(heading, hasHeading);
    return {
      a: {
        x: pos.x - axis.x * BOAT_CAPSULE_HALF_SEGMENT,
        y: pos.y - axis.y * BOAT_CAPSULE_HALF_SEGMENT
      },
      b: {
        x: pos.x + axis.x * BOAT_CAPSULE_HALF_SEGMENT,
        y: pos.y + axis.y * BOAT_CAPSULE_HALF_SEGMENT
      },
      r: BOAT_COLLISION_RADIUS
    };
  }

  function boatCapsuleForIndex(boatIdx, posOverride=null, headingOverride=null, hasHeadingOverride=null){
    const boat = boats[boatIdx];
    const pos = posOverride || { x: boat?.x || 0, y: boat?.y || 0 };
    const heading = Number.isFinite(headingOverride) ? headingOverride : (Number.isFinite(boat?.heading) ? boat.heading : 0);
    const hasHeading = (typeof hasHeadingOverride === "boolean") ? hasHeadingOverride : !!boat?.hasHeading;
    return boatCapsuleAt(pos, heading, hasHeading);
  }

  function capsuleDistanceToPoint(capsule, point){
    return pointToSegment(point, capsule.a, capsule.b).d - capsule.r;
  }

  function segmentSegmentDistance(a0, a1, b0, b1){
    const EPS = 1e-9;
    const u = { x: a1.x - a0.x, y: a1.y - a0.y };
    const v = { x: b1.x - b0.x, y: b1.y - b0.y };
    const w = { x: a0.x - b0.x, y: a0.y - b0.y };

    const a = dot(u, u);
    const b = dot(u, v);
    const c = dot(v, v);
    const d = dot(u, w);
    const e = dot(v, w);
    const D = a * c - b * b;

    let sN, sD = D;
    let tN, tD = D;

    if (D < EPS){
      sN = 0;
      sD = 1;
      tN = e;
      tD = c;
    } else {
      sN = b * e - c * d;
      tN = a * e - b * d;
      if (sN < 0){
        sN = 0;
        tN = e;
        tD = c;
      } else if (sN > sD){
        sN = sD;
        tN = e + b;
        tD = c;
      }
    }

    if (tN < 0){
      tN = 0;
      if (-d < 0){
        sN = 0;
      } else if (-d > a){
        sN = sD;
      } else {
        sN = -d;
        sD = a;
      }
    } else if (tN > tD){
      tN = tD;
      if ((-d + b) < 0){
        sN = 0;
      } else if ((-d + b) > a){
        sN = sD;
      } else {
        sN = -d + b;
        sD = a;
      }
    }

    const sc = Math.abs(sN) < EPS ? 0 : sN / sD;
    const tc = Math.abs(tN) < EPS ? 0 : tN / tD;
    const dx = w.x + sc * u.x - tc * v.x;
    const dy = w.y + sc * u.y - tc * v.y;
    return Math.hypot(dx, dy);
  }

  function capsulesOverlap(left, right, extra=0){
    return segmentSegmentDistance(left.a, left.b, right.a, right.b) < (left.r + right.r + extra - 1e-9);
  }

  function capsuleIntersectsMark(capsule, markPos, extra=0){
    return pointToSegment(markPos, capsule.a, capsule.b).d < (capsule.r + MARK_RADIUS + extra - 1e-9);
  }

