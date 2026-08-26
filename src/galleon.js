/**
 * Galleon — a 3-D hull defined as stations and re-projected to isometric on
 * every frame, so changing the bearing re-draws the ship instead of rotating a
 * bitmap. Extracted from the Galleon Sprite Forge; the forge's UI, sprite-sheet
 * export and draw-order audit are dropped, leaving the model and the renderer.
 *
 * drawGalleon(ctx, W, H, deg) draws one frame centred in a W x H box. Bearing 0
 * points the bow to the lower right and frames run clockwise on screen. The
 * pivot is the ship's centre at the waterline, which projects to the centre of
 * the box at every bearing, so the ship never wanders as it turns.
 */

const ISO_X=0.866, ISO_Y=0.5, VIEW=[1,1,1];
const LIGHT=(()=>{const v=[-0.42,0.46,0.78],l=Math.hypot(...v);return v.map(c=>c/l)})();

const PALETTES=[
 {name:"Oak",low:"#3b2a1c",mid:"#6d4a2c",strake:"#c39443",top:"#52351f",cap:"#7a5533",
  deck:"#b48f5c",deck2:"#a8834f",wood:"#6b4a2d",dark:"#4a3320",sail:"#efe7d3",back:"#d3c8ae",flag:"#c8452f",glass:"#a9cbdd",pane:"#a8865a",port:"#b1844d"},
 {name:"Ebony",low:"#20222a",mid:"#33363f",strake:"#8e8f96",top:"#2a2c34",cap:"#45474f",
  deck:"#8d8577",deck2:"#7e7669",wood:"#3c3e46",dark:"#26282f",sail:"#d8d6cf",back:"#b7b5ad",flag:"#9fd6c6",glass:"#b3c8d6",pane:"#8f8471",port:"#8e9198"},
 {name:"Crimson",low:"#3a1c1c",mid:"#6e2f2b",strake:"#d5a03c",top:"#4a201f",cap:"#7c3b32",
  deck:"#b98f57",deck2:"#a9814c",wood:"#5c3626",dark:"#3d2419",sail:"#f2ecdc",back:"#d6ccb5",flag:"#f0d17a",glass:"#a9cbdd",pane:"#b08f60",port:"#c08a4a"}
];
const PAL=PALETTES[0];   // Oak

const ST=[
 [-60, 9.6,23.2, 4.4],[-52,12.6,20.6, 9.4],[-40,15.3,17.0,14.1],
 [-26,17.6,14.2,18.3],[-12,18.9,12.7,20.5],[  2,18.7,12.3,20.2],
 [ 16,17.4,12.7,18.6],[ 30,14.6,14.1,15.3],[ 42,10.8,16.2,10.6],
 [ 52, 6.2,18.6, 5.4],[ 56, 4.4,19.9, 3.8],[ 60, 1.7,21.2, 1.2]
];
const BULWARK=2.7, lerp=(a,b,t)=>a+(b-a)*t;
/* The height of whatever a mast is stepped on at x: the quarterdeck aft, the
   forecastle forward, and the open waist between them. Module level rather than
   inside buildShip because the rig needs it too, to sheet a headsail home. */
const deckZAt=x=>(x>=-58&&x<=-18)?23.6:(x>=24&&x<=50)?20.2:stationAt(x).sheer;
const station=i=>({x:ST[i][0],w:ST[i][1],sheer:ST[i][2],wl:ST[i][3]});
function stationAt(x){
 x=Math.max(ST[0][0],Math.min(60,x));
 for(let i=0;i<ST.length-1;i++)if(x>=ST[i][0]&&x<=ST[i+1][0]){
  const t=(x-ST[i][0])/(ST[i+1][0]-ST[i][0]);
  return{x,w:lerp(ST[i][1],ST[i+1][1],t),sheer:lerp(ST[i][2],ST[i+1][2],t),
   wl:lerp(ST[i][3],ST[i+1][3],t)};}
 return station(0);
}
const BOW_X0=42, BOW_X1=60, BOW_RAKE=8.5;
function bowShift(x,f){
 if(x<=BOW_X0) return 0;
 const t=(x-BOW_X0)/(BOW_X1-BOW_X0);
 return -BOW_RAKE*t*t*Math.pow(1-Math.max(0,Math.min(1,f)),1.7);
}
function hullPtF(s,side,f){
 const z=s.sheer*f, w=lerp(s.wl,s.w,f*f*(3-2*f))+0.45*Math.sin(Math.PI*f);
 return[s.x+bowShift(s.x,f),side*w,z];
}
function hullWAtZ(s,z){
 const f=Math.max(0,Math.min(1,z/s.sheer));
 return lerp(s.wl,s.w,f*f*(3-2*f))+0.45*Math.sin(Math.PI*f);
}
function hullPt(s,side,u){
 const rail=s.sheer+BULWARK, uS=s.sheer/rail;
 if(u<=uS) return hullPtF(s,side,u/uS);
 return[s.x,side*s.w,lerp(s.sheer,rail,(u-uS)/(1-uS))];
}
function newell(p){let x=0,y=0,z=0;for(let i=0;i<p.length;i++){const a=p[i],b=p[(i+1)%p.length];
 x+=(a[1]-b[1])*(a[2]+b[2]);y+=(a[2]-b[2])*(a[0]+b[0]);z+=(a[0]-b[0])*(a[1]+b[1]);}
 const l=Math.hypot(x,y,z);return l<1e-9?null:[x/l,y/l,z/l];}
function addFace(F,pts,color,hint,opts){let n=newell(pts);if(!n)return;
 if(hint&&n[0]*hint[0]+n[1]*hint[1]+n[2]*hint[2]<0){pts=pts.slice().reverse();n=n.map(v=>-v);}
 F.push(Object.assign({pts,n,color},opts||{}));}
function addPrism(F,a,b,r0,r1,color,tag,sides,bias){
 const n=sides||4;
 let d=[b[0]-a[0],b[1]-a[1],b[2]-a[2]];const L=Math.hypot(...d);if(L<1e-6)return;d=d.map(c=>c/L);
 const cross=(p,q)=>[p[1]*q[2]-p[2]*q[1],p[2]*q[0]-p[0]*q[2],p[0]*q[1]-p[1]*q[0]];
 const ref=Math.abs(d[2])>0.9?[1,0,0]:[0,0,1];let u=cross(d,ref);const lu=Math.hypot(...u);u=u.map(c=>c/lu);
 const v=cross(d,u);
 const off=n===4?Math.PI/4:0, rad=n===4?Math.SQRT2:1;
 const ring=(c,r)=>{const o=[];
  for(let i=0;i<n;i++){const t=off+i*2*Math.PI/n,cs=Math.cos(t)*r*rad,sn=Math.sin(t)*r*rad;
   o.push([c[0]+u[0]*cs+v[0]*sn,c[1]+u[1]*cs+v[1]*sn,c[2]+u[2]*cs+v[2]*sn]);}
  return o;};
 const A=ring(a,r0),B=ring(b,r1),m=[(a[0]+b[0])/2,(a[1]+b[1])/2,(a[2]+b[2])/2];
 for(let i=0;i<n;i++){const j=(i+1)%n,q=[A[i],A[j],B[j],B[i]],
  c=[(q[0][0]+q[2][0])/2,(q[0][1]+q[2][1])/2,(q[0][2]+q[2][2])/2];
  addFace(F,q,color,[c[0]-m[0],c[1]-m[1],c[2]-m[2]],{tag,bias});}
 addFace(F,B,color,d,{tag,bias});addFace(F,A,color,d.map(c=>-c),{tag,bias});
}
/* Long spars and ropes sort by average depth, so a single long segment can win
   the sort against a sail cell that is genuinely in front of it — that is what
   made the masts punch through the canvas. Segments are therefore short and
   sized from the spar's own length (SEG_LEN model units each), never by hand. */
const SEG_LEN=2.2;   // spar segment length, model units
function addSpar(F,a,b,r0,r1,color,tag,segs,sides,bias){
 const L=Math.hypot(b[0]-a[0],b[1]-a[1],b[2]-a[2]);
 segs=Math.max(segs||1,Math.ceil(L/SEG_LEN));
 for(let i=0;i<segs;i++){
  const t0=i/segs,t1=(i+1)/segs,
   p=[lerp(a[0],b[0],t0),lerp(a[1],b[1],t0),lerp(a[2],b[2],t0)],
   q=[lerp(a[0],b[0],t1),lerp(a[1],b[1],t1),lerp(a[2],b[2],t1)];
  addPrism(F,p,q,lerp(r0,r1,t0),lerp(r0,r1,t1),color,tag,sides,bias);
 }
}

// ±% on a hex, for plank courses and contact shading
function tint(hex,k){const n=parseInt(hex.slice(1),16),f=c=>Math.max(0,Math.min(255,Math.round(c*k)));
 return"#"+[f(n>>16&255),f(n>>8&255),f(n&255)].map(v=>v.toString(16).padStart(2,"0")).join("");}
function addBox(F,x0,x1,y0,y1,z0,z1,color,tag,bias,top){
 const t=top||color;
 addFace(F,[[x0,y0,z1],[x1,y0,z1],[x1,y1,z1],[x0,y1,z1]],t,[0,0,1],{tag,bias});
 addFace(F,[[x0,y0,z0],[x1,y0,z0],[x1,y0,z1],[x0,y0,z1]],color,[0,-1,0],{tag,bias});
 addFace(F,[[x0,y1,z0],[x1,y1,z0],[x1,y1,z1],[x0,y1,z1]],color,[0,1,0],{tag,bias});
 addFace(F,[[x0,y0,z0],[x0,y1,z0],[x0,y1,z1],[x0,y0,z1]],color,[-1,0,0],{tag,bias});
 addFace(F,[[x1,y0,z0],[x1,y1,z0],[x1,y1,z1],[x1,y0,z1]],color,[1,0,0],{tag,bias});
}
const OPT={sails:true,rig:true};

