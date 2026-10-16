// SDL Design Tool - canvas window manager
// 2019-2026 Peter Csurgay
//
// Every visible thing is an Area in one tree:
//   WM.root (Workspace window) -> TitleBar / MenuBar / ClientArea -> child Windows -> ...
//   WM.overlay: popups, context menus, drag ghosts, signal animations (always on top)
// Coordinates of a child are relative to its father; absolute() computes ax,ay.
// Rendering: any change calls invalidate(), the whole tree is redrawn in the next
// animation frame (painter's algorithm + clipping => upper windows are never overdrawn).
"use strict";

const ddx=100, ddy=40, ddpad=16, ddhead=20;
const HORIZ="HORIZ", VERT="VERT";
const CLOSABLE="CLOSABLE", NOTCLOSABLE="NOTCLOSABLE";
const RESIZABLE="RESIZABLE", NOTRESIZABLE="NOTRESIZABLE";
const DEBUG=0;

var canvas=null, ctx=null, c=null, DPR=1;
function initCanvas(pid) {
	canvas=document.getElementById(pid);
	ctx=canvas.getContext("2d");
	c=new CanvasContext();
	fitCanvas();
}
function fitCanvas() {
	DPR=window.devicePixelRatio||1;
	const w=window.innerWidth, h=window.innerHeight;
	canvas.style.width=w+"px"; canvas.style.height=h+"px";
	canvas.width=Math.round(w*DPR); canvas.height=Math.round(h*DPR);
	ctx.setTransform(DPR,0,0,DPR,0,0);
}

const THEME = {
	font: "13px Arial, Helvetica, sans-serif",
	fontBold: "bold 13px Arial, Helvetica, sans-serif",
	fontSmall: "11px Arial, Helvetica, sans-serif",
	fontMono: "12px Consolas, 'Courier New', monospace",
	desk: "#e4e7eb",
	win: "#fbfbfc",
	border: "#7d8591",
	title: "#d5dae1",
	titleActive: "#3b6ea5",
	titleText: "#2a2f36",
	titleTextActive: "#ffffff",
	menu: "#eef0f3",
	menuHi: "#3b6ea5",
	menuHiText: "#ffffff",
	text: "#15181c",
	textDim: "#8a9099",
	button: "#e9ecf0",
	buttonHi: "#dce6f3",
	buttonDown: "#c3d3e8",
	select: "#1e6fd9",
	shadow: "rgba(0,0,0,0.18)",
};

/* ------------------------------------------------------------------ */
/* basic tree node (was: class Object - that name shadowed JS Object)  */
/* ------------------------------------------------------------------ */
class WNode {
	constructor(pname="noname") {
		checkString(this,pname);
		this.class="WNode";
		this.name=pname;
		this.father=null;
		this.children=[];
	}
	push(child) {
		if (child.father) child.father.remove(child);
		this.children.push(child);
		child.father=this;
		return child;
	}
	remove(child) {
		const i=this.children.indexOf(child);
		if (i>=0) this.children.splice(i,1);
		child.father=null;
	}
	isDescendantOf(o) {
		for (let f=this; f; f=f.father) if (f===o) return true;
		return false;
	}
}

/* ------------------------------------------------------------------ */
/* all drawing primitives in one place (kept from 2019 version)        */
/* ------------------------------------------------------------------ */
class CanvasContext extends WNode {
	constructor() { super("CanvasContext"); }
	defaultStyle() {
		ctx.beginPath();
		ctx.lineWidth=1;
		ctx.strokeStyle="#000000";
		ctx.fillStyle="#000000";
		ctx.globalAlpha=1;
		ctx.setLineDash([]);
	}
	multiLine(px,py,...pts) {
		this.defaultStyle();
		ctx.moveTo(px,py);
		for (let i=0;i+1<pts.length;i+=2) ctx.lineTo(pts[i],pts[i+1]);
		ctx.stroke();
	}
	line(px,py,pw,ph,color="#000") {
		this.defaultStyle();
		ctx.strokeStyle=color;
		ctx.moveTo(px,py);
		ctx.lineTo(px+pw,py+ph);
		ctx.stroke();
	}
	rect(px,py,pw,ph,color="#000",lw=1) {
		this.defaultStyle();
		ctx.strokeStyle=color; ctx.lineWidth=lw;
		ctx.strokeRect(px,py,pw,ph);
	}
	fillRect(px,py,pw,ph,color="#000") {
		this.defaultStyle();
		ctx.fillStyle=color;
		ctx.fillRect(px,py,pw,ph);
	}
	roundRect(px,py,pw,ph,r,fill,stroke) {
		this.defaultStyle();
		ctx.moveTo(px+r,py);
		ctx.arcTo(px+pw,py,px+pw,py+ph,r);
		ctx.arcTo(px+pw,py+ph,px,py+ph,r);
		ctx.arcTo(px,py+ph,px,py,r);
		ctx.arcTo(px,py,px+pw,py,r);
		ctx.closePath();
		if (fill) { ctx.fillStyle=fill; ctx.fill(); }
		if (stroke) { ctx.strokeStyle=stroke; ctx.stroke(); }
	}
	debugRect(px,py,pw,ph) { this.rect(px,py,pw,ph,"#FF0000",2); }
	clearRect(px,py,pw,ph) { ctx.clearRect(px,py,pw,ph); }
	fillText(ptext,px,py,palign="left",color=THEME.text,font=THEME.font) {
		this.defaultStyle();
		ctx.font=font;
		ctx.textAlign=palign;
		ctx.textBaseline="middle";
		ctx.fillStyle=color;
		ctx.fillText(ptext,px,py);
	}
	// text clipped with ellipsis to maxw
	fitText(ptext,px,py,maxw,palign="left",color=THEME.text,font=THEME.font) {
		ctx.font=font;
		let t=String(ptext);
		if (ctx.measureText(t).width>maxw) {
			while (t.length>0 && ctx.measureText(t+"…").width>maxw) t=t.slice(0,-1);
			t+="…";
		}
		this.fillText(t,px,py,palign,color,font);
	}
	measure(ptext,font=THEME.font) {
		ctx.font=font;
		return ctx.measureText(String(ptext)).width;
	}
	triangleUp(px,py,pw,ph,color="#000") {
		this.defaultStyle(); ctx.fillStyle=color;
		ctx.moveTo(px+pw/2-4,py+ph/2+2); ctx.lineTo(px+pw/2+4,py+ph/2+2); ctx.lineTo(px+pw/2,py+ph/2-3);
		ctx.closePath(); ctx.fill();
	}
	triangleDown(px,py,pw,ph,color="#000") {
		this.defaultStyle(); ctx.fillStyle=color;
		ctx.moveTo(px+pw/2-4,py+ph/2-2); ctx.lineTo(px+pw/2+4,py+ph/2-2); ctx.lineTo(px+pw/2,py+ph/2+3);
		ctx.closePath(); ctx.fill();
	}
	cross(px,py,pw,ph,color="#000") {
		this.defaultStyle(); ctx.strokeStyle=color; ctx.lineWidth=1.5;
		const cx=px+pw/2, cy=py+ph/2;
		ctx.moveTo(cx-4,cy-4); ctx.lineTo(cx+4,cy+4);
		ctx.moveTo(cx+4,cy-4); ctx.lineTo(cx-4,cy+4);
		ctx.stroke();
	}
}

