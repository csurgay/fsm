// FSM Tool - freely drawn state diagram editor
//
//  double click on the background ... new state
//  drag inside a state .............. move it
//  drag from the rim of a state ..... new transition (drop on a state, on itself = loop,
//                                     on the background = new state + transition)
//  drag a transition / its label .... bend it (a loop: turn it around the state)
//  drag the small initial arrow ..... turn it around, or drop it on another state
//  double click / F2 ................ edit the label,  Del: delete,  right click: menu
"use strict";

const FSM_FONT="14px Arial, Helvetica, sans-serif";
const FSM_LFONT="13px Arial, Helvetica, sans-serif";
const V2 = {
	add:(a,b)=>({x:a.x+b.x,y:a.y+b.y}), sub:(a,b)=>({x:a.x-b.x,y:a.y-b.y}), mul:(a,k)=>({x:a.x*k,y:a.y*k}),
	len:(a)=>Math.hypot(a.x,a.y), norm:(a)=>{ const l=Math.hypot(a.x,a.y)||1; return {x:a.x/l,y:a.y/l}; },
	perp:(a)=>({x:-a.y,y:a.x}), dir:(ang)=>({x:Math.cos(ang),y:Math.sin(ang)}),
};
function cubicAt(g,t) {
	const u=1-t;
	return { x:u*u*u*g.p0.x+3*u*u*t*g.c1.x+3*u*t*t*g.c2.x+t*t*t*g.p1.x,
	         y:u*u*u*g.p0.y+3*u*u*t*g.c1.y+3*u*t*t*g.c2.y+t*t*t*g.p1.y };
}
function distToSeg(p,a,b) {
	const d=V2.sub(b,a), l2=d.x*d.x+d.y*d.y;
	let t=l2?((p.x-a.x)*d.x+(p.y-a.y)*d.y)/l2:0; t=Math.max(0,Math.min(1,t));
	return Math.hypot(p.x-(a.x+t*d.x),p.y-(a.y+t*d.y));
}