/* ---- the rig, as data -------------------------------------------------------
   Everything above the deck used to be a list of literals: three masts at fixed
   heights, five calls to sail() with hand-tuned corners, three stays written out
   end to end. That is fine for one ship and useless for a shipyard, where the
   ship on the menu is whatever the captain has actually rigged.

   So the rig is described instead of drawn. A station (where a mast stands along
   the keel) owns the geometry that belongs to the *place*: the x it stands at,
   how thick the pole is, where the shrouds are made fast, and the bands of air a
   sail occupies as you go up it. A mast owns only its height. Put the two
   together and you get a rig, and buildShip turns that into faces.

   The numbers here are the galleon's own, so passing her rig back in reproduces
   the ship this file has always drawn. Fewer sails, a shorter mast or an empty
   station simply leave parts of it out. Hull shapes per class are still to come;
   for now every rig stands on this one hull. */

// `slots` are square-sail bands, deck upward, written at the height `ref` names
// and scaled with the mast that actually stands there. `tri` is the same for
// fore-and-aft canvas, as fractions of the masthead, because a triangular sail
// is one tall band rather than a stack of short ones.
const STATION_GEOM = {
  fore: {
    x: 36, pole: 88.64, ref: 78, r0: 1.05, r1: 0.58, hoist: 0.8114,
    shrouds: [-8, -2.5], ratlines: true, stay: { from: 0.963, to: 1.0 },
    slots: [
      { span: 15.5, zt: 49.8, zb: 33.9, bulge: 5.2, seg: 10 },
      { span: 10.5, zt: 67.6, zb: 53.4, bulge: 4.0, seg: 9 },
      { span: 7.6, zt: 76.2, zb: 69.4, bulge: 3.0, seg: 8 },
    ],
    tri: [{ zb: 0.24, zt: 0.90 }, { zb: 0.64, zt: 0.96 }, { zb: 0.82, zt: 1.0 }],
  },
  main: {
    x: 0, pole: 90, ref: 90, r0: 1.2, r1: 0.64, hoist: 0.7964,
    shrouds: [-8, -2.5], ratlines: true, stay: { from: 0.9722, to: 1.0 },
    slots: [
      { span: 18.5, zt: 48.2, zb: 30.1, bulge: 6.2, seg: 11 },
      { span: 13.0, zt: 68.5, zb: 52.7, bulge: 4.6, seg: 10 },
      { span: 8.5, zt: 81.0, zb: 71.9, bulge: 3.4, seg: 8 },
    ],
    tri: [{ zb: 0.20, zt: 0.90 }, { zb: 0.62, zt: 0.96 }, { zb: 0.80, zt: 1.0 }],
  },
  mizzen: {
    // one shroud a side and no ratlines: set level with the mast the second rope
    // projected straight down the pole, and the rungs would have run over the
    // quarterdeck rail
    x: -32, pole: 87.84, ref: 65, r0: 0.95, r1: 0.52, hoist: 1.0,
    shrouds: [-3.5], ratlines: false, stay: { from: 0.9262, to: 0.9156 },
    slots: [
      { span: 13.4, zt: 41.5, zb: 28.4, bulge: 4.5, seg: 10 },
      { span: 9.4, zt: 55.6, zb: 47.2, bulge: 3.3, seg: 9 },
      { span: 6.1, zt: 62.2, zb: 57.0, bulge: 2.4, seg: 8 },
    ],
    tri: [{ zb: 0.4538, zt: 0.9 }, { zb: 0.72, zt: 0.97 }, { zb: 0.84, zt: 1.0 }],
  },
  /* The fourth mast of a carrack or a great galleon, stepped on the poop abaft
     the mizzen. Shorter than the mizzen and rigged like it: one shroud a side,
     no ratlines, and a stay running forward to the mast ahead. Her bands are
     written for a full-height mast, so `ref` is her whole pole and a shorter
     mast carries its canvas proportionally lower. */
  /* Set well inside the taffrail and given a short band for her lateen. A
     lateen is cut from the height of the band it stands in, so the mizzen's own
     proportions on a mast this far aft put the clew out over the stern and into
     the water astern of her. */
  bonaventure: {
    x: -44, pole: 70, ref: 70, r0: 0.82, r1: 0.44, hoist: 1.0,
    shrouds: [-3.0], ratlines: false, stay: { from: 0.92, to: 0.86 },
    slots: [
      { span: 10.5, zt: 42.0, zb: 28.0, bulge: 3.6, seg: 9 },
      { span: 7.4, zt: 56.0, zb: 46.5, bulge: 2.7, seg: 8 },
      { span: 5.0, zt: 63.5, zb: 57.5, bulge: 2.0, seg: 8 },
    ],
    tri: [{ zb: 0.55, zt: 0.86 }, { zb: 0.74, zt: 0.94 }, { zb: 0.86, zt: 1.0 }],
  },
  /* THE BOWSPRIT, which is a station like the others to the shipyard and unlike
     any of them here: it is a spar sticking out over the bow, not a pole
     standing on a deck, so nothing about a mast applies to it. No pole is drawn
     (the hull's own bowsprit is), no shrouds are set up, it takes no place in
     the chain of stays, and the pennant never flies from it.

     What it carries is two different sails and they hang two different ways.
     Triangular canvas is a HEADSAIL: tacked down to the spar, hoisted up the
     stay to the head of the foremost mast, and sheeted home aft, which is three
     corners in three different places rather than a band up a pole. Square
     canvas is a SPRITSAIL, which is slung under the spar on a yard athwart it,
     the way a carrack and a galleon carried theirs.

     `tack` and `head` are the ranges those two corners run over, inner sail to
     outer: a staysail near the stem is tacked close in and hoisted partway up
     the mast, and the flying jib outside it is tacked at the boom end and goes
     high. `foot` is how far in towards the mast the sheet comes, as a share of
     the run from that sail's own tack, so each sail is cut to its own luff.
     `slung` is where a spritsail hangs and how big it is. */
  bowsprit: {
    spar: true, x: 66,
    tack: [0.34, 0.98], head: [0.40, 0.76], foot: 0.5,
    slung: [0.42, 0.82], span: [9.0, 6.2], drop: [11.0, 7.6],
  },
};

const BOWSPRIT = { heel: [50, 0, 22.6], tip: [88, 0, 33.5], r0: 1.3, r1: 0.66 };
/* A point along the bowsprit, 0 at the heel and 1 at the boom end. */
const sparAt = (f) => BOWSPRIT.heel.map((c, i) => lerp(c, BOWSPRIT.tip[i], f));

/* The sail categories drawn as a triangle. Everything else takes the square, and
   RIG_KINDS at the foot of this file is what says which categories are settling
   for it. */
const TRIANGULAR = new Set(["TRI", "LAT"]);

/* ---- how many sails, and where they sit ------------------------------------
   Each station above is authored with three bands, which was every stack the
   catalogue could build. A four or five sail mast is a real rig -- course,
   topsail, topgallant, royal, skysail -- and the old code clamped anything past
   the third onto the third, so the fourth and fifth drew exactly on top of it:
   bought, paid for and invisible.

   Adding a fourth row to STATION_GEOM does not fix that, because three sails
   already reach the masthead. There is no room above; a taller stack has to be
   COMPRESSED into the same air. So a stack larger than the authored one is
   generated: the authored bands become a profile (how a sail's span, belly and
   height change as you go up) and the envelope they occupy, and any number of
   bands is that profile resampled and squeezed to fit the envelope.

   A stack of three or fewer is left exactly as authored. That is what keeps the
   galleon the ship this file has always drawn, and it is also right on its own
   terms: a mast carrying one sail wants that sail on the course band, not one
   sail stretched over the whole pole. */
const MAX_BERTHS = 5;

/* Read a value off an authored list at `t`, 0 at the lowest band and 1 at the
   highest, interpolating between the two it falls between. */
function sample(list, t, read) {
  const last = list.length - 1;
  if (last <= 0) return read(list[0]);
  const p = Math.min(last, Math.max(0, t)) * last;
  const i = Math.min(last - 1, Math.floor(p));
  const f = p - i;
  return read(list[i]) * (1 - f) + read(list[i + 1]) * f;
}

/* The square-canvas bands for a stack of `n` sails at this station. */
function squareBands(g, n) {
  const slots = g.slots;
  if (n <= slots.length) return slots;

  const heights = slots.map((s) => ({ v: s.zt - s.zb }));
  const gaps = slots.slice(1).map((s, i) => ({ v: s.zb - slots[i].zt }));
  const val = (list, t) => sample(list, t, (x) => x.v);

  // the profile, resampled to n bands
  const bands = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    bands.push({
      span: sample(slots, t, (s) => s.span),
      bulge: sample(slots, t, (s) => s.bulge),
      seg: Math.max(6, Math.round(sample(slots, t, (s) => s.seg))),
      h: val(heights, t),
    });
  }
  const gapOf = (j) => val(gaps, n > 2 ? j / (n - 2) : 0);

  // then squeezed into the air the authored stack occupied, so five sails reach
  // the same masthead three did rather than standing two bands into the sky
  const bottom = slots[0].zb;
  const envelope = slots[slots.length - 1].zt - bottom;
  let want = bands.reduce((a, b) => a + b.h, 0);
  for (let j = 0; j < n - 1; j++) want += gapOf(j);
  const squeeze = envelope / want;

  let z = bottom;
  return bands.map((b, i) => {
    const zb = z;
    const zt = zb + b.h * squeeze;
    z = zt + (i < n - 1 ? gapOf(i) * squeeze : 0);
    return { span: b.span, bulge: b.bulge, seg: b.seg, zt, zb };
  });
}