/* ------------------------------------------------------------------ */
class Rect extends WNode {
	constructor(px=0,py=0,pw=0,ph=0) {
		super();
		this.class="Rect";
		checkInteger(this,px); checkInteger(this,py);
		checkInteger(this,pw); checkInteger(this,ph);
		this.x=px; this.y=py; this.w=pw; this.h=ph;
		this.ax=px; this.ay=py;
	}
	set(px,py,pw,ph) { this.x=px; this.y=py; this.w=pw; this.h=ph; }
	absolute() {
		this.ax=this.fatherx()+this.x;
		this.ay=this.fathery()+this.y;
	}
	fatherx() { return this.father ? this.father.x+this.father.fatherx() : 0; }
	fathery() { return this.father ? this.father.y+this.father.fathery() : 0; }
	contains(px,py) {
		this.absolute();
		return px>=this.ax && px<this.ax+this.w && py>=this.ay && py<this.ay+this.h;
	}
}

/* ------------------------------------------------------------------ */
const e_down="Down", e_up="Up", e_move="Move", e_dbl="Dbl", e_ctx="Ctx", e_wheel="Wheel";

class WEvent extends WNode {
	constructor(px,py,ptype,src={}) {
		super();
		this.class="Event";
		this.x=px; this.y=py; this.type=ptype; this.seen=false;
		this.button=src.button||0;
		this.shift=!!src.shiftKey; this.ctrl=!!(src.ctrlKey||src.metaKey); this.alt=!!src.altKey;
		this.deltaX=src.deltaX||0; this.deltaY=src.deltaY||0;
	}
}

/* ------------------------------------------------------------------ */
/* Area: a rectangle with children, clipping, event dispatch            */
/* ------------------------------------------------------------------ */
class Area extends Rect {
	constructor(px,py,pw,ph) {
		super(px,py,pw,ph);
		this.class="Area";
		this.visible=true;
		this.cursor=null;     // css cursor when hovering
		this.tooltip=null;
	}
	treeVisible() {
		return this.father==null ? this.visible : this.visible && this.father.treeVisible();
	}
	bringFwd(o) {
		const i=this.children.indexOf(o);
		if (i>=0 && i!==this.children.length-1) {
			this.children.splice(i,1);
			this.children.push(o);
			invalidate();
		}
	}
	// hit test: deepest visible area under the point (topmost child first)
	hit(px,py) {
		if (!this.visible || !this.contains(px,py)) return null;
		for (let i=this.children.length-1;i>=0;i--) {
			const h=this.children[i].hit ? this.children[i].hit(px,py) : null;
			if (h) return h;
		}
		return this;
	}
	// only the topmost child under the mouse gets the event; returns true if consumed
	dispatch(pevt) {
		if (!this.visible) return false;
		for (let i=this.children.length-1;i>=0;i--) {
			const ch=this.children[i];
			if (ch.visible && ch.dispatch && ch.contains(pevt.x,pevt.y)) {
				if (ch.dispatch(pevt)) return true;
				break;
			}
		}
		return this.processEvent(pevt)===true;
	}
	processEvent(pevt) { return false; }
	onKey(kevt) { return false; }
	layout() {}
	draw() {
		if (!this.visible) return;
		this.absolute();
		ctx.save();
		ctx.beginPath();
		ctx.rect(this.ax,this.ay,this.w,this.h);
		ctx.clip();
		this.paint();
		this.children.forEach(ch=>{ if (ch.visible) ch.draw(); });
		this.paintOver();
		ctx.restore();
		if (DEBUG) c.debugRect(this.ax,this.ay,this.w,this.h);
	}
	paint() {}
	paintOver() {}
	isHover() { return WM.hover===this; }
}