class FsmView extends Area {
	constructor() {
		super(0,0,10,10);
		this.class="FsmView";
		this.fill={l:0,t:0,r:0,b:0};
		this.ox=0; this.oy=0; this.z=1;
		this.sel=null;            // {kind:"state"|"trans", id}
		this.connect=null;        // {from, p, target}
		this.initDrag=null;       // {p, target}
		this.onSelect=null;
		this.highlight=()=>({});  // simulation: {active, lastTrans, nextTrans, stuck}
	}
	/* ---------------- geometry (diagram coordinates) ---------------- */
	size(s) {
		ctx.font=FSM_FONT;
		const lines=String(s.label).split("\n");
		const w=Math.max(...lines.map(l=>ctx.measureText(l).width));
		return { rx:Math.max(40,w/2+22), ry:Math.max(26,lines.length*9+15) };
	}
	boundary(s,d) {                 // point on the ellipse of s in direction d
		const {rx,ry}=this.size(s);
		const n=V2.norm(d);
		const k=1/Math.sqrt((n.x/rx)**2+(n.y/ry)**2);
		return { x:s.x+n.x*k, y:s.y+n.y*k };
	}
	ellipseDist(s,p) { const {rx,ry}=this.size(s); return Math.sqrt(((p.x-s.x)/rx)**2+((p.y-s.y)/ry)**2); }
	autoBend(t) {
		if (t.bend) return t.bend;
		const rev=Fsm.fsm.transitions.some(x=>x.from===t.to && x.to===t.from && x.id!==t.id);
		return rev ? 24 : 0;
	}
	geom(t) {
		const A=Fsm.state(t.from), B=Fsm.state(t.to);
		if (!A || !B) return null;
		if (A===B) {
			const th=t.loopAngle, sp=0.42, dist=62;
			const pA=this.boundary(A,V2.dir(th-sp)), pB=this.boundary(A,V2.dir(th+sp));
			const g={ p0:pA, c1:V2.add(pA,V2.mul(V2.dir(th-sp),dist)), c2:V2.add(pB,V2.mul(V2.dir(th+sp),dist)), p1:pB, loop:true };
			g.mid=cubicAt(g,0.5);
			g.normal=V2.dir(th);
			return g;
		}
		const a={x:A.x,y:A.y}, b={x:B.x,y:B.y};
		const bend=this.autoBend(t);
		const n=V2.norm(V2.perp(V2.sub(b,a)));
		const ctrl=V2.add(V2.mul(V2.add(a,b),0.5),V2.mul(n,bend*2));
		const p0=this.boundary(A,bend?V2.sub(ctrl,a):V2.sub(b,a));
		const p1=this.boundary(B,bend?V2.sub(ctrl,b):V2.sub(a,b));
		const g={ p0, c1:V2.add(p0,V2.mul(V2.sub(ctrl,p0),2/3)), c2:V2.add(p1,V2.mul(V2.sub(ctrl,p1),2/3)), p1, loop:false };
		g.mid=cubicAt(g,0.5);
		g.normal=n;
		return g;
	}
	labelBox(t,g) {
		const parts=this.labelParts(t);
		ctx.font=FSM_LFONT;
		const w=parts.reduce((s,p)=>s+ctx.measureText(p.text).width,0)+10, h=18;
		let c=g.mid;
		if (g.loop) c=V2.add(g.mid,V2.mul(g.normal,14));
		return { x:c.x-w/2, y:c.y-h/2, w, h, parts };
	}
	labelParts(t) {
		const out=[];
		out.push({text:t.event||"?",color:t.event?"#15181c":"#c01818"});
		if (t.guard && t.guard.trim()) out.push({text:" ["+t.guard.trim()+"]",color:"#6a3d9a"});
		if (t.action && t.action.trim()) out.push({text:" / "+t.action.trim(),color:"#2c6e2c"});
		return out;
	}
	initGeom(s) {
		const d=V2.dir(Fsm.fsm.initAngle);
		const head=this.boundary(s,d);
		return { head, tail:V2.add(head,V2.mul(d,34)) };
	}
	toDiagram(px,py) { this.absolute(); return { x:(px-this.ax-this.ox)/this.z, y:(py-this.ay-this.oy)/this.z }; }
	toScreen(p) { this.absolute(); return { x:this.ax+this.ox+p.x*this.z, y:this.ay+this.oy+p.y*this.z }; }

	/* ---------------- hit testing ---------------- */
	hitTest(p) {
		const f=Fsm.fsm; if (!f) return null;
		const tol=7/this.z;
		const ini=f.initial && Fsm.state(f.initial);
		if (ini) { const ig=this.initGeom(ini); if (distToSeg(p,ig.tail,V2.add(ig.head,V2.mul(V2.norm(V2.sub(ig.tail,ig.head)),6)))<tol) return {kind:"init"}; }
		for (let i=f.transitions.length-1;i>=0;i--) {
			const t=f.transitions[i], g=this.geom(t); if (!g) continue;
			const lb=this.labelBox(t,g);
			if (p.x>=lb.x-2 && p.x<=lb.x+lb.w+2 && p.y>=lb.y-2 && p.y<=lb.y+lb.h+2) return {kind:"trans",id:t.id,obj:t,label:true};
		}
		for (let i=f.states.length-1;i>=0;i--) {
			const s=f.states[i], d=this.ellipseDist(s,p);
			if (d<=1.12) return {kind:"state",id:s.id,obj:s,rim:d>0.72};
		}
		for (let i=f.transitions.length-1;i>=0;i--) {
			const t=f.transitions[i], g=this.geom(t); if (!g) continue;
			let prev=g.p0;
			for (let k=1;k<=24;k++) { const q=cubicAt(g,k/24); if (distToSeg(p,prev,q)<tol) return {kind:"trans",id:t.id,obj:t}; prev=q; }
		}
		return null;
	}
	stateAt(p) { const f=Fsm.fsm; for (let i=f.states.length-1;i>=0;i--) if (this.ellipseDist(f.states[i],p)<=1.12) return f.states[i]; return null; }