/* The same for fore-and-aft canvas, which is one tall band rather than a stack
   of short ones, so only the foot and the head of it are interpolated. */
function triBands(g, n) {
  if (n <= g.tri.length) return g.tri;
  const bands = [];
  for (let i = 0; i < n; i++) {
    const t = i / (n - 1);
    bands.push({ zb: sample(g.tri, t, (b) => b.zb), zt: sample(g.tri, t, (b) => b.zt) });
  }
  return bands;
}

/**
 * Where the sails on the bowsprit hang, given the masts already worked out.
 *
 * A headsail needs a mast to go to: it is hoisted up the stay to the head of the
 * foremost one, so a ship with nothing stepped has nowhere to set one and simply
 * does not. A spritsail needs no such thing, being slung under the spar, and is
 * drawn whether she has a mast or not.
 */
function sparSails(g, list, foremost) {
  const at = (range, i, n) => lerp(range[0], range[1], n > 1 ? i / (n - 1) : 0);
  const n = list.length;
  const out = [];
  list.forEach((s, i) => {
    if (TRIANGULAR.has(s.kind)) {
      if (!foremost) return;
      const tack = sparAt(at(g.tack, i, n));
      /* The clew is taken off this sail's own tack rather than from a fixed
         point aft. Written as a place on the deck it made the outer jib a sheet:
         its tack is out at the boom end and its head at the masthead, so a clew
         level with the mast gave it a foot the length of the ship and the three
         of them together closed into one grey wall over the bow. Half way in to
         the mast, each sail is a triangle the size of its own luff, and they
         stand apart because their tacks do. */
      const cx = lerp(tack[0], foremost.x, g.foot);
      out.push({
        cut: "headsail",
        tack,
        head: [foremost.x, 0, foremost.top * at(g.head, i, n)],
        clew: [cx, 0, deckZAt(cx) + BULWARK + 1.6],
      });
      return;
    }
    // square canvas under a bowsprit is a spritsail: a yard athwart the spar
    // with the cloth hanging below it
    const p = sparAt(at(g.slung, i, n));
    const span = at(g.span, i, n), drop = at(g.drop, i, n);
    out.push({ cut: "square", mx: p[0], span, zt: p[2] - 1.2, zb: p[2] - 1.2 - drop, bulge: span * 0.34, seg: 9 });
  });
  return out;
}

/**
 * Turn a shipyard rig spec into the geometry buildShip wants.
 *
 * `spec` is `{ bowsprit, masts: [{ station, height, sails: [{ kind }] }] }`,
 * which is what `shipyard.js` hands over: what is rigged, not where it goes.
 * Masts come out ordered bow to stern so the stays can be chained down the line.
 *
 * A sail's `kind` is its shipyard category and this file knows two shapes to draw
 * it in, a square one and a triangle. LSQ and SSQ are square canvas and get the
 * square; TRI and LAT get the triangle. A gaff sail and a lugsail are neither,
 * and until this file is taught their shapes they draw as square canvas, which
 * is closer than a triangle and is what the bench reports rather than hides.
 *
 * A spar station comes back separately from the masts, because nothing done to a
 * mast applies to it: see the bowsprit in STATION_GEOM.
 */
function rigFromSpec(spec) {
  const entries = spec.masts || [];
  const masts = entries
    .map((m) => {
      const g = STATION_GEOM[m.station];
      if (!g || g.spar) return null;
      const pole = Math.round(g.pole * (m.height || 1) * 100) / 100;
      const k = pole / g.ref; // a shorter mast carries its canvas proportionally lower
      // The bands are cut for the stack she actually carries: three or fewer are
      // the authored ones, and a taller stack is squeezed into the same air.
      const stack = (m.sails || []).length;
      const squares = squareBands(g, stack);
      const tris = triBands(g, stack);
      const sails = (m.sails || []).map((s, i) => {
        if (TRIANGULAR.has(s.kind)) {
          const band = tris[Math.min(i, tris.length - 1)];
          return { cut: "triangle", zb: pole * band.zb, zt: pole * band.zt };
        }
        const slot = squares[Math.min(i, squares.length - 1)];
        return {
          cut: "square",
          span: slot.span * k, zt: slot.zt * k, zb: slot.zb * k,
          bulge: slot.bulge * k, seg: slot.seg,
        };
      });
      /* The pole is then cut down to the canvas actually bent on it. A mast is as
         tall as it needs to be for its highest sail plus the room a masthead
         takes: leave it at its full nominal height and a boat carrying one small
         sail stands a bare spar twice the height of her rig, which reads as a
         mast that has lost its sails rather than a boat that never had them. The
         galleon's own masts are already cut this way, so her three come out
         unchanged. A mast with nothing on her keeps her full height: a bare pole
         is exactly what she is. */
      const HEAD = 0.14;
      const highest = sails.reduce((a, s) => Math.max(a, s.zt), 0);
      const top = highest ? Math.min(pole, highest + HEAD * pole) : pole;
      return { x: g.x, top, r0: g.r0, r1: g.r1, hoist: g.hoist, shrouds: g.shrouds, ratlines: g.ratlines, stay: g.stay, sails };
    })
    .filter(Boolean)
    .sort((a, b) => b.x - a.x);

  // the spars, once the masts they hoist against are known
  const spars = [];
  for (const m of entries) {
    const g = STATION_GEOM[m.station];
    if (!g || !g.spar) continue;
    spars.push({ x: g.x, sails: sparSails(g, m.sails || [], masts[0]) });
  }
  return { bowsprit: spec.bowsprit !== false, masts, spars };
}

/** The ship this file has always drawn, and what it falls back to when asked for no rig in particular. */
const GALLEON_RIG = rigFromSpec({
  bowsprit: true,
  masts: [
    { station: "fore", height: 0.88, sails: [{ kind: "LSQ" }, { kind: "SSQ" }] },
    { station: "main", height: 1.0, sails: [{ kind: "LSQ" }, { kind: "SSQ" }, { kind: "SSQ" }] },
    { station: "mizzen", height: 0.74, sails: [{ kind: "TRI" }] },
  ],
});