/* ------------------------------------------------------------------ */
/* small widgets                                                        */
/* ------------------------------------------------------------------ */
class Button extends Area {
	constructor(pcaption,px,py,pw,ph,pcallback,opts={}) {
		super(px,py,pw||Math.ceil(c.measure(pcaption))+20,ph||22);
		this.class="Button";
		this.caption=pcaption;
		this.callback=pcallback;
		this.pressed=false;
		this.enabled=opts.enabled||null;   // function -> bool
		this.toggled=opts.toggled||null;   // function -> bool
		this.tooltip=opts.tooltip||null;
		this.cursor="pointer";
	}
	isEnabled() { return this.enabled ? this.enabled() : true; }
	paint() {
		const en=this.isEnabled();
		let bg=THEME.button;
		if (this.toggled && this.toggled()) bg=THEME.buttonDown;
		if (en && this.isHover()) bg=THEME.buttonHi;
		if (this.pressed) bg=THEME.buttonDown;
		c.roundRect(this.ax+0.5,this.ay+0.5,this.w-1,this.h-1,3,bg,"#9aa3ad");
		c.fitText(this.caption,this.ax+this.w/2,this.ay+this.h/2+1,this.w-6,"center",en?THEME.text:THEME.textDim);
	}
	processEvent(pevt) {
		if (pevt.type===e_down && pevt.button===0 && this.isEnabled()) {
			this.pressed=true; invalidate();
			WM.setCapture({
				move:()=>{},
				up:(e)=>{ this.pressed=false; invalidate(); if (this.contains(e.x,e.y) && this.callback) this.callback(); }
			});
			return true;
		}
		return pevt.type===e_down || pevt.type===e_up;
	}
}

class Label extends Area {
	constructor(ptext,px,py,pw,ph,opts={}) {
		super(px,py,pw,ph||18);
		this.class="Label";
		this.text=ptext;       // string or function
		this.font=opts.font||THEME.font;
		this.color=opts.color||THEME.text;
		this.align=opts.align||"left";
	}
	paint() {
		const t=typeof this.text==="function" ? this.text() : this.text;
		const x=this.align==="center" ? this.ax+this.w/2 : this.align==="right" ? this.ax+this.w-2 : this.ax+2;
		c.fitText(t,x,this.ay+this.h/2+1,this.w-4,this.align,this.color,this.font);
	}
}

// one-line text input; editing happens in a real <textarea> placed over the canvas
class TextField extends Area {
	constructor(pvalue,px,py,pw,ph,opts={}) {
		super(px,py,pw,ph||22);
		this.class="TextField";
		this.value=pvalue;
		this.placeholder=opts.placeholder||"";
		this.onEnter=opts.onEnter||null;
		this.onChange=opts.onChange||null;    // called when an edit is committed with a new value
		this.keepAfterEnter=!!opts.keepAfterEnter;
		this.cursor="text";
	}
	paint() {
		c.fillRect(this.ax,this.ay,this.w,this.h,"#ffffff");
		c.rect(this.ax+0.5,this.ay+0.5,this.w-1,this.h-1,WM.editing&&WM.editing.owner===this?THEME.select:"#9aa3ad");
		if (this.value==="") c.fitText(this.placeholder,this.ax+5,this.ay+this.h/2+1,this.w-8,"left",THEME.textDim);
		else c.fitText(this.value,this.ax+5,this.ay+this.h/2+1,this.w-8,"left",THEME.text,THEME.fontMono);
	}
	edit() {
		this.absolute();
		WM.editText({
			owner:this, x:this.ax, y:this.ay, w:this.w, h:this.h, value:this.value, font:THEME.fontMono,
			onCommit:(v)=>{ const old=this.value; this.value=v; if (this.onChange && v!==old) this.onChange(v); },
			onEnter:(v)=>{ this.value=v; if (this.onEnter) this.onEnter(v); if (this.keepAfterEnter) setTimeout(()=>this.edit(),0); },
		});
	}
	processEvent(pevt) {
		if (pevt.type===e_down) { this.edit(); return true; }
		return pevt.type===e_up;
	}
}

// scrollable list of strings / objects
class ListView extends Area {
	constructor(px,py,pw,ph,opts={}) {
		super(px,py,pw,ph);
		this.class="ListView";
		this.items=opts.items||(()=>[]);   // function -> [{text, color, data}]
		this.rowH=opts.rowH||18;
		this.scroll=0;
		this.selected=-1;
		this.onSelect=opts.onSelect||null;
		this.onDbl=opts.onDbl||null;
		this.onCtx=opts.onCtx||null;
		this.font=opts.font||THEME.font;
		this.stickBottom=!!opts.stickBottom;
	}
	paint() {
		const items=this.items();
		c.fillRect(this.ax,this.ay,this.w,this.h,"#ffffff");
		const maxScroll=Math.max(0,items.length*this.rowH-this.h+4);
		if (this.stickBottom && this.atBottom!==false) this.scroll=maxScroll;
		this.scroll=Math.max(0,Math.min(this.scroll,maxScroll));
		items.forEach((it,i)=>{
			const y=this.ay+2+i*this.rowH-this.scroll;
			if (y+this.rowH<this.ay || y>this.ay+this.h) return;
			if (i===this.selected) c.fillRect(this.ax,y,this.w,this.rowH,"#dbe7f7");
			c.fitText(it.text,this.ax+5,y+this.rowH/2+1,this.w-10,"left",it.color||THEME.text,it.font||this.font);
		});
		c.rect(this.ax+0.5,this.ay+0.5,this.w-1,this.h-1,"#b5bcc5");
	}
	rowAt(py) { return Math.floor((py-this.ay-2+this.scroll)/this.rowH); }
	processEvent(pevt) {
		const items=this.items();
		if (pevt.type===e_wheel) {
			this.scroll+=pevt.deltaY>0?this.rowH*3:-this.rowH*3;
			const maxScroll=Math.max(0,items.length*this.rowH-this.h+4);
			this.atBottom=this.scroll>=maxScroll;
			invalidate(); return true;
		}
		const r=this.rowAt(pevt.y);
		if (pevt.type===e_down || pevt.type===e_ctx) {
			if (r>=0 && r<items.length) { this.selected=r; if (this.onSelect) this.onSelect(items[r],r); }
			if (pevt.type===e_ctx && this.onCtx) this.onCtx(r>=0&&r<items.length?items[r]:null,pevt);
			invalidate(); return true;
		}
		if (pevt.type===e_dbl && r>=0 && r<items.length && this.onDbl) { this.onDbl(items[r],r); return true; }
		return false;
	}
}