	/* ---------------- painting ---------------- */
	paint() {
		c.fillRect(this.ax,this.ay,this.w,this.h,"#ffffff");
		// light dot grid
		const step=20*this.z;
		if (step>=8) {
			ctx.fillStyle="#e3e7ec";
			const x0=this.ax+((this.ox%step)+step)%step, y0=this.ay+((this.oy%step)+step)%step;
			for (let x=x0;x<this.ax+this.w;x+=step) for (let y=y0;y<this.ay+this.h;y+=step) ctx.fillRect(x-0.75,y-0.75,1.5,1.5);
		}
		const f=Fsm.fsm; if (!f) return;
		const hl=this.highlight()||{};
		ctx.save();
		ctx.translate(this.ax+this.ox,this.ay+this.oy);
		ctx.scale(this.z,this.z);
		// transitions
		f.transitions.forEach(t=>{
			const g=this.geom(t); if (!g) return;
			const sel=this.sel && this.sel.kind==="trans" && this.sel.id===t.id;
			let col="#2b3036", lw=1.4, dash=[];
			if (t.id===hl.nextTrans) { col="#e0a100"; lw=2; dash=[6,4]; }
			if (t.id===hl.lastTrans) { col="#d97a00"; lw=3; }
			if (sel) { col=THEME.select; lw=Math.max(lw,2.4); }
			ctx.strokeStyle=col; ctx.lineWidth=lw; ctx.setLineDash(dash);
			ctx.beginPath(); ctx.moveTo(g.p0.x,g.p0.y); ctx.bezierCurveTo(g.c1.x,g.c1.y,g.c2.x,g.c2.y,g.p1.x,g.p1.y); ctx.stroke();
			ctx.setLineDash([]);
			this.arrowHead(g.p1,V2.sub(g.p1,g.c2),col,lw>2?12:10);
			const lb=this.labelBox(t,g);
			ctx.fillStyle=sel?"#e6effb":"rgba(255,255,255,0.92)";
			ctx.fillRect(lb.x,lb.y,lb.w,lb.h);
			if (sel||t.id===hl.lastTrans) { ctx.strokeStyle=col; ctx.lineWidth=1; ctx.strokeRect(lb.x+0.5,lb.y+0.5,lb.w-1,lb.h-1); }
			ctx.font=FSM_LFONT; ctx.textAlign="left"; ctx.textBaseline="middle";
			let x=lb.x+5;
			lb.parts.forEach(pt=>{ ctx.fillStyle=pt.color; ctx.fillText(pt.text,x,lb.y+lb.h/2+1); x+=ctx.measureText(pt.text).width; });
		});
		// states
		f.states.forEach(s=>{
			const {rx,ry}=this.size(s);
			const sel=this.sel && this.sel.kind==="state" && this.sel.id===s.id;
			let fill="#ffffff", stroke="#1d2126", lw=1.6;
			if (this.connect && this.connect.target===s) fill="#e3f0ff";
			if (this.initDrag && this.initDrag.target===s) fill="#e3f0ff";
			if (s.id===hl.active) { fill=hl.stuck?"#ffd6d6":hl.accepted?"#d7f0d2":"#ffe58a"; stroke=hl.stuck?"#c01818":hl.accepted?"#2c6e2c":"#b07d00"; lw=3; }
			if (sel) { stroke=THEME.select; lw=Math.max(lw,2.6); }
			ctx.beginPath(); ctx.ellipse(s.x,s.y,rx,ry,0,0,Math.PI*2);
			ctx.fillStyle=fill; ctx.fill();
			ctx.strokeStyle=stroke; ctx.lineWidth=lw; ctx.stroke();
			if (s.accepting) { ctx.beginPath(); ctx.ellipse(s.x,s.y,rx-5,ry-5,0,0,Math.PI*2); ctx.lineWidth=1.3; ctx.stroke(); }
			const lines=String(s.label).split("\n");
			ctx.font=FSM_FONT; ctx.fillStyle="#15181c"; ctx.textAlign="center"; ctx.textBaseline="middle";
			lines.forEach((l,i)=>ctx.fillText(l,s.x,s.y+(i-(lines.length-1)/2)*17+1));
		});
		// initial arrow
		const ini=f.initial && Fsm.state(f.initial);
		if (ini && !this.initDrag) {
			const ig=this.initGeom(ini);
			const sel=this.sel && this.sel.kind==="init";
			this.initArrow(ig.tail,ig.head,sel?THEME.select:"#1d2126");
		}
		if (this.initDrag) {
			const tg=this.initDrag.target;
			if (tg && tg!==ini) { const ig=this.initGeom(tg); this.initArrow(ig.tail,ig.head,THEME.select); }
			else if (ini) {
				const d=V2.sub(this.initDrag.p,{x:ini.x,y:ini.y});
				const head=this.boundary(ini,d);
				this.initArrow(V2.add(head,V2.mul(V2.norm(d),34)),head,THEME.select);
			}
		}
		// transition being drawn
		if (this.connect) {
			const cn=this.connect, s=cn.from;
			let end=cn.p, start;
			if (cn.target && cn.target!==s) { end=this.boundary(cn.target,V2.sub(s,cn.target)); start=this.boundary(s,V2.sub(cn.target,s)); }
			else start=this.boundary(s,V2.sub(cn.p,s));
			ctx.strokeStyle=THEME.select; ctx.lineWidth=2; ctx.setLineDash([6,4]);
			ctx.beginPath(); ctx.moveTo(start.x,start.y); ctx.lineTo(end.x,end.y); ctx.stroke(); ctx.setLineDash([]);
			this.arrowHead(end,V2.sub(end,start),THEME.select,10);
		}
		ctx.restore();
		if (!f.states.length) {
			c.fillText("Double click: new state   ·   drag from the rim of a state: new transition",this.ax+this.w/2,this.ay+this.h/2,"center",THEME.textDim);
		}
		if (this.z!==1) c.fillText(Math.round(this.z*100)+"%",this.ax+this.w-22,this.ay+this.h-10,"right",THEME.textDim,THEME.fontSmall);
	}
	arrowHead(p,d,col,size=10) {
		const n=V2.norm(d), q=V2.perp(n);
		ctx.fillStyle=col;
		ctx.beginPath();
		ctx.moveTo(p.x,p.y);
		ctx.lineTo(p.x-n.x*size+q.x*size*0.42,p.y-n.y*size+q.y*size*0.42);
		ctx.lineTo(p.x-n.x*size-q.x*size*0.42,p.y-n.y*size-q.y*size*0.42);
		ctx.closePath(); ctx.fill();
	}
	initArrow(tail,head,col) {
		ctx.strokeStyle=col; ctx.lineWidth=2;
		ctx.beginPath(); ctx.moveTo(tail.x,tail.y); ctx.lineTo(head.x,head.y); ctx.stroke();
		this.arrowHead(head,V2.sub(head,tail),col,10);
		ctx.beginPath(); ctx.arc(tail.x,tail.y,3.5,0,Math.PI*2); ctx.fillStyle=col; ctx.fill();
	}