function buildShip(rig){
 const F=[],P=PAL;
 // plank courses: the topside band is split into three strakes at ±6% so the
 // hull reads as laid planking rather than one flat panel
 const fs=[0,0.14,0.34,0.50,0.66,0.82,1],
       bc=[P.low,P.mid,tint(P.mid,0.94),tint(P.mid,1.06),P.strake,P.top];
 /* Planks are cut at roughly 4.5 units, not left to span a whole station gap.
    The stations run up to 14 apart, and a plank that long is keyed on a centroid
    metres from the gunport sitting on it — far enough that the plank's key beat
    the port's, and the planking closed over the open port and the gun standing
    in it at grazing headings. Cutting the run keeps each plank's key beside the
    work it carries. The extra samples are interpolated stations, so the surface
    is unchanged: same curve, same colours, just more quads along it. */
 for(let i=0;i<ST.length-1;i++){const a=station(i),b=station(i+1);
  const NS=Math.max(1,Math.ceil(Math.abs(b.x-a.x)/4.5));
  for(let s=0;s<NS;s++){
   const pa=s===0?a:stationAt(lerp(a.x,b.x,s/NS)), pb=s===NS-1?b:stationAt(lerp(a.x,b.x,(s+1)/NS));
   for(const side of[1,-1]){
    for(let k=0;k<6;k++)
     addFace(F,[hullPtF(pa,side,fs[k]),hullPtF(pb,side,fs[k]),hullPtF(pb,side,fs[k+1]),hullPtF(pa,side,fs[k+1])],
             bc[k],[0,side,0],{tag:"hull"});
   }
  }
 }
 function xSamples(xa,xb,step){
  const out=[xa], mid=[];
  for(let x=xa+step;x<xb-0.4;x+=step) mid.push(x);
  for(const s of ST) if(s[0]>xa+0.4&&s[0]<xb-0.4) mid.push(s[0]);
  mid.sort((p,q)=>p-q);
  for(const x of mid) if(x-out[out.length-1]>0.4) out.push(x);
  out.push(xb);
  return out;
 }
 function bulwarkRun(xa,xb,capA,capB,lift){
  const xs=xSamples(xa,xb,3.5), L=lift||0;
  const dz=s=>s.sheer+L, tz=s=>s.sheer+BULWARK+L;
  const iw=s=>Math.max(s.w-1.35,0.3);
  for(let i=0;i<xs.length-1;i++){
   const x0=xs[i],x1=xs[i+1],s0=stationAt(x0),s1=stationAt(x1);
   const d0=dz(s0),d1=dz(s1),t0=tz(s0),t1=tz(s1);
   for(const side of[1,-1]){
    addFace(F,[[x0,side*s0.w,s0.sheer],[x1,side*s1.w,s1.sheer],
               [x1,side*s1.w,t1],[x0,side*s0.w,t0]],P.top,[0,side,0],{tag:"hull"});
    addFace(F,[[x0,side*s0.w,t0],[x1,side*s1.w,t1],
               [x1,side*(iw(s1)),t1],[x0,side*(iw(s0)),t0]],P.cap,[0,0,1],{tag:"hull"});
    addFace(F,[[x0,side*(iw(s0)),d0],[x1,side*(iw(s1)),d1],
               [x1,side*(iw(s1)),t1],[x0,side*(iw(s0)),t0]],P.dark,[0,-side,0],{tag:"hull"});
   }
   /* One plain plate per sample, unstroked and held clear of the bulwark. The
      plank banding added seam lines across the deck and its outline spilled onto
      whatever the deck butted against — rail, castle wall, hatch coaming.
      Cut into three strips athwartships as well, and sunk a fixed 2.6 in the sort
      (sink): a plate keyed on its own centroid sits nearer the eye than anything
      standing against the FAR bulwark, which is what let the deck paint over the
      far-side stair walls. A fixed sink clears the fittings without dropping the
      plate behind the hull skin, which keying on the far corner did. Sunk plates
      must not stop short of what surrounds them either, or the face behind shows
      as a dark hairline — so the plate now tucks UNDER the bulwark. */
   {const INSET=-0.25, w0=iw(s0)-INSET, w1=iw(s1)-INSET, xe=x1+(i<xs.length-2?0.6:0), NY=5;
    for(let k=0;k<NY;k++){const a=-1+2*k/NY-(k?0.02:0),b=-1+2*(k+1)/NY+(k<NY-1?0.02:0);
     addFace(F,[[x0,a*w0,d0],[xe,a*w1,d1],[xe,b*w1,d1],[x0,b*w0,d0]],
             P.deck,[0,0,1],{tag:"deck",bias:-1.6,nostroke:true,nearW:0,sink:2.6});}}
  }
  for(const[xc,dir]of[[xa,capA],[xb,capB]]){
   if(!dir)continue;
   const s=stationAt(xc);
   for(const side of[1,-1])
    addFace(F,[[xc,side*s.w,dz(s)],[xc,side*(iw(s)),dz(s)],
               [xc,side*(iw(s)),tz(s)],[xc,side*s.w,tz(s)]],P.cap,[dir,0,0],{tag:"hull"});
  }
 }
 bulwarkRun(-18,24,0,0);
 bulwarkRun(50,60,0,0,20.2-stationAt(50).sheer);
 const uu=[0,0.46,0.74,0.87,1],s0=station(0),sN=station(ST.length-1);
 {
  const NB=12,NC=4;
  for(const[st,nx]of[[s0,-1],[sN,1]]){
   for(let i=0;i<NB;i++){
    const a=hullPt(st,1,i/NB), b=hullPt(st,1,(i+1)/NB);
    for(let j=0;j<NC;j++){
     const y0a=lerp(-a[1],a[1],j/NC), y1a=lerp(-a[1],a[1],(j+1)/NC);
     const y0b=lerp(-b[1],b[1],j/NC), y1b=lerp(-b[1],b[1],(j+1)/NC);
     addFace(F,[[a[0],y0a,a[2]],[a[0],y1a,a[2]],[b[0],y1b,b[2]],[b[0],y0b,b[2]]],
             P.mid,[nx,0,0],{tag:"hull"});
    }
   }
  }
 }
 {
  const surfW=(x,z)=>hullWAtZ(stationAt(x),z);
  const patch=(px,side,zc,hw,hh,out,col,bias,flat)=>{
   const NX=4,NZ=3;
   for(let i=0;i<NX;i++)for(let j=0;j<NZ;j++){
    const xa=px-hw+2*hw*i/NX, xb=px-hw+2*hw*(i+1)/NX;
    const za=zc-hh+2*hh*j/NZ, zb=zc-hh+2*hh*(j+1)/NZ;
    addFace(F,[[xa,side*(surfW(xa,za)+out),za],[xb,side*(surfW(xb,za)+out),za],
               [xb,side*(surfW(xb,zb)+out),zb],[xa,side*(surfW(xa,zb)+out),zb]],
            col,[0,side,0],flat!=null?{tag:"hull",bias,flat}:{tag:"hull",bias});
   }
  };
  // kept clear of the castle breaks fore and aft, where the hull curves too fast
  // for a port to sit flat
  for(const px of[-21,-8,6,19]){
   const z=stationAt(px).sheer*0.47; if(z-1.95<0.7) continue;
   for(const side of[1,-1]){
    /* Gunport: a small square of tan trim, a flat black opening inside it, and a
       cannon standing out of the black. Trim, opening and gun are strongly biased
       forward of the planking so they stay whole at grazing headings instead of
       breaking into slivers where the hull faces sort past them. */
    const i0=F.length;
    const iGun=()=>F.length;
    patch(px,side,z,2.60,2.20,0.05,P.port,4.0);
    patch(px,side,z,2.42,2.02,0.11,"#0b0806",4.4,0.09);   // black fills the port to a hairline of trim
    const g0=iGun();
    // straight athwartships, so the gun is centred in its port from every heading
    const n=[0,side,0], sp=[px,side*surfW(px,z),z];
    const at=t=>[sp[0],sp[1]+n[1]*t,sp[2]];
    /* The barrel starts at the hull surface. It used to run 1.7 back inside the
       ship, and that buried length was biased forward of the black, so the shadow
       it was supposed to be sunk into was painted over by grey barrel — the port
       read shallow, as though the gun were stuck on the planking. Nothing behind
       the surface is ever seen through a hull that has no hole in it, so the
       length was doing no work. */
    addSpar(F,at(0),at(2.85),0.70,0.50,"#57504a","hull",4,10,4.6);
    addPrism(F,at(2.70),at(3.14),0.60,0.54,"#6a635c","hull",10,4.7);    // muzzle swell
    addPrism(F,at(3.12),at(3.32),0.48,0.32,"#6a635c","hull",10,4.8);    // rounded off at the mouth
    addPrism(F,at(3.30),at(3.38),0.24,0.22,"#0b0806","hull",10,4.9);    // bore
    /* The flat port faces drop out as this side turns edge-on — they have no
       thickness to show. The gun does: rather than vanish, it falls back behind
       the hull in the sort, so bow-on and stern-on views keep a barrel sticking
       out past the silhouette on BOTH sides, which is what you would see. */
    for(let i=i0;i<F.length;i++){
     F[i].cull=[0,side,0];
     F[i].cullT=0.32;
     if(i>=g0)F[i].biasFar=-3;
    }
   }
  }
 }
 const RAIL_T=1.35;
 /* Cut into lengths of about 5 rather than run as three full-length faces. A rail
    across the stern is 26 units of timber keyed on its own midpoint, so the deck
    plate that butts against its foot — keyed on its own centre, metres away —
    could outrank it and paint over the rail's inner face. Short lengths keep each
    piece keyed beside whatever stands next to it. Consecutive pieces overlap by a
    hair so the run reads unbroken. */
 function railWall(ax,ay,bx,by,dz,rh,ix,iy,noOuter){
  const top=dz+rh;
  const run=Math.hypot(bx-ax,by-ay), NR=Math.max(1,Math.ceil(run/5));
  for(let s=0;s<NR;s++){
   const u0=s/NR, u1=(s+1)/NR+(s<NR-1?0.004:0);
   const x0=lerp(ax,bx,u0), y0=lerp(ay,by,u0), x1=lerp(ax,bx,u1), y1=lerp(ay,by,u1);
   const i0x=x0+ix*RAIL_T, i0y=y0+iy*RAIL_T, i1x=x1+ix*RAIL_T, i1y=y1+iy*RAIL_T;
   if(!noOuter)addFace(F,[[x0,y0,dz],[x1,y1,dz],[x1,y1,top],[x0,y0,top]],P.top,[-ix,-iy,0],{tag:"castle",bias:3});
   addFace(F,[[i0x,i0y,dz],[i0x,i0y,top],[i1x,i1y,top],[i1x,i1y,dz]],P.dark,[ix,iy,0],{tag:"castle",bias:3});
   addFace(F,[[x0,y0,top],[x1,y1,top],[i1x,i1y,top],[i0x,i0y,top]],P.cap,[0,0,1],{tag:"castle",bias:3});
  }
 }
 /* Stairs, and the gaps their heads open in the castle end rails. Both come from
    the same numbers, so a stair can never land against a closed rail. */
 const STAIR=[[24,-1,20.2],[-18,1,23.6]], STAIR_W=4.4, STAIR_RUN=11;
 // one flight per side, hard against the bulwark: [inboard edge, outboard edge]
 const stairSpan=(fx,dir,side)=>{const mx=fx+dir*STAIR_RUN*0.5,
   wo=stationAt(mx).w-RAIL_T-0.25;
   return[side*(wo-STAIR_W),side*wo];};
 // the flight runs from its inboard edge right out to the hull, so the rail gap
 // does too — the sloping topside outboard of it is what closes that side
 const stairGaps=(fx,dir)=>[1,-1].map(side=>{const yi=stairSpan(fx,dir,side)[0],
   yo=side*(stationAt(fx).w+2);
   return[Math.min(yi,yo),Math.max(yi,yo)];}).sort((a,b)=>a[0]-b[0]);
 const endRail=(xr,dz,rh,ix,gaps,noOuter)=>{
  const w=stationAt(xr).w;
  let segs=[[-w,w]];
  for(const g of gaps||[]){const out=[];
   for(const[a,b]of segs){
    if(g[1]<=a||g[0]>=b){out.push([a,b]);continue;}
    if(a<g[0])out.push([a,g[0]]);
    if(g[1]<b)out.push([g[1],b]);}
   segs=out;}
  // each cut end gets a closing face, so a rail never stops on an open edge
  const cap=(y,ny)=>addFace(F,[[xr,y,dz],[xr+ix*RAIL_T,y,dz],[xr+ix*RAIL_T,y,dz+rh],[xr,y,dz+rh]],
                            P.cap,[0,ny,0],{tag:"castle",bias:3.2});
  for(const[a,b]of segs){
   if(b-a<=0.3)continue;
   railWall(xr,a,xr,b,dz,rh,ix,0,noOuter);
   if(a>-w+0.01)cap(a,-1);
   if(b<w-0.01)cap(b,1);
  }
 };
 function castle(xa,xb,dz,rh,ins,face){
  const hw=x=>Math.max(stationAt(x).w-ins,2),bs=x=>Math.min(stationAt(x).sheer-0.6,dz-0.5);
  const xs=xSamples(xa,xb,3.5);   // finer plates: keeps the deck's depth sort local around the masts
  for(let i=0;i<xs.length-1;i++){
   const x0=xs[i],x1=xs[i+1],w0=hw(x0),w1=hw(x1),b0=bs(x0),b1=bs(x1);
   for(const side of[1,-1]){
    addFace(F,[[x0,side*w0,b0],[x1,side*w1,b1],[x1,side*w1,dz],[x0,side*w0,dz]],P.top,[0,side,0],{tag:"castle",bias:3});
    railWall(x0,side*w0,x1,side*w1,dz,rh,0,-side);
   }
   /* same treatment as the waist deck: plain plates, unstroked, split
      athwartships. These sit at the top of the ship, so unlike the waist plates
      they are NOT sunk in the sort: sinking them let waist-level work — stair
      walls, shrouds, mast heels — bleed up through the castle floor. They still
      tuck 0.25 under the rail, which is opaque and drawn over them.

      They no longer run past the break wall. That overhang was half a unit of
      deck protruding into open air beyond the wall face, kept out of sight only
      by the wall being painted over it — and at two thirds of the headings the
      lip is genuinely the nearer surface, so it showed. The plate now stops on
      the wall plane: the break reads as one unbroken face, and the wall's own
      seam stroke covers the joint. */
   const cw0=w0-RAIL_T+0.25,cw1=w1-RAIL_T+0.25,
    xp0=x0,
    /* Five strips athwartships, not three. A plate is keyed on its own centroid,
       so a wide strip is keyed metres away from the rail it butts against: the
       margin over the rail's bias ran out at a fair number of headings and the
       deck painted over the rail's inner face and cap. Narrower strips keep each
       plate's key close to the work standing along its edge. */
    xe=x1+(i<xs.length-2?0.6:0),NY=5;
   for(let k=0;k<NY;k++){const a=-1+2*k/NY-(k?0.02:0),b=-1+2*(k+1)/NY+(k<NY-1?0.02:0);
    addFace(F,[[xp0,a*cw0,dz],[xe,a*cw1,dz],[xe,b*cw1,dz],[xp0,b*cw0,dz]],
            P.deck,[0,0,1],{tag:"castle",bias:-1.6,nostroke:true,nearW:0});}
  }
  const we=hw(face),be=bs(face),nf=face===xa?-1:1;
  const st=STAIR.find(s=>s[0]===face), yi=st?Math.abs(stairSpan(st[0],st[1],1)[0]):0;
  /* Tiled finely for the same reason as the deck: the break wall is one plane, but
     each tile sorts on its own centroid, and a third-of-the-width tile was keyed
     far enough inboard to beat the head of the stair standing against it — the
     wall then painted over the top treads and the string. Every tile is the same
     timber, so nothing can show between them. */
  const NWY=9,NWZ=4;
  for(let iy=0;iy<NWY;iy++)for(let iz=0;iz<NWZ;iz++){
   const y0=-we+2*we*iy/NWY,y1=-we+2*we*(iy+1)/NWY,z0=be+(dz-be)*iz/NWZ,z1=be+(dz-be)*(iz+1)/NWZ;
   addFace(F,[[face,y0,z0],[face,y1,z0],[face,y1,z1],[face,y0,z1]],P.wood,[nf,0,0],{tag:"castle",bias:3});}
  /* Above the deck the break wall carries on to the top of the rail, in the same
     timber as below it, so the whole face reads as one plane from the main deck
     to the rail cap instead of changing colour and picking up a seam where the
     rail used to start. It stops at the inboard edge of each flight — exactly
     where the stair walls stand — and the rail above the deck skips its own
     outer face over that span (endRail's noOuter) so nothing is drawn twice. */
  if(yi>0.3)for(let iy=0;iy<NWY;iy++){
   const y0=-yi+2*yi*iy/NWY,y1=-yi+2*yi*(iy+1)/NWY;
   addFace(F,[[face,y0,dz],[face,y1,dz],[face,y1,dz+rh],[face,y0,dz+rh]],P.wood,[nf,0,0],{tag:"castle",bias:3});}
 }
 castle(-60,-18,23.6,BULWARK,0,-18); castle(24,50,20.2,BULWARK,0,24);
 endRail(-60,23.6,BULWARK,1);
 endRail(-18,23.6,BULWARK,-1,stairGaps(-18,1),true);
 endRail(24,20.2,BULWARK,1,stairGaps(24,-1),true);
 {
  const w=stationAt(-57.5).w-2.6, XT=-60.55, XG=-60.7, XM=-60.8;
  /* Three stern lights. The sort key counts height as depth, so a tall face
     outsorts anything shorter standing on it — every piece of the transom trim
     therefore carries a bias with its own centre height subtracted out, which
     leaves the stack ordered purely by the layer number. */
  /* The sort key counts height as depth, so a tall face outsorts anything
     shorter standing on it — the sash plate would paint over its own two lower
     panes. Each upright piece of transom trim therefore subtracts its OWN centre
     height back out of its bias, which leaves the stack ordered purely by layer.
     All of them face dead astern, so they are culled the moment the transom
     turns away; only the horizontal mouldings below carry an ordinary bias. */
  const trim=(x,ya,yb,za,zb,color,layer,flat,n)=>addFace(F,
   [[x,ya,za],[x,yb,za],[x,yb,zb],[x,ya,zb]],color,n||[-1,0,0],
   {tag:"trim",flat,nearW:0,nostroke:true,bias:30-(za+zb)/2+layer});
  for(let k=-1;k<=1;k++){
   const y=k*w*0.72, z=19.65, HW=1.55, HH=2.8, FT=0.34, G=0.4,
    PW=HW-FT, PH=HH-FT;
   /* No backing plate: four panes of glass with the frame and mullions built as
      thin bars laid proud of them. Every piece is of comparable size, so none
      can outsort a neighbour as the heading swings the depth axis around. */
   for(const sy of[-1,1])for(const sz of[-1,1])
    trim(XG,y+(sy<0?-PW:G),y+(sy<0?-G:PW),z+(sz<0?-PH:G),z+(sz<0?-G:PH),P.glass,0,0.84);
   for(const[ya,yb,za,zb]of[[-HW,-PW,-HH,HH],[PW,HW,-HH,HH],[-HW,HW,PH,HH],
                            [-HW,HW,-HH,-PH],[-G,G,-HH,HH],[-HW,HW,-G,G]])
    trim(XM,y+ya,y+yb,z+za,z+zb,P.pane,0.6,0.62);
  }
  for(const[bz,bh]of[[15.9,0.8],[23.4,0.8]]){
   const bw=hullWAtZ(station(0),bz)*0.90, XB=XT-0.22;
   trim(XB,-bw,bw,bz-bh,bz+bh,P.pane,1,0.9);
   addFace(F,[[XB,-bw,bz+bh],[XB,bw,bz+bh],[XT,bw,bz+bh],[XT,-bw,bz+bh]],P.cap,[0,0,1],
           {tag:"trim",flat:0.94,nearW:0,nostroke:true,bias:2.2});
  }
 }
 const masts=rig.masts;
 for(const m of masts){
  const dz=deckZAt(m.x);
  m.deck=dz;
  addSpar(F,[m.x,0,dz],[m.x,0,m.top],m.r0,m.r1,P.wood,"mast",0,10);
  /* Mast partner: a short ring in two stacked bands, biased forward of the deck
     plate it sits in, so from bow-on views it reads as a collar around the pole
     instead of a lump half-swallowed by the planking. */
  /* Built as a true ring: two stacked bands of outer wall, closed on top by a
     washer rather than a disc. A solid cap covered the pole rising through it,
     and the pole is one long run, so no sort could bring it back out — the
     collar looked as though it had swallowed a length of the mast. The washer's
     inner edge sits at 0.92 of the pole radius, inside the decagon's inradius
     (0.951), so it tucks under the pole's surface without opening a gap at the
     flats. The buried bottom cap is gone with it. */
  {const CN=14, ct=dz+1.2, ro=m.r0*1.46,
    rp=lerp(m.r0,m.r1,1.2/(m.top-dz))*0.92,
    pt=(r,z,t)=>[m.x-Math.sin(t)*r, Math.cos(t)*r, z];
   for(let b=0;b<2;b++){
    const z0=dz+b*0.6, z1=dz+(b+1)*0.6, r0=m.r0*(1.7-0.12*b), r1=m.r0*(1.58-0.12*b);
    for(let i=0;i<CN;i++){const t0=i*2*Math.PI/CN, t1=(i+1)*2*Math.PI/CN;
     addFace(F,[pt(r0,z0,t0),pt(r0,z0,t1),pt(r1,z1,t1),pt(r1,z1,t0)],P.dark,
             [-(Math.sin(t0)+Math.sin(t1))/2,(Math.cos(t0)+Math.cos(t1))/2,0],{tag:"mast",bias:2.2});}
   }
   for(let i=0;i<CN;i++){const t0=i*2*Math.PI/CN, t1=(i+1)*2*Math.PI/CN;
    addFace(F,[pt(rp,ct,t0),pt(ro,ct,t0),pt(ro,ct,t1),pt(rp,ct,t1)],P.dark,[0,0,1],{tag:"mast",bias:2.2});}
  }
 }
 if(rig.bowsprit) addSpar(F,BOWSPRIT.heel,BOWSPRIT.tip,BOWSPRIT.r0,BOWSPRIT.r1,P.wood,"mast",0);
 function sail(mx,span,zt,zb,bulge,seg){if(!OPT.sails)return;
  /* The cloth stands clear of the pole in x (CLEAR), and the yard sits between
     the two — so no part of the mast can be closer to the eye than the canvas
     it belongs to, at any heading. */
  /* The yard rides fully above the head of the cloth (bottom of the spar clears
     zt), so its segments can never notch through the top edge of the sail. */
  const CLEAR=2.4, YARD=1.5, YR=0.62;
  addSpar(F,[mx+YARD,-(span+2),zt+YR+0.2],[mx+YARD,span+2,zt+YR+0.2],YR,YR,P.dark,"mast",0);
  const ROWS=8;
  const pt=(t,fv)=>{
   const y=t*span*(1-0.10*fv);
   const vert=Math.sin(Math.PI*Math.pow(fv,1.45));
   const bow=bulge*(1-t*t)*vert;
   const wave=0.9*Math.sin(Math.PI*(t*0.5+0.5))*Math.sin(Math.PI*fv);
   const sag=1.15*fv*fv*(1-t*t)+wave;
   return[mx+CLEAR+bow,y,lerp(zt,zb,fv)-sag];
  };
  for(let i=0;i<seg;i++){const t0=-1+2*i/seg,t1=-1+2*(i+1)/seg;
   for(let r=0;r<ROWS;r++){const v0=r/ROWS,v1=(r+1)/ROWS;
    addFace(F,[pt(t0,v0),pt(t1,v0),pt(t1,v1),pt(t0,v1)],P.sail,[1,0,0],{tag:"sail",double:true,back:P.back});}}
 }
 /* A triangular sail is one tall panel between three corners rather than a stack
    of bands, so it is drawn from the band it occupies: tack forward and low,
    peak aft at the head, clew aft and low. The fractions are the mizzen lateen's
    own proportions, held against the height of the band, so the same shape
    serves a lateen on a big ship's after mast and the single standing sail of a
    boat that has nothing else. */
 /* The cloth of a three-cornered sail: a panel fanned from corner B across the
    edge between A and C, bellied out in y so it stands full rather than flat.
    Both edges off B carry the belly and the far edge inherits it, so all three
    corners come to a point and everything between them is under strain. */
 const triPanel=(B,A,C,belly)=>{
  const on=(p,q,t)=>[lerp(p[0],q[0],t),lerp(p[1],q[1],t)+belly*Math.sin(Math.PI*t),lerp(p[2],q[2],t)];
  const mix=(p,q,s)=>[lerp(p[0],q[0],s),lerp(p[1],q[1],s),lerp(p[2],q[2],s)];
  for(let i=0;i<12;i++){const t0=i/12,t1=(i+1)/12,a0=on(B,A,t0),a1=on(B,A,t1),c0=on(B,C,t0),c1=on(B,C,t1);
   for(const[s0v,s1v]of[[0,1/3],[1/3,2/3],[2/3,1]])
    addFace(F,[mix(a0,c0,s0v),mix(a1,c1,s0v),mix(a1,c1,s1v),mix(a0,c0,s1v)],P.sail,[0,1,0],{tag:"sail",double:true,back:P.back});}
 };
 function lateen(mx,zb,zt){if(!OPT.sails)return;
  const h=zt-zb;
  const B=[mx+0.621*h,1.1,zb+0.310*h],A=[mx-0.690*h,1.1,zt],C=[mx-0.552*h,1.1,zb];
  const mix=(p,q,s)=>[lerp(p[0],q[0],s),lerp(p[1],q[1],s),lerp(p[2],q[2],s)];
  // straight lateen yard: a plain chord from tack to peak, so the bellied head
  // of the cloth stands off it rather than the spar bending with the canvas
  const yq=t=>{const p=mix(B,A,t);return[p[0],p[1]-0.75,p[2]];};
  const YS=16;
  for(let i=0;i<YS;i++){const t0=i/YS,t1=(i+1)/YS;
   addPrism(F,yq(t0),yq(t1),lerp(0.55,0.42,t0),lerp(0.55,0.42,t1),P.dark,"mast");}
  addSpar(F,yq(1),[mx-0.828*h,1.1-0.75,zt+0.069*h],0.42,0.36,P.dark,"mast",0);
  triPanel(B,A,C,3.6);
 }
 /* A headsail has no spar at all: it is tacked down to the bowsprit, hoisted up
    the stay to the masthead, and sheeted home to the deck aft of both. So it is
    three loose corners and its luff is the stay it is hanked to, which is
    already drawn. Fanned from the tack, which is the corner all of it hangs
    forward of. */
 function headsail(tack,head,clew){if(!OPT.sails)return;
  const y=1.1, at=p=>[p[0],p[1]+y,p[2]];
  triPanel(at(tack),at(head),at(clew),2.6);
 }
 for(const m of masts) for(const s of m.sails){
  if(s.cut==="triangle") lateen(m.x,s.zb,s.zt);
  else sail(m.x,s.span,s.zt,s.zb,s.bulge,s.seg);
 }
 // and whatever is set on the bowsprit: headsails out on the stay, a spritsail
 // slung under the spar
 for(const sp of rig.spars||[]) for(const s of sp.sails){
  if(s.cut==="headsail") headsail(s.tack,s.head,s.clew);
  else sail(s.mx,s.span,s.zt,s.zb,s.bulge,s.seg);
 }
 if(OPT.rig){const rope=P.dark,r=0.3;
  // shrouds land on the rail cap abreast of the mast, not out on the open deck
  for(const m of masts){const sz=m.top*m.hoist;
   for(const side of[1,-1]){
    // the after mast carries one shroud a side, square-rigged masts two. The one
    // is set abaft its mast: level with it, it projected straight down the pole
    // and read as the mast carrying on through the quarterdeck.
    const offs=m.shrouds;
    /* Made fast just inside the rail, not on top of the cap. Landing on the cap
       put the rope's axis exactly in the cap's plane, so half its thickness stood
       above the timber and should have shown — but the cap outranks rope in the
       sort at almost every heading, and no bias that fixes that leaves the rope
       behind its own mast. Set 0.35 inboard of the rail's inner face the rope
       runs up and inboard from the start, never crossing the cap's plane, so the
       cap occludes it only where it genuinely should. */
    const foot=offs.map(d=>{const lx=m.x+d,s=stationAt(lx);
     return[lx,side*(s.w-1.7),deckZAt(lx)+BULWARK];});
    for(const p of foot) addSpar(F,[m.x,0,sz],p,r,r,rope,"rig",0);
    // ratlines: the rungs stop well short of the head, as they do aboard, and
    // they need two shrouds to run between
    if(!m.ratlines||foot.length<2)continue;
    const RN=7, top=0.62;
    for(let k=1;k<=RN;k++){
     const t=(k/(RN+1))*top,
      a=foot[0].map((c,i)=>lerp(c,[m.x,0,sz][i],t)),
      b=foot[1].map((c,i)=>lerp(c,[m.x,0,sz][i],t));
     addSpar(F,a,b,0.17,0.17,rope,"rig",0,4);
    }}}
  /* Stays run forward down the line of masts: each one from a point near its own
     head to a point near the head of the mast ahead of it, and the foremost mast
     to the end of the bowsprit. Chaining them off the masts that are actually
     stepped is what lets a ship with one mast, or none, rig correctly instead of
     leaving ropes hanging in the air where a mast used to be. */
  masts.forEach((m,i)=>{
   const fwd=masts[i-1];
   if(fwd) addSpar(F,[m.x,0,m.top*m.stay.from],[fwd.x,0,fwd.top*m.stay.to],r,r,rope,"rig",0);
   else if(rig.bowsprit) addSpar(F,[m.x,0,m.top*m.stay.from],[BOWSPRIT.tip[0],0,BOWSPRIT.tip[2]-0.4],r,r,rope,"rig",0);
  });
 }
 /* ---- timbers and deck fittings ---- */
 {
  const waist=x=>stationAt(x).sheer;
  // beakhead knee under the bowsprit
  addSpar(F,[57,0,14.5],[71,0,27.4],1.0,0.62,P.wood,"hull",0,6,0.9);
  /* Hatch, forward of the main mast: a low box whose lid is a single horizontal
     plane — brown ground with evenly spaced black squares painted on it, inside
     a thick brown border. Reads as a crossed grating from every heading without
     any bar geometry to sort. */
  {
   const hz=waist(12), lz=hz+1.9, X0=7,X1=17,Y0=-5.2,Y1=5.2, BORDER=1.2;
   // coaming sides only — no lid face of its own: one quad that wide outsorts
   // the small cells painted on it and hides half the grid
   // walls stand inboard of the lid edge, so the lid overhangs them a little and
   // a far wall can never paint over the grating's far row
   const WX0=X0+0.3,WX1=X1-0.3,WY0=Y0+0.3,WY1=Y1-0.3;
   addFace(F,[[WX0,WY0,hz],[WX1,WY0,hz],[WX1,WY0,lz],[WX0,WY0,lz]],P.top,[0,-1,0],{tag:"deck",bias:4.6});
   addFace(F,[[WX0,WY1,hz],[WX1,WY1,hz],[WX1,WY1,lz],[WX0,WY1,lz]],P.top,[0,1,0],{tag:"deck",bias:4.6});
   addFace(F,[[WX0,WY0,hz],[WX0,WY1,hz],[WX0,WY1,lz],[WX0,WY0,lz]],P.top,[-1,0,0],{tag:"deck",bias:4.6});
   addFace(F,[[WX1,WY0,hz],[WX1,WY1,hz],[WX1,WY1,lz],[WX1,WY0,lz]],P.top,[1,0,0],{tag:"deck",bias:4.6});
   /* The lid is ONE plane tiled into cells that are either brown or black —
      squares stacked slightly above a full-width lid face kept losing the depth
      sort (and its outline stroke) at some headings. Coplanar, non-overlapping
      cells can't fight each other, so the grid reads the same from every view. */
   const TX=11,TY=9, IN=(i,n)=>i>1&&i<n-2;
   for(let i=0;i<TX;i++)for(let j=0;j<TY;j++){
    const x0=lerp(X0,X1,i/TX),x1=lerp(X0,X1,(i+1)/TX),
     y0=lerp(Y0,Y1,j/TY),y1=lerp(Y0,Y1,(j+1)/TY),
     black=IN(i,TX)&&IN(j,TY)&&i%2===0&&j%2===0;
    addFace(F,[[x0,y0,lz+0.01],[x1,y0,lz+0.01],[x1,y1,lz+0.01],[x0,y1,lz+0.01]],
            black?"#0b0806":P.wood,[0,0,1],
            black?{tag:"deck",bias:5.2,flat:0.11,nostroke:true}:{tag:"deck",bias:5.2,nostroke:true});
   }
  }
  {
   // capstan, just forward of the quarterdeck break
   const cz=waist(-9);
   addPrism(F,[-9,0,cz],[-9,0,cz+2.7],1.45,1.15,P.wood,"deck",10,4.4);
   addPrism(F,[-9,0,cz+2.7],[-9,0,cz+3.5],1.85,1.7,P.cap,"deck",10,4.5);
  }
  // stairs from the waist up through the gap in each castle rail
  for(const[fx,dir,topz]of STAIR){
   const bx=fx+dir*STAIR_RUN, bz=waist(bx);
   for(const side of[1,-1]){
    const sp=stairSpan(fx,dir,side), yi=sp[0], yo=sp[1];
    /* The topside runs on past the castle break and ramps down to the main rail
       over the length of the stair, so the flight is walled in by the hull itself
       rather than by a post. */
    {
     /* Sampled the same way as the wall inboard of it, and unstroked for the same
        reason: the ramp is the width of the rail cap, so a round join at each
        sample stood out past the cap as a notch — worst at the head, where the
        ramp starts against the castle rail and the notch fell on the rail. */
     const RS=8, xr1=bx+dir*1.2;
     const R=e=>{const x=lerp(fx,xr1,e), s=stationAt(x), t=e*e*(3-2*e);
      return{x, y:side*s.w, yi:side*(s.w-RAIL_T), z0:s.sheer+BULWARK,
             z1:lerp(topz+BULWARK,s.sheer+BULWARK,t)};};
     for(let i=0;i<RS;i++){
      const a=R(i/RS), b=R(Math.min(1,(i+1)/RS+(i<RS-1?0.03:0)));
      if(a.z1-a.z0<0.05&&b.z1-b.z0<0.05)continue;
      addFace(F,[[a.x,a.y,a.z0],[b.x,b.y,b.z0],[b.x,b.y,b.z1],[a.x,a.y,a.z1]],P.top,[0,side,0],{tag:"castle",bias:3.1,nostroke:true});
      addFace(F,[[a.x,a.yi,a.z0],[b.x,b.yi,b.z0],[b.x,b.yi,b.z1],[a.x,a.yi,a.z1]],P.dark,[0,-side,0],{tag:"castle",bias:3.1,nostroke:true});
      addFace(F,[[a.x,a.y,a.z1],[b.x,b.y,b.z1],[b.x,b.yi,b.z1],[a.x,a.yi,a.z1]],P.cap,[0,0,1],{tag:"castle",bias:3.2,nostroke:true});
     }
    }
    /* A built flight, not a row of slats: every step contributes a riser and a
       tread, and each edge of the flight is closed by one sawtooth panel — so
       there is no daylight under the stair and nothing to sort through. */
    {
     const N=8, xs=i=>lerp(bx,fx,i/N), zs=i=>lerp(bz,topz,i/N);
     for(let i=0;i<N;i++){
      const x0=xs(i),x1=xs(i+1),z0=zs(i),z1=zs(i+1);
      addFace(F,[[x0,yi,z0],[x0,yo,z0],[x0,yo,z1],[x0,yi,z1]],P.dark,[dir,0,0],{tag:"deck",bias:5.0});
      addFace(F,[[x0,yi,z1],[x0,yo,z1],[x1,yo,z1],[x1,yi,z1]],P.deck,[0,0,1],{tag:"deck",bias:5.1});
     }
     /* Inboard side is a solid wall, deck to cap, and its top runs PARALLEL to
        the flight one bulwark height above the nosing line: at the head that is
        exactly the castle rail cap it continues, at the foot it ends on a newel
        at waist-rail height. An earlier version eased the top from rail height
        down to the sheer, which from inboard views read as a curved berm filling
        the waist with the treads combing over its top edge. */
     {const T=0.55, yo2=yi, yi2=yi-side*T, NW=8, x0w=fx, x1w=bx+dir*1.2;
      // nosing line of the flight, level for the short landing past the foot
      const line=x=>lerp(topz,bz,Math.min(1,Math.max(0,(x-fx)/(bx-fx))));
      /* The wall stands ON the deck: its foot is level with the planking, less a
         hair for the seam. It used to be sunk 0.3, and since the deck plate is
         keyed behind the fittings that stand on it, that buried stretch was drawn
         over the planking — a dark nick in the deck at the base of the string. */
      const at=x=>{const s=stationAt(x);return[x, s.sheer-0.05, line(x)+BULWARK];};
      /* The wall runs as a row of short panels so its depth sort stays local to
         each stretch. Each panel used to carry the seam stroke every other face
         gets, and a round join on a panel only 0.55 thick stands proud of the
         timber: the string read as a row of scallops along its top, and at both
         ends the stroke hung past the last panel as a bright nub on the deck.
         The panels are therefore unstroked and overlap their neighbour by 0.35,
         which closes the seams the stroke was carried for. */
      for(let i=0;i<NW;i++){
       const a=at(lerp(x0w,x1w,i/NW)), b=at(lerp(x0w,x1w,(i+1)/NW)+(i<NW-1?dir*0.35:0));
       for(const[y,col,n,bias]of[[yi2,P.top,[0,-side,0],5.35],[yo2,P.dark,[0,side,0],5.3]])
        addFace(F,[[a[0],y,a[1]],[b[0],y,b[1]],[b[0],y,b[2]],[a[0],y,a[2]]],col,n,{tag:"deck",bias,nostroke:true});
       addFace(F,[[a[0],yi2,a[2]],[b[0],yi2,b[2]],[b[0],yo2,b[2]],[a[0],yo2,a[2]]],P.cap,[0,0,1],{tag:"deck",bias:5.4,nostroke:true});
      }
      /* Both end faces look along the run, away from the wall they close: the
         head face into the castle break it butts against — so it is culled from
         the waist, where the break wall itself is what you see — and the foot
         face out over the newel, so that end reads solid from any view that can
         see it. They were the other way round, which laid a pale strip of the
         head face across the break wall and left the newel open. */
      const h=at(x0w);
      addFace(F,[[h[0],yi2,h[1]],[h[0],yo2,h[1]],[h[0],yo2,h[2]],[h[0],yi2,h[2]]],P.cap,[-dir,0,0],{tag:"deck",bias:5.4,nostroke:true});
      const ft=at(x1w);
      addFace(F,[[ft[0],yi2,ft[1]],[ft[0],yi2,ft[2]],[ft[0],yo2,ft[2]],[ft[0],yo2,ft[1]]],P.cap,[dir,0,0],{tag:"deck",bias:5.4,nostroke:true});}
     const profile=[[bx,waist(bx)-0.05]];
     for(let i=0;i<N;i++){const x0=xs(i),x1=xs(i+1);
      profile.push([x0,zs(i)],[x0,zs(i+1)],[x1,zs(i+1)]);}
     profile.push([fx,waist(fx)-0.05]);
     addFace(F,profile.map(p=>[p[0],yi,p[1]]),P.top,[0,-side,0],{tag:"deck",bias:4.9});
     addFace(F,profile.map(p=>[p[0],yo,p[1]]),P.dark,[0,side,0],{tag:"deck",bias:4.9});
    }
   }
  }
 }
 /* The pennant flies from the truck of the tallest mast she has stepped, and
    from nothing if she has none. It used to be pinned to the height the galleon's
    main mast happened to reach, which left it hanging in the sky above a boat
    whose one mast stopped thirty feet below it. */
 {const truck=masts.reduce((a,m)=>(!a||m.top>a.top?m:a),null);
  if(truck){const top=truck.top+0.5,mx=truck.x,len=Math.min(22,(top-truck.deck)*0.33),pts=[];
   for(let i=0;i<=6;i++){const t=i/6;pts.push([mx-t*len,Math.sin(t*4.2)*1.6,top-0.4-t*1.2]);}
   for(let i=6;i>=0;i--){const t=i/6;pts.push([mx-t*len,Math.sin(t*4.2)*1.6,top-3.4+t*1.9]);}
   addFace(F,pts,P.flag,null,{tag:"flag",double:true,back:P.flag});}
  // ensign staff stepped on the taffrail itself, raking aft
  addPrism(F,[-58,0,25.6],[-58,0,37],0.5,0.4,P.wood,"mast");
  const fl=[];for(let i=0;i<=5;i++){const t=i/5;fl.push([-58-t*13,Math.sin(t*3.6)*1.4,36.4]);}
  for(let i=5;i>=0;i--){const t=i/5;fl.push([-58-t*13,Math.sin(t*3.6)*1.4,30.2]);}
  addFace(F,fl,P.flag,null,{tag:"flag",double:true,back:P.flag});
 }
 return F;
}
/* The model is bearing-independent, so it is built once and re-projected per
   frame. It is now built once *per rig*: the menu turns one ship at a time and a
   captain changes hers rarely, so a small cache keyed on the rig means fitting a
   sail costs one rebuild and every frame after it costs nothing. */