/* ------------------------------------------------------------------ */
/* window parts                                                         */
/* ------------------------------------------------------------------ */
class MoveBar extends Area {
	constructor(pwin) {
		super(0,0,0,ddhead);
		this.class="MoveBar";
		this.win=pwin;
		this.cursor="move";
	}
	processEvent(pevt) {
		const win=this.win;
		if (pevt.type===e_dbl) { win.toggleCollapse(); return true; }
		if (pevt.type===e_down && pevt.button===0 && win.movable) {
			const sx=pevt.x, sy=pevt.y, wx=win.x, wy=win.y;
			WM.setCapture({
				cursor:"move",
				move:(e)=>{ win.moveTo(wx+e.x-sx, wy+e.y-sy); },
				up:()=>{}
			});
			return true;
		}
		return false;
	}
}

class TitleButton extends Area {
	constructor(pkind,pwin) {
		super(0,0,ddhead,ddhead);
		this.class="TitleButton";
		this.kind=pkind;          // "close" | "collapse"
		this.win=pwin;
		this.cursor="pointer";
		this.tooltip = pkind==="close" ? "Close" : "Collapse / expand";
	}
	paint() {
		const col=this.win.isActive()?THEME.titleTextActive:THEME.titleText;
		if (this.isHover()) c.fillRect(this.ax+2,this.ay+2,this.w-4,this.h-4,"rgba(255,255,255,0.35)");
		if (this.kind==="close") c.cross(this.ax,this.ay,this.w,this.h,col);
		else if (this.win.collapsed) c.triangleDown(this.ax,this.ay,this.w,this.h,col);
		else c.triangleUp(this.ax,this.ay,this.w,this.h,col);
	}
	processEvent(pevt) {
		if (pevt.type===e_down && pevt.button===0) {
			WM.setCapture({ move:()=>{}, up:(e)=>{
				if (!this.contains(e.x,e.y)) return;
				if (this.kind==="close") this.win.close(); else this.win.toggleCollapse();
			}});
			return true;
		}
		return false;
	}
}

class TitleBar extends Area {
	constructor(pwin,ptitle,pclosable) {
		super(0,0,pwin.w,ddhead);
		this.class="TitleBar";
		checkClosable(this,pclosable);
		this.win=pwin;
		this.closable=pclosable;
		this.title=ptitle;
		this.moveBar=this.push(new MoveBar(pwin));
		this.closeBox=null; this.openClose=null;
		if (pclosable===CLOSABLE) {
			this.closeBox=this.push(new TitleButton("close",pwin));
			this.openClose=this.push(new TitleButton("collapse",pwin));
		}
	}
	layout() {
		let right=this.w;
		if (this.closeBox) { right-=ddhead; this.closeBox.set(right,0,ddhead,ddhead); }
		if (this.openClose) { right-=ddhead; this.openClose.set(right,0,ddhead,ddhead); }
		this.moveBar.set(0,0,right,ddhead);
	}
	paint() {
		const active=this.win.isActive();
		c.fillRect(this.ax,this.ay,this.w,this.h,active?THEME.titleActive:THEME.title);
		const t=typeof this.title==="function"?this.title():this.title;
		c.fitText(t,this.ax+7,this.ay+ddhead/2+1,this.moveBar.w-10,"left",active?THEME.titleTextActive:THEME.titleText,THEME.fontBold);
	}
}

class ResizeArea extends Area {
	constructor(pwin) {
		super(0,0,ddpad,ddpad);
		this.class="Resize";
		this.win=pwin;
		this.cursor="nwse-resize";
	}
	processEvent(pevt) {
		if (pevt.type===e_down && pevt.button===0) {
			const sx=pevt.x, sy=pevt.y, w0=this.win.w, h0=this.win.h;
			WM.setCapture({ cursor:"nwse-resize", move:(e)=>{ this.win.setSize(w0+e.x-sx,h0+e.y-sy); }, up:()=>{} });
			return true;
		}
		return false;
	}
	paint() {
		const x=this.ax+this.w, y=this.ay+this.h;
		for (let k=4;k<=12;k+=4) c.line(x-k-1,y-2,k-1+2,-k+1-2+2,"#8a9099");
	}
}

class ClientArea extends Area {
	constructor(pwin,presizable) {
		super(0,ddhead,pwin.w,pwin.h-ddhead);
		this.class="ClientArea";
		checkResizable(this,presizable);
		this.win=pwin;
		this.resizable=presizable;
		this.background=THEME.win;
		this.resizeArea=null;
		if (presizable===RESIZABLE) this.resizeArea=new ResizeArea(pwin);
	}
	layout() {
		if (this.resizeArea) {
			// keep grip as the last child => always on top of the content
			this.push(this.resizeArea);
			this.resizeArea.set(this.w-ddpad,this.h-ddpad,ddpad,ddpad);
		}
		this.children.forEach(ch=>{ if (ch.fill) { ch.set(ch.fill.l||0, ch.fill.t||0, this.w-(ch.fill.l||0)-(ch.fill.r||0), this.h-(ch.fill.t||0)-(ch.fill.b||0)); ch.layout(); } });
	}
	push(o) {
		const r=super.push(o);
		if (this.resizeArea && o!==this.resizeArea) super.push(this.resizeArea);
		return r;
	}
	paint() { if (this.background) c.fillRect(this.ax,this.ay,this.w,this.h,this.background); }
}