	/* ---------------- interaction ---------------- */
	select(sel) {
		this.sel=sel;
		if (this.onSelect) this.onSelect(sel);
		invalidate();
	}
	selected() {
		if (!this.sel) return null;
		if (this.sel.kind==="state") return Fsm.state(this.sel.id);
		if (this.sel.kind==="trans") return Fsm.trans(this.sel.id);
		return null;
	}
	doEdit(label,fn) {
		try { return Fsm.edit(label,fn); }
		catch(e) { WM.message("Error",e.message); return false; }
	}
	processEvent(pevt) {
		if (pevt.type===e_wheel) {
			if (pevt.ctrl) this.zoomAt(pevt.x,pevt.y,pevt.deltaY<0?1.1:1/1.1);
			else if (pevt.shift) { this.ox-=pevt.deltaY; invalidate(); }
			else { this.ox-=pevt.deltaX; this.oy-=pevt.deltaY; invalidate(); }
			return true;
		}
		const p=this.toDiagram(pevt.x,pevt.y);
		const h=this.hitTest(p);
		if (pevt.type===e_move && !WM.capture) {
			canvas.style.cursor = !h ? "default" : h.kind==="init" ? "grab" : h.kind==="state" ? (h.rim||pevt.shift ? "crosshair" : "move") : "pointer";
			return true;
		}
		if (pevt.type===e_down && pevt.button===0) { this.mouseDown(h,p,pevt); return true; }
		if (pevt.type===e_down && pevt.button===1) { this.pan(pevt); return true; }
		if (pevt.type===e_dbl) {
			if (!h) {
				const s=this.doEdit("state",()=>Fsm.addState(p.x,p.y));
				if (s) { this.select({kind:"state",id:s.id}); this.editLabel(s); }
			}
			else if (h.kind==="state") this.editLabel(h.obj);
			else if (h.kind==="trans") this.editLabel(h.obj);
			return true;
		}
		if (pevt.type===e_ctx) { this.contextMenu(h,p,pevt); return true; }
		return false;
	}
	pan(pevt) {
		const sx=pevt.x, sy=pevt.y, ox=this.ox, oy=this.oy;
		WM.setCapture({ cursor:"grabbing", move:(e)=>{ this.ox=ox+e.x-sx; this.oy=oy+e.y-sy; }, up:()=>{} });
	}
	mouseDown(h,p,pevt) {
		WM.lastView=this;
		if (!h) { this.select(null); this.pan(pevt); return; }
		if (h.kind==="init") {
			this.select({kind:"init"});
			this.initDrag={p,target:null};
			WM.setCapture({ cursor:"grabbing",
				move:(e)=>{ const q=this.toDiagram(e.x,e.y); this.initDrag.p=q; this.initDrag.target=this.stateAt(q); },
				up:(e)=>{
					const q=this.toDiagram(e.x,e.y), cur=Fsm.state(Fsm.fsm.initial), on=this.stateAt(q);
					this.initDrag=null;
					if (on && on!==cur) { this.doEdit("initial",()=>{ Fsm.fsm.initial=on.id; }); return; }   // moved to another state, same side
					if (!cur) return;
					const d=V2.sub(q,cur);                           // turned around the same state
					if (V2.len(d)<3) return;
					this.doEdit("initial",()=>{ Fsm.fsm.initAngle=Math.round(Math.atan2(d.y,d.x)*100)/100; });
				} });
			return;
		}
		if (h.kind==="state") {
			const s=h.obj;
			this.select({kind:"state",id:s.id});
			if (h.rim || pevt.shift) {        // draw a new transition
				this.connect={from:s,p,target:null,moved:false};
				WM.setCapture({ cursor:"crosshair",
					move:(e)=>{
						const q=this.toDiagram(e.x,e.y);
						this.connect.p=q;
						if (!this.connect.moved && V2.len(V2.sub(q,p))>6) this.connect.moved=true;
						const tg=this.stateAt(q);
						this.connect.target = tg===s && !this.connect.left ? null : tg;
						if (!tg) this.connect.left=true;         // left the source: dropping back = loop
					},
					up:(e)=>{
						const cn=this.connect; this.connect=null;
						if (!cn.moved) return;
						const q=this.toDiagram(e.x,e.y);
						let tg=this.stateAt(q);
						if (tg===s && !cn.left) return;
						const t=this.doEdit("transition",()=>{
							if (!tg) tg=Fsm.addState(q.x,q.y);
							const t=Fsm.addTransition(s.id,tg.id,"");
							if (tg===s) t.loopAngle=Math.round(Math.atan2(q.y-s.y,q.x-s.x)*100)/100;
							return t;
						});
						if (t) { this.select({kind:"trans",id:t.id}); setTimeout(()=>this.editLabel(Fsm.trans(t.id)),0); }
					} });
				return;
			}
			// move the state
			const sx=s.x, sy=s.y;
			Fsm.beginDrag();
			WM.setCapture({ cursor:"move",
				move:(e)=>{ const q=this.toDiagram(e.x,e.y); const st=Fsm.state(s.id); if (st) { st.x=Math.round(sx+q.x-p.x); st.y=Math.round(sy+q.y-p.y); } },
				up:()=>Fsm.endDrag() });
			return;
		}
		if (h.kind==="trans") {
			const t=h.obj;
			this.select({kind:"trans",id:t.id});
			Fsm.beginDrag();
			WM.setCapture({ cursor:"grabbing",
				move:(e)=>{
					const q=this.toDiagram(e.x,e.y), tt=Fsm.trans(t.id); if (!tt) return;
					const A=Fsm.state(tt.from), B=Fsm.state(tt.to);
					if (A===B) tt.loopAngle=Math.round(Math.atan2(q.y-A.y,q.x-A.x)*100)/100;
					else {
						const n=V2.norm(V2.perp(V2.sub(B,A))), mid=V2.mul(V2.add(A,B),0.5);
						let b=(q.x-mid.x)*n.x+(q.y-mid.y)*n.y;
						if (Math.abs(b)<6) b=0;
						tt.bend=Math.round(b);
					}
				},
				up:()=>Fsm.endDrag() });
		}
	}
	editLabel(o) {
		if (!o) return;
		const isState=!!Fsm.state(o.id);
		let box;
		if (isState) {
			const {rx,ry}=this.size(o);
			const tl=this.toScreen({x:o.x-rx,y:o.y-ry});
			box={ x:tl.x, y:tl.y+ry*this.z-Math.max(26,ry*this.z*0.8)/2, w:Math.max(120,2*rx*this.z), h:Math.max(26,ry*this.z*0.8) };
			if (String(o.label).includes("\n")) box={ x:tl.x, y:tl.y, w:Math.max(120,2*rx*this.z), h:Math.max(40,2*ry*this.z) };
		}
		else {
			const g=this.geom(o), lb=this.labelBox(o,g);
			const tl=this.toScreen({x:lb.x+lb.w/2,y:lb.y});
			const w=Math.max(200,lb.w*this.z+40);
			box={ x:tl.x-w/2, y:tl.y-4, w, h:28 };
		}
		WM.editText({
			owner:this, x:box.x, y:box.y, w:box.w, h:box.h, align:"center", font:isState?FSM_FONT:FSM_LFONT,
			multiline:isState && String(o.label).includes("\n"),
			value:isState?o.label:Fsm.labelOf(o).replace(/^ε\?$/,""),
			onCommit:(v)=>{
				if (isState) { v=v.trim(); if (!v || v===o.label) return; this.doEdit("label",()=>{ const s=Fsm.state(o.id); if (s) s.label=v; }); }
				else this.doEdit("label",()=>{ const t=Fsm.trans(o.id); if (t) Fsm.setLabel(t,v); });
			},
		});
	}
	deleteSelected() {
		const s=this.sel; if (!s) return;
		if (s.kind==="state") this.doEdit("delete",()=>Fsm.deleteState(s.id));
		if (s.kind==="trans") this.doEdit("delete",()=>Fsm.deleteTransition(s.id));
		this.select(null);
	}
	toggleAccepting(id) { this.doEdit("accepting",()=>{ const s=Fsm.state(id); if (s) s.accepting=!s.accepting; }); }
	setInitial(id) { this.doEdit("initial",()=>{ Fsm.fsm.initial=id; }); }
	contextMenu(h,p,pevt) {
		const items=[];
		if (!h) {
			items.push({caption:"New state here",action:()=>{ const s=this.doEdit("state",()=>Fsm.addState(p.x,p.y)); if (s) { this.select({kind:"state",id:s.id}); this.editLabel(s); } }});
			items.push("-");
			items.push({caption:"Fit to window",action:()=>this.fit(),key:"0"});
			items.push({caption:"Zoom 100%",action:()=>{ this.z=1; invalidate(); }});
		}
		else if (h.kind==="state") {
			const s=h.obj;
			this.select({kind:"state",id:s.id});
			items.push({caption:"Edit label",action:()=>this.editLabel(s),key:"F2"});
			items.push({caption:"Accepting state",checked:()=>s.accepting,action:()=>this.toggleAccepting(s.id),key:"A"});
			items.push({caption:"Initial state",checked:()=>Fsm.fsm.initial===s.id,action:()=>this.setInitial(s.id),key:"I"});
			items.push("-");
			items.push({caption:"Delete state",action:()=>this.deleteSelected(),key:"Del"});
		}
		else if (h.kind==="trans") {
			const t=h.obj;
			this.select({kind:"trans",id:t.id});
			items.push({caption:"Edit label  (event [guard] / action)",action:()=>this.editLabel(t),key:"F2"});
			items.push({caption:"Straighten",enabled:()=>t.from!==t.to,action:()=>this.doEdit("bend",()=>{ const tt=Fsm.trans(t.id); tt.bend=0; })});
			items.push({caption:"Reverse direction",action:()=>this.doEdit("reverse",()=>{ const tt=Fsm.trans(t.id); [tt.from,tt.to]=[tt.to,tt.from]; })});
			items.push("-");
			items.push({caption:"Delete transition",action:()=>this.deleteSelected(),key:"Del"});
		}
		else if (h.kind==="init") {
			items.push({caption:"Drag the arrow onto another state",enabled:()=>false});
		}
		popupMenu(items,pevt.x,pevt.y);
	}
	onKey(k) {
		const o=this.selected();
		if ((k.key==="Delete"||k.key==="Backspace") && o) { this.deleteSelected(); return true; }
		if ((k.key==="F2"||k.key==="Enter") && o) { this.editLabel(o); return true; }
		if ((k.key==="a"||k.key==="A") && !k.ctrlKey && !k.metaKey && this.sel && this.sel.kind==="state") { this.toggleAccepting(this.sel.id); return true; }
		if ((k.key==="i"||k.key==="I") && !k.ctrlKey && !k.metaKey && this.sel && this.sel.kind==="state") { this.setInitial(this.sel.id); return true; }
		if (k.key==="+"||k.key==="=") { this.zoomAt(this.ax+this.w/2,this.ay+this.h/2,1.15); return true; }
		if (k.key==="-") { this.zoomAt(this.ax+this.w/2,this.ay+this.h/2,1/1.15); return true; }
		if (k.key==="0") { this.fit(); return true; }
		return false;
	}
	zoomAt(px,py,f) {
		const d=this.toDiagram(px,py);
		this.z=Math.max(0.3,Math.min(3,this.z*f));
		this.absolute();
		this.ox=px-this.ax-d.x*this.z; this.oy=py-this.ay-d.y*this.z;
		invalidate();
	}
	bounds() {
		const f=Fsm.fsm; if (!f || !f.states.length) return null;
		let x0=1e9,y0=1e9,x1=-1e9,y1=-1e9;
		const add=(p)=>{ x0=Math.min(x0,p.x); y0=Math.min(y0,p.y); x1=Math.max(x1,p.x); y1=Math.max(y1,p.y); };
		f.states.forEach(s=>{ const {rx,ry}=this.size(s); add({x:s.x-rx,y:s.y-ry}); add({x:s.x+rx,y:s.y+ry}); });
		f.transitions.forEach(t=>{ const g=this.geom(t); if (!g) return; const lb=this.labelBox(t,g); add(g.mid); add({x:lb.x,y:lb.y}); add({x:lb.x+lb.w,y:lb.y+lb.h}); if (g.loop) { add(g.c1); add(g.c2); } });
		const ini=f.initial && Fsm.state(f.initial); if (ini) add(this.initGeom(ini).tail);
		return {x0,y0,x1,y1};
	}
	fit() {
		const b=this.bounds(); if (!b) { this.z=1; this.ox=0; this.oy=0; invalidate(); return; }
		const m=40, w=b.x1-b.x0+2*m, h=b.y1-b.y0+2*m;
		this.z=Math.max(0.3,Math.min(1.6,Math.min(this.w/w,this.h/h)));
		this.ox=(this.w-(b.x1+b.x0)*this.z)/2; this.oy=(this.h-(b.y1+b.y0)*this.z)/2;
		invalidate();
	}
}

class DiagramWindow extends Window {
	constructor(prect) {
		super("",prect,CLOSABLE,RESIZABLE,{minW:240,minH:160});
		this.class="DiagramWindow";
		this.title=()=>"State diagram – "+(Fsm.fsm?Fsm.fsm.name:"");
		this.view=this.push(new FsmView());
		this.layout();
	}
	onKey(k) { return this.view.onKey(k); }
}