/* Both steps are cached, because drawGalleon runs sixty times a second and the
   rig it is handed is the same numbers on every one of them.

   Bounded, because a face list is thousands of objects and a captain rearranging
   her rig in a shipyard produces a fresh key on every single change. KEEP is
   generous next to the handful of ships anyone sails and small enough that the
   worst case is bounded; going over drops the whole cache rather than tracking
   ages, which costs one rebuild of the ship currently on screen and nothing
   else. */
const KEEP=24;
const BUILT=new Map();
const RIGS=new Map();
function cache(map,key,make){
 let v=map.get(key);
 if(v===undefined){if(map.size>=KEEP)map.clear();v=make();map.set(key,v);}
 return v;
}
function rigFor(spec){
 if(!spec) return GALLEON_RIG;
 const key=JSON.stringify(spec);
 return cache(RIGS,key,()=>Object.assign(rigFromSpec(spec),{key}));
}
const facesFor=rig=>cache(BUILT,rig.key||"default",()=>buildShip(rig));

function shade(hex,k){const n=parseInt(hex.slice(1),16),f=c=>Math.min(255,Math.round(c*k));
 return`rgb(${f(n>>16&255)},${f(n>>8&255)},${f(n&255)})`;}
const SPAN=248, NEAR_W=0.35;
/**
 * Draw one frame of a ship, centred in a W x H box at bearing `deg`.
 *
 * `spec` is a shipyard rig spec — what is rigged, from `rigSpec()` in
 * `shipyard.js`. Leave it out and the galleon this file was written around is
 * drawn, which is what the menu did before there was anything else to draw.
 */