/* ------------------------------------------------------------------ */
class Window extends Area {
	constructor(ptitle,prect,pclosable=CLOSABLE,presizable=RESIZABLE,opts={}) {
		super(prect.x,prect.y,prect.w,prect.h);
		this.class="Window";
		this.movable=opts.movable!==false;
		this.closeAction=opts.closeAction||"hide";   // "hide" | "destroy"
		this.minW=opts.minW||120; this.minH=opts.minH||ddhead*2+10;
		this.collapsed=false;
		this.menuBar=null;
		this.titleBar=super.push(new TitleBar(this,ptitle,pclosable));
		this.clientArea=super.push(new ClientArea(this,presizable));
		this.onClose=null;
		this.layout();
	}
	get title() { return this.titleBar.title; }
	set title(t) { this.titleBar.title=t; invalidate(); }
	push(o) { return this.clientArea.push(o); }
	addMenu(pmenu) {
		this.menuBar=pmenu;
		pmenu.win=this;
		super.push(pmenu);
		this.children=[this.titleBar,this.menuBar,this.clientArea];
		this.layout();
	}
	layout() {
		this.titleBar.set(0,0,this.w,ddhead);
		this.titleBar.layout();
		let y=ddhead;
		if (this.menuBar) { this.menuBar.set(0,y,this.w,ddhead+2); this.menuBar.layout(); y+=ddhead+2; }
		this.clientArea.set(0,y,this.w,Math.max(0,this.h-y));
		this.clientArea.visible=!this.collapsed;
		if (this.menuBar) this.menuBar.visible=!this.collapsed;
		this.clientArea.layout();
		this.onLayout();
		invalidate();
	}
	onLayout() {}
	setSize(pw,ph) {
		this.w=Math.max(this.minW,Math.round(pw));
		this.h=Math.max(this.minH,Math.round(ph));
		this.collapsed=false;
		this.layout();
	}
	moveTo(px,py) {
		// keep the title bar reachable inside the father's client area
		const f=this.father;
		if (f) {
			px=Math.max(-this.w+60,Math.min(px,f.w-40));
			py=Math.max(0,Math.min(py,f.h-ddhead));
		}
		this.x=Math.round(px); this.y=Math.round(py);
		invalidate();
	}
	move(px,py) { this.moveTo(this.x+px,this.y+py); }      // 2019 API
	resize(pw,ph) { this.setSize(this.w+pw,this.h+ph); }   // 2019 API
	toggleCollapse() {
		if (!this.collapsed) { this.expandedH=this.h; this.collapsed=true; this.h=ddhead; }
		else { this.collapsed=false; this.h=this.expandedH||this.h; }
		this.layout();
	}
	isActive() { return WM.active===this; }
	activate() {
		for (let w=this; w && w.father; w=w.father) {
			if (w instanceof Window && w.father) w.father.bringFwd(w);
		}
		WM.active=this;
		invalidate();
	}
	show() {
		this.visible=true;
		if (this.collapsed) this.toggleCollapse();
		this.activate();
	}
	close() {
		if (this.onClose && this.onClose()===false) return;
		if (this.closeAction==="destroy" && this.father) this.father.remove(this);
		else this.visible=false;
		if (WM.active===this || (WM.active && WM.active.isDescendantOf(this))) WM.active=null;
		invalidate();
	}
	dispatch(pevt) {
		if (!this.visible) return false;
		if (pevt.type===e_down || pevt.type===e_ctx) {
			// the innermost window under the mouse becomes active and comes to front
			const inner=this.hitWindow(pevt.x,pevt.y);
			if (inner===this) this.activate();
		}
		super.dispatch(pevt);
		return true;     // a window is opaque: nothing below it gets the event
	}
	hitWindow(px,py) {
		for (let a=this.hit(px,py); a; a=a.father) if (a instanceof Window) return a;
		return this;
	}
	draw() {
		if (!this.visible) return;
		this.absolute();
		if (this.father) c.fillRect(this.ax+3,this.ay+3,this.w,this.h,THEME.shadow);
		super.draw();
		c.rect(this.ax+0.5,this.ay+0.5,this.w-1,this.h-1,this.isActive()?"#2f5a88":THEME.border);
	}
	onKey(kevt) { return false; }
}

/* ------------------------------------------------------------------ */
/* menus                                                                */
/* ------------------------------------------------------------------ */
class MenuItem extends Area {
	constructor(pcaption,pcallback=null,opts={}) {
		super(0,0,Math.ceil(c.measure(pcaption)),ddhead+2);
		this.class="MenuItem";
		this.caption=pcaption;
		this.callback=pcallback;
		this.key=opts.key||"";
		this.enabled=opts.enabled||null;
		this.checked=opts.checked||null;
		this.separator=pcaption==="-";
		if (this.separator) this.h=7;
	}
	addCallback(pcallback) { this.callback=pcallback; }
	isEnabled() { return !this.separator && (this.enabled ? this.enabled() : true); }
	paint() {
		if (this.separator) { c.line(this.ax+4,this.ay+3.5,this.w-8,0,"#c2c7ce"); return; }
		const en=this.isEnabled(), hi=en&&this.isHover();
		if (hi) c.fillRect(this.ax,this.ay,this.w,this.h,THEME.menuHi);
		const col=hi?THEME.menuHiText:(en?THEME.text:THEME.textDim);
		if (this.checked && this.checked()) c.fillText("✓",this.ax+6,this.ay+this.h/2+1,"left",col);
		c.fillText(this.caption,this.ax+ddpad+4,this.ay+this.h/2+1,"left",col);
		if (this.key) c.fillText(this.key,this.ax+this.w-8,this.ay+this.h/2+1,"right",hi?col:THEME.textDim,THEME.fontSmall);
	}
	processEvent(pevt) {
		if ((pevt.type===e_up || pevt.type===e_down) && pevt.button===0 && this.isEnabled()) {
			if (pevt.type===e_up && this.father && this.father.openedAt && performance.now()-this.father.openedAt<200) return true;
			WM.closePopups();
			if (this.callback) this.callback();
			invalidate();
			return true;
		}
		return true;
	}
}

class MenuPopupArea extends Area {
	constructor() {
		super(0,0,2*ddpad,6);
		this.class="MenuPopupArea";
		this.lasty=3;
	}
	addMenuItem(pmenuitem) {
		this.push(pmenuitem);
		pmenuitem.x=0; pmenuitem.y=this.lasty;
		this.lasty+=pmenuitem.h;
		this.h=this.lasty+3;
		this.fitWidth();
		return pmenuitem;
	}
	fitWidth() {
		let w=120;
		this.children.forEach(m=>{ w=Math.max(w,2*ddpad+8+Math.ceil(c.measure(m.caption))+(m.key?Math.ceil(c.measure(m.key,THEME.fontSmall))+24:0)); });
		this.w=w;
		this.children.forEach(m=>{ m.w=w; });
	}
	paint() {
		c.fillRect(this.ax+3,this.ay+3,this.w,this.h,THEME.shadow);
		c.fillRect(this.ax,this.ay,this.w,this.h,"#ffffff");
	}
	paintOver() { c.rect(this.ax+0.5,this.ay+0.5,this.w-1,this.h-1,THEME.border); }
	draw() {
		// shadow needs to be outside the clip
		this.absolute();
		c.fillRect(this.ax+3,this.ay+3,this.w,this.h,THEME.shadow);
		super.draw();
	}
	openAt(px,py) {
		this.fitWidth();
		px=Math.max(0,Math.min(px,WM.root.w-this.w-4));
		if (py+this.h>WM.root.h) py=Math.max(0,WM.root.h-this.h-4);
		this.x=px; this.y=py;
		this.openedAt=performance.now();
		WM.overlay.push(this);
		invalidate();
	}
	processEvent(pevt) { return true; }
}

// a menu title in the menu bar with its popup
class MenuPopup extends MenuItem {
	constructor(pcaption) {
		super(pcaption);
		this.class="MenuPopup";
		this.popupArea=new MenuPopupArea();
		this.w=Math.ceil(c.measure(pcaption))+ddpad;
	}
	addMenuItem(pmenuitem) { return this.popupArea.addMenuItem(pmenuitem); }
	add(pcaption,pcallback,opts) { return this.addMenuItem(new MenuItem(pcaption,pcallback,opts)); }
	isOpen() { return this.popupArea.father===WM.overlay; }
	open() {
		WM.closePopups();
		if (this.build) {     // dynamic menu (e.g. list of windows)
			const pa=this.popupArea;
			pa.children.slice().forEach(ch=>pa.remove(ch));
			pa.lasty=3; pa.h=6;
			this.build(this);
		}
		this.absolute();
		this.popupArea.openAt(this.ax,this.ay+this.h);
		WM.openMenu=this;
	}
	paint() {
		const hi=this.isOpen()||this.isHover();
		if (hi) c.fillRect(this.ax,this.ay+1,this.w,this.h-2,this.isOpen()?THEME.menuHi:THEME.buttonHi);
		c.fillText(this.caption,this.ax+ddpad/2,this.ay+this.h/2+1,"left",this.isOpen()?THEME.menuHiText:THEME.text);
	}
	processEvent(pevt) {
		if (pevt.type===e_down) {
			if (this.isOpen()) WM.closePopups(); else this.open();
			invalidate();
			return true;
		}
		if (pevt.type===e_move && WM.openMenu && WM.openMenu!==this && WM.openMenu.father===this.father) {
			this.open();
			return true;
		}
		return true;
	}
}

class MenuBar extends Area {
	constructor() {
		super(0,0,0,0); // Window.addMenu will adjust Rect
		this.class="MenuBar";
		this.lastx=4;
	}
	addMenuItem(pmenuitem) {
		super.push(pmenuitem);
		pmenuitem.x=this.lastx; pmenuitem.y=0;
		this.lastx+=pmenuitem.w;
		return pmenuitem;
	}
	addMenu(pcaption) { return this.addMenuItem(new MenuPopup(pcaption)); }
	layout() { this.children.forEach(m=>{ m.h=this.h; }); }
	closeAll() { WM.closePopups(); }
	paint() {
		c.fillRect(this.ax,this.ay,this.w,this.h,THEME.menu);
		c.line(this.ax,this.ay+this.h-0.5,this.w,0,"#c2c7ce");    // line under the menubar
	}
}

// context menu: items = [{caption, action, key, enabled}] or "-"
function popupMenu(items,px,py) {
	WM.closePopups();
	const p=new MenuPopupArea();
	items.forEach(it=>{
		if (it==="-") p.addMenuItem(new MenuItem("-"));
		else if (it) p.addMenuItem(new MenuItem(it.caption,it.action,{key:it.key,enabled:it.enabled,checked:it.checked}));
	});
	if (p.children.length) p.openAt(px,py);
	return p;
}

/* ------------------------------------------------------------------ */
/* Workspace: the root window filling the canvas                        */
/* ------------------------------------------------------------------ */
class Workspace extends Window {
	constructor(ptitle,prect) {
		super(ptitle,prect,NOTCLOSABLE,NOTRESIZABLE,{movable:false});
		this.class="Workspace";
		this.clientArea.background=THEME.desk;
	}
	isActive() { return true; }
	draw() {
		if (!this.visible) return;
		this.absolute();
		Area.prototype.draw.call(this);
	}
}