function drawGalleon(ctx,W,H,deg,spec){
 const rig=rigFor(spec);
 /* Every rig is drawn at the one size the box was cut for. Classes really do
    differ in size, but a hull is going to be modelled per class rather than
    scaled off this one, so the size comes with the model when it is built. */
 const a=deg*Math.PI/180,ca=Math.cos(a),sa=Math.sin(a),scale=W/SPAN,ox=W/2,oy=H*0.71,items=[];
 for(const f of facesFor(rig)){
  let bias=f.bias||0;
  if(f.cull){const cx=f.cull[0]*ca-f.cull[1]*sa,cy=f.cull[0]*sa+f.cull[1]*ca;
   if(cx*VIEW[0]+cy*VIEW[1]+f.cull[2]*VIEW[2]<(f.cullT??0.32)){
    if(f.biasFar==null)continue;   // no far-side treatment: drop it
    bias=f.biasFar;                // else sink it behind the hull instead
   }}
  let pts=f.pts;
  let n=[f.n[0]*ca-f.n[1]*sa,f.n[0]*sa+f.n[1]*ca,f.n[2]],color=f.color;
  if(n[0]*VIEW[0]+n[1]*VIEW[1]+n[2]*VIEW[2]<=0.0008){if(!f.double)continue;n=n.map(v=>-v);color=f.back||f.color;}
  let depth=0,dmax=-1e9;const proj=[];
  for(const p of pts){const X=p[0]*ca-p[1]*sa,Y=p[0]*sa+p[1]*ca,d=X+Y+p[2];
   depth+=d; if(d>dmax)dmax=d;
   proj.push([ox+(X-Y)*ISO_X*scale,oy+((X+Y)*ISO_Y-p[2])*scale]);}
  /* Sort key: the face centroid pulled toward its NEAREST vertex. A pure
     centroid loses to any long or steeply-raked neighbour; a pure nearest
     vertex lets big deck plates jump in front of the fittings standing on
     them. The blend fixes the first without causing the second. */
  /* Big deck plates opt out of the near-vertex pull (nearW 0): their near corner
     is metres away from their centre, so the blend threw them in front of the
     collars, coamings and stairs standing on them. */
  const mean=depth/pts.length, key=mean+(f.nearW??NEAR_W)*(dmax-mean)-(f.sink??0);
  const lam=n[0]*LIGHT[0]+n[1]*LIGHT[1]+n[2]*LIGHT[2];
  const bright=f.flat!=null?f.flat:(f.amb??0.5)+(f.gain??0.62)*Math.max(0,lam);
  items.push({proj,c:shade(color,bright),d:key+bias,ns:f.nostroke});
 }
 items.sort((p,q)=>p.d-q.d);
 ctx.lineJoin="round";ctx.lineWidth=Math.max(0.6,scale*0.55);
 for(const it of items){ctx.beginPath();ctx.moveTo(it.proj[0][0],it.proj[0][1]);
  for(let i=1;i<it.proj.length;i++)ctx.lineTo(it.proj[i][0],it.proj[i][1]);ctx.closePath();
  ctx.fillStyle=it.c;ctx.fill();
  // coplanar tiles (the hatch grating) skip the seam stroke: at this scale a 2px
  // outline on the neighbouring cell would swallow the black square
  if(!it.ns){ctx.strokeStyle=it.c;ctx.stroke();}}
}

/* The stations this renderer can actually put a mast at. A spec naming any other
   one has that mast quietly left off the ship, which is the right thing to do at
   sixty frames a second and the wrong thing to find out that way: `npm run
   catalogue` checks the whole fleet against this list so a class with a station
   nobody has drawn yet is caught in the catalogue rather than on the menu. */
const RIG_STATIONS = Object.keys(STATION_GEOM);

/* The sail categories this renderer draws in a shape of their own. Anything else
   falls back to a square sail, which is a wrong-looking ship rather than a broken
   one: the bench says which categories are in that position so a rig nobody has
   drawn yet is a known gap rather than a surprise. */
const RIG_KINDS = ["LSQ", "SSQ", "TRI", "LAT"];

/* How many sails this renderer can place up one mast and have them land in
   different places. The bands are generated from the authored profile and the
   number of sails bent on, so this is no longer the three that happen to be
   written down: it is where the squeeze stops being worth drawing, since a stack
   thin enough is a mast wearing stripes. Five is a course, topsail, topgallant,
   royal and skysail, which is the tallest rig the fleet has. The bench holds the
   catalogue to it. */
const RIG_BERTHS = MAX_BERTHS;

/* Where a stack of `n` sails would sit at a station, square canvas and
   fore-and-aft alike, as `{ zb, zt }` in the station's own units. The bench asks
   for this to check that every sail on a mast lands somewhere of its own: a band
   that overlaps the one under it is a sail a captain paid for and cannot see,
   and that is exactly the fault the old clamp produced. */
function rigBands(station, n) {
  const g = STATION_GEOM[station];
  if (!g || n < 1) return null;
  // A spar's sails are spread along it rather than up it, so what has to be
  // distinct is where each one is tacked. Reported as bands so the same check
  // covers both: two sails tacked at one point is two sails in one place.
  if (g.spar) {
    const run = (range) => {
      const w = Math.abs(range[1] - range[0]) / Math.max(1, n) * 0.5;
      return Array.from({ length: n }, (_, i) => {
        const f = lerp(range[0], range[1], n > 1 ? i / (n - 1) : 0);
        return { zb: f - w, zt: f + w };
      }).sort((a, b) => a.zb - b.zb);
    };
    return { square: run(g.slung), tri: run(g.tack) };
  }
  const squares = squareBands(g, n).slice(0, n).map((s) => ({ zb: s.zb, zt: s.zt }));
  const tris = triBands(g, n).slice(0, n).map((b) => ({ zb: b.zb * g.pole, zt: b.zt * g.pole }));
  return { square: squares, tri: tris };
}

export { drawGalleon, RIG_STATIONS, RIG_KINDS, RIG_BERTHS, rigBands };