/* ------------------------------------------------------------------ */
/* the window manager singleton                                         */
/* ------------------------------------------------------------------ */
const WM = {
	root:null,
	overlay:null,
	capture:null,
	hover:null,
	active:null,
	openMenu:null,
	editing:null,
	modal:null,
	dirty:true,
	animations:[],
	allEvents:[],     // listeners getting every mouse event (e.g. x,y window)
	keyHandlers:[],   // global shortcuts: {key, ctrl, shift, action}
	mouse:{x:0,y:0},
	init(ptitle) {
		this.root=new Workspace(ptitle,new Rect(0,0,canvas.clientWidth,canvas.clientHeight));
		this.overlay=new Area(0,0,this.root.w,this.root.h);
		this.overlay.class="Overlay";
		requestAnimationFrame(renderFrame);
		return this.root;
	},
	resize(pw,ph) {
		this.root.setSize(pw,ph);
		this.overlay.set(0,0,pw,ph);
		this.windows().forEach(w=>{ if (w.father) w.moveTo(w.x,w.y); });
	},
	setCapture(pcap) { this.capture=pcap; },
	closePopups() {
		this.overlay.children.slice().forEach(ch=>{ if (ch instanceof MenuPopupArea) this.overlay.remove(ch); });
		this.openMenu=null;
		invalidate();
	},
	// all Window objects inside the workspace (depth first)
	windows(from=this.root.clientArea,acc=[]) {
		from.children.forEach(ch=>{
			if (ch instanceof Window) acc.push(ch);
			if (ch.children) this.windows(ch,acc);
		});
		return acc;
	},
	handle(pevt) {
		this.mouse.x=pevt.x; this.mouse.y=pevt.y;
		this.allEvents.forEach(f=>f(pevt));
		if (this.editing && (pevt.type===e_down||pevt.type===e_ctx)) this.commitEdit();
		if (this.capture) {
			if (pevt.type===e_move) { this.capture.move(pevt); invalidate(); return; }
			if (pevt.type===e_up) { const cap=this.capture; this.capture=null; cap.up(pevt); invalidate(); return; }
		}
		if (this.drag && pevt.type===e_move) { this.drag.x=pevt.x; this.drag.y=pevt.y; invalidate(); }
		// hover (for highlight + cursor)
		if (pevt.type===e_move || pevt.type===e_down) {
			const target=this.overlay.hit(pevt.x,pevt.y)||this.root.hit(pevt.x,pevt.y);
			const h=target===this.overlay?null:target;
			if (h!==this.hover) {
				this.hover=h; this.hoverSince=performance.now(); invalidate();
				if (h && h.tooltip) setTimeout(invalidate,650);
			}
			let cur="default";
			for (let a=h; a; a=a.father) if (a.cursor) { cur=a.cursor; break; }
			canvas.style.cursor=cur;
		}
		// popups first
		if (this.overlay.children.some(ch=>ch instanceof MenuPopupArea)) {
			for (let i=this.overlay.children.length-1;i>=0;i--) {
				const ch=this.overlay.children[i];
				if (ch.visible && ch.contains(pevt.x,pevt.y)) { ch.dispatch(pevt); return; }
			}
			if (pevt.type===e_down || pevt.type===e_ctx) {
				// click outside: close; a click on another menu title is still delivered
				const t=this.root.hit(pevt.x,pevt.y);
				this.closePopups();
				if (!(t instanceof MenuPopup)) return;
			}
			else if (pevt.type!==e_move) return;
		}
		if (this.modal && this.modal.visible) {
			if (!this.modal.contains(pevt.x,pevt.y)) { if (pevt.type===e_down) this.modal.activate(); return; }
			this.modal.dispatch(pevt); return;
		}
		this.root.dispatch(pevt);
	},
	handleKey(kevt) {
		if (this.editing) return false;
		if (kevt.key==="Escape" && this.overlay.children.length) { this.closePopups(); return true; }
		for (let w=this.active; w; w=w.father) if (w.onKey && w.onKey(kevt)) { invalidate(); return true; }
		// e.g. Delete right after dropping a symbol from the palette
		if (this.lastView && !this.modal && this.lastView.treeVisible() && this.lastView.onKey(kevt)) { invalidate(); return true; }
		for (const k of this.keyHandlers) {
			if (k.key.toLowerCase()===kevt.key.toLowerCase() && !!k.ctrl===!!(kevt.ctrlKey||kevt.metaKey) && !!k.shift===!!kevt.shiftKey) {
				k.action(); invalidate(); return true;
			}
		}
		return false;
	},
	addKey(key,action,ctrl=false,shift=false) { this.keyHandlers.push({key,action,ctrl,shift}); },

	// ---- in-place text editing with a real <textarea> over the canvas ----
	editText(o) {
		this.commitEdit();
		const ta=document.createElement("textarea");
		ta.value=o.value||"";
		ta.spellcheck=false;
		const r=canvas.getBoundingClientRect();
		Object.assign(ta.style,{
			position:"fixed", left:(r.left+o.x)+"px", top:(r.top+o.y)+"px",
			width:Math.max(40,o.w)+"px", height:Math.max(20,o.h)+"px",
			font:o.font||THEME.font, textAlign:o.align||"left",
			padding:"2px 4px", margin:"0", boxSizing:"border-box",
			border:"2px solid "+THEME.select, borderRadius:"2px", outline:"none",
			resize:"none", overflow:"hidden", background:"#ffffff", zIndex:10,
			whiteSpace:o.multiline?"pre-wrap":"nowrap", lineHeight:o.multiline?"1.25":((Math.max(20,o.h)-8)+"px"),
		});
		document.body.appendChild(ta);
		const ed={ ta, owner:o.owner, o, done:false };
		this.editing=ed;
		ta.addEventListener("keydown",(e)=>{
			e.stopPropagation();
			if (e.key==="Escape") { e.preventDefault(); this.finishEdit(false); }
			else if (e.key==="Enter" && !(o.multiline && e.shiftKey)) {
				e.preventDefault();
				const v=ta.value;
				this.finishEdit(true);
				if (o.onEnter) o.onEnter(v);
			}
			else if (e.key==="Tab") { e.preventDefault(); this.finishEdit(true); }
		});
		ta.addEventListener("blur",()=>{ if (this.editing===ed) this.finishEdit(true); });
		setTimeout(()=>{ ta.focus(); if (o.selectAll!==false) ta.select(); },0);
		invalidate();
	},
	finishEdit(commit) {
		const ed=this.editing;
		if (!ed || ed.done) return;
		ed.done=true;
		this.editing=null;
		const v=ed.ta.value;
		ed.ta.remove();
		if (commit) { if (ed.o.onCommit) ed.o.onCommit(v); }
		else if (ed.o.onCancel) ed.o.onCancel();
		invalidate();
	},
	commitEdit() { if (this.editing) this.finishEdit(true); },

	// ---- simple dialogs ----
	message(ptitle,ptext,pw=420) {
		const lines=String(ptext).split("\n");
		const h=ddhead+24+lines.length*18+44;
		const d=new Window(ptitle,new Rect(0,0,pw,h),CLOSABLE,NOTRESIZABLE,{closeAction:"destroy"});
		lines.forEach((l,i)=>d.push(new Label(l,12,10+i*18,pw-24,18)));
		d.push(new Button("OK",pw-80,h-ddhead-34,64,24,()=>d.close()));
		this.showDialog(d);
		d.onKey=(k)=>{ if (k.key==="Enter"||k.key==="Escape") { d.close(); return true; } return false; };
		return d;
	},
	prompt(ptitle,plabel,pvalue,pcallback,pw=360) {
		const h=ddhead+100;
		const d=new Window(ptitle,new Rect(0,0,pw,h),CLOSABLE,NOTRESIZABLE,{closeAction:"destroy"});
		d.push(new Label(plabel,12,8,pw-24,18));
		const tf=d.push(new TextField(pvalue,12,30,pw-24,24));
		const ok=()=>{ const v=tf.value; d.close(); pcallback(v); };
		tf.onEnter=()=>ok();
		d.push(new Button("OK",pw-160,h-ddhead-34,68,24,()=>{ this.commitEdit(); ok(); }));
		d.push(new Button("Cancel",pw-84,h-ddhead-34,72,24,()=>{ this.finishEdit(false); d.close(); }));
		this.showDialog(d);
		setTimeout(()=>tf.edit(),0);
		return d;
	},
	confirm(ptitle,ptext,pcallback,pw=380) {
		const h=ddhead+90;
		const d=new Window(ptitle,new Rect(0,0,pw,h),CLOSABLE,NOTRESIZABLE,{closeAction:"destroy"});
		d.push(new Label(ptext,12,12,pw-24,18));
		d.push(new Button("Yes",pw-160,h-ddhead-34,68,24,()=>{ d.close(); pcallback(); }));
		d.push(new Button("No",pw-84,h-ddhead-34,72,24,()=>d.close()));
		this.showDialog(d);
		return d;
	},
	showDialog(d) {
		const ca=this.root.clientArea;
		ca.push(d);
		d.moveTo((ca.w-d.w)/2,Math.max(20,(ca.h-d.h)/3));
		this.modal=d;
		const prevClose=d.onClose;
		d.onClose=()=>{ if (this.modal===d) this.modal=null; return prevClose?prevClose():true; };
		d.activate();
	},
};

function invalidate() { WM.dirty=true; }

function renderFrame(ts) {
	const anim=WM.animations.length>0;
	if (WM.dirty || anim) {
		WM.dirty=false;
		ctx.setTransform(DPR,0,0,DPR,0,0);
		ctx.clearRect(0,0,canvas.width,canvas.height);
		WM.root.draw();
		WM.overlay.draw();
		if (WM.drag && WM.drag.paint) WM.drag.paint(WM.drag.x,WM.drag.y);
		const now=performance.now();
		WM.animations=WM.animations.filter(a=>{
			const t=(now-a.t0)/a.dur;
			if (t>=1) { if (a.done) a.done(); invalidate(); return false; }
			a.paint(Math.max(0,t));
			return true;
		});
		const hv=WM.hover;
		if (hv && hv.tooltip && !WM.capture && WM.hoverSince && now-WM.hoverSince>600) paintTooltip(hv.tooltip);
	}
	requestAnimationFrame(renderFrame);
}

function paintTooltip(t) {
	const w=c.measure(t,THEME.fontSmall)+12;
	let x=WM.mouse.x+12, y=WM.mouse.y+18;
	x=Math.min(x,WM.root.w-w-2);
	c.fillRect(x,y,w,18,"#fffbe0");
	c.rect(x+0.5,y+0.5,w-1,17,"#a09a70");
	c.fillText(t,x+6,y+10,"left",THEME.text,THEME.fontSmall);
}

/* ------------------------------------------------------------------ */
/* 2019 sanity checks, kept                                            */
/* ------------------------------------------------------------------ */
function checkString(o,pstring) {
	if (typeof pstring!=="string") { console.warn("string error:",pstring,o); }
}
function checkInteger(o,pint) {
	if (!(typeof pint==="number" && Math.floor(2*pint)===2*pint)) { console.warn("integer error:",pint,o); }
}
function checkClosable(o,pclosable) {
	if (![CLOSABLE,NOTCLOSABLE].includes(pclosable)) { console.warn("CLOSABLE error:",pclosable,o); }
}
function checkResizable(o,presizable) {
	if (![RESIZABLE,NOTRESIZABLE].includes(presizable)) { console.warn("RESIZABLE error:",presizable,o); }
}
